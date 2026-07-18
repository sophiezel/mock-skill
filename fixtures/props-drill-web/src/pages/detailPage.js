import { getDetail } from '../api/detail';
import { DetailCard } from '../components/DetailCard';

/**
 * Parent: fetches detail, passes the WHOLE response payload as a `detail`
 * prop to <DetailCard />. The child reads detail.name / detail.price /
 * detail.sku. One-layer props-drill should propagate these fields back to
 * the GET /v1/detail/:id shape.
 */
export function loadDetailPage(id) {
  return getDetail(id).then(({ data }) => {
    const payload = data?.data || data || {};
    return <DetailCard detail={payload} />;
  });
}
