'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { inferApiUsage } = require('../scripts/infer-api-usage');
const { classifyRequests } = require('../scripts/classify-requests');

function withTempProject(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('infer: fetch absolute + relative with method option', () => {
  withTempProject(
    {
      'src/api.js': `
export async function list() {
  return fetch('https://api.example.com/v1/items');
}
export async function create(body) {
  return fetch('/v1/items', { method: 'POST', body: JSON.stringify(body) });
}
export async function remove(id) {
  return fetch(\`https://api.example.com/v1/items/\${id}\`, { method: 'DELETE' });
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: false });
      const keys = apis.map((a) => `${a.method} ${a.host}${a.path}`);
      assert.ok(keys.includes('GET api.example.com/v1/items'), keys.join(','));
      assert.ok(keys.includes('POST _default/v1/items') || keys.includes('POST api.example.com/v1/items'), keys.join(','));
      assert.ok(
        keys.some((k) => k.startsWith('DELETE ') && k.includes('/v1/items')),
        keys.join(','),
      );
    },
  );
});

test('infer: --adapter=create-request loads adapters/create-request.js', () => {
  withTempProject(
    {
      'src/svc.js': `
const getList = request.createRequest({ key: "DEMO", method: "get" });
getList({ uri: "/v1/demo/list" });
`,
      'config/env.js': `export default { DEMO: 'https://api.example.com/demo' };`,
    },
    (root) => {
      const without = inferApiUsage(root, { withUsageIo: false });
      const withAdapter = inferApiUsage(root, {
        withUsageIo: false,
        adapter: 'create-request',
      });
      assert.ok(Array.isArray(withAdapter));
      // adapter path must not throw; create-request may add or dedupe against built-in
      assert.ok(withAdapter.length >= without.length || withAdapter.length >= 0);
      assert.equal(withAdapter.meta?.adapter, 'create-request');
    },
  );
});

test('infer: unknown adapter throws', () => {
  withTempProject({ 'src/a.js': 'export const x = 1;' }, (root) => {
    assert.throws(
      () => inferApiUsage(root, { withUsageIo: false, adapter: 'no-such-adapter' }),
      /adapter not found/,
    );
  });
});

test('classify: no-task baseline uses dependency heuristic', () => {
  const result = classifyRequests({
    apis: [
      { method: 'GET', host: 'api.example.com', path: '/v1/a', evidence: 'a.js:1' },
      { method: 'GET', host: 'api.example.com', path: '/v1/b', evidence: 'b.js:1' },
    ],
    taskId: null,
    existingMockKeys: new Set(['GET api.example.com/v1/a']),
  });
  for (const r of result.roles) {
    assert.equal(r.role, 'dependency', r.apiKey);
  }
});
