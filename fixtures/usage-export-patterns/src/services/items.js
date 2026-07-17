import { createRequest } from 'request-lib';

const demoReq = createRequest({ key: 'DEMO_HOST', prefix: '' });

const fetchItemInner = demoReq('/external/item/detail');

export async function getItemDetail(params) {
  const raw = await fetchItemInner(params);
  return raw;
}

const listInner = demoReq({ uri: '/external/item/list', type: 'get' });

export async function getItemList(query) {
  return listInner(query);
}
