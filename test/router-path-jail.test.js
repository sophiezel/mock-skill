'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const createRouter = require('../runtime/mock-server/router');
const { resolveHandlerFile, jailPath, clearHandlerCache, loadHandler } = createRouter;
const { startMockServer } = require('../runtime/mock-server/server');

test('jailPath: rejects paths outside mocksRoot', () => {
  const root = path.join(os.tmpdir(), 'mocks-jail-root');
  const outside = path.join(root, '..', '..', 'etc', 'index.js');
  assert.equal(jailPath(root, outside), null);
});

test('jailPath: accepts paths inside mocksRoot', () => {
  const root = path.join(os.tmpdir(), 'mocks-jail-root');
  const inside = path.join(root, 'api.example.com', 'v1', 'users', 'index.js');
  const resolved = jailPath(root, inside);
  assert.ok(resolved);
  assert.ok(resolved.startsWith(path.resolve(root)));
});

test('resolveHandlerFile: traversal segments return null', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-jail-'));
  try {
    // Plant a file outside mocks root that would be hit without jail
    const outsideDir = path.join(tmp, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(
      path.join(outsideDir, 'index.js'),
      'module.exports = () => ({ code: 999 });',
    );
    const mocksRoot = path.join(tmp, 'mocks');
    fs.mkdirSync(mocksRoot, { recursive: true });

    assert.equal(
      resolveHandlerFile(mocksRoot, '/../../outside', 'api.example.com'),
      null,
    );
    assert.equal(
      resolveHandlerFile(mocksRoot, '/../outside', 'host'),
      null,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('router HTTP: path traversal yields 404 never executes outside handler', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-jail-http-'));
  const mocksRoot = path.join(tmp, 'mocks');
  fs.mkdirSync(path.join(mocksRoot, 'api.example.com', 'v1', 'ok'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(mocksRoot, 'api.example.com', 'v1', 'ok', 'index.js'),
    `module.exports = () => ({ code: 0, data: { ok: true }, message: '' });`,
  );
  // Outside bait
  fs.mkdirSync(path.join(tmp, 'pwn'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'pwn', 'index.js'),
    `module.exports = () => ({ code: 666, data: 'pwned', message: '' });`,
  );

  const srv = await startMockServer({
    mocksRoot,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const res = await new Promise((resolve, reject) => {
      http
        .request(
          {
            hostname: '127.0.0.1',
            port: srv.port,
            path: '/../../pwn',
            method: 'GET',
            headers: { 'x-forwarded-host': 'api.example.com' },
          },
          (r) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => {
              resolve({
                status: r.statusCode,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          },
        )
        .on('error', reject)
        .end();
    });
    assert.equal(res.status, 404);
    assert.ok(!res.body.includes('pwned'));
    assert.ok(!res.body.includes('666'));
  } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadHandler: mtime cache reloads only when file changes', async () => {
  clearHandlerCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-mtime-'));
  const file = path.join(tmp, 'index.js');
  fs.writeFileSync(file, `module.exports = () => ({ n: 1 });`);
  const a = loadHandler(file);
  assert.equal(a().n, 1);
  const b = loadHandler(file);
  assert.equal(b, a, 'same module instance when mtime unchanged');

  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(file, `module.exports = () => ({ n: 2 });`);
  // bump mtime explicitly on some FS with coarse resolution
  const now = new Date();
  fs.utimesSync(file, now, now);
  clearHandlerCache(); // ensure clean; then load new
  // Actually we want to test mtime detection — clear was wrong.
  // Re-seed cache with old then change:
  clearHandlerCache();
  fs.writeFileSync(file, `module.exports = () => ({ n: 1 });`);
  const c1 = loadHandler(file);
  assert.equal(c1().n, 1);
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(file, `module.exports = () => ({ n: 2 });`);
  fs.utimesSync(file, new Date(), new Date());
  const c2 = loadHandler(file);
  assert.equal(c2().n, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});
