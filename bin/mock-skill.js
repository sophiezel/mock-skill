#!/usr/bin/env node
'use strict';

const path = require('path');

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [], flags: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          out.flags[key] = next;
          i++;
        } else {
          out.flags[key] = true;
        }
      }
    } else if (a.startsWith('-') && a.length === 2) {
      out.flags[a.slice(1)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function help() {
  console.log(`
mock-skill — generic zero-coupling frontend API mock (self-test + E2E)

Usage:
  mock-skill init [projectDir] [--name=slug] [--task=ID] [--related-from=path] [--adapter=name] [--force]
  mock-skill classify [--task=ID] [--related-from=path]
  mock-skill generate [--task=ID] [--force]
  mock-skill session start|stop [--name=slug] [--task=ID] [--mock-port=N] [--proxy-port=N] [--proxy-host=HOST] [--proxy=0|1] [--start-url=URL] [--no-auto-launch] [--scenario=NAME]
  mock-skill set-case <apiId> <caseId> [--task=ID]
  mock-skill set-scenario <name> [--name=slug]
  mock-skill smoke [--name=slug] [--ci] [--cases=...] [--scenario=NAME]
  mock-skill audit [--task=ID] [--api=host/path]
  mock-skill capture-merge [--name=slug] [--task=ID]
  mock-skill install | uninstall

Install:
  bash scripts/install.sh

Data:
  .data/projects/<projectSlug>/

Device (on-device WebView via Wi-Fi proxy, zero business-code change):
  mock-skill session start --proxy-host=0.0.0.0
  # then set phone Wi-Fi manual proxy to the printed LAN IP:port
`);
}

async function main() {
  const parsed = parseArgs(process.argv);
  const cmd = parsed._[0] || 'help';
  const rest = parsed._.slice(1);
  const f = parsed.flags;

  if (cmd === 'help' || f.help || f.h) {
    help();
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
      writeProjectConfig: Boolean(f['write-project-config']),
    });
    return;
  }

  if (cmd === 'classify') {
    const { inferApiUsage } = require('../scripts/infer-api-usage');
    const { classifyRequests, writeClassifyResult } = require('../scripts/classify-requests');
    const {
      resolveProjectSlug,
      ensureProjectDirs,
    } = require('../lib/paths');
    const {
      loadExistingContracts,
      listExistingMockKeys,
    } = require('../scripts/generate-mock');
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
    console.log(`[mock-skill] wrote ${file} (${result.roles.length} roles, ${result.conflicts.length} conflicts)`);
    return;
  }

  if (cmd === 'generate') {
    const { resolveProjectSlug, projectDataDir } = require('../lib/paths');
    const { generateMocks } = require('../scripts/generate-mock');
    const fs = require('fs');
    const path = require('path');
    const projectDir = process.cwd();
    const projectSlug = resolveProjectSlug(projectDir, f.name);
    const rolesFile = path.join(
      projectDataDir(projectSlug),
      'classify',
      'request-roles.json',
    );
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
    });
    console.log(`[mock-skill] generate`, gen);
    return;
  }

  if (cmd === 'session') {
    const sub = rest[0];
    if (sub === 'start') {
      const { startSession } = require('../scripts/start-session');
      await startSession({
        projectDir: process.cwd(),
        name: f.name,
        taskId: f.task || null,
        mockPort: f['mock-port'],
        proxyPort: f['proxy-port'],
        proxyHost: f['proxy-host'],
        proxy: f.proxy,
        startUrl: f['start-url'],
        autoLaunch: f['no-auto-launch'] ? false : undefined,
        scenario: f.scenario,
      });
      return;
    }
    if (sub === 'stop') {
      const { stopSession } = require('../scripts/stop-session');
      stopSession({
        projectDir: process.cwd(),
        name: f.name,
        taskId: f.task || null,
      });
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
    const { setScenario } = require('../scripts/set-scenario');
    setScenario({
      projectDir: process.cwd(),
      name: f.name,
      scenario: rest[0],
      taskId: f.task || null,
    });
    return;
  }

  if (cmd === 'smoke') {
    const { smokeCases } = require('../scripts/smoke-cases');
    if (f.scenario) {
      const { setScenario } = require('../scripts/set-scenario');
      setScenario({ projectDir: process.cwd(), name: f.name, scenario: f.scenario, taskId: f.task || null });
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
    const { resolveProjectSlug } = require('../lib/paths');
    const { captureMerge } = require('../scripts/capture-merge');
    const projectSlug = resolveProjectSlug(process.cwd(), f.name);
    captureMerge(projectSlug, { taskId: f.task || null });
    return;
  }

  help();
  process.exit(1);
}

main().catch((e) => {
  console.error(`[mock-skill] error: ${e.message}`);
  process.exit(1);
});
