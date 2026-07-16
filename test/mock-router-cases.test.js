'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startMockServer } = require('../runtime/mock-server/server');

function mkMockDir(root, host, urlPath, handlerSource) {
  const dir = path.join(root, host, urlPath.replace(/^\//, ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), handlerSource);
}

function req(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    require('http').request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body;
          try { body = JSON.parse(raw); } catch { body = raw; }
          resolve({ status: res.statusCode, body });
        });
      },
    ).on('error', reject).end();
  });
}

async function withServer(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-router-'));
  mkMockDir(tmp, 'api.example.com', '/v1/users', `module.exports = ({ caseId }) => {
    const cases = {
      success: { response: { code: 0, data: [], message: '' }, httpStatus: 200 },
      empty: { response: { code: 0, data: [], message: '' }, httpStatus: 200 },
      biz_error: { response: { code: 50000, data: null, message: 'fail' }, httpStatus: 200 },
      http_401: { response: { code: 401, data: null, message: 'no auth' }, httpStatus: 401 },
      http_403: { response: { code: 403, data: null, message: 'forbidden' }, httpStatus: 403 },
      http_404: { response: { code: 404, data: null, message: 'missing' }, httpStatus: 404 },
      http_500: { response: { code: 500, data: null, message: 'err' }, httpStatus: 500 },
      http_502: { response: { code: 502, data: null, message: 'dep' }, httpStatus: 502 },
      dep_fail: { response: { code: 502, data: null, message: 'dep' }, httpStatus: 502 },
      slow: { response: { code: 0, data: [], message: '' }, httpStatus: 200, meta: { delayMs: 50 } },
      timeout: { response: { code: 0, data: null, message: '' }, httpStatus: 0, meta: { delayMs: 20, fault: 'hang' } },
      offline: { response: { code: 0, data: null, message: '' }, httpStatus: 0, meta: { fault: 'reset' } },
    };
    return cases[caseId] || cases.success;
  };`);
  const port = 3901 + Math.floor(Math.random() * 1000);
  const srv = await startMockServer({ mocksRoot: tmp, host: '127.0.0.1', port });
  try {
    await fn(`${srv.url}/v1/users`, 'api.example.com');
  } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('router: success returns 200', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'success' });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
  });
});

test('router: biz_error returns 200 with biz code', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'biz_error' });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 50000);
  });
});

test('router: empty returns 200', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'empty' });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
  });
});

test('router: http_401 returns 401', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'http_401' });
    assert.equal(res.status, 401);
  });
});

test('router: http_403 returns 403', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'http_403' });
    assert.equal(res.status, 403);
  });
});

test('router: http_404 returns 404', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'http_404' });
    assert.equal(res.status, 404);
  });
});

test('router: http_500 returns 500', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'http_500' });
    assert.equal(res.status, 500);
  });
});

test('router: dep_fail normalizes to http_502', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'dep_fail' });
    assert.equal(res.status, 502);
  });
});

test('router: http_502 returns 502', async () => {
  await withServer(async (url) => {
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'http_502' });
    assert.equal(res.status, 502);
  });
});

test('router: slow applies delay but returns 200', async () => {
  await withServer(async (url) => {
    const start = Date.now();
    const res = await req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'slow' });
    const elapsed = Date.now() - start;
    assert.equal(res.status, 200);
    assert.ok(elapsed >= 40, `expected delay, got ${elapsed}ms`);
  });
});

test('router: timeout hangs (no response body)', async () => {
  await withServer(async (url) => {
    await assert.rejects(
      () =>
        new Promise((resolve, reject) => {
          const u = new URL(url);
          const r = require('http').request(
            {
              hostname: u.hostname,
              port: u.port,
              path: u.pathname,
              method: 'GET',
              headers: { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'timeout' },
            },
            () => resolve(),
          );
          r.setTimeout(150, () => {
            r.destroy();
            reject(new Error('client-timeout'));
          });
          r.on('error', reject);
          r.end();
        }),
      /client-timeout|ECONNRESET|socket hang up/,
    );
  });
});

test('router: offline resets connection', async () => {
  await withServer(async (url) => {
    await assert.rejects(
      () => req(url, { 'x-forwarded-host': 'api.example.com', 'x-mock-case': 'offline' }),
      /ECONNRESET|socket hang up|aborted/,
    );
  });
});

test('router: no handler returns 404', async () => {
  await withServer(async (url) => {
    const res = await req(url.replace('/v1/users', '/v1/missing'), { 'x-forwarded-host': 'api.example.com' });
    assert.equal(res.status, 404);
  });
});
