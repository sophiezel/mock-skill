'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inferApiUsage } = require('../scripts/infer-api-usage');
const { extractVueScriptBlocks } = require('../lib/vue-script');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'usage-destructure');

test('vue-script: extract <script setup> block', () => {
  const source = `<script setup>
import { getX } from '../svc';
getX();
</script>
<template><div /></template>`;
  const blocks = extractVueScriptBlocks(source);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'js');
  assert.ok(blocks[0].content.includes("import { getX }"));
});

test('vue-script: extract lang="ts" script block', () => {
  const source = `<script lang="ts">
const x: number = 1;
</script>`;
  const blocks = extractVueScriptBlocks(source);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'ts');
});

test('infer: export { name } binds exportHint (no no_export_symbol)', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false });
  const addrApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/info',
  );
  assert.ok(addrApi, 'getAddrInfo API not discovered');
  assert.equal(addrApi.exportHint, 'getAddrInfo');
  assert.ok(
    !addrApi.coverage?.gaps?.includes('no_export_symbol'),
    'should not have no_export_symbol gap',
  );
});

test('infer: export { name } for object-form call binds exportHint', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: false });
  const updateApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/update',
  );
  assert.ok(updateApi, 'updateAddr API not discovered');
  assert.equal(updateApi.method, 'POST');
  assert.equal(updateApi.exportHint, 'updateAddr');
});

test('infer: destructuring from .then({ data }) yields responseShape fields', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: true });
  const addrApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/info',
  );
  assert.ok(addrApi, 'getAddrInfo API not discovered');
  assert.ok(addrApi.exportHint, 'exportHint should be set');
  assert.ok(
    !addrApi.coverage?.gaps?.includes('no_export_symbol'),
    'should not have no_export_symbol gap',
  );
  const props = addrApi.responseShape?.props || {};
  const fields = Object.keys(props);
  for (const f of [
    'city_id',
    'city_name',
    'address',
    'evaluator_id',
    'lng',
    'lat',
    'vehicles',
    'vehicles_name',
  ]) {
    assert.ok(fields.includes(f), `responseShape should include field "${f}" (got: ${fields.join(', ')})`);
  }
});

test('infer: Vue SFC <script setup> destructuring yields responseShape fields', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: true });
  const addrApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/info',
  );
  assert.ok(addrApi, 'getAddrInfo API not discovered');
  const props = addrApi.responseShape?.props || {};
  const fields = Object.keys(props);
  // Vue page destructures a subset: city_id, city_name, address, evaluator_id, lng, lat
  for (const f of ['city_id', 'city_name', 'address', 'evaluator_id', 'lng', 'lat']) {
    assert.ok(
      fields.includes(f),
      `Vue SFC destructuring should yield field "${f}" (got: ${fields.join(', ')})`,
    );
  }
});

test('infer: UI state camelCase (cityId) must not enter responseShape', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: true });
  const addrApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/info',
  );
  assert.ok(addrApi, 'getAddrInfo API not discovered');
  const props = addrApi.responseShape?.props || {};
  const fields = Object.keys(props);
  assert.ok(fields.includes('city_id'), `expected city_id (got: ${fields.join(', ')})`);
  assert.ok(fields.includes('city_name'), `expected city_name (got: ${fields.join(', ')})`);
  for (const ui of ['cityId', 'cityName', 'evaluatorId', 'vehiclesName']) {
    assert.ok(
      !fields.includes(ui),
      `UI state field "${ui}" must not be in responseShape (got: ${fields.join(', ')})`,
    );
  }
});

test('infer: await const { data } = api() yields responseShape fields', () => {
  const apis = inferApiUsage(FIXTURE, { withUsageIo: true });
  const addrApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/info',
  );
  assert.ok(addrApi, 'getAddrInfo API not discovered');
  const props = addrApi.responseShape?.props || {};
  const fields = Object.keys(props);
  for (const f of ['city_id', 'city_name', 'address', 'evaluator_id']) {
    assert.ok(fields.includes(f), `await destructure should yield "${f}" (got: ${fields.join(', ')})`);
  }
  assert.ok(
    !fields.includes('error'),
    'envelope key error must not enter responseShape',
  );
});

test('infer: same-name data (useState vs .then) does not dual-write camelCase', () => {
  // Fixture addrFormState.js: const [data,setData]=useState + .then(({data}) + outer data.cityId
  const apis = inferApiUsage(FIXTURE, { withUsageIo: true });
  const addrApi = apis.find(
    (a) => a.path === '/external/evaluator/default/work/address/info',
  );
  assert.ok(addrApi, 'getAddrInfo API not discovered');
  const props = addrApi.responseShape?.props || {};
  const fields = Object.keys(props);
  for (const f of ['city_id', 'city_name', 'address', 'evaluator_id']) {
    assert.ok(fields.includes(f), `expected snake_case "${f}" (got: ${fields.join(', ')})`);
  }
  for (const ui of ['cityId', 'cityName', 'evaluatorId', 'vehiclesName']) {
    assert.ok(
      !fields.includes(ui),
      `colliding useState field "${ui}" must not enter shape (got: ${fields.join(', ')})`,
    );
  }
});
