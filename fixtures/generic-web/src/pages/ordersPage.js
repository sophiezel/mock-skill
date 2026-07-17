import { listOrders, getOrder, cancelOrder } from '../api/orders';

/** Consume order APIs so usage-io can infer responseShape fields. */
export async function loadOrdersPage() {
  const list = await listOrders('pending');
  const { items, total } = list?.data || list || {};
  const order = await getOrder(1);
  const { id, status, amount, createdAt } = order?.data || order || {};
  const cancelRes = await cancelOrder(1, 'test');
  const { success, reason } = cancelRes?.data || cancelRes || {};
  return { items, total, id, status, amount, createdAt, success, reason };
}
