let svcCPrefix
;(function () {
  if (true) {
    svcCPrefix = '//svc-c.example.com'
  } else {
    svcCPrefix = '//svc-c-stage.example.com'
  }
})()

export function getDetail(id) {
  return $HTTP.getP(`${svcCPrefix}/v1/detail/${id}`);
}
