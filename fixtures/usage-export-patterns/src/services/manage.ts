import { createRequest } from 'request-lib';

const demoReq = createRequest({ key: 'DEMO_HOST', prefix: '' });

// Long param + return type between signature and body — binding must not use a short char window.
const manageInner = demoReq('/external/item/manage/list');

export async function getMisapplyManageList(
  params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: number;
    startTime?: string;
    endTime?: string;
    deptId?: string;
    ownerId?: string;
    tags?: string[];
    extra?: Record<string, string | number | boolean | null | undefined>;
    nested?: { a: string; b: { c: number; d: string[] } };
  },
): Promise<{ list: Array<{ id: string; name: string }> }> {
  const raw = await manageInner(params);
  return raw;
}
