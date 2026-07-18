'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeCapture, DEFAULT_SENSITIVE_PATHS } = require('../lib/sanitize-capture');

test('P1-S1: DEFAULT_SENSITIVE_PATHS contains generic token/PII keys, no brand', () => {
  const serialized = JSON.stringify(DEFAULT_SENSITIVE_PATHS);
  assert.ok(!/guazi|tower|company/i.test(serialized), 'brand leak in default sensitive paths');
  // industry-standard sensitive keys
  for (const expected of ['authorization', 'token', 'password', 'secret', 'cookie']) {
    assert.ok(
      DEFAULT_SENSITIVE_PATHS.some((p) => p.toLowerCase() === expected || p.toLowerCase().includes(expected)),
      `missing generic sensitive key: ${expected}`,
    );
  }
});

test('P1-S2: sanitizeCapture redacts matching header keys', () => {
  const cap = {
    requestHeaders: { Authorization: 'Bearer abc', 'X-Token': 'xyz', 'Content-Type': 'application/json' },
    responseBody: { code: 0, data: { id: 1 } },
  };
  const out = sanitizeCapture(cap);
  assert.equal(out.requestHeaders.Authorization, '[REDACTED]');
  assert.equal(out.requestHeaders['X-Token'], '[REDACTED]');
  assert.equal(out.requestHeaders['Content-Type'], 'application/json');
});

test('P1-S3: sanitizeCapture redacts matching body keys (case-insensitive, nested)', () => {
  const cap = {
    responseBody: {
      code: 0,
      data: { id: 1, Password: 'secret', user: { token: 'abc', name: 'bob' } },
    },
  };
  const out = sanitizeCapture(cap);
  assert.equal(out.responseBody.data.Password, '[REDACTED]');
  assert.equal(out.responseBody.data.user.token, '[REDACTED]');
  assert.equal(out.responseBody.data.user.name, 'bob');
});

test('P1-S4: sanitizeCapture accepts extra sensitive paths via opts', () => {
  const cap = {
    responseBody: { code: 0, data: { mySecretField: 'v', id: 1 } },
  };
  const out = sanitizeCapture(cap, { sensitivePaths: ['mySecretField'] });
  assert.equal(out.responseBody.data.mySecretField, '[REDACTED]');
  assert.equal(out.responseBody.data.id, 1);
});

test('P1-S5: sanitizeCapture is immutable (does not mutate input)', () => {
  const cap = {
    requestHeaders: { Authorization: 'Bearer abc' },
    responseBody: { code: 0, data: { token: 'x' } },
  };
  const out = sanitizeCapture(cap);
  assert.notEqual(out, cap, 'returns new object');
  assert.equal(cap.requestHeaders.Authorization, 'Bearer abc', 'input unchanged');
  assert.equal(cap.responseBody.data.token, 'x', 'input body unchanged');
  assert.equal(out.requestHeaders.Authorization, '[REDACTED]');
});

test('P1-S6: sanitizeCapture handles missing fields defensively', () => {
  assert.deepEqual(sanitizeCapture(null), {});
  assert.deepEqual(sanitizeCapture(undefined), {});
  assert.deepEqual(sanitizeCapture({}), {});
  assert.deepEqual(sanitizeCapture({ responseBody: null }), { responseBody: null });
});

test('P1-S7: sanitizeCapture redacts arrays of objects', () => {
  const cap = {
    responseBody: { code: 0, data: [{ id: 1, token: 'a' }, { id: 2, token: 'b' }] },
  };
  const out = sanitizeCapture(cap);
  assert.equal(out.responseBody.data[0].token, '[REDACTED]');
  assert.equal(out.responseBody.data[1].token, '[REDACTED]');
  assert.equal(out.responseBody.data[0].id, 1);
});
