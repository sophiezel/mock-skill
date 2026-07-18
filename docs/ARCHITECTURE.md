# 架构与设计

使用指南见根目录 [`README.md`](../README.md)。操作细节见 [`references/`](../references/)。已锁定决策见 [`DECISIONS.md`](./DECISIONS.md)。

## 角色

| 角色 | 职责 |
|------|------|
| CLI / runtime | discover、generate、session、proxy、scenario、capture-merge、smoke |
| LLM（或人） | 有任务时的 classify、冲突决议、`new` IO 起草（须确认）、缺口解释与下一步 |
| Skill（[`SKILL.md`](../SKILL.md)） | checklist + BLOCK/禁宣称规则；禁止 Agent 自写脚本绕开 CLI |

LLM 介入边界（摘要；**真源**见 [`DECISIONS.md`](./DECISIONS.md) § LLM 介入边界）：

| 时机 | LLM？ |
|------|-------|
| 读 Skill / 编排命令 | 是 |
| Discover / Generate / Session / set-case\|scenario / traffic | 否 |
| Proxy 命中、delay/fault | **否**（热路径禁模型） |
| 无任务全量 init 的 classify | 否（启发式） |
| 有 `--task` / 需求语义的 classify | 是（或人） |
| `new` 无文档 IO / resolve 冲突决议 | 是（或人） |
| capture-merge 核心 / smoke | 否 |

> **CLI 负责确定性能力；LLM 负责有歧义的语义决策与流程编排；Skill 把边界钉死。**

## Stub Catalog

一个 stub = 一个逻辑 API（`METHOD + upstreamId + path`），多环境 host 作为匹配器（`hosts[]`），不再按 FQDN 分目录。

```
mocks/<upstreamId>/<METHOD>/<path>/index.js   ← 一套 mock 数据
proxy-rules.json: { stubId, upstreamId, hosts[], pathPrefix, methods }
upstreams.json:  { upstreamId: { hosts[], canonicalHost } }
```

- `upstreamId`：逻辑服务标识（来自 `hostVar` / `prefixKey` / 归一化 host label），不含 FQDN。
- `hosts[]`：该服务所有环境域名；proxy 命中任一即路由到同一 stub。条目可含 `host:port`。
- `stubId`：全链路统一身份（infer → classify → contract → proxy-rules → runtime → set-case → capture → smoke → audit → openapi → export-msw）。
- 代理零侵入：客户端仍打真实域名，proxy 命中后注入 `x-mock-stub-id` 路由到 mock handler。
- Catalog 可全量生成；**运行时是否 mock** 由 `trafficMode` 决定（见下）。

通用性：引擎不含业务仓硬编码、不依赖特定公司域名。

## 流量策略

对齐 WireMock proxy/intercept：catalog 存在 ≠ 一律 mock。

| `trafficMode` | 行为 |
|---------------|------|
| `all-mock`（默认） | 命中 rule → mock |
| `all-passthrough` | 全部透传真上游 + 录制（录制/联调） |
| `selective` | 仅 `mockAllowlist` 内 stubId mock；其余透传 |

优先级：`passthroughHosts` → `trafficMode` → 无 rule 时 `missPolicy`。

日常入口：`mock-skill start`（默认 `all-mock`，主轨 0 依赖）；可选辅轨 `start --record`（=`all-passthrough`，升 L2，非 E2E）。

细节与 port 匹配见 [`references/session-and-proxy.md`](../references/session-and-proxy.md)。

## 保真度与 Shape

| 级 | 含义 | 升阶 |
|----|------|------|
| **L0** | 空信封，无 shape | `import-openapi` / 更好用法 / capture |
| **L1** | usage/OpenAPI shape + 占位值 | `traffic` 透传 + `capture-merge` |
| **L2** | 已 capture 真值 | 可选 scenario |
| **L3** | 场景 / 有状态（预留） | — |

**纪律**：Shape 永不发明键；真值只来自 capture / OpenAPI；materialize（jsf）只填已有键。

Shape 通道（有界静态推断，见 [`references/infer-from-usage.md`](../references/infer-from-usage.md)）：

- **DeclarativeFieldSource**：按 JSX 属性名提取 `columns[].dataIndex` / `fieldNames` 等；项目可在 `.mock-skill/infer.json` 注册自定义 prop 名。
- **一层跨文件 props-drill**：父传 `detail={payload}`，子读 `detail.name` → 回连到响应 shape。
- 超出边界 → `TRACE_EMPTY` / `props_shallow_only`，导向 capture / OpenAPI。

## 数据目录

```
rules/                         共享 rule 包（可 git；不绑 project）
.data/
  session.json                 全局运行时：端口 / trafficMode / allowlist / cases / activeCatalogs
  runtime.json                 当前进程状态
  projects/<projectSlug>/      catalog（按源码 init）
    mocks/
    contracts/
    captures/
    proxy-rules.json
    upstreams.json
    reports/
```

- **一个** proxy + mock 进程；`start --name=a --name=b` 合并多份 catalog。
- stubId 跨 catalog 冲突 → 启动失败（不静默覆盖）。
- `--task` 只做需求溯源，**不**拆分 mock 目录。
