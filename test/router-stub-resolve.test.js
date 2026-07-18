'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { stubHandlerPath } = require('../lib/paths');

/**
 * R1/R2/R3: router resolveStubHandlerFile tests.
 * We test the new resolveStubHandlerFile function (added to router.js)
 * which resolves by stubId header or by host→upstream mapping.
 */

function withTempMocks(setup, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-'));
  const mocksRoot = path.join(root, 'mocks');
  try {
    setup(mocksRoot);
    return fn(mocksRoot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('R1: stub header resolves to mocks/<up>/<METHOD>/<path>/index.js', () => {
  withTempMocks(
    (mocksRoot) => {
      const handlerFile = path.join(mocksRoot, 'svc-a', 'GET', 'v1', 'items', 'index.js');
      fs.mkdirSync(path.dirname(handlerFile), { recursive: true });
      fs.writeFileSync(handlerFile, 'module.exports = () => ({ data: [] });\n');
    },
    (mocksRoot) => {
      const { resolveStubHandlerFile } = require('../runtime/mock-server/router');
      const stubId = 'GET svc-a/v1/items';
      const file = resolveStubHandlerFile(mocksRoot, {
        stubId,
        method: 'GET',
        urlPath: '/v1/items',
      });
      assert.ok(file, 'should resolve handler file');
      assert.ok(file.endsWith(path.join('svc-a', 'GET', 'v1', 'items', 'index.js')));
    },
  );
});

test('R2: no stub header + unregistered host → 404 (null)', () => {
  withTempMocks(
    () => {},
    (mocksRoot) => {
      const { resolveStubHandlerFile } = require('../runtime/mock-server/router');
      const file = resolveStubHandlerFile(mocksRoot, {
        stubId: null,
        method: 'GET',
        urlPath: '/v1/items',
        forwardedHost: 'unknown.example.com',
        hostToUpstream: () => null,
      });
      assert.equal(file, null);
    },
  );
});

test('R3: jail — traversal in stubId path is rejected', () => {
  const { resolveStubHandlerFile } = require('../runtime/mock-server/router');
  // stubId with traversal in path
  const file = resolveStubHandlerFile('/tmp/mocks', {
    stubId: 'GET svc-a/../etc/passwd',
    method: 'GET',
    urlPath: '/../etc/passwd',
  });
  assert.equal(file, null);
});
