'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inferApiUsage } = require('../scripts/infer-api-usage');

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/declarative-grid-web');

function shapeKeys(api) {
  const props = api?.responseShape?.props || {};
  const keys = Object.keys(props);
  if (api?.responseShape?.type === 'array') {
    const itemProps = api?.responseShape?.item?.props || {};
    return Object.keys(itemProps);
  }
  return keys;
}

test('P2-FX1: DeclarativeFieldSource extracts fields from generic (non-antd) DataGrid columns', () => {
  const apis = inferApiUsage(FIXTURE_ROOT, { forceRefresh: true });
  const hit = apis.find(
    (a) => a.path === '/v1/items' && a.method === 'GET',
  );
  assert.ok(hit, `expected GET /v1/items, got: ${JSON.stringify(apis.map((a) => `${a.method} ${a.path}`))}`);
  const keys = shapeKeys(hit);
  // Fields should come from columns[].dataIndex (id, name, price), NOT 'action'
  assert.ok(keys.includes('id'), `id missing from shape: ${keys.join(',')}`);
  assert.ok(keys.includes('name'), `name missing from shape: ${keys.join(',')}`);
  assert.ok(keys.includes('price'), `price missing from shape: ${keys.join(',')}`);
  assert.ok(!keys.includes('action'), `action should be skipped: ${keys.join(',')}`);
});

test('P2-FX2: fixture uses no antd / brand imports (proves generality)', () => {
  // Sanity: the fixture page must not import antd/Table — the plugin matches by prop name.
  const fs = require('fs');
  const page = fs.readFileSync(
    path.join(FIXTURE_ROOT, 'src/pages/itemsGridPage.js'),
    'utf8',
  );
  assert.ok(!/antd|ant-design|@ant-design/i.test(page), 'fixture must not use antd');
  assert.ok(/DataGrid/.test(page), 'fixture uses a generic DataGrid component');
});
