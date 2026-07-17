'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeDataAdditive } = require('../scripts/capture-merge');

test('mergeDataAdditive: real capture overwrites faker placeholder', () => {
  const existing = { city_id: '42', city_name: '某市', address: null };
  const incoming = { city_id: 110100, city_name: '北京市', address: '朝阳区xxx', lng: 116.4 };
  const out = mergeDataAdditive(existing, incoming);
  assert.equal(out.city_id, 110100);
  assert.equal(out.city_name, '北京市');
  assert.equal(out.address, '朝阳区xxx');
  assert.equal(out.lng, 116.4);
});

test('mergeDataAdditive: adds keys present only in real response', () => {
  const out = mergeDataAdditive({ a: 1 }, { a: 1, b: 2 });
  assert.deepEqual(out, { a: 1, b: 2 });
});

test('mergeDataAdditive: nested objects', () => {
  const out = mergeDataAdditive(
    { nest: { x: 'mock', y: null } },
    { nest: { x: 'real', y: 2, z: 3 } },
  );
  assert.deepEqual(out, { nest: { x: 'real', y: 2, z: 3 } });
});
