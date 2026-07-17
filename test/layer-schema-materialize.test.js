'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shapeToJsonSchema,
  jsonSchemaToShape,
  makeExportKey,
} = require('../lib/infer/shape-json-schema');
const { materialize, resetFakerSeed } = require('../lib/materialize');

test('shape ↔ JSON Schema roundtrip keeps props', () => {
  const shape = {
    type: 'object',
    props: {
      list: {
        type: 'array',
        item: {
          type: 'object',
          props: { reasonId: { type: 'unknown' }, reason: { type: 'unknown' } },
        },
      },
      total: { type: 'unknown' },
    },
  };
  const schema = shapeToJsonSchema(shape);
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties.list);
  assert.equal(schema.properties.list.type, 'array');
  const back = jsonSchemaToShape(schema);
  assert.ok(back.props.list);
  assert.ok(back.props.list.item.props.reasonId);
  assert.ok(back.props.total);
});

test('materialize via jsf: list item fields non-null-ish', () => {
  resetFakerSeed();
  const shape = {
    type: 'object',
    props: {
      list: {
        type: 'array',
        item: {
          type: 'object',
          props: {
            reasonId: { type: 'unknown' },
            reason: { type: 'unknown' },
            typeDesc: { type: 'unknown' },
          },
        },
      },
      total: { type: 'unknown' },
      currentPage: { type: 'unknown' },
    },
  };
  const data = materialize(shape);
  assert.ok(Array.isArray(data.list));
  assert.ok(data.list.length >= 1);
  assert.ok(data.list[0].reasonId != null && data.list[0].reasonId !== '');
  assert.ok(Object.keys(data).sort().join(',') === 'currentPage,list,total');
});

test('makeExportKey is file#name', () => {
  assert.equal(
    makeExportKey('src/services/rejectReason/index.tsx', 'getReasonList'),
    'src/services/rejectReason/index.tsx#getReasonList',
  );
});
