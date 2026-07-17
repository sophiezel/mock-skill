'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { inferApiUsage } = require('../scripts/infer-api-usage');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'usage-export-patterns');

test('export patterns: prefix:"" keeps env pathname', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false });
  const hit = apis.find((a) => a.path.includes('/external/item/detail'));
  assert.ok(hit, 'item detail discovered');
  assert.ok(
    hit.path.includes('/demo-svc') || hit.path.startsWith('/demo-svc'),
    `expected env prefix in path, got ${hit.path}`,
  );
  assert.equal(hit.host, 'api.example.com');
});

test('export patterns: async wrapper binds exportHint', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false });
  const hit = apis.find((a) => a.path.includes('/external/item/detail'));
  assert.ok(hit);
  assert.equal(hit.exportHint, 'getItemDetail');
});

test('export patterns: async wrapper binds despite long type signature', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false });
  const hit = apis.find((a) => a.path.includes('/external/item/manage/list'));
  assert.ok(hit, 'manage list API discovered');
  assert.equal(hit.exportHint, 'getMisapplyManageList');
});

test('export patterns: export default { } binds exportHint', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false });
  const hit = apis.find((a) => a.path.includes('/external/order/info'));
  assert.ok(hit, 'order info discovered');
  assert.equal(hit.exportHint, 'getOrder');
});

test('export patterns: usage-io yields fields without no_export_symbol', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: true });
  const hit = apis.find((a) => a.path.includes('/external/item/detail'));
  assert.ok(hit);
  assert.ok(
    !hit.coverage?.gaps?.includes('no_export_symbol'),
    `gaps=${JSON.stringify(hit.coverage?.gaps)}`,
  );
  const props = Object.keys(hit.responseShape?.props || {});
  for (const f of ['item_id', 'item_name', 'price']) {
    assert.ok(props.includes(f), `missing ${f} in ${props.join(',')}`);
  }
});

test('request.get({ key, uri }) discovers with service host', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-req-'));
  try {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'config', 'env.js'),
      `export const env = { DEMO_HOST: 'https://api.example.com/demo-svc' };`,
    );
    fs.writeFileSync(
      path.join(root, 'src', 'api.js'),
      `
export const getFollow = request.get({
  key: 'DEMO_HOST',
  uri: '/external/follow/up/list',
});
`,
    );
    const apis = inferApiUsage(root, { withUsageIo: false });
    const hit = apis.find((a) => a.path.includes('/external/follow/up/list'));
    assert.ok(hit, `apis=${JSON.stringify(apis.map((a) => a.path))}`);
    assert.equal(hit.host, 'api.example.com');
    assert.ok(hit.path.includes('/demo-svc'));
    assert.equal(hit.method, 'GET');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan hygiene: skips e2e and spec files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-skip-'));
  try {
    fs.mkdirSync(path.join(root, 'e2e'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'e2e', 'foo.spec.ts'),
      `url.includes('/customer/detail/v2');`,
    );
    fs.writeFileSync(
      path.join(root, 'src', 'page.test.ts'),
      `navigate('/v2/unknown');`,
    );
    fs.writeFileSync(
      path.join(root, 'config', 'env.js'),
      `export const env = { API: 'https://api.example.com/v1' };`,
    );
    const apis = inferApiUsage(root, { withUsageIo: false });
    assert.ok(
      !apis.some((a) => a.path.includes('/customer/detail')),
      'e2e path should not be discovered',
    );
    assert.ok(
      !apis.some((a) => a.path.includes('/v2/unknown')),
      'test file SPA path should not be discovered',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
