export async function listOrders(status) {
  const res = await fetch(`https://api.example.com/v1/orders?status=pending`, {
    headers: { Authorization: 'Bearer demo' },
  });
  return res.json();
}

export async function getOrder(id) {
  const res = await fetch('https://api.example.com/v1/orders/1');
  return res.json();
}

export async function cancelOrder(id, reason) {
  const res = await fetch('https://api.example.com/v1/orders/1/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return res.json();
}

export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  SHIPPED: 'shipped',
  DONE: 'done',
};
