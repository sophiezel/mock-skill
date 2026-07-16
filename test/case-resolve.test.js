'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCase,
  pickCase,
  normalizeCaseId,
  isDescriptor,
  STANDARD_CASE_DEFAULTS,
} = require('../lib/case-resolve');

test('normalizeCaseId: dep_fail aliases to http_502', () => {
  assert.equal(normalizeCaseId('dep_fail'), 'http_502');
  assert.equal(normalizeCaseId('success'), 'success');
  assert.equal(normalizeCaseId(undefined), 'success');
});

test('isDescriptor detects new shape', () => {
  assert.equal(isDescriptor({ httpStatus: 200, body: {} }), true);
  assert.equal(isDescriptor({ delayMs: 100 }), true);
  assert.equal(isDescriptor({ fault: 'reset' }), true);
  assert.equal(isDescriptor({ code: 0, data: {}, message: '' }), false);
  assert.equal(isDescriptor(null), false);
  assert.equal(isDescriptor([1, 2]), false);
});

test('resolveCase: plain envelope body defaults to 200, no delay', () => {
  const plan = resolveCase('success', { response: { code: 0, data: { a: 1 }, message: '' } });
  assert.equal(plan.httpStatus, 200);
  assert.equal(plan.delayMs, 0);
  assert.equal(plan.fault, undefined);
  assert.deepEqual(plan.body, { code: 0, data: { a: 1 }, message: '' });
});

test('resolveCase: http_500 sets status 500', () => {
  const plan = resolveCase('http_500', {
    response: { code: 500, data: null, message: 'boom' },
    httpStatus: 500,
  });
  assert.equal(plan.httpStatus, 500);
});

test('resolveCase: slow applies delayMs from defaults', () => {
  const plan = resolveCase('slow', { response: { code: 0, data: {}, message: '' }, httpStatus: 200 });
  assert.equal(plan.httpStatus, 200);
  assert.equal(plan.delayMs, STANDARD_CASE_DEFAULTS.slow.delayMs);
});

test('resolveCase: timeout applies hang fault + long delay', () => {
  const plan = resolveCase('timeout', {
    response: { code: 0, data: null, message: '' },
    httpStatus: 0,
    meta: { delayMs: 60000, fault: 'hang' },
  });
  assert.equal(plan.fault, 'hang');
  assert.equal(plan.delayMs, 60000);
  assert.equal(plan.httpStatus, 0);
});

test('resolveCase: offline applies reset fault', () => {
  const plan = resolveCase('offline', {
    response: { code: 0, data: null, message: '' },
    httpStatus: 0,
    meta: { fault: 'reset' },
  });
  assert.equal(plan.fault, 'reset');
  assert.equal(plan.httpStatus, 0);
});

test('resolveCase: explicit delayMs 0 is preserved (not treated as missing)', () => {
  const plan = resolveCase('slow', {
    response: { code: 0, data: {}, message: '' },
    httpStatus: 200,
    meta: { delayMs: 0 },
  });
  assert.equal(plan.delayMs, 0);
});

test('resolveCase: dep_fail normalizes to http_502', () => {
  const plan = resolveCase('dep_fail', {
    response: { code: 502, data: null, message: 'dep' },
    httpStatus: 502,
  });
  assert.equal(plan.httpStatus, 502);
});

test('resolveCase: meta.delayMs overrides defaults', () => {
  const plan = resolveCase('slow', {
    response: { code: 0, data: {}, message: '' },
    httpStatus: 200,
    meta: { delayMs: 7000 },
  });
  assert.equal(plan.delayMs, 7000);
});

test('pickCase: falls back to success', () => {
  const cases = {
    success: { response: { code: 0, data: {}, message: '' }, httpStatus: 200 },
    http_500: { response: { code: 500, data: null, message: '' }, httpStatus: 500 },
  };
  assert.ok(pickCase(cases, 'http_500'));
  assert.ok(pickCase(cases, 'unknown'));
  assert.equal(pickCase(cases, 'unknown').httpStatus, 200);
  assert.equal(pickCase(null, 'x'), null);
});
