'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBindingGraph } = require('../lib/infer/binding-graph');

test('drainTransfers: ObjLiteralProp + JsxPropLink → list item fields', () => {
  const shape = { type: 'object', props: {} };
  const paths = [];
  const g = createBindingGraph(shape, paths);
  g.drainTransfers([
    {
      type: 'ObjLiteralProp',
      stateAlias: 'tableData',
      prop: 'list',
      binding: { kind: 'path', path: ['list'] },
      asArray: true,
    },
    {
      type: 'ObjLiteralProp',
      stateAlias: 'tableData',
      prop: 'total',
      binding: { kind: 'path', path: ['total'] },
    },
    {
      type: 'JsxPropLink',
      arrayPath: ['list'],
      dataIndexes: ['reasonId', 'reason', 'typeDesc'],
    },
  ]);
  assert.ok(shape.props.list);
  assert.equal(shape.props.list.type, 'array');
  assert.ok(shape.props.list.item.props.reasonId);
  assert.ok(shape.props.list.item.props.reason);
  assert.ok(shape.props.total);
});

test('drainTransfers: Assign + IterItem + MemberRead', () => {
  const shape = { type: 'object', props: {} };
  const g = createBindingGraph(shape, []);
  g.drainTransfers([
    {
      type: 'Assign',
      alias: 'rows',
      binding: { kind: 'path', path: ['items'] },
      asArray: true,
    },
    { type: 'IterItem', itemAlias: 'row', arrayPath: ['items'] },
    { type: 'MemberRead', alias: 'row', members: ['cityId'] },
  ]);
  assert.equal(shape.props.items.type, 'array');
  assert.ok(shape.props.items.item.props.cityId);
});

test('drainTransfers: JsxPropLink Select fieldNames → root array item props', () => {
  const shape = { type: 'object', props: {} };
  const g = createBindingGraph(shape, []);
  g.drainTransfers([
    {
      type: 'Assign',
      alias: 'detectOptions',
      binding: { kind: 'root' },
      asArray: true,
    },
    {
      type: 'JsxPropLink',
      arrayPath: [],
      dataIndexes: ['itemName', 'itemId'],
    },
  ]);
  assert.equal(shape.type, 'array');
  assert.ok(shape.item.props.itemName);
  assert.ok(shape.item.props.itemId);
});

test('bindItemAlias under nested itemList → nested item props', () => {
  const shape = { type: 'object', props: {} };
  const g = createBindingGraph(shape, []);
  g.drainTransfers([
    {
      type: 'Assign',
      alias: 'originData',
      binding: { kind: 'root' },
      asArray: true,
    },
  ]);
  g.bindItemAlias('detail', []);
  g.applyMember('detail', ['dirDesc']);
  g.bindItemAlias('item', [], ['itemList']);
  g.applyMember('item', ['itemName']);
  g.applyMember('item', ['itemId']);
  assert.equal(shape.type, 'array');
  assert.ok(shape.item.props.dirDesc);
  assert.equal(shape.item.props.itemList.type, 'array');
  assert.ok(shape.item.props.itemList.item.props.itemName);
  assert.ok(shape.item.props.itemList.item.props.itemId);
});
