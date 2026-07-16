'use strict';

/**
 * Fixture smoke pipeline (CI gate):
 *   init fixtures/generic-web → start mock → smoke --ci → set-scenario e2e-fault → smoke → stop
 * Exits non-zero on any failure. Designed to run against the bundled generic-web fixture
 * (axios + fetch, no company domain).
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { initProject } = require('./init-project');
const { startMockServer } = require('../runtime/mock-server/server');
const { startProxyServer } = require('../runtime/proxy/server');
const { smokeCases } = require('./smoke-cases');
const { setScenario } = require('./set-scenario');
const { loadSession } = require('../lib/session-config');
const { projectDataDir, ensureProjectDirs } = require('../lib/paths');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'generic-web');
const SLUG = 'generic-web-fixture';
const TASK_ID = 'fixture-smoke';

function reqProxy(proxyUrl, target) {
  return new Promise((resolve, reject) => {
    const u = new URL(proxyUrl);
    http
      .request(
        { hostname: u.hostname, port: u.port, path: target, method: 'GET' },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode }));
        },
      )
      .on('error', reject)
      .end();
  });
}

async function verifyScenarioViaProxy(proxyUrl, rules, expectedStatus) {
  let fails = 0;
  for (const rule of rules.slice(0, 6)) {
    const target = `http://${rule.host}${rule.pathPrefix}`;
    try {
      const res = await reqProxy(proxyUrl, target);
      if (res.status !== expectedStatus) {
        console.error(
          `[fixture-smoke]   ${target} -> ${res.status} (expected ${expectedStatus})`,
        );
        fails++;
      }
    } catch (e) {
      fails++;
    }
  }
  return fails;
}

async function run() {
  // 0. clean stale project data for a deterministic CI gate
  fs.rmSync(projectDataDir(SLUG), { recursive: true, force: true });

  // 1. init
  console.log('[fixture-smoke] init fixtures/generic-web');
  const initRes = await initProject({
    projectDir: FIXTURE_DIR,
    name: SLUG,
    taskId: TASK_ID,
    force: true,
  });
  console.log(
    `[fixture-smoke] discovered=${initRes.apis.length} generated=${initRes.gen.generated}`,
  );

  ensureProjectDirs(SLUG);
  const mocksRoot = path.join(projectDataDir(SLUG), 'mocks');
  if (!fs.existsSync(mocksRoot)) {
    throw new Error('no mocks generated for fixture');
  }

  // 2. start mock on a random port
  const port = 13900 + Math.floor(Math.random() * 1000);
  const srv = await startMockServer({
    mocksRoot,
    host: '127.0.0.1',
    port,
  });
  console.log(`[fixture-smoke] mock listening ${srv.url}`);

  let failed = 0;
  try {
    // 3. smoke --ci (uses session mock.host/port; override by saving session)
    const { saveSession } = require('../lib/session-config');
    saveSession(SLUG, { mock: { host: '127.0.0.1', port } });

    const r1 = await smokeCases({ name: SLUG, ci: true, taskId: TASK_ID });
    failed += r1.failed;
    console.log(`[fixture-smoke] smoke --ci: failed=${r1.failed}`);

    // 4. set-scenario e2e-fault → default http_500; verify via PROXY (no client case header)
    setScenario({ name: SLUG, scenario: 'e2e-fault' });
    const proxyPort = port + 1;
    const rulesPath = path.join(projectDataDir(SLUG), 'proxy-rules.json');
    const rules = fs.existsSync(rulesPath)
      ? JSON.parse(fs.readFileSync(rulesPath, 'utf8'))
      : [];
    const casesLoader = () => loadSession(SLUG).cases || { default: 'success', active: {} };
    const proxy = await startProxyServer({
      host: '127.0.0.1',
      port: proxyPort,
      mockTarget: srv.url,
      rules,
      cases: loadSession(SLUG).cases,
      casesLoader,
      caseHeader: 'x-mock-case',
    });
    console.log(`[fixture-smoke] proxy listening ${proxy.url}`);
    try {
      const faultFails = await verifyScenarioViaProxy(proxy.url, rules, 500);
      if (faultFails > 0) {
        console.error(`[fixture-smoke] e2e-fault: ${faultFails} APIs did NOT return 500 via proxy`);
        failed += faultFails;
      } else {
        console.log('[fixture-smoke] e2e-fault default=500 via proxy: verified');
      }

      // 5. set-scenario e2e-happy → default success → 200 via proxy
      setScenario({ name: SLUG, scenario: 'e2e-happy' });
      // clear casesLoader cache by waiting out TTL
      await new Promise((r) => setTimeout(r, 1100));
      const happyFails = await verifyScenarioViaProxy(proxy.url, rules, 200);
      if (happyFails > 0) {
        console.error(`[fixture-smoke] e2e-happy: ${happyFails} APIs did NOT return 200 via proxy`);
        failed += happyFails;
      } else {
        console.log('[fixture-smoke] e2e-happy default=200 via proxy: verified');
      }
    } finally {
      await proxy.close();
    }
  } finally {
    await srv.close();
  }

  if (failed > 0) {
    console.error(`[fixture-smoke] FAILED: ${failed} failures`);
    process.exitCode = 1;
  } else {
    console.log('[fixture-smoke] PASS');
  }
}

if (require.main === module) {
  run().catch((e) => {
    console.error(`[fixture-smoke] error: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  });
}

module.exports = { run };
