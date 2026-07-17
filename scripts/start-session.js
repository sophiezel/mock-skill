'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const {
  resolveProjectSlug,
  ensureProjectDirs,
  projectDataDir,
  chromeProfileDir,
} = require('../lib/paths');
const { loadSession, saveRuntimeState, deepMerge } = require('../lib/session-config');
const { appendAudit } = require('../lib/audit');
const { startMockServer } = require('../runtime/mock-server/server');
const { startProxyServer } = require('../runtime/proxy/server');

function portFree(host, port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium',
  ];
  for (const c of candidates) {
    if (c.startsWith('/') && fs.existsSync(c)) return c;
    // bare name — hope PATH
    if (!c.startsWith('/')) return c;
  }
  return null;
}

const os = require('os');

function lanIp() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return null;
}

/** Bind may be 0.0.0.0 for LAN; Chrome/desktop proxy target must be loopback. */
function resolveClientProxyHost(bindHost) {
  if (!bindHost || bindHost === '0.0.0.0' || bindHost === '::') return '127.0.0.1';
  return bindHost;
}

/** Apply CLI overrides without mutating the loaded session object. */
function applySessionOpts(base, opts = {}) {
  const patch = {};
  if (opts.mockPort != null && opts.mockPort !== '') {
    patch.mock = { port: Number(opts.mockPort) };
  }
  if (opts.proxyPort != null && opts.proxyPort !== '') {
    patch.proxy = { ...(patch.proxy || {}), port: Number(opts.proxyPort) };
  }
  if (opts.proxyHost) {
    patch.proxy = { ...(patch.proxy || {}), host: opts.proxyHost };
  }
  if (opts.proxyEnabled === false || opts.proxy === '0' || opts.proxy === 0) {
    patch.proxy = { ...(patch.proxy || {}), enabled: false };
  }
  if (opts.proxyEnabled === true || opts.proxy === '1') {
    patch.proxy = { ...(patch.proxy || {}), enabled: true };
  }
  if (opts.startUrl) {
    patch.browser = { ...(patch.browser || {}), startUrl: opts.startUrl };
  }
  if (opts.autoLaunch === false) {
    patch.browser = { ...(patch.browser || {}), autoLaunch: false };
  }
  if (opts.allowOpenProxy === true || opts['allow-open-proxy'] === true) {
    patch.proxy = { ...(patch.proxy || {}), allowOpenProxy: true };
  }
  if (opts.mitm === true || opts.mitm === '1') {
    patch.proxy = { ...(patch.proxy || {}), mitm: { enabled: true } };
  }
  if (opts.recordMockHits === true) {
    patch.proxy = { ...(patch.proxy || {}), recordMockHits: true };
  }
  if (opts.mockPort != null || opts.proxyPort != null) {
    // already handled above
  }
  // Validate numeric ports
  if (patch.mock?.port != null && !Number.isFinite(patch.mock.port)) {
    throw new Error(`invalid --mock-port: ${opts.mockPort}`);
  }
  if (patch.proxy?.port != null && !Number.isFinite(patch.proxy.port)) {
    throw new Error(`invalid --proxy-port: ${opts.proxyPort}`);
  }
  return Object.keys(patch).length ? deepMerge(base, patch) : base;
}

