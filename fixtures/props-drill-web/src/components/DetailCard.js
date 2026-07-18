/**
 * Child component: receives `detail` prop and reads fields off it.
 * The static analyzer must link this back to the parent's response data
 * (one-layer cross-file props-drill) so `name` / `price` / `sku` become
 * part of the GET /v1/detail/:id response shape.
 */
export function DetailCard({ detail }) {
  const name = detail?.name;
  const price = detail?.price;
  const sku = detail?.sku;
  return null;
}
