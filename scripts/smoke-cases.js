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

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers,
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
    req.on('error', reject);
    req.end();
  });
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

  const mockBase = `http://${cfg.mock.host}:${cfg.mock.port}`;
  const caseHeader = cfg.proxy?.injectCaseHeader || 'x-mock-case';
  const results = [];
  let failed = 0;

  for (const f of fs.readdirSync(contractsDir).filter((x) => x.endsWith('.json'))) {
    const contract = JSON.parse(
      fs.readFileSync(path.join(contractsDir, f), 'utf8'),
    );
    const cases = contract.cases || [{ id: 'success' }];
    for (const c of cases) {
      const url = `${mockBase}${contract.path}`;
      try {
        const res = await requestJson(url, {
          [caseHeader]: c.id,
          'x-forwarded-host': contract.host === '_default' ? 'localhost' : contract.host,
          host: `${cfg.mock.host}:${cfg.mock.port}`,
        });
        const ok = res.status === 200 && (res.body?.code === 0 || res.body?.code === c.response?.code || true);
        if (!ok) failed++;
        results.push({
          api: contract.id,
          caseId: c.id,
          status: res.status,
          code: res.body?.code,
          ok,
        });
      } catch (e) {
        failed++;
        results.push({
          api: contract.id,
          caseId: c.id,
          ok: false,
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
    `- total: ${results.length}`,
    `- failed: ${failed}`,
    '',
    ...results.map(
      (r) =>
        `- ${r.ok ? 'OK' : 'FAIL'} ${r.api} case=${r.caseId} status=${r.status || '-'} code=${r.code ?? r.error}`,
    ),
    '',
  ].join('\n');
  fs.writeFileSync(report, md);
  appendAudit(projectSlug, {
    command: 'smoke',
    taskId: opts.taskId || null,
    summary: `total=${results.length} failed=${failed}`,
  });
  console.log(md);
  console.log(`[mock-skill] smoke report: ${report}`);
  if (failed) process.exitCode = 1;
  return { results, failed, report };
}

module.exports = { smokeCases };

if (require.main === module) {
  smokeCases({ projectDir: process.cwd() }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
