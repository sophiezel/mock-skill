'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeContract,
  isCaptureBacked,
  buildContract,
} = require('../scripts/generate-mock');

test('isCaptureBacked detects usage+capture', () => {
  assert.equal(isCaptureBacked({ response: { source: 'usage+capture' } }), true);
  assert.equal(isCaptureBacked({ response: { source: 'usage' } }), false);
});

test('merge without overwriteCapture preserves capture success.data', () => {
  const existing = {
    id: 'GET h/p',
    response: { source: 'usage+capture', shape: { type: 'object', props: {} } },
    cases: [
      {
        id: 'success',
        response: { code: 0, data: { real: 'from-env', nested: { a: 1 } }, message: '' },
      },
      { id: 'empty', response: { code: 0, data: {}, message: '' } },
    ],
    history: [],
    request: { query: {}, body: {}, headers: [] },
  };
  const next = buildContract(
    {
      method: 'GET',
      host: 'h',
      path: '/p',
      role: 'modify',
      hasMock: true,
      responseShape: {
        type: 'object',
        props: { list: { type: 'array', item: { type: 'object', props: {} } } },
      },
      coverage: { gaps: [], request: {}, response: {} },
    },
    { taskId: 't', source: 'usage' },
  );
  const merged = mergeContract(existing, next, {
    taskId: 't',
    overwriteCapture: false,
  });
  assert.equal(merged.response.source, 'usage+capture');
  const success = merged.cases.find((c) => c.id === 'success');
  assert.deepEqual(success.response.data, {
    real: 'from-env',
    nested: { a: 1 },
  });
});

test('merge with overwriteCapture replaces capture success.data', () => {
  const existing = {
    id: 'GET h/p',
    response: { source: 'usage+capture', shape: { type: 'object', props: {} } },
    cases: [
      {
        id: 'success',
        response: { code: 0, data: { real: 'from-env' }, message: '' },
      },
    ],
    history: [],
    request: { query: {}, body: {}, headers: [] },
  };
  const next = buildContract(
    {
      method: 'GET',
      host: 'h',
      path: '/p',
      role: 'modify',
      hasMock: true,
      responseShape: {
        type: 'object',
        props: { fake: { type: 'unknown' } },
      },
      coverage: { gaps: [], request: {}, response: {} },
    },
    { taskId: 't', source: 'usage' },
  );
  const merged = mergeContract(existing, next, {
    taskId: 't',
    overwriteCapture: true,
  });
  const success = merged.cases.find((c) => c.id === 'success');
  assert.ok(success.response.data.fake != null || 'fake' in success.response.data);
  assert.ok(!('real' in success.response.data) || success.response.data.real !== 'from-env' || merged.response.source !== 'usage+capture');
});
