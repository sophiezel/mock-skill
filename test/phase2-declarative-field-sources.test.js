'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_FIELD_SOURCES,
  getDeclarativeFieldSources,
  registerFieldSource,
  extractDataIndexes,
} = require('../lib/infer/declarative-field-sources');

test('P2-DF1: built-in field sources cover Table columns.dataIndex and Select fieldNames', () => {
  const names = BUILTIN_FIELD_SOURCES.map((p) => p.name);
  assert.ok(names.includes('table-columns-dataIndex'));
  assert.ok(names.includes('select-fieldNames'));
});

test('P2-DF2: built-in plugins are generic (no antd / brand strings)', () => {
  const serialized = JSON.stringify(BUILTIN_FIELD_SOURCES);
  assert.ok(!/antd|ant-design|guazi|tower/i.test(serialized), 'brand leak in built-in field sources');
});

test('P2-DF3: each built-in plugin declares dataSourceProp + columnsProp + fieldKey', () => {
  for (const p of BUILTIN_FIELD_SOURCES) {
    assert.ok(p.name, 'plugin name missing');
    assert.ok(p.dataSourceProp, `${p.name} dataSourceProp missing`);
    assert.ok(p.columnsProp, `${p.name} columnsProp missing`);
    assert.ok(p.fieldKey, `${p.name} fieldKey missing`);
    assert.equal(typeof p.extract, 'function', `${p.name} extract missing`);
  }
});

test('P2-DF4: registerFieldSource adds a custom plugin retrievable by getDeclarativeFieldSources', () => {
  const custom = {
    name: 'custom-grid-fields',
    dataSourceProp: 'rows',
    columnsProp: 'fields',
    fieldKey: 'key',
    extract: () => [],
  };
  const before = getDeclarativeFieldSources().length;
  registerFieldSource(custom);
  const after = getDeclarativeFieldSources();
  assert.ok(after.length === before + 1);
  assert.ok(after.some((p) => p.name === 'custom-grid-fields'));
});

test('P2-DF5: getDeclarativeFieldSources merges built-ins with project config entries', () => {
  const projectSources = [
    { name: 'proj-datagrid', dataSourceProp: 'data', columnsProp: 'config', fieldKey: 'dataIndex' },
  ];
  const merged = getDeclarativeFieldSources(projectSources);
  assert.ok(merged.some((p) => p.name === 'table-columns-dataIndex'));
  assert.ok(merged.some((p) => p.name === 'proj-datagrid'));
});

test('P2-DF6: extractDataIndexes reads string dataIndex from a columns array literal (synthetic)', () => {
  // Simulate the shape of a ts-morph columns expression via a tiny stub.
  // extractDataIndexes is a pure helper operating on a normalized node-like API.
  const fakeColumns = {
    getKindName: () => 'ArrayLiteralExpression',
    getElements: () => [
      {
        getKindName: () => 'ObjectLiteralExpression',
        getProperties: () => [
          { getKindName: () => 'PropertyAssignment', getName: () => 'title', getInitializer: () => ({ getKindName: () => 'StringLiteral', getLiteralValue: () => 'Name' }) },
          { getKindName: () => 'PropertyAssignment', getName: () => 'dataIndex', getInitializer: () => ({ getKindName: () => 'StringLiteral', getLiteralValue: () => 'userName' }) },
        ],
      },
      {
        getKindName: () => 'ObjectLiteralExpression',
        getProperties: () => [
          { getKindName: () => 'PropertyAssignment', getName: () => 'dataIndex', getInitializer: () => ({ getKindName: () => 'StringLiteral', getLiteralValue: () => 'age' }) },
        ],
      },
    ],
  };
  const out = extractDataIndexes(fakeColumns, { getKindName: () => 'SyntaxKind' });
  assert.deepEqual(out, ['userName', 'age']);
});

test('P2-DF7: extractDataIndexes skips action/operation dataIndex', () => {
  const fakeColumns = {
    getKindName: () => 'ArrayLiteralExpression',
    getElements: () => [
      {
        getKindName: () => 'ObjectLiteralExpression',
        getProperties: () => [
          { getKindName: () => 'PropertyAssignment', getName: () => 'dataIndex', getInitializer: () => ({ getKindName: () => 'StringLiteral', getLiteralValue: () => 'action' }) },
          { getKindName: () => 'PropertyAssignment', getName: () => 'dataIndex', getInitializer: () => ({ getKindName: () => 'StringLiteral', getLiteralValue: () => 'id' }) },
        ],
      },
    ],
  };
  const out = extractDataIndexes(fakeColumns, { getKindName: () => 'SyntaxKind' });
  assert.deepEqual(out, ['id']);
});
