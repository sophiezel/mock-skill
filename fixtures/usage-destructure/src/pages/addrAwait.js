import { getAddrInfo } from '../services/addr';

/**
 * Common pattern: const { error, data } = await api(); then destructure data.
 */
export async function loadAddrAwait() {
  const { error, data } = await getAddrInfo();
  if (error) throw error;
  const {
    city_id,
    city_name,
    address,
    evaluator_id,
  } = data || {};
  return { city_id, city_name, address, evaluator_id };
}
