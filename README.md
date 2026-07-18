# mock-skill

前端 API Mock **CLI**：内置 Mock 运行时 + 可开关正向代理，用于后端未通时的自测与 E2E（桌面 + 真机 WebView）。**不改业务仓代码**、不依赖 Whistle/Charles、不绑定特定前端框架。

附带可选 Agent Skill 入口（教 Agent 正确调用本 CLI），**不是**产品本体。

> **CLI 负责确定性能力；LLM 负责有歧义的语义决策与流程编排；Skill 把边界钉死。**

## 架构与角色

| 角色 | 职责 |
|------|------|
| CLI / runtime | discover、generate、session、proxy、scenario、capture-merge、smoke |
| LLM（或人） | 有任务时的 classify、冲突决议、`new` IO 起草（须确认）、缺口解释与下一步 |
| Skill（[`SKILL.md`](./SKILL.md)） | checklist + BLOCK/禁宣称规则；禁止 Agent 自写脚本绕开 CLI |

LLM 介入边界（摘要；**真源**见 [`docs/DECISIONS.md`](./docs/DECISIONS.md) § LLM 介入边界）：

| 时机 | LLM？ |
|------|-------|
| 读 Skill / 编排命令 | 是 |
| Discover / Generate / Session / set-case\|scenario | 否 |
| Proxy 命中、delay/fault | **否**（热路径禁模型） |
| 无任务全量 init 的 classify | 否（启发式） |
| 有 `--task` / 需求语义的 classify | 是（或人） |
| `new` 无文档 IO / modify 冲突决议 | 是（或人） |
| capture-merge 核心 / smoke | 否 |

## 一键安装

先装 CLI，再按需挂 Skill：

```bash
bash scripts/install.sh
```

等价：

```bash
npm install && npm link
# 可选：供 Cursor/Agent 发现编排约束
ln -sfn "$(pwd)" ~/.agents/skills/api-mock-orchestrator
```

> Node >= 18。安装后 CLI 名 `mock-skill` 全局可用。

## 在业务项目预生成全部接口 Mock

```bash
cd /path/to/frontend-app
mock-skill init
mock-skill init --task=TR-1234 --related-from=./docs/req.md
mock-skill init --adapter=create-request   # 可选：叠加 adapters/<name>.js
mock-skill init --strict-usage             # TRACE_EMPTY > 0 时非零退出
```

默认扫描 HTTP CallShape（`request(url,{method})` / `axios.get` / `$HTTP` 等）+ 用法倒推响应字段；`createRequest` 亦内置。项目差异写 `<project>/.mock-skill/infer.json`（`callShapes` / `importSources` / `httpWrappers` / `pathAliases`），或用 `--adapter=` 叠加 `adapters/`。详见 [`references/infer-from-usage.md`](./references/infer-from-usage.md)。

**样例数据（静态优先）**：

- init 从用法倒推 **接口字段**（`exportKey=file#name` 身份绑定，同名跨模块不串台），经 JSON Schema + `json-schema-faker` 填占位值；**不发明字段**。
- 成功主看 `usageBackedCount` / `usageBackedHints`；有调用点但 shape 空记 `TRACE_EMPTY`（`--strict-usage` 可硬失败）。
- **`capture-merge`：显式真值写入**（以捕获数据为准，`response.source=usage+capture`）。**不是**补洞/自动兜底。
- **覆盖矩阵**：普通 `init`/`generate`（含裸 `--force`）**保留**已有 capture；仅 `--overwrite-capture` 允许 usage 盖掉真值。
- `no_export_symbol` 且空 shape → `skippedEmpty`（不渲空 handler）。

```bash
mock-skill capture-merge --name=<slug>           # 以真实捕获为准
mock-skill generate --force --overwrite-capture  # 显式允许 usage 覆盖 capture
```

数据落在（扁平，一项目一份）：

```
.data/projects/<projectSlug>/
```

`--task` 只做需求溯源（契约 history / `audit/changelog.jsonl`），**不**拆分 mock 目录。无任务全量 init 时分类启发式为 `dependency`（不强制 LLM）。

### Stub Catalog（多环境 host 共享一套 mock）

一个 stub = 一个逻辑 API（`METHOD + upstreamId + path`），多环境 host 作为匹配器（`hosts[]`），不再按 FQDN 分目录。

```
mocks/<upstreamId>/<METHOD>/<path>/index.js   ← 一套 mock 数据
proxy-rules.json: { stubId, upstreamId, hosts[], pathPrefix, methods }
upstreams.json:  { upstreamId: { hosts[], canonicalHost } }
```

- `upstreamId`：逻辑服务标识（来自 `hostVar` 变量名 / `prefixKey` / 归一化 host label），不含 FQDN。
- `hosts[]`：该服务所有环境域名（prod / stage / dev / ...），proxy 命中任一即路由到同一 stub。
- `stubId`：全链路统一身份（infer → classify → contract → proxy-rules → runtime → set-case → capture → smoke → audit → openapi → export-msw）。
- 代理零侵入：客户端仍打真实域名，proxy 命中后注入 `x-mock-stub-id` header 路由到 mock handler。
- 空 stub 闭环：无字段也能生成 contract、列出、由 capture-merge 填充；指标按 stub 计数（`stubsTotal` / `emptyStubs` / `multiHostStubs`）。

