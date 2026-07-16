# mock-skill

通用、零耦合的前端 API Mock 编排器：内置 Mock 运行时 + 可开关正向代理，用于后端未通时的自测与 E2E（桌面 + 真机 WebView）。**不改业务仓代码**、不依赖 Whistle/Charles、不绑定特定前端框架。

## 一键安装

```bash
bash scripts/install.sh
```

等价：

```bash
npm install && npm link
ln -sfn "$(pwd)" ~/.agents/skills/api-mock-orchestrator
```

> Node >= 18。安装后 CLI 名 `mock-skill` 全局可用。

## 在业务项目预生成全部接口 Mock

```bash
cd /path/to/frontend-app
mock-skill init
mock-skill init --task=TR-1234 --related-from=./docs/req.md
mock-skill init --adapter=create-request   # 可选：叠加 adapters/<name>.js
```

默认扫描 `fetch` / `axios` / 字符串 URL；`createRequest` 亦内置。自定义封装放 `adapters/`，用 `--adapter=` 启用。详见 [`references/infer-from-usage.md`](./references/infer-from-usage.md)。

数据落在（扁平，一项目一份）：

```
.data/projects/<projectSlug>/
```

`--task` 只做需求溯源（契约 history / `audit/changelog.jsonl`），**不**拆分 mock 目录。无任务全量 init 时分类启发式为 `dependency`（不强制 LLM）。

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
# 仅信任局域网，勿在公共 Wi‑Fi 开 0.0.0.0
# 并行 E2E：一 worker 一 session，或用例前后 set-scenario 复位
```

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
| `mock-skill init [--adapter=]` | 全量扫描并预生成 mock |
| `mock-skill classify` | 分类 |
| `mock-skill generate` | 按分类结果生成 |
| `mock-skill session start\|stop` | 起停 mock±proxy（`--proxy-host` / `--scenario`） |
| `mock-skill set-case` | 单接口切换用例 |
| `mock-skill set-scenario` | 批量切换场景 |
| `mock-skill smoke [--ci] [--scenario=]` | 冒烟（CI 非零退出；默认跳过 timeout/offline） |
| `mock-skill audit --task=` | 追因 |
| `mock-skill capture-merge` | 回灌运行时字段 |

## Agent Skill

安装后通过 symlink 暴露为 `api-mock-orchestrator`。详见 [`SKILL.md`](./SKILL.md)。

## 文档

- 定稿决策：[docs/DECISIONS.md](./docs/DECISIONS.md)
- 后续登记：[docs/BACKLOG.md](./docs/BACKLOG.md)
- 索引与计划存档：[docs/README.md](./docs/README.md)
- 操作手册：[`references/`](./references/)（infer / classify / scenarios / e2e）

## 测试

```bash
npm test                 # node:test 单测 + 集成
npm run test:smoke       # fixtures/generic-web：init → smoke --ci → set-scenario → proxy
```
