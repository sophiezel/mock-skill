# mock-skill 文档索引

- **使用指南**（安装 / 快速开始 / 命令）：仓库根 [`README.md`](../README.md)
- **架构与设计**（角色 / Stub Catalog / 流量 / 保真度）：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Agent 裁决卡**：[`SKILL.md`](../SKILL.md)
- **操作细节**：[`references/`](../references/)

**角色边界**（CLI / LLM / Skill）见 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [DECISIONS.md](./DECISIONS.md) § LLM 介入边界。

## 定稿

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构与设计（从 README 拆出） |
| [DECISIONS.md](./DECISIONS.md) | 已锁定决策与当前约束（优先阅读；含 LLM 边界真源） |

## 操作说明（references）

| 文档 | 说明 |
|------|------|
| [classify-request.md](../references/classify-request.md) | 相关否 × new/modify/dependency/unrelated |
| [contract-schema.md](../references/contract-schema.md) | 契约结构 |
| [infer-from-usage.md](../references/infer-from-usage.md) | 用法反推 |
| [generate-mock.md](../references/generate-mock.md) | mock 生成 |
| [session-and-proxy.md](../references/session-and-proxy.md) | session / 代理 / trafficMode |
| [scenarios.md](../references/scenarios.md) | scenario / case 切换 |
| [e2e-and-device-proxy.md](../references/e2e-and-device-proxy.md) | 桌面 E2E + 真机 Wi‑Fi 代理 / HTTPS |
| [pitfalls.md](../references/pitfalls.md) | 已知坑 |

## 历史计划存档（archive）

由 Cursor plans 原样拷贝，保留演进过程；与当前实现冲突时以 `DECISIONS.md` + 代码为准。

| 档案 | 来源 |
|------|------|
| [2026-03-mock-skill-brainstorm.plan.md](./archive/2026-03-mock-skill-brainstorm.plan.md) | `~/.cursor/plans/mock_skill_brainstorm_ec82c040.plan.md` |
| [2026-07-fix-api-infer-empty.plan.md](./archive/2026-07-fix-api-infer-empty.plan.md) | `~/.cursor/plans/fix_api_infer_empty_5c923b1b.plan.md` |

未纳入本仓（范围不同）：

- `auto_mock_pipeline_*.plan.md` — e2e-device WebView inject 管线
- `收车回捞_e2e_mock_*.plan.md` — Guazi mock-server + jian-h5 Playwright 业务用例
