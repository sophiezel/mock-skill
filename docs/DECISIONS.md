# mock-skill 定稿决策

最后同步：2026-07-17。与 archive 中历史计划不一致时，以本文 + 代码为准。

## 产品定位

| 项 | 定稿 |
|----|------|
| 定位 | **通用 Mock CLI + 可选 Agent Skill 编排层**：前端 Mock 后端 HTTP(S) 接口，后端未通时不阻塞自测与 E2E |
| 角色一句话 | **CLI 负责确定性能力；LLM 负责有歧义的语义决策与流程编排；Skill 把边界钉死。** |
| 仓库 | 本仓（git）；`scripts/install.sh` 一键 `npm link` + 可选 skill symlink |
| Agent 发现 | 可选 symlink `~/.agents/skills/api-mock-orchestrator` → 本仓（教 Agent 调用 CLI，非产品本体） |
| CLI | 全局 `mock-skill`（`npm link` / `scripts/install.sh`）— **主产品** |
| 运行时 | **路线 A**：编排 + 正向代理 + Mock **全在本仓 Node**；借鉴 WireMock **语义**（delay/fault/HTTP/scenario），**不**引入 WireMock/Java/Docker 运行时 |
| 业务仓 | 默认零侵入；不改 `baseURL`、不植入 MSW |
| 耦合边界 | **不**绑定本机绝对路径、公司域名/鉴权头、前端框架、特定请求封装 |

## 数据与 `--task`

| 项 | 定稿 |
|----|------|
| 项目数据 | 扁平 `.data/projects/<projectSlug>/`（contracts / mocks / captures / reports / audit / scenarios） |
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

Classify 是否需要 LLM/人：仅当有 `--task` / `--related-from` / 明确需求语义时；**无任务全量 init** 用启发式（多为 dependency/unrelated），不强行 LLM。

## IO 反推

| 项 | 定稿 |
|----|------|
| 默认 adapter | 通用 `fetch` / `axios` / 字符串 URL + method 启发式 |
| 可选 adapter | `adapters/*.js`（如 `create-request`）；`--adapter=<name>` 启用；不安装也能扫常见 API |
| 主路径 | ts-morph：引用、实参、属性链、`===`/`switch` 枚举 |
| `src/mock` | **不**作为契约来源 |
| 完整性 | **不承诺 100% 零遗漏**；缺口写入 `coverage.gaps` / `coverage-summary.json` |
| Host 过滤 | `config/default.infer.json`：`denyHostSuffixes`（cdn、静态站启发式）；**无公司 allowlist 写死** |
| 样例字段 | **禁止创造响应字段**；键只来自接口侧解构/`res.data.x` 或 capture 真实 body；**不**扫 UI state 改名 |
| 样例值 | init 用 `@faker-js/faker`（固定 seed）仅给已有键填占位；`capture-merge` 用真实值覆盖并可并入真实 body 新键 |
| 运行时补洞 | soft proxy → `captures/` → `capture-merge`（只增不盲删） |

## 场景引擎（对齐 WireMock 语义子集）

每个 API 生成时自动写入标准 case；运行时可单切或批量切。

| caseId | HTTP | 行为 |
|--------|------|------|
| `success` | 200 | envelope 成功 |
| `empty` | 200 | 空 data |
| `biz_error` | 200 | 业务码失败 |
| `http_401` / `http_403` / `http_404` / `http_500` / `http_502` | 同名 | HTTP 层故障（`dep_fail` → `http_502` 别名） |
| `slow` | 200 | `meta.delayMs`（默认 3000） |
| `timeout` | — | `fault: hang` + 长 delay |
| `offline` | — | `fault: reset`（`res.destroy()`） |

Contract 扩展：`httpStatus` + `meta.{delayMs,fault}`。Router 去掉写死延迟；handler 返回描述符或纯 JSON（兼容）。

Scenario 文件 `.data/projects/<slug>/scenarios/<name>.json`：`{ default, apis }`；`set-scenario` 批量切；proxy **每请求 ≤1s 缓存**读 session active map。

内置模板：`assets/scenarios/e2e-happy|e2e-fault|e2e-slow.json`。

## Session / 代理 / CORS / 真机

| 项 | 定稿 |
|----|------|
| 浏览器（桌面） | 独立 Chrome：`--proxy-server` + 专用 `--user-data-dir` |
| 真机 | 设备 Wi‑Fi 手动代理 → `proxyPort`（同 Whistle）；业务代码零改 |
| proxy 绑定 | 桌面-only 可 `127.0.0.1`；真机/E2E 场景须 `0.0.0.0`，启动日志打印 **LAN IP:port** 供手机填写 |
| LAN 安全 | **仅信任局域网，勿在公共 Wi‑Fi 开 0.0.0.0** |
| mock 命中 | `mocks/<host>/<url-path>/index.js` |
| miss | soft：透传 + capture，不因单接口拖垮 session |
| CORS | 默认 localhost Origin；OPTIONS → 204；Hybrid WebView 非 localhost Origin 走 `cors.extraOrigins`（不实现「万能 Origin」） |
| HTTPS | CONNECT 隧道透传；完整 MITM 改写为后续能力（P2），首期不假装已覆盖 |
| E2E scenario 隔离 | 一 worker 一 session，或用例 `beforeEach`/`afterEach` `set-scenario` 复位；不建分布式锁 |

## LLM 介入边界

> 本节为 LLM/人 vs CLI 边界的**唯一真源**。README「架构与角色」为摘要；与本节冲突时以本节为准。

| 时机 | LLM？ |
|------|-------|
| Agent checklist / 读 references | 是（编排） |
| Discover `infer` | 否（静态扫描；漏扫时可选建议补 adapter） |
| Classify（有任务/需求语义） | 是（或人） |
| Classify（无任务全量 init） | 否（启发式） |
| `new` 无文档 IO | 是（或人）+ 工具 BLOCK；LLM 起草须人确认后再生 |
| `modify` 冲突决议 | 是（或人） |
| Generate / session / set-case\|scenario 执行 | 否 |
| Proxy 命中 / delay / fault / HTTP case | **否**（热路径禁止模型） |
| capture-merge 核心 | 否（算法；diff 解释可选 LLM） |
| smoke --ci / unit / integration | 否 |

## CLI 面

`init` · `classify` · `generate` · `session start\|stop` · `set-case` · `set-scenario` · `smoke` · `audit` · `capture-merge` · install/uninstall

## 验证基线

- 仓库内 `fixtures/generic-web/`（axios+fetch 样本）为默认 CI 基线
- `npm test && npm run test:smoke` 必绿
- 任意机器相对路径安装；文档/代码默认路径无本机绝对路径、无公司 Origin 写死

## 非目标（明确不做）

- 不把公司域名/鉴权/封装写入默认核心路径
- 不默认改业务仓 baseURL / 植入 MSW
- 不引入 WireMock/Java 作为运行时依赖
- 不在本迭代做完整 MITM / OpenAPI import / 状态机平台 / Admin HTTP API / 证书自动安装 / Appium 插件

## 后续（P1/P2，登记不阻塞 P0）

- P1：OpenAPI import；精细 query/header 匹配；轻量 stateful scenario；可选 export-msw
- P2：HTTPS MITM（本地 CA、默认关、仅命中规则 host）
