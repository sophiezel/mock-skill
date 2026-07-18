#!/usr/bin/env node
'use strict';

const path = require('path');

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [], flags: {} };
  const multiKeys = new Set(['name', 'rules']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let key;
      let value;
      if (eq !== -1) {
        key = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        key = a.slice(2);
        if (key === 'rules') {
          const values = [];
          while (args[i + 1] && !args[i + 1].startsWith('-')) {
            values.push(args[++i]);
          }
          value = values.length ? values : true;
        } else {
          const next = args[i + 1];
          if (next && !next.startsWith('-')) {
            value = next;
            i++;
          } else {
            value = true;
          }
        }
      }
      if (multiKeys.has(key)) {
        const prev = out.flags[key];
        const add = Array.isArray(value)
          ? value
          : value === true
            ? []
            : String(value)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        if (Array.isArray(prev)) {
          out.flags[key] = prev.concat(add);
        } else if (prev != null && prev !== true) {
          out.flags[key] = [prev].concat(add);
        } else {
          out.flags[key] = add;
        }
      } else {
        out.flags[key] = value;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      out.flags[a.slice(1)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function help(full = false) {
  const primary = `
mock-skill — frontend API mock CLI (single proxy, multi catalog)

Primary:
  mock-skill init [projectDir] [--name=slug] [--task=ID] [--adapter=name] [--force] [--strict-usage]
  mock-skill start [--name=slug…] [--rules kw…] [--start-url=URL] [--scenario=NAME] [--proxy-host=HOST] [--mitm=1]
  mock-skill stop [--auto-merge]
  mock-skill rules list|use <kw…>|save <name> [--rules-dir=DIR]
  mock-skill scenario <name> [--name=slug]
  mock-skill smoke [--name=slug] [--ci] [--cases=...] [--scenario=NAME]

Optional (needs real upstream; not for E2E):
  mock-skill start --record [--name=slug…]
  mock-skill record | mock
  mock-skill merge [--name=slug]
`;

  const advanced = `
Advanced / legacy:
  mock-skill classify [--task=ID] [--related-from=path]
  mock-skill generate [--task=ID] [--force] [--overwrite-capture]
  mock-skill session start|stop [...]
  mock-skill set-case <apiId> <caseId>
  mock-skill set-scenario <name>
  mock-skill traffic <all-mock|all-passthrough|selective|allow|deny|list|clear> [stubId]
  mock-skill capture-merge [...]
  mock-skill list-empty [--gap=GAP] [--all]
  mock-skill import-openapi --from=<spec>
  mock-skill export-msw [--out=path]
  mock-skill audit [--task=ID] [--api=host/path]
  mock-skill install | uninstall

Session security:
  --allow-open-proxy   permit passthrough/CONNECT when binding 0.0.0.0 (default: reject)
  --mitm=1             enable HTTPS MITM for matched hosts (requires openssl; trust printed CA)

Flags:
  --name=a --name=b    mount multiple catalogs (or --name=a,b); omit = all catalogs
  --rules kw1 kw2      selective mock; with --record still selective (record passthrough only)
  --rules-dir=DIR      override rules directory (default: <pkg>/rules)
  --record             alone: all-passthrough; with --rules: record passthrough only
  --auto-merge         with stop: run capture-merge after stop
`;

  const footer = `
Install: bash scripts/install.sh
Catalog: .data/projects/<slug>/   Session: .data/session.json   Rules: rules/
Help:    mock-skill help --all
`;

  console.log(full ? primary + advanced + footer : primary + `\n  mock-skill help --all   # full command list\n` + footer);
}

function resolveStartTraffic(f) {
  const wantRecord = Boolean(f.record);
  const wantTraffic = f.traffic != null && f.traffic !== false && f.traffic !== '';
  const wantRules =
    f.rules != null &&
    f.rules !== false &&
    !(Array.isArray(f.rules) && f.rules.length === 0);
  if (wantRecord && wantTraffic) {
    throw new Error('--record and --traffic= are mutually exclusive');
  }
  // --rules wins over --record: stay selective; start-session enables recordMisses
  if (wantRules) {
    if (wantRecord) {
      console.log(
        '[mock-skill] --record with --rules: selective mock + record passthrough',
      );
    }
    return null;
  }
  if (wantRecord) {
    console.log(
      '[mock-skill] mode=record (all-passthrough; optional fidelity upgrade — not for E2E)',
    );
    return 'all-passthrough';
  }
  return wantTraffic ? f.traffic : null;
}

async function runSessionStart(f) {
  const { startSession } = require('../scripts/start-session');
  const traffic = resolveStartTraffic(f);
  const wantRules =
    f.rules != null &&
    f.rules !== false &&
    !(Array.isArray(f.rules) && f.rules.length === 0);
  await startSession({
    projectDir: process.cwd(),
    name: f.name,
    names: f.name,
    rules: f.rules,
    rulesDir: f['rules-dir'],
    taskId: f.task || null,
    mockPort: f['mock-port'],
    proxyPort: f['proxy-port'],
    proxyHost: f['proxy-host'],
    proxy: f.proxy,
    startUrl: f['start-url'],
    autoLaunch: f['no-auto-launch'] ? false : undefined,
    scenario: f.scenario,
    allowOpenProxy: Boolean(f['allow-open-proxy']),
    mitm: f.mitm === true || f.mitm === '1' || f.mitm === 1,
    recordMockHits: Boolean(f['record-mock-hits']),
    record: Boolean(f.record) && wantRules,
    traffic,
  });
}

function runSessionStop(f) {
  const { stopSession } = require('../scripts/stop-session');
  stopSession({
    projectDir: process.cwd(),
    name: f.name,
    taskId: f.task || null,
    autoMerge: Boolean(f['auto-merge']),
  });
}

function runTraffic(f, action, stubId) {
  const { setTraffic } = require('../scripts/set-traffic');
  if (action === 'allow' || action === 'deny') {
    setTraffic({
      projectDir: process.cwd(),
      name: f.name,
      action,
      stubId,
    });
    return;
  }
  setTraffic({
    projectDir: process.cwd(),
    name: f.name,
    action: action || 'list',
  });
}

function runMerge(f) {
  const { resolveProjectSlug } = require('../lib/paths');
  const { captureMerge } = require('../scripts/capture-merge');
  const projectSlug = resolveProjectSlug(process.cwd(), f.name);
  captureMerge(projectSlug, {
    taskId: f.task || null,
    sanitize: f.sanitize !== false,
    sensitivePaths: f['sensitive-paths']
      ? String(f['sensitive-paths'])
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  });
}

function runScenario(f, scenario) {
  const { setScenario } = require('../scripts/set-scenario');
  setScenario({
    projectDir: process.cwd(),
    name: f.name,
    scenario,
    taskId: f.task || null,
  });
}

async function main() {
  const parsed = parseArgs(process.argv);
  const cmd = parsed._[0] || 'help';
  const rest = parsed._.slice(1);
  const f = parsed.flags;

  if (cmd === 'help' || f.help || f.h || f['help-all']) {
    help(
      Boolean(f.all) ||
        Boolean(f['help-all']) ||
        rest[0] === '--all' ||
        rest[0] === 'all',
    );
    return;
  }

  if (cmd === 'install') {
    const { spawnSync } = require('child_process');
    const sh = path.join(__dirname, '..', 'scripts', 'install.sh');
    const r = spawnSync('bash', [sh], { stdio: 'inherit' });
    process.exit(r.status || 0);
  }

  if (cmd === 'uninstall') {
    const { spawnSync } = require('child_process');
    const sh = path.join(__dirname, '..', 'scripts', 'uninstall.sh');
    const r = spawnSync('bash', [sh], { stdio: 'inherit' });
    process.exit(r.status || 0);
  }

  if (cmd === 'init') {
    const { initProject } = require('../scripts/init-project');
    await initProject({
      projectDir: rest[0] || process.cwd(),
      name: f.name,
      taskId: f.task || null,
      relatedFrom: f['related-from'] || null,
      adapter: f.adapter || null,
      force: Boolean(f.force),
      overwriteCapture: Boolean(f['overwrite-capture']),
      strictUsage: Boolean(f['strict-usage']),
      writeProjectConfig: Boolean(f['write-project-config']),
    });
    return;
  }

  if (cmd === 'classify') {
    const { inferApiUsage } = require('../scripts/infer-api-usage');
    const { classifyRequests, writeClassifyResult } = require('../scripts/classify-requests');
    const { resolveProjectSlug, ensureProjectDirs } = require('../lib/paths');
    const { loadExistingContracts, listExistingMockKeys } = require('../scripts/generate-mock');
    const projectDir = rest[0] || process.cwd();
    const projectSlug = resolveProjectSlug(projectDir, f.name);
    ensureProjectDirs(projectSlug);
    const apis = inferApiUsage(projectDir);
    const result = classifyRequests({
      apis,
      taskId: f.task || null,
      relatedFrom: f['related-from'] || null,
      existingMockKeys: listExistingMockKeys(projectSlug),
      existingContracts: loadExistingContracts(projectSlug),
    });
    const file = writeClassifyResult(projectSlug, result);
    console.log(
      `[mock-skill] wrote ${file} (${result.roles.length} roles, ${result.conflicts.length} conflicts)`,
    );
    return;
  }

  if (cmd === 'generate') {
    const { resolveProjectSlug, projectDataDir } = require('../lib/paths');
    const { generateMocks } = require('../scripts/generate-mock');
    const fs = require('fs');
    const projectDir = rest[0] || process.cwd();
    const projectSlug = resolveProjectSlug(projectDir, f.name);
    const rolesFile = path.join(projectDataDir(projectSlug), 'classify', 'request-roles.json');
    if (!fs.existsSync(rolesFile)) {
      throw new Error('no classify result — run mock-skill init or classify first');
    }
    const classified = JSON.parse(fs.readFileSync(rolesFile, 'utf8'));
    const gen = generateMocks({
      projectSlug,
      roles: classified.roles,
      conflicts: classified.conflicts || [],
      taskId: f.task || classified.taskId || null,
      force: Boolean(f.force),
      merge: !f.force,
      overwriteCapture: Boolean(f['overwrite-capture']),
    });
    console.log(`[mock-skill] generate`, gen);
    return;
  }

  // Intent aliases (primary track)
  if (cmd === 'start') {
    await runSessionStart(f);
    return;
  }
  if (cmd === 'stop') {
    runSessionStop(f);
    return;
  }
  if (cmd === 'rules') {
    const { runRules } = require('../scripts/rules-cli');
    const sub = rest[0] || 'list';
    if (sub === 'list') {
      runRules({ action: 'list', rulesDir: f['rules-dir'] });
      return;
    }
    if (sub === 'use') {
      runRules({
        action: 'use',
        keywords: rest.slice(1),
        rulesDir: f['rules-dir'],
      });
      return;
    }
    if (sub === 'save') {
      runRules({
        action: 'save',
        name: rest[1] || rest[0],
        rulesDir: f['rules-dir'],
      });
      return;
    }
    console.error('Usage: mock-skill rules list|use <kw…>|save <name>');
    process.exit(1);
  }
  if (cmd === 'scenario') {
    runScenario(f, rest[0]);
    return;
  }
  if (cmd === 'record') {
    runTraffic(f, 'all-passthrough');
    return;
  }
  if (cmd === 'mock') {
    runTraffic(f, 'all-mock');
    return;
  }
  if (cmd === 'merge') {
    runMerge(f);
    return;
  }

  if (cmd === 'session') {
    const sub = rest[0];
    if (sub === 'start') {
      await runSessionStart(f);
      return;
    }
    if (sub === 'stop') {
      runSessionStop(f);
      return;
    }
    console.error('Usage: mock-skill session start|stop');
    process.exit(1);
  }

  if (cmd === 'set-case') {
    const { setCase } = require('../scripts/set-case');
    setCase({
      projectDir: process.cwd(),
      name: f.name,
      apiId: rest[0],
      caseId: rest[1],
      taskId: f.task || null,
    });
    return;
  }

  if (cmd === 'set-scenario') {
    runScenario(f, rest[0]);
    return;
  }

  if (cmd === 'traffic') {
    const sub = rest[0];
    if (sub === 'allow' || sub === 'deny') {
      runTraffic(f, sub, rest.slice(1).join(' ') || rest[1]);
      return;
    }
    runTraffic(f, sub || 'list');
    return;
  }

  if (cmd === 'smoke') {
    const { smokeCases } = require('../scripts/smoke-cases');
    if (f.scenario) {
      runScenario(f, f.scenario);
    }
    await smokeCases({
      projectDir: process.cwd(),
      name: f.name,
      taskId: f.task || null,
      ci: Boolean(f.ci),
      cases: f.cases,
    });
    return;
  }

  if (cmd === 'audit') {
    const { resolveProjectSlug } = require('../lib/paths');
    const { readAudit } = require('../lib/audit');
    const projectSlug = resolveProjectSlug(process.cwd(), f.name);
    const rows = readAudit(projectSlug, { taskId: f.task, api: f.api });
    console.log(JSON.stringify(rows, null, 2));
    console.log(`[mock-skill] ${rows.length} audit rows`);
    return;
  }

  if (cmd === 'capture-merge') {
    runMerge(f);
    return;
  }

  if (cmd === 'list-empty') {
    const { resolveProjectSlug } = require('../lib/paths');
    const { listEmptyStubs, listByFidelity } = require('../lib/list-empty');
    const projectSlug = resolveProjectSlug(process.cwd(), f.name);
    if (f.all) {
      const grouped = listByFidelity(projectSlug);
      for (const lvl of ['L0', 'L1', 'L2', 'L3']) {
        console.log(`## ${lvl} (${grouped[lvl].length})`);
        for (const r of grouped[lvl]) {
          console.log(`- ${r.stubId}${r.gaps.length ? ` — ${r.gaps.join(',')}` : ''}`);
        }
      }
      return;
    }
    const rows = listEmptyStubs(projectSlug, { gap: f.gap || null });
    if (!rows.length) {
      console.log('[mock-skill] no empty stubs — all stubs have shape or capture');
      return;
    }
    console.log(`[mock-skill] ${rows.length} empty stub(s) needing capture-merge / import-openapi:`);
    for (const r of rows) {
      console.log(
        `- ${r.stubId} [${r.fidelity}]${r.gaps.length ? ` gaps=${r.gaps.join(',')}` : ''}${r.exportHint ? ` export=${r.exportHint}` : ''}`,
      );
      console.log(`    upgrade: ${r.upgradeHint}`);
    }
    return;
  }

  if (cmd === 'import-openapi') {
    const { importOpenApi } = require('../scripts/import-openapi');
    importOpenApi({
      projectDir: process.cwd(),
      name: f.name,
      from: f.from,
      taskId: f.task || null,
      force: Boolean(f.force),
    });
    return;
  }

  if (cmd === 'export-msw') {
    const { exportMsw } = require('../scripts/export-msw');
    exportMsw({
      projectDir: process.cwd(),
      name: f.name,
      out: f.out,
      taskId: f.task || null,
    });
    return;
  }

  console.error(`[mock-skill] unknown command: ${cmd}`);
  help();
  process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[mock-skill] error: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, resolveStartTraffic, help };
