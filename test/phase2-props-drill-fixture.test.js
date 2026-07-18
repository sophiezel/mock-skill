'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inferApiUsage } = require('../scripts/infer-api-usage');

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/props-drill-web');

function shapeKeys(api) {
  const props = api?.responseShape?.props || {};
  if (api?.responseShape?.type === 'array') {
    return Object.keys(api?.responseShape?.item?.props || {});
  }
  return Object.keys(props);
}

test('P2-PD1: one-layer cross-file props-drill propagates child field reads to parent response shape', () => {
  const apis = inferApiUsage(FIXTURE_ROOT, { forceRefresh: true });
  const hit = apis.find(
    (a) => a.method === 'GET' && /\/v1\/detail\//.test(a.path),
  );
  assert.ok(hit, `expected GET /v1/detail/:id, got: ${JSON.stringify(apis.map((a) => `${a.method} ${a.path}`))}`);
  const keys = shapeKeys(hit);
  // Child DetailCard reads detail.name / detail.price / detail.sku.
  // One-layer props-drill should surface these on the response shape.
  assert.ok(keys.includes('name'), `name missing from shape: ${keys.join(',')}`);
  assert.ok(keys.includes('price'), `price missing from shape: ${keys.join(',')}`);
  assert.ok(keys.includes('sku'), `sku missing from shape: ${keys.join(',')}`);
});

test('P2-PD2: props-drill fixture uses no UI-library imports', () => {
  const fs = require('fs');
  const files = [
    'src/pages/detailPage.js',
    'src/components/DetailCard.js',
  ];
  for (const rel of files) {
    const body = fs.readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8');
    assert.ok(!/antd|ant-design|@ant-design/i.test(body), `${rel} must not use antd`);
  }
});
