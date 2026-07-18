# Backlog（登记，不阻塞已交付项）

## Done in 1.1.0

| 项 | 说明 |
|----|------|
| HTTPS MITM（最小） | `--mitm=1` + 本地 CA；仅命中 rules 的 host |
| 精细匹配（when） | proxy rules 支持 `when.query` / `when.header` |
| 轻量 stateful | scenario `times` / `transitions` |
| OpenAPI import | `mock-skill import-openapi --from=` |
| export-msw | `mock-skill export-msw` |

## Done — Virtual Backend（本迭代）

| 项 | 说明 |
|----|------|
| Service Catalog | mocks/contracts 真源按 `upstreamId`；project 仅 `index.json` |
| Virtual Service + Store | 每 upstream 内存 store；handler 可读写；`service reset` |
| CRUD resource cluster | 确定性配对 list/detail CRUD → store-backed handlers |
| domain-draft | 虚拟实体草稿；init/generate 静默写入（热路径禁 LLM）；高级 CLI 可重跑 |

## P1（后续）

| 项 | 说明 | 触发条件 |
|----|------|----------|
| MITM 证书一键信任 | 桌面 keychain / 真机引导脚本 | 团队真机 HTTPS 日用 |
| OpenAPI YAML | 当前仅 JSON | 团队只有 yaml |
| infer 进一步拆分 | `lib/infer/{discover,usage-io}` 彻底下沉 | 维护成本上升 |
| capture 命中采样默认开 | 现需 `--record-mock-hits` | 补洞流程成为主路径 |
| Store 持久化 / TTL | 默认纯内存；可选落盘 | 长会话调试需要 |

## P2

| 项 | 说明 | 触发条件 |
|----|------|----------|
| GraphQL / WebSocket | 非目标直至明确需求 | 客户点名 |
| Admin HTTP API / UI | 保持 CLI-first；已有 journal/reset CLI | — |