async function startSession(opts = {}) {
  const projectDir = path.resolve(opts.projectDir || process.cwd());
  const projectSlug = resolveProjectSlug(projectDir, opts.name);
  const taskId = opts.taskId || null;
  ensureProjectDirs(projectSlug);

  let cfg = applySessionOpts(loadSession(projectSlug), opts);
  if (opts.scenario) {
    const { setScenario } = require('./set-scenario');
    setScenario({ projectDir, name: opts.name, scenario: opts.scenario, taskId });
    cfg = applySessionOpts(loadSession(projectSlug), opts);
  }

  const mockHost = cfg.mock.host || '127.0.0.1';
  const mockPort = cfg.mock.port || 3900;
  const proxyHost = cfg.proxy.host || '127.0.0.1';
  const proxyPort = cfg.proxy.port || 18999;

  if (!(await portFree(mockHost, mockPort))) {
    throw new Error(`mock port in use: ${mockHost}:${mockPort}`);
  }
  if (cfg.proxy.enabled && !(await portFree(proxyHost, proxyPort))) {
    throw new Error(`proxy port in use: ${proxyHost}:${proxyPort}`);
  }

  const mocksRoot = path.join(projectDataDir(projectSlug), 'mocks');
  const rulesPath = path.join(projectDataDir(projectSlug), 'proxy-rules.json');
  let rules = [];
  if (fs.existsSync(rulesPath)) {
    rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  }

  const mock = await startMockServer({
    mocksRoot,
    host: mockHost,
    port: mockPort,
    cors: cfg.cors,
    caseHeader: cfg.proxy.injectCaseHeader || 'x-mock-case',
  });
  console.log(`[mock-skill] mock ${mock.url}`);

  let proxy = null;
  if (cfg.proxy.enabled) {
    const casesLoader = () => {
      const live = loadSession(projectSlug);
      return live.cases || { default: 'success', active: {} };
    };
    const allowOpenProxy = Boolean(
      cfg.proxy.allowOpenProxy || opts.allowOpenProxy || opts['allow-open-proxy'],
    );
    let mitm = null;
    if (cfg.proxy.mitm?.enabled || opts.mitm === true || opts.mitm === '1') {
      try {
        const { createMitmCa } = require('../lib/mitm-ca');
        const ca = createMitmCa(projectSlug);
        mitm = {
          enabled: true,
          getSecureContext: (hostname) => ca.getSecureContext(hostname),
          caCertPath: ca.caCertPath,
        };
        console.log(`[mock-skill] HTTPS MITM enabled; trust CA: ${ca.caCertPath}`);
      } catch (e) {
        console.warn(`[mock-skill] MITM unavailable: ${e.message}`);
      }
    }
    const statefulLoader = () => {
      const live = loadSession(projectSlug);
      return live.stateful || null;
    };
    proxy = await startProxyServer({
      host: proxyHost,
      port: proxyPort,
      mockTarget: mock.url,
      rules,
      cors: cfg.cors,
      cases: cfg.cases,
      casesLoader,
      statefulLoader,
      caseHeader: cfg.proxy.injectCaseHeader || 'x-mock-case',
      missPolicy: cfg.proxy.missPolicy || 'passthrough',
      blockWritePassthrough: cfg.proxy.blockWritePassthrough !== false,
      passthroughHosts: cfg.proxy.passthroughHosts || [],
      recordMisses: cfg.proxy.recordMisses !== false,
      recordMockHits: Boolean(cfg.proxy.recordMockHits || opts.recordMockHits),
      allowOpenProxy,
      rejectUnauthorized: cfg.proxy.rejectUnauthorized !== false,
      mitm,
      capturesDir: path.join(projectDataDir(projectSlug), 'captures'),
      taskId,
      accessLogPath: path.join(
        projectDataDir(projectSlug),
        'audit',
        'proxy-access.jsonl',
      ),
    });
    console.log(`[mock-skill] proxy ${proxy.url} missPolicy=${proxy.missPolicy}`);
    if (proxyHost === '0.0.0.0') {
      const ip = lanIp();
      const scenarioLabel = cfg.scenario || opts.scenario || '(unset)';
      console.log('');
      console.log('===【真机 Wi‑Fi 代理】手机 Wi‑Fi 手动代理填写===');
      console.log(`  host: ${ip || '<电脑LAN_IP>'}`);
      console.log(`  port: ${proxyPort}`);
      console.log(`  scenario: ${scenarioLabel}`);
      console.log('  仅信任局域网，勿在公共 Wi‑Fi 开 0.0.0.0');
      if (!allowOpenProxy) {
        console.log('  missPolicy=reject（未传 --allow-open-proxy）；CONNECT 仅放行 passthroughHosts');
      } else {
        console.log('  WARNING: --allow-open-proxy 已开启，本机可被用作开放代理');
      }
      if (mitm?.caCertPath) {
        console.log(`  HTTPS MITM CA（真机需安装信任）: ${mitm.caCertPath}`);
      } else {
        console.log('  HTTPS: 默认仅 CONNECT 隧道（无法改写）；启用 MITM: --mitm=1');
      }
      console.log('');
    }
  } else {
    console.log('[mock-skill] proxy disabled');
  }

  const userDataDir = chromeProfileDir(projectSlug);
  const chrome = findChrome();
  const clientProxyHost = resolveClientProxyHost(proxyHost);
  const proxyServerArg = `${clientProxyHost}:${proxyPort}`;
  const startUrl = cfg.browser.startUrl || '';
  const chromeCmd = chrome
    ? `"${chrome}" --user-data-dir="${userDataDir}" --proxy-server="${proxyServerArg}" --no-first-run ${
        startUrl ? `"${startUrl}"` : ''
      }`
    : `(find Google Chrome) --user-data-dir="${userDataDir}" --proxy-server="${proxyServerArg}" --no-first-run`;

  console.log('');
  console.log('===【Mock 自测浏览器】请只在此窗口自测===');
  console.log(chromeCmd);
  console.log('');

  let chromePid = null;
  if (cfg.proxy.enabled && cfg.browser.autoLaunch && chrome && fs.existsSync(chrome)) {
    const args = [
      `--user-data-dir=${userDataDir}`,
      `--proxy-server=${proxyServerArg}`,
      '--no-first-run',
      '--new-window',
    ];
    if (startUrl) args.push(startUrl);
    else args.push(`http://${clientProxyHost}:${proxyPort}/`);
    const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
    child.unref();
    chromePid = child.pid;
    console.log(`[mock-skill] launched Chrome pid=${chromePid}`);
  }

  const state = {
    projectSlug,
    taskId,
    mock: { host: mockHost, port: mockPort, pid: process.pid },
    proxy: cfg.proxy.enabled
      ? { host: proxyHost, port: proxyPort, enabled: true }
      : { enabled: false },
    chromePid,
    startedAt: new Date().toISOString(),
  };
  saveRuntimeState(projectSlug, state);
  appendAudit(projectSlug, {
    command: 'session start',
    taskId,
    summary: `mock=${mockPort} proxy=${cfg.proxy.enabled ? proxyPort : 'off'}`,
  });

  // Keep process alive when run as CLI foreground session
  if (opts.detach) {
    return { mock, proxy, state, chromeCmd };
  }

  console.log('[mock-skill] session running — Ctrl+C to stop');
  const shutdown = async () => {
    console.log('\n[mock-skill] stopping...');
    if (chromePid) {
      try {
        process.kill(chromePid, 'SIGTERM');
      } catch (_) {
        /* ignore */
      }
    }
    if (proxy) await proxy.close().catch(() => {});
    await mock.close().catch(() => {});
    saveRuntimeState(projectSlug, { ...state, stoppedAt: new Date().toISOString() });
    appendAudit(projectSlug, { command: 'session stop', taskId, summary: 'stopped' });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // idle
  await new Promise(() => {});
}

module.exports = { startSession, findChrome, resolveClientProxyHost, applySessionOpts };

if (require.main === module) {
  startSession({
    projectDir: process.cwd(),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
