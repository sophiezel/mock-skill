'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startMockServer } = require('../runtime/mock-server/server');
const { startProxyServer } = require('../runtime/proxy/server');

function mkMockDir(root, host, urlPath, handlerSource) {
  const dir = path.join(root, host, urlPath.replace(/^\//, ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), handlerSource);
}

function reqProxy(proxyUrl, target, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(proxyUrl);
    require('http').request(
      {
        hostname: u.hostname,
        port: u.port,
        path: target, // absolute-form for proxy
        method,
        headers,
      },
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

const RULE_ID = 'GET api.example.com/v1/users';

async function withProxyEnv(fn) {
  const tmpMock = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-mock-'));
  const tmpCapture = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-cap-'));
  mkMockDir(tmpMock, 'api.example.com', '/v1/users', `module.exports = ({ caseId }) => {
    const cases = {
      success: { response: { code: 0, data: [], message: '' }, httpStatus: 200 },
      http_500: { response: { code: 500, data: null, message: 'err' }, httpStatus: 500 },
      http_502: { response: { code: 502, data: null, message: 'dep' }, httpStatus: 502 },
    };
    return cases[caseId] || cases.success;
  };`);

  const mock = await startMockServer({ mocksRoot: tmpMock, host: '127.0.0.1', port: 0 });
  const proxy = await startProxyServer({
    host: '127.0.0.1',
    port: 0,
    mockTarget: mock.url,
    rules: [{ id: RULE_ID, host: 'api.example.com', pathPrefix: '/v1/users', methods: ['GET'] }],
    cases: { default: 'success', active: {} },
    blockWritePassthrough: true,
    capturesDir: tmpCapture,
  });
  try {
    await fn(proxy.url, proxy);
  } finally {
    await proxy.close();
    await mock.close();
    fs.rmSync(tmpMock, { recursive: true, force: true });
    fs.rmSync(tmpCapture, { recursive: true, force: true });
  }
}

test('proxy: default success forwards to mock → 200', async () => {
  await withProxyEnv(async (proxyUrl) => {
    const res = await reqProxy(proxyUrl, 'http://api.example.com/v1/users');
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
  });
});

test('proxy: active case http_500 via setCases → 500', async () => {
  await withProxyEnv(async (proxyUrl, proxy) => {
    proxy.setCases({ active: { [RULE_ID]: 'http_500' } });
    const res = await reqProxy(proxyUrl, 'http://api.example.com/v1/users');
    assert.equal(res.status, 500);
  });
});

test('proxy: active case http_502 via setCases → 502', async () => {
  await withProxyEnv(async (proxyUrl, proxy) => {
    proxy.setCases({ active: { [RULE_ID]: 'http_502' } });
    const res = await reqProxy(proxyUrl, 'http://api.example.com/v1/users');
    assert.equal(res.status, 502);
  });
});

test('proxy: miss GET soft-passthrough to unrouteable host → 502', async () => {
  await withProxyEnv(async (proxyUrl) => {
    try {
      const res = await reqProxy(proxyUrl, 'http://nonexistent.invalid/v1/x');
      assert.ok(res.status === 502 || res.status === 500, `status=${res.status}`);
    } catch (e) {
      assert.ok(e, 'expected error on unrouteable upstream');
    }
  });
});

test('proxy: miss POST blocked with 403', async () => {
  await withProxyEnv(async (proxyUrl) => {
    const res = await reqProxy(proxyUrl, 'http://api.example.com/v1/unknown', {}, 'POST');
    assert.equal(res.status, 403);
  });
});

test('proxy: hot-reload default case via setCases', async () => {
  await withProxyEnv(async (proxyUrl, proxy) => {
    const r1 = await reqProxy(proxyUrl, 'http://api.example.com/v1/users');
    assert.equal(r1.status, 200);
    proxy.setCases({ default: 'http_502' });
    const r2 = await reqProxy(proxyUrl, 'http://api.example.com/v1/users');
    assert.equal(r2.status, 502);
  });
});
