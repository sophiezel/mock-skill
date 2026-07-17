import { getAddrInfo } from '../services/addr';

export function loadAddrPage() {
  return getAddrInfo().then(({ data }) => {
    const {
      city_id,
      city_name,
      address,
      evaluator_id,
      lng,
      lat,
      vehicles,
      vehicles_name,
    } = data || {};

    return {
      cityId: city_id,
      cityName: city_name,
      address,
      evaluatorId: evaluator_id,
      lng,
      lat,
      vehicles,
      vehiclesName: vehicles_name,
    };
  });
}
