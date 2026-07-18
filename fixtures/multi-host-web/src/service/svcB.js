// Service B: different upstream, single host
const svcBPrefix = '//svc-b.example.com'

const getProfile = (data) =>
  $HTTP.getP(`${svcBPrefix}/v1/profile`, data)

export { getProfile }
