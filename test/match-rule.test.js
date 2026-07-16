'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchRule } = require('../lib/match-rule');

const rules = [
  { id: 'a', host: 'api.example.com', pathPrefix: '/v1/users', methods: ['GET'] },
  { id: 'b', host: '*.example.com', pathPrefix: '/v1/orders', methods: ['GET', 'POST'] },
  { id: 'c', host: 'api.example.com', pathPrefix: '/v1', methods: ['*'] },
  { id: 'd', pathPrefix: '/public', methods: ['GET'] },
];

test('exact host + path prefix match', () => {
  const r = matchRule(rules, 'api.example.com', '/v1/users', 'GET');
  assert.equal(r.id, 'a');
});

test('wildcard host match', () => {
  const r = matchRule(rules, 'sub.example.com', '/v1/orders', 'POST');
  assert.equal(r.id, 'b');
});

test('method wildcard', () => {
  const r = matchRule(rules, 'api.example.com', '/v1/anything', 'DELETE');
  assert.equal(r.id, 'c');
});

test('no host matches any host', () => {
  const r = matchRule(rules, 'other.host', '/public', 'GET');
  assert.equal(r.id, 'd');
});

test('method mismatch on a strict-method rule falls through to wildcard-method rule', () => {
  // rule a (GET only) won't match POST, but rule c (methods: ['*'], prefix /v1) will
  const r = matchRule(rules, 'api.example.com', '/v1/users', 'POST');
  assert.equal(r.id, 'c');
});

test('no match returns null', () => {
  const r = matchRule(rules, 'api.example.com', '/unknown', 'GET');
  assert.equal(r, null);
});

test('path prefix /v1 matches /v1/foo (wildcard-method rule)', () => {
  assert.ok(matchRule(rules, 'api.example.com', '/v1/foo', 'GET'));
});

test('prefix is a string prefix (documented behavior): /v1 also matches /v1users via rule c', () => {
  // matchRule uses startsWith(prefix) — /v1users starts with /v1, so rule c matches.
  // This documents the current semantics; stricter boundary matching is a P1 backlog item.
  const r = matchRule(rules, 'api.example.com', '/v1users', 'GET');
  assert.equal(r.id, 'c');
});

test('empty rules returns null', () => {
  assert.equal(matchRule([], 'api.example.com', '/x', 'GET'), null);
});
