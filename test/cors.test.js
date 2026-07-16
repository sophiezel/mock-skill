'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedOrigin } = require('../lib/cors');

test('localhost allowed by default', () => {
  assert.equal(isAllowedOrigin('http://localhost:8080'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:3000'), true);
  assert.equal(isAllowedOrigin('https://[::1]:9000'), true);
  assert.equal(isAllowedOrigin('http://localhost'), true);
});

test('arbitrary origin blocked by default', () => {
  assert.equal(isAllowedOrigin('https://api.example.com'), false);
  assert.equal(isAllowedOrigin('https://evil.com'), false);
});

test('extraOrigins exact + wildcard', () => {
  const cfg = { extraOrigins: ['https://h5.app', '*.my-scheme'] };
  assert.equal(isAllowedOrigin('https://h5.app', cfg), true);
  assert.equal(isAllowedOrigin('custom://my.my-scheme', cfg), true);
  assert.equal(isAllowedOrigin('https://other.app', cfg), false);
});

test('no company domain is hardcoded', () => {
  // Any company-looking origin must NOT be implicitly allowed
  assert.equal(isAllowedOrigin('https://anything-guazi-cloud.com'), false);
  assert.equal(isAllowedOrigin('https://guazi.com'), false);
});

test('allowLocalhost false disables localhost', () => {
  assert.equal(isAllowedOrigin('http://localhost:8080', { allowLocalhost: false }), false);
});

test('empty origin rejected', () => {
  assert.equal(isAllowedOrigin(''), false);
  assert.equal(isAllowedOrigin(undefined), false);
});
