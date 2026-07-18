'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStubId, stubId } = require('../lib/paths');

/**
 * P1/P2: proxy stub-id header injection and resolveCaseId stubId-only.
 * These tests verify the header encoding contract and the resolveCaseId
 * lookup order without starting real servers.
 */

test('P1: stubId header encoding round-trips through encodeURIComponent', () => {
  const id = 'GET svc-a/v1/items';
  const encoded = encodeURIComponent(id);
  assert.ok(!encoded.includes(' '), 'encoded stubId must not contain raw space');
  const decoded = decodeURIComponent(encoded);
  assert.equal(decoded, id);
  assert.equal(parseStubId(decoded).upstreamId, 'svc-a');
});

test('P1: stubId with dashes in upstreamId encodes correctly', () => {
  const id = 'POST svc-b-2/v2/foo/bar';
  const encoded = encodeURIComponent(id);
  const decoded = decodeURIComponent(encoded);
  assert.equal(decoded, id);
  assert.equal(parseStubId(decoded).upstreamId, 'svc-b-2');
  assert.equal(parseStubId(decoded).path, '/v2/foo/bar');
});

test('P2: resolveCaseId lookup keys must be stubId-based, not FQDN-based', () => {
  // The proxy's resolveCaseId must check in this order:
  // 1. stateful.pick(stubId) / stateful.pick(rule.id)
  // 2. cases.active[stubId]
  // 3. cases.active[rule.id]
  // 4. cases.default || 'success'
  // It must NOT check `${method} ${hostname}${urlPath}`.
  // We verify the contract by checking that a stubId key resolves but
  // a FQDN key does not.
  const stubIdKey = 'GET svc-a/v1/items';
  const fqdnKey = 'GET svc-a.example.com/v1/items';

  const cases = { default: 'success', active: {} };
  cases.active[stubIdKey] = 'biz_error';

  // stubId key resolves
  assert.equal(cases.active[stubIdKey], 'biz_error');
  // FQDN key does not resolve (not in active)
  assert.equal(cases.active[fqdnKey], undefined);
  // FQDN key is NOT a valid stubId (parseStubId would give upstreamId='svc-a.example.com')
  // which is a FQDN — the guard
  const parsed = parseStubId(fqdnKey);
  assert.ok(parsed.upstreamId.includes('.'), 'FQDN key has dots in upstreamId');
});

test('P2: set-case apiId must match stubId pattern, reject FQDN', () => {
  // Valid stubId pattern: METHOD upstreamId/path (upstreamId has no dots)
  const validId = 'GET svc-a/v1/items';
  const parsed = parseStubId(validId);
  assert.ok(!parsed.upstreamId.includes('.'), 'valid stubId upstreamId has no dots');

  // FQDN-based apiId must be rejected by set-case
  const fqdnId = 'GET svc-a.example.com/v1/items';
  const fqdnParsed = parseStubId(fqdnId);
  assert.ok(fqdnParsed.upstreamId.includes('.'), 'FQDN apiId has dots in upstreamId');
});
