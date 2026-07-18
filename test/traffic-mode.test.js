'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldMock,
  normalizeTrafficMode,
  trafficPassthroughReason,
} = require('../lib/traffic-mode');

const rule = { stubId: 'GET svc-a/v1/items', id: 'GET svc-a/v1/items' };

test('TM1: all-mock mocks any matched rule', () => {
  assert.equal(shouldMock(rule, { trafficMode: 'all-mock' }), true);
  assert.equal(shouldMock(null, { trafficMode: 'all-mock' }), false);
});

test('TM2: all-passthrough never mocks', () => {
  assert.equal(
    shouldMock(rule, { trafficMode: 'all-passthrough', mockAllowlist: [rule.stubId] }),
    false,
  );
  assert.equal(trafficPassthroughReason('all-passthrough'), 'traffic-passthrough');
});

test('TM3: selective only mocks allowlist stubIds', () => {
  assert.equal(
    shouldMock(rule, { trafficMode: 'selective', mockAllowlist: [] }),
    false,
  );
  assert.equal(
    shouldMock(rule, {
      trafficMode: 'selective',
      mockAllowlist: ['GET svc-a/v1/items'],
    }),
    true,
  );
  assert.equal(
    shouldMock(rule, {
      trafficMode: 'selective',
      mockAllowlist: ['GET other/v1/x'],
    }),
    false,
  );
  assert.equal(trafficPassthroughReason('selective'), 'traffic-selective-miss');
});

test('TM4: normalizeTrafficMode rejects invalid', () => {
  assert.equal(normalizeTrafficMode('ALL-MOCK'), 'all-mock');
  assert.throws(() => normalizeTrafficMode('nope'), /invalid trafficMode/);
});
