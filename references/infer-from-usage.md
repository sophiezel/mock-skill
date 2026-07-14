# 用法倒推

扫描 `.js/.ts/.vue` 等（跳过 `node_modules`/`dist`）：

- `baseURL`、绝对 URL、`axios.*(path)`、`fetch`、`.get/.post('...')`
- 路径字面量 `/api` `/external` `/v1`
- 响应解构字段 → `responseHints`

证据写 `file:line`；confidence：`high|medium|low`。
