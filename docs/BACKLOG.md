# Backlog（登记，不阻塞已交付项）

## Done in 1.1.0

| 项 | 说明 |
|----|------|
| HTTPS MITM（最小） | `--mitm=1` + 本地 CA；仅命中 rules 的 host |
| 精细匹配（when） | proxy rules 支持 `when.query` / `when.header` |
| 轻量 stateful | scenario `times` / `transitions` |
| OpenAPI import | `mock-skill import-openapi --from=` |
| export-msw | `mock-skill export-msw` |

## P1（后续）

| 项 | 说明 | 触发条件 |
|----|------|----------|
| MITM 证书一键信任 | 桌面 keychain / 真机引导脚本 | 团队真机 HTTPS 日用 |
| OpenAPI YAML | 当前仅 JSON | 团队只有 yaml |
| infer 进一步拆分 | `lib/infer/{discover,usage-io}` 彻底下沉 | 维护成本上升 |
| capture 命中采样默认开 | 现需 `--record-mock-hits` | 补洞流程成为主路径 |

## P2

| 项 | 说明 | 触发条件 |
|----|------|----------|
| GraphQL / WebSocket | 非目标直至明确需求 | 客户点名 |
| Admin HTTP API / UI | 保持 CLI-first | — |
