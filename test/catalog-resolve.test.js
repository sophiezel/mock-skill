'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-catalog-api-'));
process.env.MOCK_SKILL_DATA_ROOT = tmpRoot;

const {
  writeProjectIndex,
  loadContractsForCatalog,
  handlerExistsForContract,
  listMockKeysForCatalog,
  mocksRootFor,
  upsertServiceRules,
} = require('../lib/catalog-merge');
const {
  ensureServiceDirs,
  serviceStubHandlerPath,
  serviceContractPath,
  projectDataDir,
} = require('../lib/paths');

before(() => {
  process.env.MOCK_SKILL_DATA_ROOT = tmpRoot;
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('loadContractsForCatalog prefers service truth + project mirror', () => {
  ensureServiceDirs('api');
  writeProjectIndex('demo', {
    stubs: ['GET api/v1/items'],
    upstreams: ['api'],
  });
  const svcContract = {
    id: 'GET api/v1/items',
    stubId: 'GET api/v1/items',
    upstreamId: 'api',
    method: ['GET'],
    path: '/v1/items',
    hosts: ['api.example.com'],
  };
  fs.writeFileSync(
    serviceContractPath('api', 'GET__api__v1__items'),
    `${JSON.stringify(svcContract, null, 2)}\n`,
  );
  const mirrorDir = path.join(projectDataDir('demo'), 'contracts');
  fs.mkdirSync(mirrorDir, { recursive: true });
  fs.writeFileSync(
    path.join(mirrorDir, 'GET__api__v1__items.json'),
    `${JSON.stringify({ ...svcContract, note: 'mirror' }, null, 2)}\n`,
  );

  const list = loadContractsForCatalog('demo');
  assert.equal(list.length, 1);
  assert.equal(list[0].stubId, 'GET api/v1/items');
});

test('handlerExistsForContract reads service handlers', () => {
  ensureServiceDirs('shop');
  const file = serviceStubHandlerPath('shop', 'GET', '/items');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'module.exports = () => ({});\n');
  assert.equal(
    handlerExistsForContract({
      stubId: 'GET shop/items',
      upstreamId: 'shop',
      method: ['GET'],
      path: '/items',
    }),
    true,
  );
  assert.equal(
    handlerExistsForContract({
      stubId: 'GET shop/missing',
      upstreamId: 'shop',
      method: ['GET'],
      path: '/missing',
    }),
    false,
  );
});

test('listMockKeysForCatalog includes stubId when handler exists', () => {
  ensureServiceDirs('kv');
  writeProjectIndex('app', { stubs: ['GET kv/x'], upstreams: ['kv'] });
  upsertServiceRules('kv', [
    {
      stubId: 'GET kv/x',
      upstreamId: 'kv',
      pathPrefix: '/x',
      methods: ['GET'],
      hosts: ['kv.example.com'],
    },
  ]);
  const file = serviceStubHandlerPath('kv', 'GET', '/x');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'module.exports = () => ({});\n');
  fs.writeFileSync(
    serviceContractPath('kv', 'GET__kv__x'),
    `${JSON.stringify({
      id: 'GET kv/x',
      stubId: 'GET kv/x',
      upstreamId: 'kv',
      method: ['GET'],
      path: '/x',
      hosts: ['kv.example.com'],
    })}\n`,
  );

  const keys = listMockKeysForCatalog('app');
  assert.ok(keys.has('GET kv/x'));
  assert.ok(keys.has('GET kv.example.com/x'));
});

test('mocksRootFor points at services when present', () => {
  ensureServiceDirs('svc');
  fs.mkdirSync(path.join(require('../lib/paths').serviceDataDir('svc'), 'mocks'), {
    recursive: true,
  });
  assert.ok(mocksRootFor('svc').includes(`${path.sep}services${path.sep}svc`));
});