**通用性约束**：本工具不含任何业务仓硬编码、不依赖特定公司域名或内部服务名。同一份代码可 `init` 任意前端项目。

## 自测 Session

```bash
mock-skill session start --task=TR-1234 --start-url=http://localhost:8080
# 使用打印出的【Mock 自测浏览器】（带 --proxy-server → 127.0.0.1）
mock-skill set-scenario e2e-fault   # 或 session start --scenario=e2e-fault
mock-skill smoke --ci
# Ctrl+C 结束 session
```

开关与端口：

```bash
mock-skill session start --proxy=0 --mock-port=3901
mock-skill session start --proxy-port=19000
```

真机 WebView（Wi‑Fi 代理，业务代码零改）：

```bash
mock-skill session start --proxy-host=0.0.0.0 --scenario=e2e-fault --start-url=http://localhost:8080
# 按启动日志【真机 Wi‑Fi 代理】块填写：LAN IP / port / 当前 scenario
# listen=0.0.0.0；桌面 Chrome 仍走 127.0.0.1
# 默认 missPolicy=reject（防开放代理）；需要透传时显式 --allow-open-proxy
# 仅信任局域网，勿在公共 Wi‑Fi 开 0.0.0.0
```

**HTTPS 说明（诚实边界）**：

| 模式 | 行为 |
|------|------|
| 默认 | CONNECT **仅隧道透传**，**不改写** HTTPS 响应 |
| `--mitm=1` | 对 `proxy-rules` 命中 host 做本地 CA MITM（需 openssl；真机/桌面须信任打印的 CA） |
| 外挂 | 仍可用 Whistle 等做 MITM，再链到本 CLI |

生产 H5 几乎全是 HTTPS —— 真机要改写响应请加 `--mitm=1` 并安装 CA，或走 HTTP 调试域。

详见 [`references/e2e-and-device-proxy.md`](./references/e2e-and-device-proxy.md)。

## 场景引擎

每个 API 自动生成标准 case，运行时可单切或批量切：

| caseId | 含义 |
|--------|------|
| `success` / `empty` / `biz_error` | 业务层 |
| `http_401/403/404/500/502` | HTTP 层故障 |
| `dep_fail` | 依赖故障（= `http_502`） |
| `slow` / `timeout` / `offline` | 弱网 / 超时 / 断连 |

```bash
mock-skill set-case <apiId> <caseId>
mock-skill set-scenario e2e-fault     # 批量切多接口
```

内置模板：`e2e-happy` / `e2e-fault` / `e2e-slow`。详见 [`references/scenarios.md`](./references/scenarios.md)。

## CLI

| 命令 | 作用 |
|------|------|
| `mock-skill init [--adapter=] [--force] [--overwrite-capture] [--strict-usage]` | 全量扫描并预生成 mock |
| `mock-skill import-openapi --from=` | 从 OpenAPI JSON 生成 contracts/handlers |
| `mock-skill export-msw` | 导出 MSW handlers 供单测 |
| `mock-skill classify` | 分类 |
| `mock-skill generate [--force] [--overwrite-capture]` | 按分类结果生成（默认可保 capture） |
| `mock-skill session start\|stop` | 起停 mock±proxy（`--proxy-host` / `--scenario`） |
| `mock-skill set-case` | 单接口切换用例 |
| `mock-skill set-scenario` | 批量切换场景 |
| `mock-skill smoke [--ci] [--scenario=]` | 冒烟（CI 非零退出；默认跳过 timeout/offline） |
| `mock-skill audit --task=` | 追因 |
| `mock-skill capture-merge` | 以真实捕获覆盖对应接口 success 数据 |

**init / generate 常用 flags：**

| flag | 含义 |
|------|------|
| `--force` | 无 merge 重生 + 可 prune 孤儿；**默认仍不擦** `usage+capture` |
| `--overwrite-capture` | 允许 usage/jsf 盖掉已有 capture 真值 |
| `--strict-usage` | （仅 init）存在 `TRACE_EMPTY` 时非零退出 |

## 文档

- 定稿决策（含 LLM 边界真源）：[docs/DECISIONS.md](./docs/DECISIONS.md)
- 后续登记：[docs/BACKLOG.md](./docs/BACKLOG.md)
- 索引与计划存档：[docs/README.md](./docs/README.md)
- 操作手册：[`references/`](./references/)（infer / classify / scenarios / e2e）

## 测试

```bash
npm test                 # node:test 单测 + 集成
npm run test:smoke       # fixtures/generic-web：init → smoke --ci → set-scenario → proxy
npm run test:upstream-e2e # fixtures/multi-host-web：infer → collapse → generate → proxy match → router
npm run test:all         # 全部
```

## Agent Skill（可选）

安装时的 symlink 将本仓暴露为 `api-mock-orchestrator`，供 Agent 加载**编排约束与裁决卡**（checklist / BLOCK / 场景决策树）。完整命令与端口说明以本 README 为准；Agent 入口见 [`SKILL.md`](./SKILL.md)。
