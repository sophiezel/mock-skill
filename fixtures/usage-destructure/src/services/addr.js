import { createRequest } from 'request-lib';

const addrReq = createRequest({ key: 'ADDR_HOST', prefix: '' });

const getAddrInfo = addrReq('/external/evaluator/default/work/address/info');

const updateAddr = addrReq({
  uri: '/external/evaluator/default/work/address/update',
  type: 'post',
});

export { getAddrInfo, updateAddr };
