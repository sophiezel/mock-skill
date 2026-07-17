'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  generateMocks,
  pruneOrphanArtifacts,
} = require('../scripts/generate-mock');
const { projectDataDir, mockHandlerPath, contractPath, apiKey } = require('../lib/paths');

function withTempProject(fn) {
  const slug = `prune-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const root = projectDataDir(slug);
  fs.mkdirSync(path.join(root, 'mocks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audit'), { recursive: true });
  try {
    return fn(slug);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('generate force: prunes orphan handlers and contracts', () => {
  withTempProject((slug) => {
    const orphanHost = 'www.w3.org';
    const orphanPath = '/2000/svg';
    const orphanHandler = mockHandlerPath(slug, orphanHost, orphanPath);
    fs.mkdirSync(path.dirname(orphanHandler), { recursive: true });
    fs.writeFileSync(orphanHandler, 'module.exports = () => ({});\n');
    const orphanKey = apiKey({ host: orphanHost, method: 'GET', path: orphanPath });
    fs.writeFileSync(
      contractPath(slug, orphanKey),
      JSON.stringify({ id: orphanKey, host: orphanHost, path: orphanPath, method: ['GET'] }, null, 2),
    );

    const roles = [
      {
        role: 'modify',
        host: 'api.example.com',
        path: '/v1/items/detail',
        method: 'GET',
        exportHint: 'getItem',
        responseShape: {
          type: 'object',
          props: { item_id: { type: 'unknown' } },
        },
        coverage: {
          request: { keysFound: [], confidence: 'high' },
          response: { pathsFound: ['item_id'], confidence: 'high' },
          enums: [],
          gaps: [],
        },
      },
    ];

    const gen = generateMocks({ projectSlug: slug, roles, force: true, merge: false });
    assert.ok(gen.prunedHandlers >= 1, `expected prunedHandlers>=1 got ${gen.prunedHandlers}`);
    assert.ok(gen.prunedContracts >= 1, `expected prunedContracts>=1 got ${gen.prunedContracts}`);
    assert.ok(!fs.existsSync(orphanHandler), 'orphan handler should be removed');
    assert.ok(!fs.existsSync(contractPath(slug, orphanKey)), 'orphan contract should be removed');

    const keepHandler = mockHandlerPath(slug, 'api.example.com', '/v1/items/detail');
    assert.ok(fs.existsSync(keepHandler), 'whitelist handler should remain');
  });
});

test('generate: empty + no_property_access is contract-only (no proxy rule)', () => {
  withTempProject((slug) => {
    const roles = [
      {
        role: 'modify',
        host: 'api.example.com',
        path: '/v1/addr/init',
        method: 'GET',
        exportHint: 'initAddr',
        responseShape: { type: 'object', props: {} },
        coverage: {
          request: { keysFound: [], confidence: 'low' },
          response: { pathsFound: [], confidence: 'low' },
          enums: [],
          gaps: ['no_property_access'],
        },
      },
    ];
    const gen = generateMocks({ projectSlug: slug, roles, force: true, merge: false });
    assert.equal(gen.skippedEmptyCount, 1);
    const rules = JSON.parse(
      fs.readFileSync(path.join(projectDataDir(slug), 'proxy-rules.json'), 'utf8'),
    );
    assert.equal(rules.length, 0, 'empty+no_property_access must not enter proxy-rules');
    const key = apiKey({ host: 'api.example.com', method: 'GET', path: '/v1/addr/init' });
    assert.ok(fs.existsSync(contractPath(slug, key)), 'contract should still be written');
    assert.ok(
      !fs.existsSync(mockHandlerPath(slug, 'api.example.com', '/v1/addr/init')),
      'handler should not be rendered',
    );
  });
});

test('pruneOrphanArtifacts: keeps mock-skill:manual handlers', () => {
  withTempProject((slug) => {
    const handler = mockHandlerPath(slug, 'api.example.com', '/v1/manual');
    fs.mkdirSync(path.dirname(handler), { recursive: true });
    fs.writeFileSync(
      handler,
      '/** mock-skill:manual */\nmodule.exports = () => ({});\n',
    );
    const { prunedHandlers } = pruneOrphanArtifacts(slug, {
      keepHandlerKeys: new Set(),
      keepContractKeys: new Set(),
    });
    assert.equal(prunedHandlers, 0);
    assert.ok(fs.existsSync(handler));
  });
});
