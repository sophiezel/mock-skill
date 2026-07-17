'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { inferApiUsage } = require('../scripts/infer-api-usage');

function withTempProject(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-select-'));
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

test('Select options + fieldNames + setX(res.data||[]): root array item props', () => {
  withTempProject(
    {
      'src/services/testReject/index.ts': `
import { request } from '@umijs/max';
export const getAllList = (options?: any) => {
  return request('/cars-config/external/reject/detectItem/all/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
};
export const getDirList = (options?: any) => {
  return request('/cars-config/external/reject/reason/dir/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
};
`,
      'src/pages/TestReject/index.tsx': `
import React, { useEffect, useState } from 'react';
import { Select } from 'antd';
import { getAllList, getDirList } from '@/services/testReject';

export default function Page() {
  const [detectOptions, setDetectOptions] = useState([]);
  const [options, setOptions] = useState([]);
  useEffect(() => {
    getAllList().then((res: any) => {
      setDetectOptions(res?.data || []);
    });
    getDirList().then((res: any) => {
      setOptions(res?.data || []);
    });
  }, []);
  return (
    <>
      <Select
        options={detectOptions}
        fieldNames={{ label: 'itemName', value: 'itemId' }}
        optionFilterProp="itemName"
      />
      <Select
        options={options}
        fieldNames={{ label: 'dirDesc', value: 'dirId' }}
      />
    </>
  );
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });
      const allList = apis.find((a) => a.path?.includes('detectItem/all/list'));
      const dirList = apis.find((a) => a.path?.includes('reason/dir/list'));
      assert.ok(allList, 'getAllList discovered');
      assert.equal(allList.responseShape?.type, 'array');
      assert.ok(
        allList.responseShape?.item?.props?.itemName,
        `expected itemName, got ${JSON.stringify(allList.responseShape)}`,
      );
      assert.ok(allList.responseShape?.item?.props?.itemId);
      assert.ok(!allList.coverage?.gaps?.includes('TRACE_EMPTY'));

      assert.ok(dirList, 'getDirList discovered');
      assert.equal(dirList.responseShape?.type, 'array');
      assert.ok(dirList.responseShape?.item?.props?.dirDesc);
      assert.ok(dirList.responseShape?.item?.props?.dirId);
    },
  );
});

test('same path two exports: merge usage from called getDetailList', () => {
  withTempProject(
    {
      'src/services/testReject/index.ts': `
import { request } from '@umijs/max';
export const getDetectItemList = (options?: any) => {
  return request('/cars-config/external/reject/detectItem/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
};
export const getDetailList = (options?: any) => {
  return request('/cars-config/external/reject/detectItem/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
};
`,
      'src/pages/TestReject/index.tsx': `
import React, { useEffect, useState } from 'react';
import { getDetailList } from '@/services/testReject';

export default function Page() {
  const [originData, setOriginData] = useState([]);
  useEffect(() => {
    getDetailList().then((res: any) => {
      setOriginData(res?.data || []);
    });
  }, []);
  return (
    <div>
      {originData.map((detail: any, index: number) => (
        <div key={index}>
          <span>{detail.dirDesc}</span>
          {detail?.itemList?.map((item: any, i: number) => (
            <h2 key={i}>
              {item.itemName} {item.itemId}
            </h2>
          ))}
        </div>
      ))}
    </div>
  );
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });
      const api = apis.find((a) => a.path?.includes('detectItem/list'));
      assert.ok(api, 'detectItem/list discovered');
      assert.ok(
        api.exportHints?.includes('getDetailList'),
        `exportHints should include getDetailList, got ${api.exportHints}`,
      );
      assert.ok(
        api.exportHints?.includes('getDetectItemList'),
        `exportHints should include getDetectItemList, got ${api.exportHints}`,
      );
      assert.equal(api.exportHint, 'getDetailList', 'prefer called export');
      assert.equal(api.responseShape?.type, 'array');
      assert.ok(
        api.responseShape?.item?.props?.dirDesc,
        `expected dirDesc, got ${JSON.stringify(api.responseShape)}`,
      );
      assert.equal(api.responseShape?.item?.props?.itemList?.type, 'array');
      assert.ok(api.responseShape?.item?.props?.itemList?.item?.props?.itemName);
      assert.ok(api.responseShape?.item?.props?.itemList?.item?.props?.itemId);
      assert.ok(!api.coverage?.gaps?.includes('TRACE_EMPTY'));
      assert.ok(!api.coverage?.gaps?.includes('no_callsite'));
    },
  );
});
