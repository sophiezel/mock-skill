'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  inferApiUsage,
  discoverHostVarAssignments,
  extractLegacyApis,
} = require('../scripts/infer-api-usage');

function withTempProject(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infer-http-'));
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

const SERVICE_SRC = `
let apiPrefix
let apiOrder
;(function () {
  if (true) {
    apiPrefix = '//api.chesupai.cn'
    apiOrder = '//csp-order-api.guazi.com'
  } else if (false) {
    apiPrefix = '//api-preview.chesupai.cn'
    apiOrder = '//csp-order-api-preview.guazi-apps.com'
  } else if (false) {
    apiPrefix = '//appstage.chesupai.net.cn'
    apiOrder = '//csp-order-api.guazi-stage.com'
  } else {
    apiPrefix = '//apitest.chesupai.net.cn'
    apiOrder = '//csp-order-api.guazi-cloud.com'
  }
})()

const getList = (data) =>
  $HTTP.getP(\`\${ apiPrefix }/exposure/sunflower/list\`, data)
const commitOrder = (data) =>
  $HTTP.postP(\`\${ apiOrder }/order/commit\`, data)
const getToken = (data) =>
  $HTTP.getP('//csp-bc-test.guazi-cloud.com/getToken', data)
const dynamicUser = (id) =>
  $HTTP.getP(\`\${ apiPrefix }/users/\${id}\`, id)

export { getList, commitOrder, getToken, dynamicUser }
`;

test('discoverHostVarAssignments: keeps all env hosts for apiPrefix', () => {
  withTempProject({ 'src/service/index.js': SERVICE_SRC }, (root) => {
    const map = discoverHostVarAssignments(root);
    const hosts = (map.get('apiPrefix') || []).map((h) => h.host).sort();
    assert.deepEqual(hosts, [
      'api-preview.chesupai.cn',
      'api.chesupai.cn',
      'apitest.chesupai.net.cn',
      'appstage.chesupai.net.cn',
    ]);
  });
});

test('infer: $HTTP.getP `${apiPrefix}/path` expands all env hosts', () => {
  withTempProject({ 'src/service/index.js': SERVICE_SRC }, (root) => {
    const apis = inferApiUsage(root, { withUsageIo: false, forceRefresh: true });
    const listApis = apis.filter(
      (a) => a.path === '/exposure/sunflower/list' && a.method === 'GET',
    );
    assert.equal(listApis.length, 4, JSON.stringify(listApis));
    const hosts = listApis.map((a) => a.host).sort();
    assert.deepEqual(hosts, [
      'api-preview.chesupai.cn',
      'api.chesupai.cn',
      'apitest.chesupai.net.cn',
      'appstage.chesupai.net.cn',
    ]);
    assert.ok(listApis.every((a) => a.exportHint === 'getList'));
  });
});

test('infer: $HTTP.postP maps to POST and expands apiOrder hosts', () => {
  withTempProject({ 'src/service/index.js': SERVICE_SRC }, (root) => {
    const apis = inferApiUsage(root, { withUsageIo: false, forceRefresh: true });
    const posts = apis.filter((a) => a.path === '/order/commit');
    assert.equal(posts.length, 4, JSON.stringify(posts));
    assert.ok(posts.every((a) => a.method === 'POST'));
    assert.ok(posts.every((a) => a.exportHint === 'commitOrder'));
  });
});

test('infer: $HTTP absolute protocol-relative URL', () => {
  withTempProject({ 'src/service/index.js': SERVICE_SRC }, (root) => {
    const apis = inferApiUsage(root, { withUsageIo: false, forceRefresh: true });
    const hit = apis.find(
      (a) =>
        a.host === 'csp-bc-test.guazi-cloud.com' && a.path === '/getToken',
    );
    assert.ok(hit, JSON.stringify(apis.slice(0, 5)));
    assert.equal(hit.method, 'GET');
    assert.equal(hit.exportHint, 'getToken');
  });
});

test('infer: location.href navigation URLs are not discovered', () => {
  withTempProject(
    {
      'src/page.js': `
export function goContract(clueId) {
  window.location.href = \`https://bm.guazi.com/evaluate/contract?clue_id=\${clueId}\`
}
export function openDetail() {
  location.href = 'https://app.chesupai.net.cn/v2/detail?id=1'
}
export function openWeb() {
  this.$NativeAPI.invoke('createWebView', { url: 'https://xrk.guazi.com/xrk-h5/gz-score' })
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: false, forceRefresh: true });
      const keys = apis.map((a) => `${a.host}${a.path}`);
      assert.ok(!keys.some((k) => k.includes('bm.guazi.com')), keys.join(','));
      assert.ok(!keys.some((k) => k.includes('/v2/detail')), keys.join(','));
      assert.ok(!keys.some((k) => k.includes('gz-score')), keys.join(','));
    },
  );
});

test('infer: path with unresolved ${id} is dropped', () => {
  withTempProject({ 'src/service/index.js': SERVICE_SRC }, (root) => {
    const apis = inferApiUsage(root, { withUsageIo: false, forceRefresh: true });
    assert.ok(
      !apis.some((a) => /\/users\//.test(a.path)),
      apis.filter((a) => /users/.test(a.path)).map((a) => a.path).join(','),
    );
  });
});

test('extractLegacyApis: expands with injected hostVars map', () => {
  const content = `
apiPrefix = '//a.example.com'
apiPrefix = '//b.example.com'
const getX = () => $HTTP.getP(\`\${apiPrefix}/v1/items\`, {})
export { getX }
`;
  const hostVars = new Map([
    [
      'apiPrefix',
      [
        { host: 'a.example.com', prefix: '' },
        { host: 'b.example.com', prefix: '' },
      ],
    ],
  ]);
  const apis = extractLegacyApis(content, 'src/s.js', [], hostVars);
  assert.equal(apis.length, 2);
  assert.ok(apis.every((a) => a.exportHint === 'getX'));
  assert.deepEqual(apis.map((a) => a.host).sort(), ['a.example.com', 'b.example.com']);
});
