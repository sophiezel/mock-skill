'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertStubId } = require('../scripts/set-case');

test('S1: set-case accepts stubId apiId', () => {
  assert.doesNotThrow(() => assertStubId('GET svc-a/v1/items'));
  assert.doesNotThrow(() => assertStubId('POST svcAPrefix/v2/foo/bar'));
});

test('S1: set-case rejects FQDN apiId', () => {
  assert.throws(
    () => assertStubId('GET svc-a.example.com/v1/items'),
    /FQDN|stubId/,
  );
  assert.throws(
    () => assertStubId('not-a-stub-id'),
    /stubId/,
  );
});
