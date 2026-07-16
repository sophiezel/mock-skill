# Backlog（登记，不阻塞 P0）

## P1

| 项 | 说明 | 触发条件 |
|----|------|----------|
| OpenAPI import | 从 OpenAPI/Swagger spec 直接生成 contracts（替代/补充静态 infer） | 团队有 spec 维护 |
| 精细匹配 | query/header 维度的 rule 匹配（当前仅 host+pathPrefix+method） | 同 path 不同 query 需不同 case |
| 轻量 stateful scenario | scenario 支持状态机（如“第 N 次请求返回 500，之后 200”） | 分页/重试/竞态 E2E |
| export-msw | 把 contract cases 导出为 MSW handlers，供进程内单测复用 | 单测也要用同套 case |

## P2

| 项 | 说明 | 触发条件 |
|----|------|----------|
| HTTPS MITM | 本地 CA + 信任 + 仅对命中规则 host 做 MITM，改写 HTTPS 响应 | 真机 HTTPS mock 必需 |
