'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inferApiUsage } = require('../scripts/infer-api-usage');

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/declarative-custom-web');

function shapeKeys(api) {
  const props = api?.responseShape?.props || {};
  if (api?.responseShape?.type === 'array') {
    return Object.keys(api?.responseShape?.item?.props || {});
  }
  return Object.keys(props);
}

test('P2-FX3: project-declared DeclarativeFieldSource plugin extracts fields from custom prop names (rows/fields/key)', () => {
  const apis = inferApiUsage(FIXTURE_ROOT, { forceRefresh: true });
  const hit = apis.find(
    (a) => a.path === '/v1/tags' && a.method === 'GET',
  );
  assert.ok(hit, `expected GET /v1/tags, got: ${JSON.stringify(apis.map((a) => `${a.method} ${a.path}`))}`);
  const keys = shapeKeys(hit);
  assert.ok(keys.includes('id'), `id missing from shape: ${keys.join(',')}`);
  assert.ok(keys.includes('label'), `label missing from shape: ${keys.join(',')}`);
  assert.ok(!keys.includes('action'), `action should be skipped: ${keys.join(',')}`);
});

test('P2-FX4: custom fixture uses no built-in prop names (rows/fields/key, not dataSource/columns)', () => {
  const fs = require('fs');
  const page = fs.readFileSync(
    path.join(FIXTURE_ROOT, 'src/pages/tagsListPage.js'),
    'utf8',
  );
  assert.ok(/rows=/.test(page), 'fixture uses custom rows prop');
  assert.ok(/fields=/.test(page), 'fixture uses custom fields prop');
  assert.ok(!/dataSource=/.test(page), 'fixture must NOT use built-in dataSource prop');
});
