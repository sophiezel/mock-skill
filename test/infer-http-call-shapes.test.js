'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractPrefixOriginEntriesFromContent,
  resolveRelativePath,
  discoverPrefixOriginMaps,
} = require('../lib/infer/prefix-origin-map');
const {
  extractHttpCallShapeApis,
  parseUrlLiteral,
  isHttpImportSource,
} = require('../lib/infer/http-call-shapes');
const { inferApiUsage } = require('../scripts/infer-api-usage');
const { loadInferConfig } = require('../lib/infer/load-infer-config');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'umi-request-web');

test('isHttpImportSource matches configured modules', () => {
  assert.equal(isHttpImportSource('@umijs/max', ['@umijs/max']), true);
  assert.equal(isHttpImportSource('lodash', ['@umijs/max']), false);
});

test('parseUrlLiteral relative and abs', () => {
  assert.deepEqual(parseUrlLiteral('/a/b'), { kind: 'relative', path: '/a/b' });
  const abs = parseUrlLiteral('https://api.example.com/v1/x');
  assert.equal(abs.kind, 'abs');
  assert.equal(abs.host, 'api.example.com');
  assert.equal(abs.path, '/v1/x');
  assert.equal(parseUrlLiteral('/users/${id}'), null);
});

test('prefix-origin structural scan (not symbol-bound)', () => {
  const src = `
    export const FOO = [
      {
        prefixList: ['/permission'],
        originConfig: {
          development: 'https://gateway-dev.example.com/enterprise-platform',
        },
      },
      {
        prefixList: ['/external'],
        originConfig: {
          development: 'https://api-dev.example.com/eva-schedule',
        },
      },
    ];
  `;
  const entries = extractPrefixOriginEntriesFromContent(src);
  assert.ok(entries.some((e) => e.prefix === '/permission'));
  assert.ok(entries.some((e) => e.prefix === '/external' && e.host === 'api-dev.example.com'));
});

test('resolveRelativePath longest prefix + originPrefix join', () => {
  const maps = [
    {
      prefix: '/',
      host: 'api.example.com',
      originPrefix: '',
      env: 'online',
      originUrl: 'https://api.example.com',
    },
    {
      prefix: '/external',
      host: 'api.example.com',
      originPrefix: '/eva-schedule',
      env: 'online',
      originUrl: 'https://api.example.com/eva-schedule',
    },
  ];
  const hit = resolveRelativePath('/external/panel/list', maps);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].host, 'api.example.com');
  assert.equal(hit[0].path, '/eva-schedule/external/panel/list');

  const root = resolveRelativePath('/eva-schedule/external/x', maps);
  assert.equal(root[0].path, '/eva-schedule/external/x');
});

test('CallShape AST: direct + config + import alias + exportHint', () => {
  const wrappers = loadInferConfig().httpWrappers;
  const files = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js)$/.test(ent.name)) files.push(full);
    }
  }
  walk(path.join(FIXTURE, 'src'));
  const prefixMaps = discoverPrefixOriginMaps(FIXTURE, files);
  assert.ok(prefixMaps.length >= 2, 'prefix maps discovered');

  const apis = extractHttpCallShapeApis({
    projectDir: FIXTURE,
    files,
    hostVars: new Map(),
    serviceBases: [],
    wrappers,
    callShapes: ['member', 'direct', 'config'],
    importSources: ['@umijs/max'],
    prefixMaps,
    isGatewayOnlyPath: () => false,
  });

  const hints = new Set(apis.map((a) => a.exportHint).filter(Boolean));
  assert.ok(hints.has('getCurrentUser'), `hints=${[...hints]}`);
  assert.ok(hints.has('getPanelList'));
  assert.ok(hints.has('createPanel'));
  assert.ok(hints.has('listTasks'));
  assert.ok(hints.has('getTaskById'));

  const panel = apis.find((a) => a.exportHint === 'getPanelList');
  assert.ok(panel);
  assert.equal(panel.method, 'GET');
  assert.match(panel.path, /\/eva-schedule\/external\/panel\/list/);

  const create = apis.find((a) => a.exportHint === 'createPanel');
  assert.equal(create.method, 'POST');

  const detail = apis.find((a) => a.exportHint === 'getTaskById');
  assert.ok(detail, 'config shape getTaskById');
  assert.match(detail.path, /cars-task\/external\/evaluate\/task\/detail/);
});

test('inferApiUsage on umi-request-web fixture discovers business APIs', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false, forceRefresh: true });
  assert.ok(apis.length >= 5, `expected >=5 apis, got ${apis.length}`);
  const withHint = apis.filter((a) => a.exportHint);
  assert.ok(withHint.length >= 5, `expected exportHints, got ${withHint.length}`);
  // Should not be only gateway shells
  assert.ok(
    apis.some((a) => (a.path || '').split('/').filter(Boolean).length >= 3),
    'expected deep business paths',
  );
});

test('member shape still works for axios.get', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'callshape-'));
  const srcDir = path.join(tmp, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, 'api.js'),
    `
import axios from 'axios';
export function listUsers() {
  return axios.get('https://api.example.com/v1/users');
}
export function createUser(body) {
  return axios.post('https://api.example.com/v1/users', body);
}
`,
  );
  const files = [path.join(srcDir, 'api.js')];
  const apis = extractHttpCallShapeApis({
    projectDir: tmp,
    files,
    hostVars: new Map(),
    serviceBases: [],
    wrappers: loadInferConfig().httpWrappers,
    callShapes: ['member', 'direct', 'config'],
    importSources: ['axios'],
    prefixMaps: [],
    isGatewayOnlyPath: () => false,
  });
  assert.ok(apis.some((a) => a.method === 'GET' && a.path === '/v1/users'));
  assert.ok(apis.some((a) => a.method === 'POST' && a.exportHint === 'createUser'));
  fs.rmSync(tmp, { recursive: true, force: true });
});
