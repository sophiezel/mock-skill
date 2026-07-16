'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  materialize,
  shapeToDataFields,
  buildEnumCases,
  sampleForName,
} = require('../lib/materialize');

test('sampleForName: id-like fields', () => {
  assert.equal(sampleForName('userId'), '1');
  assert.equal(sampleForName('id'), '1');
  // 'name' matches /Name$/ → 'mock'
  assert.equal(sampleForName('name'), 'mock');
});

test('sampleForName: count/total/num → 0', () => {
  assert.equal(sampleForName('totalCount'), 0);
  assert.equal(sampleForName('userNum'), 0);
});

test('sampleForName: list/items → []', () => {
  assert.deepEqual(sampleForName('orderList'), []);
  assert.deepEqual(sampleForName('items'), []);
});

test('sampleForName: boolean prefixes', () => {
  assert.equal(sampleForName('isEnabled'), false);
  assert.equal(sampleForName('hasStock'), false);
});

test('materialize: object shape', () => {
  const shape = {
    type: 'object',
    props: {
      id: { type: 'number' },
      name: { type: 'string' },
    },
  };
  const out = materialize(shape);
  // sampleForName('id') → '1', sampleForName('name') → 'mock'
  assert.deepEqual(out, { id: '1', name: 'mock' });
});

test('materialize: array of objects', () => {
  const shape = {
    type: 'array',
    item: { type: 'object', props: { id: { type: 'number' } } },
  };
  const out = materialize(shape);
  assert.deepEqual(out, [{ id: '1' }]);
});

test('materialize: enum string picks first', () => {
  const shape = { type: 'string', enums: ['pending', 'paid'] };
  assert.equal(materialize(shape), 'pending');
});

test('materialize: empty/null shape → {}', () => {
  assert.deepEqual(materialize(null), {});
  assert.deepEqual(materialize(undefined), {});
});

test('buildEnumCases produces enum-coded cases', () => {
  const shape = {
    type: 'object',
    props: {
      status: { type: 'string', enums: ['pending', 'paid'] },
    },
  };
  const cases = buildEnumCases(shape, { status: 'pending' });
  assert.ok(cases.length >= 2);
  assert.ok(cases.some((c) => c.id.includes('pending')));
  assert.ok(cases.some((c) => c.id.includes('paid')));
});

test('shapeToDataFields returns field map', () => {
  const shape = { type: 'object', props: { id: { type: 'number' } } };
  const fields = shapeToDataFields(shape);
  assert.ok('id' in fields);
});
