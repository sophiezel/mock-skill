'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { inferApiUsage } = require('../scripts/infer-api-usage');
const { materialize } = require('../lib/materialize');

function withTempProject(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-coll-'));
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

test('same export name in different modules: usage-io does not cross-contaminate', () => {
  withTempProject(
    {
      'src/services/rejectReason/index.ts': `
import { request } from '@umijs/max';
export async function getReasonList(options?: any) {
  return request('/cars-config/external/reject/reason/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
}
`,
      'src/services/testReject/index.ts': `
import { request } from '@umijs/max';
export async function getReasonList(options?: any) {
  return request('/cars-config/external/reject/reason/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
}
`,
      'src/services/inventoryTask/index.ts': `
import { request } from '@umijs/max';
export async function getReasonList(options?: any) {
  return request('/cars-config/external/inventory/reason/list', {
    method: 'GET',
    params: { ...(options || {}) },
  });
}
`,
      'src/pages/RejectReason/index.tsx': `
import React, { useState } from 'react';
import { Table } from 'antd';
import { getReasonList } from "@/services/rejectReason";

export default function Page() {
  const [tableData, setTableData] = useState({ list: [], total: 0, current: 1, pageSize: 10 });
  const load = () => {
    getReasonList({ currentPage: 1 }).then((res: any) => {
      setTableData({
        list: res?.data?.list || [],
        total: res?.data?.total,
        current: res.data?.currentPage,
        pageSize: res.data?.pageSize,
      });
    });
  };
  const columns = [
    { title: 'id', dataIndex: 'reasonId' },
    { title: 'reason', dataIndex: 'reason' },
    { title: 'type', dataIndex: 'typeDesc' },
    {
      title: 'op',
      dataIndex: 'action',
      render: (_: any, record: any) => record?.editFlag,
    },
  ];
  load();
  return <Table dataSource={tableData.list} columns={columns} />;
}
`,
      'src/pages/TestReject/index.tsx': `
import { getReasonList } from "@/services/testReject";
export default function Page() {
  getReasonList({ pageSize: 100 }).then((res: any) => {
    const opts = res.data?.list || [];
    console.log(opts);
  });
  return null;
}
`,
      'src/pages/Inventory/index.tsx': `
import { getReasonList } from "@/services/inventoryTask";
export default function Page() {
  getReasonList({}).then((res: any) => {
    const items = res.data?.items || [];
    console.log(items);
  });
  return null;
}
`,
    },
    (root) => {
      const apis = inferApiUsage(root, { withUsageIo: true });

      const reasonApis = apis.filter((a) =>
        String(a.path || '').includes('/reject/reason/list'),
      );
      const inventoryApis = apis.filter((a) =>
        String(a.path || '').includes('/inventory/reason/list'),
      );

      assert.ok(reasonApis.length >= 1, `expected reason list apis, got paths=${apis.map((a) => a.path)}`);
      assert.ok(inventoryApis.length >= 1, 'expected inventory list api');

      const rich = reasonApis.find(
        (a) =>
          a.responseShape?.props?.total ||
          a.responseShape?.props?.currentPage ||
          a.responseShape?.props?.pageSize,
      );
      assert.ok(
        rich,
        `expected paginated fields from RejectReason page, shapes=${JSON.stringify(
          reasonApis.map((a) => ({
            evidence: a.evidence,
            props: Object.keys(a.responseShape?.props || {}),
            listItem: Object.keys(a.responseShape?.props?.list?.item?.props || {}),
          })),
        )}`,
      );
      const props = rich.responseShape.props;
      assert.ok(props.list, 'list');
      assert.ok(props.total, 'total');
      assert.ok(props.currentPage, 'currentPage');
      assert.ok(props.pageSize, 'pageSize');

      const itemProps = props.list?.item?.props || {};
      assert.ok(itemProps.reasonId, `item.reasonId missing: ${Object.keys(itemProps)}`);
      assert.ok(itemProps.reason, 'item.reason');
      assert.ok(itemProps.typeDesc, 'item.typeDesc');
      assert.ok(itemProps.editFlag, 'item.editFlag from render');

      const inv = inventoryApis[0];
      assert.ok(inv.responseShape?.props?.items, 'inventory keeps items');
      assert.ok(
        !inv.responseShape?.props?.total,
        'inventory must not inherit RejectReason total',
      );

      const sample = materialize(rich.responseShape, { seed: 1 });
      assert.ok(Array.isArray(sample.list), 'materialize list array');
      assert.ok(sample.list.length >= 1, 'list has sample item');
      assert.ok(
        sample.list[0].reasonId != null ||
          sample.list[0].reason != null ||
          sample.list[0].typeDesc != null,
      );
    },
  );
});
