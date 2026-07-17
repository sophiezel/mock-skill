'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createBindingGraph } = require('../lib/infer/binding-graph');
const {
  collectTemplateBindingEvents,
  parseMemberExpr,
  parseSourceAlias,
} = require('../lib/infer/vue-template-ast');
const { materialize } = require('../lib/materialize');
const { inferApiUsage } = require('../scripts/infer-api-usage');
const { buildContract } = require('../scripts/generate-mock');

function withTempProject(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-ast-'));
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

test('binding-graph: markArray + item props materialize non-empty', () => {
  const shape = { type: 'object', props: {} };
  const g = createBindingGraph(shape, []);
  g.bindAlias('rows', { kind: 'path', path: ['rows'] });
  g.ensureField(['rows']);
  g.markArray(['rows']);
  g.bindItemAlias('i', ['rows']);
  g.applyMember('i', ['a']);
  assert.equal(shape.props.rows.type, 'array');
  assert.ok(shape.props.rows.item.props.a);
  const data = materialize(shape);
  assert.ok(Array.isArray(data.rows));
  assert.equal(data.rows.length, 1);
  assert.ok('a' in data.rows[0]);
});

test('vue-template-ast: v-for forParseResult + member via TS AST', () => {
  assert.equal(parseSourceAlias('foos'), 'foos');
  assert.deepEqual(parseMemberExpr('x.bar'), { root: 'x', members: ['bar'] });
  const events = collectTemplateBindingEvents(`
    <ul>
      <li v-for="x in foos" :key="x.id">{{ x.bar }}</li>
    </ul>
  `);
  assert.ok(events.some((e) => e.type === 'forSource' && e.sourceAlias === 'foos'));
  assert.ok(events.some((e) => e.type === 'member' && e.members.includes('bar')));
});

test('script forEach item props on arbitrary field name rows', () => {
  withTempProject(
    {
      'src/service/index.js': `
export function getRows() {
  return fetch('https://api.example.com/v1/rows');
}
`,
      'src/page/Rows.js': `
import { getRows } from '@/service'
export async function load() {
  const res = await getRows()
  this.rows = res.data.rows
  this.rows.forEach((i) => {
    console.log(i.a)
  })
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });
      const api = apis.find((a) => a.exportHint === 'getRows');
      assert.ok(api);
      assert.equal(api.responseShape?.props?.rows?.type, 'array');
      assert.ok(api.responseShape.props.rows.item.props.a);
    },
  );
});

test('Vue SFC: assign foos + template v-for → foos.item.bar non-empty data', () => {
  withTempProject(
    {
      'src/service/index.js': `
export function getFoos() {
  return fetch('https://api.example.com/v1/foos');
}
`,
      'src/page/Foos.vue': `
<template>
  <ul>
    <li v-for="x in foos" :key="x.id">{{ x.bar }}</li>
  </ul>
</template>
<script>
import { getFoos } from '@/service'
export default {
  data() { return { foos: [] } },
  methods: {
    async load() {
      const res = await getFoos()
      this.foos = res.data.foos || []
    }
  }
}
</script>
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });
      const api = apis.find((a) => a.exportHint === 'getFoos');
      assert.ok(api, 'API found');
      const foos = api.responseShape?.props?.foos;
      assert.equal(foos?.type, 'array');
      assert.ok(foos.item?.props?.bar, `expected bar, got ${JSON.stringify(foos)}`);
      assert.ok(foos.item?.props?.id);
      const contract = buildContract(
        { ...api, role: 'new', hasMock: false },
        { source: 'usage' },
      );
      assert.equal(contract.response.source, 'usage');
      const data = contract.cases.find((c) => c.id === 'success')?.response?.data;
      assert.ok(Array.isArray(data.foos));
      assert.ok(data.foos.length >= 1);
      assert.ok('bar' in data.foos[0]);
    },
  );
});

test('unbound local v-for does not pollute API shape', () => {
  withTempProject(
    {
      'src/service/index.js': `
export function getOther() {
  return fetch('https://api.example.com/v1/other');
}
`,
      'src/page/Other.vue': `
<template>
  <li v-for="x in localArr">{{ x.secret }}</li>
</template>
<script>
import { getOther } from '@/service'
export default {
  data() { return { localArr: [] } },
  methods: {
    async load() {
      const res = await getOther()
      this.name = res.data.name
    }
  }
}
</script>
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });
      const api = apis.find((a) => a.exportHint === 'getOther');
      assert.ok(api);
      assert.ok(api.responseShape?.props?.name);
      assert.equal(api.responseShape?.props?.secret, undefined);
      // localArr never assigned from API — no secret on shape
      const keys = Object.keys(api.responseShape?.props || {});
      assert.ok(!keys.includes('localArr') || !api.responseShape.props.localArr?.item?.props?.secret);
    },
  );
});

test('path without item usage may stay empty array', () => {
  withTempProject(
    {
      'src/service/index.js': `
export function getBare() {
  return fetch('https://api.example.com/v1/bare');
}
`,
      'src/page/Bare.js': `
import { getBare } from '@/service'
export async function load() {
  const res = await getBare()
  this.xs = res.data.xs || []
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });
      const api = apis.find((a) => a.exportHint === 'getBare');
      assert.ok(api);
      const xs = api.responseShape?.props?.xs;
      assert.ok(xs);
      // array marked via || [] ; no item props
      if (xs.type === 'array') {
        assert.deepEqual(Object.keys(xs.item?.props || {}), []);
      }
      const contract = buildContract(
        { ...api, role: 'new', hasMock: false },
        { source: 'usage' },
      );
      const data = contract.cases.find((c) => c.id === 'success')?.response?.data;
      assert.ok(data && 'xs' in data);
    },
  );
});
