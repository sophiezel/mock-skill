<script setup>
import { getAddrInfo } from '../services/addr';

export function loadVueAddr() {
  return getAddrInfo().then(({ data }) => {
    const { city_id, city_name, address, evaluator_id, lng, lat } = data || {};
    return { cityId: city_id, cityName: city_name, address, evaluatorId: evaluator_id, lng, lat };
  });
}
</script>

<template>
  <div>Addr Form</div>
</template>
