'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { startProxyServer, isLanBind } = require('../runtime/proxy/server');

test('isLanBind detects 0.0.0.0', () => {
  assert.equal(isLanBind('0.0.0.0'), true);
  assert.equal(isLanBind('127.0.0.1'), false);
});

test('proxy on 0.0.0.0 without allowOpenProxy forces missPolicy=reject', async () => {
  const proxy = await startProxyServer({
    host: '127.0.0.1', // bind loopback for CI; exercise force via explicit missPolicy path
    port: 0,
    mockTarget: 'http://127.0.0.1:9',
    rules: [],
    missPolicy: 'passthrough',
    allowOpenProxy: false,
  });
  // Direct unit: when host is 0.0.0.0 the returned missPolicy is reject
  await proxy.close();

  const open = await startProxyServer({
    host: '0.0.0.0',
    port: 0,
    mockTarget: 'http://127.0.0.1:9',
    rules: [],
    missPolicy: 'passthrough',
    allowOpenProxy: false,
  });
  try {
    assert.equal(open.missPolicy, 'reject');
  } finally {
    await open.close();
  }
});

test('CONNECT denied by default without allowOpenProxy', async () => {
  const proxy = await startProxyServer({
    host: '127.0.0.1',
    port: 0,
    mockTarget: 'http://127.0.0.1:9',
    rules: [],
    missPolicy: 'passthrough',
    allowOpenProxy: false,
    passthroughHosts: [],
  });
  try {
    const status = await new Promise((resolve, reject) => {
      const sock = net.connect(proxy.port, '127.0.0.1', () => {
        sock.write('CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n\r\n');
      });
      let buf = '';
      sock.on('data', (c) => {
        buf += c.toString('utf8');
        if (buf.includes('\r\n\r\n')) {
          sock.end();
          resolve(buf);
        }
      });
      sock.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    assert.match(status, /403 Forbidden/);
  } finally {
    await proxy.close();
  }
});

test('miss reject returns 404 when missPolicy=reject', async () => {
  const http = require('http');
  const proxy = await startProxyServer({
    host: '127.0.0.1',
    port: 0,
    mockTarget: 'http://127.0.0.1:9',
    rules: [],
    missPolicy: 'reject',
    allowOpenProxy: false,
  });
  try {
    const res = await new Promise((resolve, reject) => {
      http
        .request(
          {
            hostname: '127.0.0.1',
            port: proxy.port,
            path: 'http://api.example.com/nope',
            method: 'GET',
          },
          (r) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () =>
              resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() }),
            );
          },
        )
        .on('error', reject)
        .end();
    });
    assert.equal(res.status, 404);
  } finally {
    await proxy.close();
  }
});
