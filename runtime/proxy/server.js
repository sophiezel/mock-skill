'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { applyCorsHeaders, handleOptions } = require('../../lib/cors');
const { matchRule } = require('../../lib/match-rule');

function loadRules(rulesPath) {
  if (!rulesPath || !fs.existsSync(rulesPath)) return [];
  return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function startProxyServer(opts) {
  const {
    host = '127.0.0.1',
    port = 18999,
    mockTarget = 'http://127.0.0.1:3900',
    rules = [],
    rulesPath,
    cors = {},
    cases = { default: 'success', active: {} },
    casesLoader = null, // optional () => cases, for hot-reload (≤1s cache)
    caseHeader = 'x-mock-case',
    missPolicy = 'passthrough',
    blockWritePassthrough = true,
    passthroughHosts = [],
    recordMisses = true,
    capturesDir,
    taskId = null,
    accessLogPath,
  } = opts;

  let activeRules = rules.length ? rules : loadRules(rulesPath);
  let activeCases = { ...cases };
  let casesCacheAt = 0;
  const CASES_TTL_MS = 1000;

  function currentCases() {
    if (!casesLoader) return activeCases;
    const now = Date.now();
    if (now - casesCacheAt > CASES_TTL_MS) {
      activeCases = { ...casesLoader() };
      casesCacheAt = now;
    }
    return activeCases;
  }

  const mockUrl = new URL(mockTarget);

  function logAccess(entry) {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      taskId,
      ...entry,
    });
    if (accessLogPath) {
      fs.mkdirSync(path.dirname(accessLogPath), { recursive: true });
      fs.appendFileSync(accessLogPath, `${line}\n`);
    }
    console.log(`[proxy] ${entry.action} ${entry.method} ${entry.url}`);
  }

  function recordCapture(rec) {
    if (!recordMisses || !capturesDir) return;
    fs.mkdirSync(capturesDir, { recursive: true });
    const name = `${Date.now()}-${(rec.host || 'h').replace(/\W/g, '_')}-${rec.path
      .replace(/\W/g, '_')
      .slice(0, 80)}.json`;
    fs.writeFileSync(path.join(capturesDir, name), `${JSON.stringify(rec, null, 2)}\n`);
  }

  function isPassthroughHost(hostname) {
    return passthroughHosts.some(
      (h) =>
        h === hostname ||
        (h.startsWith('*.') && hostname.endsWith(h.slice(1))),
    );
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        handleOptions(req, res, cors);
        logAccess({ action: 'options', method: 'OPTIONS', url: req.url });
        return;
      }

      // Absolute-form proxy request: GET http://host/path
      let target;
      if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
        target = new URL(req.url);
      } else {
        const hostHeader = req.headers.host || 'localhost';
        target = new URL(`http://${hostHeader}${req.url}`);
      }

      const hostname = target.hostname;
      const urlPath = target.pathname;
      const method = req.method || 'GET';
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
        ? await readBody(req)
        : Buffer.alloc(0);

      if (isPassthroughHost(hostname)) {
        const up = await forwardUpstream(req, res, target, body, cors, true);
        logAccess({ action: 'passthrough-host', method, url: target.href });
        recordCapture({
          host: hostname,
          path: urlPath,
          method,
          reason: 'passthrough-host',
          responseBody: up?.bodyJson ?? up?.bodyText,
        });
        return;
      }

      const rule = matchRule(activeRules, hostname, urlPath, method);
      if (rule) {
        const cs = currentCases();
        const caseId =
          cs.active?.[rule.id] ||
          cs.active?.[`${method} ${hostname}${urlPath}`] ||
          cs.default ||
          'success';

        const headers = { ...req.headers };
        headers.host = mockUrl.host;
        headers['x-forwarded-host'] = hostname;
        headers[caseHeader] = caseId;
        delete headers['content-length'];

        const mockPath = urlPath + target.search;
        const mockReq = http.request(
          {
            protocol: mockUrl.protocol,
            hostname: mockUrl.hostname,
            port: mockUrl.port,
            path: mockPath,
            method,
            headers,
          },
          (mockRes) => {
            applyCorsHeaders(req, res, cors);
            const outHeaders = { ...mockRes.headers };
            delete outHeaders['access-control-allow-origin'];
            res.writeHead(mockRes.statusCode || 200, outHeaders);
            mockRes.pipe(res);
          },
        );
        mockReq.on('error', (e) => {
          applyCorsHeaders(req, res, cors);
          res.statusCode = 502;
          res.end(JSON.stringify({ code: 502, message: e.message }));
        });
        if (body.length) mockReq.write(body);
        mockReq.end();
        logAccess({
          action: 'mock',
          method,
          url: target.href,
          caseId,
          ruleId: rule.id,
        });
        return;
      }

      const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      if (isWrite && blockWritePassthrough && missPolicy !== 'reject') {
        applyCorsHeaders(req, res, cors);
        res.statusCode = 403;
        res.end(
          JSON.stringify({
            code: 403,
            message: 'write passthrough blocked; add mock rule or disable blockWritePassthrough',
            data: null,
          }),
        );
        logAccess({ action: 'block-write', method, url: target.href });
        recordCapture({
          host: hostname,
          path: urlPath,
          method,
          reason: 'block-write',
        });
        return;
      }

      if (missPolicy === 'reject') {
        applyCorsHeaders(req, res, cors);
        res.statusCode = 404;
        res.end(JSON.stringify({ code: 404, message: 'no mock rule', data: null }));
        logAccess({ action: 'reject', method, url: target.href });
        return;
      }

      const up = await forwardUpstream(req, res, target, body, cors, true);
      logAccess({ action: 'passthrough', method, url: target.href });
      recordCapture({
        host: hostname,
        path: urlPath,
        method,
        query: Object.fromEntries(target.searchParams),
        reason: 'miss',
        responseBody: up?.bodyJson ?? up?.bodyText,
      });
    } catch (err) {
      applyCorsHeaders(req, res, cors);
      res.statusCode = 500;
      res.end(JSON.stringify({ code: 500, message: err.message }));
    }
  });

  // CONNECT for HTTPS tunnel (no MITM in v1)
  server.on('connect', (req, clientSocket, head) => {
    const [hostname, portStr] = (req.url || '').split(':');
    const portNum = Number(portStr || 443);
    if (isPassthroughHost(hostname) || missPolicy === 'passthrough') {
      const upstream = netConnect(hostname, portNum, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.end());
      clientSocket.on('error', () => upstream.end());
      logAccess({ action: 'connect-tunnel', method: 'CONNECT', url: req.url });
      return;
    }
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.end();
  });

  function netConnect(hostname, portNum, cb) {
    return require('net').connect(portNum, hostname, cb);
  }

  function forwardUpstream(clientReq, clientRes, target, body, corsCfg, injectCors) {
    return new Promise((resolve) => {
      const lib = target.protocol === 'https:' ? https : http;
      const headers = { ...clientReq.headers };
      headers.host = target.host;
      const upstream = lib.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname + target.search,
          method: clientReq.method,
          headers,
          rejectUnauthorized: false,
        },
        (upRes) => {
          if (injectCors) applyCorsHeaders(clientReq, clientRes, corsCfg);
          const outHeaders = { ...upRes.headers };
          const chunks = [];
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', () => {
            const buf = Buffer.concat(chunks);
            const bodyText = buf.toString('utf8');
            let bodyJson;
            try {
              bodyJson = JSON.parse(bodyText);
            } catch {
              bodyJson = undefined;
            }
            clientRes.writeHead(upRes.statusCode || 200, outHeaders);
            clientRes.end(buf);
            resolve({ status: upRes.statusCode, bodyText, bodyJson });
          });
        },
      );
      upstream.on('error', (e) => {
        if (injectCors) applyCorsHeaders(clientReq, clientRes, corsCfg);
        clientRes.statusCode = 502;
        clientRes.end(JSON.stringify({ code: 502, message: e.message }));
        resolve({ error: e.message });
      });
      if (body.length) upstream.write(body);
      upstream.end();
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        host,
        port,
        url: `http://${host}:${port}`,
        setCases(next) {
          activeCases = { ...activeCases, ...next };
          casesCacheAt = 0;
        },
        reloadRules(nextRules) {
          activeRules = nextRules;
        },
        close: () =>
          new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

module.exports = { startProxyServer, matchRule, loadRules };
