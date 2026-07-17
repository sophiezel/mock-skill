'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  materialize,
  shapeToDataFields,
  buildEnumCases,
  sampleForName,
  isPlaceholderValue,
  resetFakerSeed,
} = require('../lib/materialize');

test('sampleForName: id-like fields are numeric strings', () => {
  resetFakerSeed();
  const id = sampleForName('userId');
  assert.equal(typeof id, 'string');
  assert.ok(/^\d+$/.test(id), id);
  assert.equal(typeof sampleForName('id'), 'string');
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

test('sampleForName: city/address/coords via faker', () => {
  resetFakerSeed();
  const city = sampleForName('city_name');
  assert.equal(typeof city, 'string');
  assert.ok(city.length > 0);
  const addr = sampleForName('address');
  assert.equal(typeof addr, 'string');
  assert.ok(addr.length > 0);
  assert.equal(typeof sampleForName('lng'), 'number');
  assert.equal(typeof sampleForName('lat'), 'number');
});

test('sampleForName: deterministic with fixed seed', () => {
  resetFakerSeed();
  const a = sampleForName('city_name');
  resetFakerSeed();
  const b = sampleForName('city_name');
  assert.equal(a, b);
});

test('materialize: object shape — keys ⊆ props only', () => {
  resetFakerSeed();
  const shape = {
    type: 'object',
    props: {
      id: { type: 'number' },
      name: { type: 'string' },
    },
  };
  const out = materialize(shape);
  assert.deepEqual(Object.keys(out).sort(), ['id', 'name']);
  assert.equal(typeof out.id, 'number');
  assert.equal(typeof out.name, 'string');
  assert.ok(out.name.length > 0);
});

test('materialize: never invents extra fields', () => {
  resetFakerSeed();
  const shape = {
    type: 'object',
    props: {
      city_id: { type: 'unknown' },
      city_name: { type: 'unknown' },
    },
  };
  const out = materialize(shape);
  assert.deepEqual(Object.keys(out).sort(), ['city_id', 'city_name']);
  assert.ok(!('cityId' in out));
});

test('materialize: array of objects', () => {
  resetFakerSeed();
  const shape = {
    type: 'array',
    item: { type: 'object', props: { id: { type: 'number' } } },
  };
  const out = materialize(shape);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 1);
  assert.equal(typeof out[0].id, 'number');
});

test('materialize: empty array item props → []', () => {
  const out = materialize({
    type: 'array',
    item: { type: 'object', props: {} },
  });
  assert.deepEqual(out, []);
});

test('materialize: enum string picks first', () => {
  const shape = { type: 'string', enums: ['pending', 'paid'] };
  assert.equal(materialize(shape), 'pending');
});

test('materialize: empty/null shape → {}', () => {
  assert.deepEqual(materialize(null), {});
  assert.deepEqual(materialize(undefined), {});
});

test('isPlaceholderValue', () => {
  assert.equal(isPlaceholderValue(null), true);
  assert.equal(isPlaceholderValue(''), true);
  assert.equal(isPlaceholderValue('mock'), true);
  assert.equal(isPlaceholderValue([]), true);
  assert.equal(isPlaceholderValue('北京'), false);
  assert.equal(isPlaceholderValue(116.4), false);
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
