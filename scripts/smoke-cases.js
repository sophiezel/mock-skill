'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  resolveProjectSlug,
  projectDataDir,
  ensureProjectDirs,
} = require('../lib/paths');
const { loadSession } = require('../lib/session-config');
const { appendAudit } = require('../lib/audit');

const DEFAULT_SKIP_CASES = ['timeout', 'offline'];

function requestJson(url, headers = {}, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode, body, headers: res.headers });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function expectedStatusFor(caseId, contractCase) {
  return contractCase?.httpStatus || 200;
}

async function smokeCases(opts = {}) {
  const projectSlug = resolveProjectSlug(
    opts.projectDir || process.cwd(),
    opts.name,
  );
  ensureProjectDirs(projectSlug);
  const cfg = loadSession(projectSlug);
  const contractsDir = path.join(projectDataDir(projectSlug), 'contracts');
  if (!fs.existsSync(contractsDir)) {
    throw new Error('no contracts — run mock-skill init first');
  }

  const ci = Boolean(opts.ci);
  const includeCases = opts.cases
    ? new Set(opts.cases.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const skipCases = ci ? new Set(DEFAULT_SKIP_CASES) : new Set();

  const mockBase = `http://${cfg.mock.host}:${cfg.mock.port}`;
  const caseHeader = cfg.proxy?.injectCaseHeader || 'x-mock-case';
  const mocksRoot = path.join(projectDataDir(projectSlug), 'mocks');
  const results = [];
  let failed = 0;
  let skippedNoHandler = 0;

  function handlerExists(contract) {
    const host = (contract.host || '_default').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const rel = String(contract.path || '/').replace(/^\//, '');
    const candidates = [
      path.join(mocksRoot, host, rel, 'index.js'),
      path.join(mocksRoot, host.replace(/\./g, '_'), rel, 'index.js'),
      path.join(mocksRoot, '_default', rel, 'index.js'),
      path.join(mocksRoot, rel, 'index.js'),
    ];
    return candidates.some((p) => fs.existsSync(p));
  }

  for (const f of fs.readdirSync(contractsDir).filter((x) => x.endsWith('.json'))) {
    const contract = JSON.parse(
      fs.readFileSync(path.join(contractsDir, f), 'utf8'),
    );
    // Only smoke APIs that have materialized handlers (contracts-only / skippedEmpty excluded)
    if (!handlerExists(contract)) {
      skippedNoHandler++;
      continue;
    }
    const cases = contract.cases || [{ id: 'success', httpStatus: 200 }];
    for (const c of cases) {
      if (includeCases && !includeCases.has(c.id)) continue;
      if (!includeCases && skipCases.has(c.id)) continue;

      const url = `${mockBase}${contract.path}`;
      const expected = expectedStatusFor(c.id, c);
      try {
        const res = await requestJson(url, {
          [caseHeader]: c.id,
          'x-forwarded-host': contract.host === '_default' ? 'localhost' : contract.host,
          host: `${cfg.mock.host}:${cfg.mock.port}`,
        });
        const ok = ci ? res.status === expected : true;
        if (!ok) failed++;
        results.push({
          api: contract.id,
          caseId: c.id,
          status: res.status,
          expected,
          code: res.body?.code,
          ok,
        });
      } catch (e) {
        // timeout/offline cases are expected to error in ci
        const expectedError = skipCases.has(c.id);
        const ok = expectedError;
        if (!ok) failed++;
        results.push({
          api: contract.id,
          caseId: c.id,
          expected,
          ok,
          error: e.message,
        });
      }
    }
  }

  const report = path.join(
    projectDataDir(projectSlug),
    'reports',
    `smoke-${Date.now()}.md`,
  );
  const md = [
    '# smoke report',
    '',
    `- mock: ${mockBase}`,
    `- ci: ${ci}`,
    `- total: ${results.length}`,
    `- failed: ${failed}`,
    `- skippedNoHandler: ${skippedNoHandler}`,
    '',
    ...results.map(
      (r) =>
        `- ${r.ok ? 'OK' : 'FAIL'} ${r.api} case=${r.caseId} status=${r.status || '-'} expected=${r.expected} code=${r.code ?? r.error ?? '-'}`,
    ),
    '',
  ].join('\n');
  fs.writeFileSync(report, md);
  appendAudit(projectSlug, {
    command: 'smoke',
    taskId: opts.taskId || null,
    summary: `ci=${ci} total=${results.length} failed=${failed}`,
  });
  console.log(md);
  console.log(`[mock-skill] smoke report: ${report}`);
  if (ci && results.length === 0) {
    console.error('[mock-skill] smoke --ci: no handlers to smoke (all contracts skipped)');
    failed = failed || 1;
  }
  if (failed) process.exitCode = 1;
  return { results, failed, report, skippedNoHandler };
}

module.exports = { smokeCases };

if (require.main === module) {
  smokeCases({ projectDir: process.cwd() }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
