'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInitReport, computeStubMetrics } = require('../lib/init-report');

test('P0-R1: computeStubMetrics collapses apiList to unique stubs', () => {
  const apiList = [
    { stubId: 'GET svc-a/v1/x', upstreamId: 'svc-a', hosts: ['a.example.com', 'b.example.com'],
      responseShape: { type: 'object', props: { id: { type: 'string' } } }, coverage: { gaps: [] } },
    { stubId: 'GET svc-a/v1/x', upstreamId: 'svc-a', hosts: ['a.example.com'],
      responseShape: { type: 'object', props: { id: { type: 'string' } } }, coverage: { gaps: [] } },
    { stubId: 'GET svc-b/v1/y', upstreamId: 'svc-b', hosts: ['c.example.com'],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['TRACE_EMPTY'] } },
  ];
  const m = computeStubMetrics(apiList);
  assert.equal(m.stubsTotal, 2);
  assert.equal(m.upstreamsTotal, 2);
  assert.equal(m.multiHostStubs, 1);
  assert.equal(m.emptyStubs, 1);
  assert.deepEqual(m.emptyStubIds, ['GET svc-b/v1/y']);
});

test('P0-R2: computeStubMetrics includes fidelity breakdown', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['no_export_symbol'] } },
    { stubId: 'b', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: { id: { type: 'string' } } }, coverage: { gaps: [] } },
    { stubId: 'c', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: { id: { type: 'string' } } },
      coverage: { gaps: [] }, responseSource: 'usage+capture' },
  ];
  const m = computeStubMetrics(apiList);
  assert.equal(m.fidelity.L0, 1);
  assert.equal(m.fidelity.L1, 1);
  // c has responseSource capture marker → L2
  assert.equal(m.fidelity.L2, 1);
});

test('P0-R3: computeStubMetrics aggregates gapsByType from stub-level coverage', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['TRACE_EMPTY'] } },
    { stubId: 'b', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['TRACE_EMPTY', 'props_shallow_only'] } },
    { stubId: 'c', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['no_callsite'] } },
  ];
  const m = computeStubMetrics(apiList);
  assert.equal(m.gapsByType.TRACE_EMPTY, 2);
  assert.equal(m.gapsByType.props_shallow_only, 1);
  assert.equal(m.gapsByType.no_callsite, 1);
});

test('P0-R4: computeStubMetrics builds emptyStubsByGap mapping', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['TRACE_EMPTY'] } },
    { stubId: 'b', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['no_callsite'] } },
    { stubId: 'c', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: { id: { type: 'string' } } }, coverage: { gaps: [] } },
  ];
  const m = computeStubMetrics(apiList);
  assert.deepEqual(m.emptyStubsByGap.TRACE_EMPTY, ['a']);
  assert.deepEqual(m.emptyStubsByGap.no_callsite, ['b']);
  assert.ok(!m.emptyStubsByGap.no_export_symbol);
});

test('P0-R5: buildInitReport markdown contains fidelity + gaps-by-type sections', () => {
  const apiList = [
    { stubId: 'GET svc-a/v1/x', upstreamId: 'svc-a', hosts: ['a.example.com'],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['TRACE_EMPTY'] } },
    { stubId: 'GET svc-b/v1/y', upstreamId: 'svc-b', hosts: ['b.example.com'],
      responseShape: { type: 'object', props: { id: { type: 'string' } } }, coverage: { gaps: [] } },
  ];
  const gen = {
    generated: 2, reused: 0, skipped: 0, blocked: [],
    gapApis: [{ id: 'GET svc-a/v1/x', gaps: ['TRACE_EMPTY'] }],
    usageBackedCount: 1, emptyDataCount: 1, traceEmptyCount: 1,
  };
  const roles = [{ role: 'new' }, { role: 'dependency' }];
  const { md, summary } = buildInitReport({
    apiList, gen, roles,
    projectDir: '/tmp/demo', projectSlug: 'demo', taskId: null,
  });
  assert.ok(md.includes('fidelity'), 'md missing fidelity');
  assert.ok(md.includes('L0'), 'md missing L0');
  assert.ok(md.includes('L1'), 'md missing L1');
  assert.ok(/gaps? by type/i.test(md), 'md missing gaps-by-type section');
  assert.ok(md.includes('TRACE_EMPTY'), 'md missing TRACE_EMPTY');
  assert.ok(summary.stubsTotal === 2);
  assert.ok(summary.fidelity.L0 === 1);
  assert.ok(summary.fidelity.L1 === 1);
  assert.ok(summary.gapsByType.TRACE_EMPTY === 1);
});

test('P0-R6: buildInitReport summary JSON is serializable and contains new fields', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: ['no_callsite'] } },
  ];
  const gen = { generated: 1, gapApis: [], traceEmptyCount: 0 };
  const { summary } = buildInitReport({
    apiList, gen, roles: [],
    projectDir: '/tmp/d', projectSlug: 'd', taskId: 'T1',
  });
  const json = JSON.stringify(summary);
  assert.ok(json.includes('"fidelity"'));
  assert.ok(json.includes('"gapsByType"'));
  assert.ok(json.includes('"emptyStubsByGap"'));
  assert.ok(json.includes('"deadExports"'));
});

test('P0-R7: buildInitReport marks no_callsite+empty stubs as deadExports candidates', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} },
      coverage: { gaps: ['no_callsite'] },
      exportHint: 'unusedFn' },
    { stubId: 'b', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} },
      coverage: { gaps: ['TRACE_EMPTY'] },
      exportHint: 'usedButEmpty' },
  ];
  const gen = { generated: 2, gapApis: [], traceEmptyCount: 1 };
  const { summary } = buildInitReport({
    apiList, gen, roles: [],
    projectDir: '/tmp/d', projectSlug: 'd', taskId: null,
  });
  assert.ok(summary.deadExports.length === 1);
  assert.equal(summary.deadExports[0].stubId, 'a');
  assert.equal(summary.deadExports[0].exportHint, 'unusedFn');
});

test('P0-R8: report contains no company brand strings', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: {} }, coverage: { gaps: [] } },
  ];
  const gen = { generated: 1, gapApis: [] };
  const { md } = buildInitReport({
    apiList, gen, roles: [],
    projectDir: '/tmp/d', projectSlug: 'd', taskId: null,
  });
  assert.ok(!/guazi|tower|jian-|company-brand/i.test(md), 'brand leak in report');
});

test('P0-R9: computeStubMetrics upgrades fidelity to L2 when contract has capture', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: { id: { type: 'string' } } },
      coverage: { gaps: [] } },
  ];
  const existingContracts = new Map([
    ['a', { id: 'a', response: { source: 'usage+capture', shape: { type: 'object', props: { id: { type: 'string' } } } } }],
  ]);
  const m = computeStubMetrics(apiList, existingContracts);
  assert.equal(m.fidelity.L2, 1);
  assert.equal(m.fidelity.L1, 0);
});

test('P0-R10: computeStubMetrics falls back to api shape when no persisted contract', () => {
  const apiList = [
    { stubId: 'a', upstreamId: 'svc-a', hosts: [],
      responseShape: { type: 'object', props: { id: { type: 'string' } } },
      coverage: { gaps: [] } },
  ];
  const m = computeStubMetrics(apiList, new Map());
  assert.equal(m.fidelity.L1, 1);
  assert.equal(m.fidelity.L2, 0);
});
