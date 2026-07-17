'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  ensureProjectDirs,
  projectDataDir,
  contractPath,
  mockHandlerPath,
} = require('../lib/paths');
const { captureMerge } = require('../scripts/capture-merge');
const { renderHandler } = require('../scripts/generate-mock');

test('captureMerge: merges real body into contract + handler', () => {
  const slug = `cap-merge-${Date.now()}`;
  ensureProjectDirs(slug);
  const host = 'api.example.com';
  const urlPath = '/v1/items';
  const id = 'GET api.example.com/v1/items';
  const contract = {
    id,
    method: ['GET'],
    host,
    path: urlPath,
    cases: [
      {
        id: 'success',
        response: { code: 0, data: { name: 'placeholder' }, message: '' },
        httpStatus: 200,
      },
    ],
    response: {
      source: 'usage',
      shape: { type: 'object', props: { name: { type: 'string' } } },
    },
    coverage: { gaps: ['no_property_access'], response: { pathsFound: [] } },
  };
  fs.writeFileSync(contractPath(slug, id), `${JSON.stringify(contract, null, 2)}\n`);
  const handlerFile = mockHandlerPath(slug, host, urlPath);
  fs.mkdirSync(path.dirname(handlerFile), { recursive: true });
  fs.writeFileSync(handlerFile, renderHandler(contract));

  const capturesDir = path.join(projectDataDir(slug), 'captures');
  fs.mkdirSync(capturesDir, { recursive: true });
  fs.writeFileSync(
    path.join(capturesDir, '1.json'),
    JSON.stringify({
      host,
      path: urlPath,
      method: 'GET',
      responseBody: { code: 0, data: { name: 'real-name', extra: 1 }, message: '' },
    }),
  );

  try {
    const r = captureMerge(slug, { taskId: 't1' });
    assert.equal(r.merged, 1);
    const next = JSON.parse(fs.readFileSync(contractPath(slug, id), 'utf8'));
    assert.equal(next.cases[0].response.data.name, 'real-name');
    assert.equal(next.cases[0].response.data.extra, 1);
    assert.ok(!next.coverage.gaps.includes('no_property_access'));
  } finally {
    fs.rmSync(projectDataDir(slug), { recursive: true, force: true });
  }
});

test('captureMerge: empty responseBody is skipped with report', () => {
  const slug = `cap-empty-${Date.now()}`;
  ensureProjectDirs(slug);
  const capturesDir = path.join(projectDataDir(slug), 'captures');
  fs.mkdirSync(capturesDir, { recursive: true });
  fs.writeFileSync(
    path.join(capturesDir, 'empty.json'),
    JSON.stringify({ host: 'h', path: '/p', method: 'GET' }),
  );
  try {
    const r = captureMerge(slug);
    assert.equal(r.merged, 0);
    assert.ok(r.skipped?.length >= 1);
    assert.equal(r.skipped[0].reason, 'empty_responseBody');
  } finally {
    fs.rmSync(projectDataDir(slug), { recursive: true, force: true });
  }
});
