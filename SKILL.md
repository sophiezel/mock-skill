---
name: api-mock-orchestrator
description: >-
  Generic, zero-coupling frontend API mock service: built-in HTTP mock runtime
  plus toggleable forward proxy for zero-intrusion self-test and E2E (desktop
  and on-device WebView via Wi-Fi proxy). Discovers APIs from project usage,
  classifies new/modify/dependency/unrelated, generates contracts and handlers
  with a WireMock-aligned scenario engine (success / empty / biz_error /
  http_4xx / http_5xx / slow / timeout / offline / dep_fail), and runs mock +
  proxy sessions switchable per scenario. Use when the user mentions mock-skill,
  init mock, API mock, 自测 mock, 倒推接口, backend not ready, E2E mock,
  弱网, 超时, 依赖故障, or boundary case.
disable-model-invocation: true
---

# api-mock-orchestrator (mock-skill)

通用、零耦合的前端 API Mock 编排器：后端未通时不阻塞自测与 E2E。借鉴 WireMock 的 delay / fault / HTTP / scenario 语义，运行时全在本仓 Node，不引入 WireMock/Java。

## Layout

- CLI: `mock-skill`（`npm link` / `scripts/install.sh`）
- Data: `.data/projects/<projectSlug>/` (flat; one mock per host+path)
- Install: `scripts/install.sh`（相对路径，任意机器可用）

## Five steps

1. **discover** — `infer-api-usage` 扫描前端 host+path（默认 fetch/axios；可选 `--adapter=`）
2. **classify** — 相关? → `new` | `modify` | `dependency` | `unrelated`（无任务时启发式）
3. **contract** — new 需 docs/`--related-from`，否则 BLOCK；modify 合并 + 冲突报告；dependency/unrelated 复用或倒推
4. **generate** — 写 contracts + `mocks/<host>/<path>/index.js` + 标准场景 cases；未决议冲突不覆盖
5. **session** — 起内置 mock ± 正向代理；桌面 Chrome `--proxy-server`；真机 Wi‑Fi 代理 → `proxyPort`

## 阶段 → reference 导航

| 你正在做 | 先读 |
|----------|------|
| init / 发现接口 | `references/infer-from-usage.md` |
| 分类 / 冲突 | `references/classify-request.md` |
| 契约形状 / 标准 cases | `references/contract-schema.md` + `references/scenarios.md` |
| 生成 handler | `references/generate-mock.md` |
| session / 代理 / 真机 | `references/session-and-proxy.md` + `references/e2e-and-device-proxy.md` |
| 排错 | `references/pitfalls.md` |

## Agent checklist

- [ ] 优先 CLI，勿自写脚本：`mock-skill init` / `session start` / `set-scenario`
- [ ] 需求自测时提醒 `--task=<需求ID>` 以便 changelog 溯源
- [ ] **禁止臆造** `new` 的 IO：无 docs/OpenAPI/用户定义时 BLOCK generate
- [ ] modify 冲突：展示 `reports/contract-conflicts.md`，未决议不覆盖
- [ ] 不改业务仓（除非用户明确 `--write-project-config`）
- [ ] 不依赖 Whistle/Charles；真机走 Wi‑Fi 代理 → 本 skill `proxyPort`
- [ ] CORS 默认 localhost；Hybrid WebView 非 localhost Origin 走 `cors.extraOrigins`
- [ ] soft miss：透传 + capture，不因单接口拖垮 session
- [ ] **E2E 前显式 `set-scenario`**；勿只生成 success 就宣称可测异常路径
- [ ] `coverage.gaps` 非空时**不宣称 IO 完备**；走 session + `capture-merge` 补洞

## 场景决策树

| 要测 | 用 case / scenario |
|------|---------------------|
| 主路径成功 | `success` / `e2e-happy` |
| 空态 UI | `empty` |
| 表单校验/业务失败 | `biz_error` |
| 登录态/权限边界 | `http_401` / `http_403` |
| 错误页/重试 | `http_404` / `http_500` / `http_502` |
| 下游依赖挂了 | `dep_fail`（= `http_502`） |
| loading/防抖/竞态 | `slow`（`meta.delayMs`） |
| 超时提示 | `timeout`（`fault: hang`） |
| 断网文案 | `offline`（`fault: reset`） |
| 多接口组合 | `set-scenario <name>` |

## Commands

```bash
bash scripts/install.sh
cd <frontend>
mock-skill init [--task=ID] [--related-from=doc] [--adapter=name]
# 看 reports/* 与 coverage-summary.json 的 gapApis / emptyDataCount
mock-skill session start --task=ID --start-url=http://localhost:8080
# 真机：加 --proxy-host=0.0.0.0，按打印的 LAN IP:port 在手机 Wi‑Fi 代理填写
mock-skill set-scenario e2e-fault
mock-skill smoke --ci
# 走主路径后回灌运行时字段
mock-skill capture-merge --name=<projectSlug>
mock-skill audit --task=ID
```

IO 反推用 ts-morph（引用 + 属性链 + 枚举）；不读 `src/mock`；不承诺零遗漏，缺口进 `coverage.gaps`。

## References

- `docs/DECISIONS.md` — 定稿决策（唯一真源）
- `docs/README.md` — 文档索引与计划存档
- `references/classify-request.md`
- `references/contract-schema.md`
- `references/infer-from-usage.md`
- `references/generate-mock.md`
- `references/session-and-proxy.md`
- `references/scenarios.md`
- `references/e2e-and-device-proxy.md`
- `references/pitfalls.md`
