// Service A: hostVar with multiple environment hosts
let svcAPrefix
;(function () {
  if (true) {
    svcAPrefix = '//svc-a.example.com'
  } else {
    svcAPrefix = '//svc-a-stage.example.com'
  }
})()

const getItems = (data) =>
  $HTTP.getP(`${svcAPrefix}/v1/items`, data)

const createItem = (data) =>
  $HTTP.postP(`${svcAPrefix}/v1/items`, data)

export { getItems, createItem }
