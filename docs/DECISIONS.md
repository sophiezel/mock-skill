# mock-skill 定稿决策

最后同步：2026-07-14。与 archive 中历史计划不一致时，以本文 + 代码为准。

## 产品定位

| 项 | 定稿 |
|----|------|
| 仓库 | `/Users/xuwei/Profession/mock`（git） |
| Agent 发现 | symlink `~/.agents/skills/api-mock-orchestrator` → 本仓 |
| CLI | 全局 `mock-skill`（`npm link` / `scripts/install.sh`） |
| 运行时 | 本仓内置 Express mock + 可开关 Node 代理；**不**依赖 Whistle/Charles |
| 业务仓 | 默认零侵入；不改 `baseURL`、不植入 MSW |
| Guazi `mock-server` | 仅对照蒸馏参考，**不是**运行时真源 |

## 数据与 `--task`

| 项 | 定稿 |
|----|------|
| 项目数据 | 扁平 `.data/projects/<projectSlug>/`（contracts / mocks / captures / reports / audit） |
| 无 `_project/`、无按 task 拆分的 mock 层 | 已否决 |
| `--task` | 仅审计/溯源（`lastTaskId`、`audit/changelog.jsonl`、契约 history），不分区存储 |
| Chrome profile | `.data/chrome-profiles/<projectSlug>/`，跨 session 复用 |
| `.data` | gitignore |

## Classify

| role | 行为摘要 |
|------|----------|
| `new` | 无文档/约束时 **BLOCK** 臆造 IO |
| `modify` | 合并前后契约；冲突进 `reports/contract-conflicts.md`，未决议不覆盖 |
| `dependency` / `unrelated` | 优先复用已有 mock，否则用法倒推 |

## IO 反推

| 项 | 定稿 |
|----|------|
| 主路径 | ts-morph：引用、实参、属性链、`===`/`switch` 枚举 |
| `src/mock` | **不**作为契约来源 |
| 完整性 | **不承诺 100% 零遗漏**；缺口写入 `coverage.gaps` / `coverage-summary.json` |
| 网关-only URL | 过滤（如裸 `.../cars-task`）；需解析 `createRequest({key})` + 路径拼接 |
| 运行时补洞 | soft proxy → `captures/` → `capture-merge`（只增不盲删） |

## Session / 代理 / CORS

| 项 | 定稿 |
|----|------|
| 浏览器 | 独立 Chrome：`--proxy-server` + 专用 `--user-data-dir` |
| mock 命中 | `mocks/<host>/<url-path>/index.js` |
| miss | soft：透传 + capture，不因单接口拖垮 session |
| CORS | 允许 localhost Origin；OPTIONS → 204 |
| HTTPS | CONNECT 隧道透传；完整 MITM 改写为后续能力，首期不假装已覆盖 |

## CLI 面

`init` · `classify` · `generate` · `session start\|stop` · `set-case` · `smoke` · `audit` · `capture-merge` · install/uninstall

## 验证基线（jian-h5）

- `mock-skill init --force --name=jian-h5` 可跑通用法反推 + coverage 报告
- 无网关级空 shell（如 `mocks/.../cars-task/index.js`）
- 主路径接口可产出非空 `data` + 枚举 case；其余 gap 见 reports
