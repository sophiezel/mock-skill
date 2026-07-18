let svcBPrefix
;(function () {
  if (true) {
    svcBPrefix = '//svc-b.example.com'
  } else {
    svcBPrefix = '//svc-b-stage.example.com'
  }
})()

export function listTags(params) {
  return $HTTP.getP(`${svcBPrefix}/v1/tags`, { params });
}
