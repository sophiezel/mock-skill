'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  getStore,
  resetStore,
  appendJournal,
  readJournal,
  _resetAllForTests,
} = require('../lib/service-store');

beforeEach(() => {
  _resetAllForTests();
});

test('KV put/get/delete with TTL expiry', async () => {
  const s = getStore('demo-svc');
  s.put('cart', { items: [1] });
  assert.deepEqual(s.get('cart'), { items: [1] });
  s.put('temp', 'x', 0.01);
  assert.equal(s.get('temp'), 'x');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.get('temp'), null);
  s.delete('cart');
  assert.equal(s.get('cart'), null);
});

test('collections CRUD shared across getStore same upstream', () => {
  const a = getStore('api');
  a.collectionPut('users', '1', { name: 'Ada' });
  const b = getStore('api');
  assert.deepEqual(b.collectionGet('users', '1'), { id: '1', name: 'Ada' });
  assert.equal(b.collectionList('users').length, 1);
  b.collectionDelete('users', '1');
  assert.equal(a.collectionList('users').length, 0);
});

test('resetStore clears one or all', () => {
  getStore('a').put('k', 1);
  getStore('b').put('k', 2);
  resetStore('a');
  assert.equal(getStore('a').get('k'), null);
  assert.equal(getStore('b').get('k'), 2);
  resetStore('*');
  assert.equal(getStore('b').get('k'), null);
});

test('journal append and limit', () => {
  appendJournal({ stubId: 'GET a/x', method: 'GET', path: '/x', upstreamId: 'a' });
  appendJournal({ stubId: 'POST a/x', method: 'POST', path: '/x', upstreamId: 'a' });
  const entries = readJournal(1);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].method, 'POST');
});
