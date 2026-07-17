'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatefulEngine } = require('../lib/stateful');

test('stateful times: first N hits then forever', () => {
  const eng = createStatefulEngine({
    times: {
      'GET h/p': [
        { case: 'http_500', times: 2 },
        { case: 'success', times: -1 },
      ],
    },
  });
  assert.equal(eng.pick('GET h/p'), 'http_500');
  assert.equal(eng.pick('GET h/p'), 'http_500');
  assert.equal(eng.pick('GET h/p'), 'success');
  assert.equal(eng.pick('GET h/p'), 'success');
});

test('stateful transitions: advance state', () => {
  const eng = createStatefulEngine({
    state: 'Started',
    transitions: {
      Started: { on: 'request', next: 'Failed', case: 'http_500' },
      Failed: { on: 'request', next: 'Started', case: 'success' },
    },
  });
  assert.equal(eng.pick('any'), 'http_500');
  assert.equal(eng.getState(), 'Failed');
  assert.equal(eng.pick('any'), 'success');
  assert.equal(eng.getState(), 'Started');
});
