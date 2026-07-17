import { getItemDetail, getItemList } from '../services/items';
import orderSvc from '../services/orders';

export function loadItem() {
  return getItemDetail().then(({ data }) => {
    const { item_id, item_name, price } = data || {};
    return { item_id, item_name, price };
  });
}

export function loadList() {
  return getItemList().then(({ data }) => {
    const { total, rows } = data || {};
    return { total, rows };
  });
}

export function loadOrder() {
  return orderSvc.getOrder().then(({ data }) => {
    const { order_id, status } = data || {};
    return { order_id, status };
  });
}
