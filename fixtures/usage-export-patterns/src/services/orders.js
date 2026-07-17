import { createRequest } from 'request-lib';

const demoReq = createRequest({ key: 'DEMO_HOST', prefix: '' });

const getOrder = demoReq('/external/order/info');
const updateOrder = demoReq({
  uri: '/external/order/update',
  type: 'post',
});

export default {
  getOrder,
  updateOrder,
};
