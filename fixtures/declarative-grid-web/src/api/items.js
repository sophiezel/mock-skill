let svcAPrefix
;(function () {
  if (true) {
    svcAPrefix = '//svc-a.example.com'
  } else {
    svcAPrefix = '//svc-a-stage.example.com'
  }
})()

export function listItems(params) {
  return $HTTP.getP(`${svcAPrefix}/v1/items`, { params });
}

export function createItem(payload) {
  return $HTTP.postP(`${svcAPrefix}/v1/items`, payload);
}
