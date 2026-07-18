'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ENV_TOKENS,
  normalizeHostLabel,
  deriveUpstreamId,
  pickCanonicalHost,
} = require('../lib/upstream');

test('U1: normalizeHostLabel strips generic env tokens', () => {
  assert.equal(normalizeHostLabel('svc-a-dev'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a-stage'), 'svc-a');
  assert.equal(normalizeHostLabel('preview-svc-a'), 'svc-a');
  assert.equal(normalizeHostLabel('api-prod'), 'api');
  assert.equal(normalizeHostLabel('svc-a.example.com'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a.example.com:443'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a-staging'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a-qa'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a-uat'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a-online'), 'svc-a');
  assert.equal(normalizeHostLabel('svc-a-production'), 'svc-a');
});

test('U1: normalizeHostLabel empty result -> default', () => {
  assert.equal(normalizeHostLabel('dev'), 'default');
  assert.equal(normalizeHostLabel('stage.example.com'), 'default');
});

test('U1: DEFAULT_ENV_TOKENS contains no company brand strings', () => {
  for (const t of DEFAULT_ENV_TOKENS) {
    assert.ok(!t.includes('guazi'), `token "${t}" must not include brand`);
    assert.ok(/^[a-z]+$/.test(t), `token "${t}" must be generic lowercase word`);
  }
  // sanity: must contain the industry-standard words
  for (const expected of ['dev', 'test', 'stage', 'preview', 'prod']) {
    assert.ok(DEFAULT_ENV_TOKENS.includes(expected), `missing generic token ${expected}`);
  }
});

test('U1: normalizeHostLabel accepts extra project envHostTokens', () => {
  assert.equal(
    normalizeHostLabel('svc-a-canary', { envHostTokens: ['canary'] }),
    'svc-a',
  );
  // default set unchanged: 'canary' not in default
  assert.equal(normalizeHostLabel('svc-a-canary'), 'svc-a-canary');
});

test('U2: deriveUpstreamId prefers hostVar', () => {
  assert.equal(
    deriveUpstreamId({ hostVar: 'apiPrefix', hosts: ['x.example.com'] }),
    'apiPrefix',
  );
});

test('U2: deriveUpstreamId uses prefixKey when no hostVar', () => {
  assert.equal(
    deriveUpstreamId({ prefixKey: 'baseURL', hosts: ['x.example.com'] }),
    'prefix-baseURL',
  );
});

test('U2: deriveUpstreamId uses family token when only hosts, same family', () => {
  assert.equal(
    deriveUpstreamId({
      hosts: ['svc-a.example.com', 'svc-a-stage.example.com'],
    }),
    'svc-a',
  );
});

test('U2: deriveUpstreamId returns null when hosts span multiple families', () => {
  // Caller must NOT merge; deriveUpstreamId alone returns null for mixed family.
  assert.equal(
    deriveUpstreamId({ hosts: ['svc-a.example.com', 'svc-b.example.com'] }),
    null,
  );
});

test('U2: deriveUpstreamId _default when only _default host', () => {
  assert.equal(deriveUpstreamId({ hosts: ['_default'] }), '_default');
  assert.equal(deriveUpstreamId({ hosts: [] }), '_default');
});

test('U2: deriveUpstreamId sanitizes id', () => {
  assert.equal(
    deriveUpstreamId({ hostVar: 'my api prefix!', hosts: [] }),
    'my-api-prefix',
  );
});

test('U7: pickCanonicalHost prefers host whose label has no env token', () => {
  const hosts = ['svc-a-stage.example.com', 'svc-a.example.com', 'svc-a-dev.example.com'];
  assert.equal(pickCanonicalHost(hosts, 'svc-a'), 'svc-a.example.com');
});

test('U7: pickCanonicalHost falls back to lexicographically smallest', () => {
  const hosts = ['svc-b.example.com', 'svc-a.example.com'];
  assert.equal(pickCanonicalHost(hosts, 'svc'), 'svc-a.example.com');
});

test('U7: pickCanonicalHost null when hosts empty', () => {
  assert.equal(pickCanonicalHost([], 'svc-a'), null);
});

test('U7: pickCanonicalHost has no domain-suffix allowlist', () => {
  // Ensure function does not special-case any company domain.
  const src = String(pickCanonicalHost);
  assert.ok(!src.includes('guazi'), 'pickCanonicalHost must not reference brand domain');
});

test('U8: project envHostTokens append does not mutate DEFAULT_ENV_TOKENS', () => {
  const before = [...DEFAULT_ENV_TOKENS];
  normalizeHostLabel('svc-a-canary', { envHostTokens: ['canary'] });
  assert.deepEqual(DEFAULT_ENV_TOKENS, before);
});
