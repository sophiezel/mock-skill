---
name: api-mock-orchestrator
description: >-
  Orchestrate the mock-skill CLI for zero-coupling frontend API mock (self-test
  + E2E, desktop and on-device WebView). Prefer invoking mock-skill over writing
  scripts. Discovers APIs, classifies new/modify/dependency/unrelated, generates
  contracts/handlers with WireMock-aligned scenarios, runs mock+proxy sessions.
  Use when the user mentions mock-skill, init mock, API mock, 自测 mock,
  倒推接口, backend not ready, E2E mock, 弱网, 超时, 依赖故障, or boundary case.
disable-model-invocation: true
---

# api-mock-orchestrator（mock-skill 编排）

> **CLI 负责确定性能力；LLM 负责有歧义的语义决策与流程编排；Skill 把边界钉死。**

本文件是裁决卡，不是 CLI 手册。安装、端口、真机代理、命令全表 → 仓库根 [`README.md`](./README.md)。LLM 边界真源 → [`docs/DECISIONS.md`](./docs/DECISIONS.md)。

**硬规则**：优先调用 `mock-skill`，勿自写 mock/proxy 脚本。

## 五步（编排）

1. **discover** — CLI 扫描 host+path
2. **classify** — 有任务时 LLM/人判定 role；无任务用启发式 `dependency`
3. **contract** — `new` 无 docs 则 BLOCK；modify 冲突未决议不覆盖
4. **generate** — CLI 写 contracts + handlers + 标准 cases
5. **session** — CLI 起 mock±proxy；E2E 前显式 `set-scenario`

## 阶段 → reference

| 你正在做 | 先读 |
|----------|------|
| init / 发现 | `references/infer-from-usage.md` |
| 分类 / 冲突 | `references/classify-request.md` |
| 契约 / cases | `references/contract-schema.md` + `references/scenarios.md` |
| 生成 handler | `references/generate-mock.md` |
| session / 真机 | `references/session-and-proxy.md` + `references/e2e-and-device-proxy.md` |
| 排错 | `references/pitfalls.md` |

## Agent checklist

- [ ] 优先 CLI：`mock-skill init` / `session start` / `set-scenario`
- [ ] 需求自测提醒 `--task=<需求ID>`（changelog 溯源）
- [ ] **禁止臆造** `new` 的 IO：无 docs/OpenAPI/用户定义时 BLOCK generate
- [ ] modify 冲突：展示 `reports/contract-conflicts.md`，未决议不覆盖
- [ ] 不改业务仓（除非用户明确 `--write-project-config`）
- [ ] 不依赖 Whistle/Charles；真机 Wi‑Fi 代理 → `proxyPort`
- [ ] CORS 默认 localhost；Hybrid 非 localhost Origin → `cors.extraOrigins`
- [ ] soft miss：透传 + capture，不因单接口拖垮 session
- [ ] **E2E 前显式 `set-scenario`**；勿只生成 success 就宣称可测异常路径
- [ ] `coverage.gaps` 非空时**不宣称 IO 完备**；session + `capture-merge` 补洞
- [ ] **禁止创造响应字段**：键只来自用法或 capture；faker 只填值不增键

## 场景决策树

| 要测 | 用 case / scenario |
|------|---------------------|
| 主路径成功 | `success` / `e2e-happy` |
| 空态 UI | `empty` |
| 表单校验/业务失败 | `biz_error` |
| 登录态/权限边界 | `http_401` / `http_403` |
| 错误页/重试 | `http_404` / `http_500` / `http_502` |
| 下游依赖挂了 | `dep_fail`（= `http_502`） |
| loading/防抖/竞态 | `slow` |
| 超时提示 | `timeout` |
| 断网文案 | `offline` |
| 多接口组合 | `set-scenario <name>` |

## 最短命令

```bash
bash scripts/install.sh
cd <frontend> && mock-skill init [--task=ID] [--related-from=doc]
mock-skill session start --task=ID --start-url=http://localhost:8080
mock-skill set-scenario e2e-fault && mock-skill capture-merge
# HTTPS 改写（可选）: session start --mitm=1 （须信任打印的 CA）
# LAN 开放代理须显式: --allow-open-proxy
# OpenAPI: mock-skill import-openapi --from=./openapi.json
```

详情与真机/`--proxy-host` → [`README.md`](./README.md)。**HTTPS 默认不改写**（CONNECT 隧道）；真机 HTTPS mock 用 `--mitm=1`。
