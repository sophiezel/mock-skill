'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { listEmptyStubs, listByFidelity } = require('../lib/list-empty');
const { projectDataDir, contractPath } = require('../lib/paths');

function withTempProject(fn) {
  const slug = `list-empty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const root = projectDataDir(slug);
  fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
  try {
    return fn(slug);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeContract(slug, c) {
  const id = c.stubId || c.id;
  fs.writeFileSync(contractPath(slug, id), `${JSON.stringify(c, null, 2)}\n`);
}

test('P1-L1: listEmptyStubs returns stubs with empty shape (L0)', () => {
  withTempProject((slug) => {
    writeContract(slug, {
      id: 'GET svc-a/v1/x', stubId: 'GET svc-a/v1/x',
      response: { source: 'empty', shape: { type: 'object', props: {} } },
      coverage: { gaps: ['TRACE_EMPTY'] },
    });
    writeContract(slug, {
      id: 'GET svc-a/v1/y', stubId: 'GET svc-a/v1/y',
      response: { source: 'usage', shape: { type: 'object', props: { id: { type: 'string' } } } },
      coverage: { gaps: [] },
    });
    const rows = listEmptyStubs(slug);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stubId, 'GET svc-a/v1/x');
    assert.equal(rows[0].fidelity, 'L0');
  });
});

test('P1-L2: listEmptyStubs --gap=TRACE_EMPTY filters by gap type', () => {
  withTempProject((slug) => {
    writeContract(slug, {
      id: 'GET svc-a/v1/x', stubId: 'GET svc-a/v1/x',
      response: { source: 'empty', shape: { type: 'object', props: {} } },
      coverage: { gaps: ['TRACE_EMPTY'] },
    });
    writeContract(slug, {
      id: 'GET svc-a/v1/y', stubId: 'GET svc-a/v1/y',
      response: { source: 'empty', shape: { type: 'object', props: {} } },
      coverage: { gaps: ['no_callsite'] },
    });
    const trace = listEmptyStubs(slug, { gap: 'TRACE_EMPTY' });
    assert.equal(trace.length, 1);
    assert.equal(trace[0].stubId, 'GET svc-a/v1/x');
    const nocall = listEmptyStubs(slug, { gap: 'no_callsite' });
    assert.equal(nocall.length, 1);
    assert.equal(nocall[0].stubId, 'GET svc-a/v1/y');
  });
});

test('P1-L3: listEmptyStubs includes gap list + fidelity + upgradeHint', () => {
  withTempProject((slug) => {
    writeContract(slug, {
      id: 'GET svc-a/v1/x', stubId: 'GET svc-a/v1/x',
      response: { source: 'empty', shape: { type: 'object', props: {} } },
      coverage: { gaps: ['TRACE_EMPTY', 'props_shallow_only'] },
      exportHint: 'loadItems',
    });
    const rows = listEmptyStubs(slug);
    assert.deepEqual(rows[0].gaps, ['TRACE_EMPTY', 'props_shallow_only']);
    assert.equal(rows[0].fidelity, 'L0');
    assert.equal(rows[0].exportHint, 'loadItems');
    assert.ok(rows[0].upgradeHint.length > 0);
  });
});

test('P1-L4: listByFidelity returns all stubs grouped by L0/L1/L2', () => {
  withTempProject((slug) => {
    writeContract(slug, {
      id: 'a', stubId: 'a',
      response: { source: 'empty', shape: { type: 'object', props: {} } },
      coverage: { gaps: [] },
    });
    writeContract(slug, {
      id: 'b', stubId: 'b',
      response: { source: 'usage', shape: { type: 'object', props: { id: { type: 'string' } } } },
      coverage: { gaps: [] },
    });
    writeContract(slug, {
      id: 'c', stubId: 'c',
      response: { source: 'usage+capture', shape: { type: 'object', props: { id: { type: 'string' } } } },
      coverage: { gaps: [] },
    });
    const grouped = listByFidelity(slug);
    assert.equal(grouped.L0.length, 1);
    assert.equal(grouped.L1.length, 1);
    assert.equal(grouped.L2.length, 1);
    assert.equal(grouped.L3.length, 0);
  });
});

test('P1-L5: listEmptyStubs tolerates missing contracts dir', () => {
  const slug = `no-such-${Date.now()}`;
  const rows = listEmptyStubs(slug);
  assert.deepEqual(rows, []);
});

test('P1-L6: listEmptyStubs skips L2 (captured) stubs even if shape empty', () => {
  withTempProject((slug) => {
    writeContract(slug, {
      id: 'a', stubId: 'a',
      response: { source: 'usage+capture', shape: { type: 'object', props: {} } },
      coverage: { gaps: [] },
    });
    const rows = listEmptyStubs(slug);
    // captured but shape empty — still has real data; not "empty" for capture-merge purposes
    assert.equal(rows.length, 0);
  });
});
