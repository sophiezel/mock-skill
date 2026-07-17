import { useState } from 'react';
import { getAddrInfo } from '../services/addr';

/**
 * Mirrors the real dual-name collision: useState binding `data` plus
 * `.then(({ data }) => …)` response binding, and outer UI reads `data.cityId`.
 * responseShape must keep only snake_case API fields (no cityId).
 */
export function AddrFormWithState() {
  const [data, setData] = useState({});

  function load() {
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

      setData({
        cityId: city_id,
        cityName: city_name,
        address,
        evaluatorId: evaluator_id,
        lng,
        lat,
        vehicles,
        vehiclesName: vehicles_name,
      });
    });
  }

  // Outer UI state named `data` — different definition from .then(({ data })
  const label = `${data.cityId}-${data.cityName}-${data.evaluatorId}-${data.vehiclesName}`;
  const { cityId, cityName } = data;

  return { load, label, data, cityId, cityName };
}
