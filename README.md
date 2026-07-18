# mock-skill

从前端代码扫出接口、生成 mock，再用本地代理把请求拦下来。业务仓不用改，也不绑特定框架。桌面自测和真机 WebView 都能用。

需要 Node >= 18。装完之后命令是 `mock-skill`。

## 安装

```bash
bash scripts/install.sh
```

也可以 `npm install && npm link`。若要给 Agent 发现，可再链一份：

```bash
ln -sfn "$(pwd)" ~/.agents/skills/api-mock-orchestrator
```

```bash
mock-skill --help
mock-skill help --all    # 含较少用的命令和旧名
```

## 快速开始

```bash
cd /path/to/frontend-app
mock-skill init --name=demo
mock-skill start --name=demo
# 需要打开页面时：
# mock-skill start --name=demo --start-url=http://localhost:8080
```

Catalog（mocks / contracts）在 `.data/projects/demo/`；运行时状态在全局 `.data/session.json`。停掉：

```bash
mock-skill stop
```

多个前端可同时挂到同一个代理：

```bash
mock-skill start --name=tower --name=other
# 省略 --name 则挂载全部已有 catalog
```

项目扫法不一样时，改 `.mock-skill/infer.json` 或加 `--adapter=`。见 [`references/infer-from-usage.md`](./references/infer-from-usage.md)。

## 常用操作

**按 rule 文件只 mock 一部分**（共享 `rules/`，不绑 project）：

```bash
# rules/jian-h5.json、rules/xrk.json — stubs 并集走 mock，其余透传
mock-skill start --name=tower --name=other --rules jian-h5 xrk
# 同时 --record：仍以 rules 为准（selective）；其余透传会写入 captures/
mock-skill start --name=tower --rules jian-h5 --record
mock-skill rules use jian-h5 xrk    # 运行中热切换
mock-skill rules list
mock-skill rules save my-pack       # 从当前 session 导出
```

**切场景**（成功 / 故障 / 慢）：

```bash
mock-skill start --name=demo
mock-skill scenario e2e-fault    # 或 e2e-happy / e2e-slow
mock-skill set-case "GET svc-a/v1/items" biz_error
```

详见 [`references/scenarios.md`](./references/scenarios.md)。

**CI 冒烟**：

```bash
mock-skill start --name=demo --no-auto-launch
mock-skill scenario e2e-happy
mock-skill smoke --ci
mock-skill stop --name=demo
```

**录真实响应写回 mock**（要能打到上游）：

```bash
mock-skill start --name=demo --record
# 浏览器走一遍主流程…
mock-skill stop --name=demo --auto-merge
```

同一 session 里热切换：`mock-skill record` → 操作 → `mock-skill merge` → `mock-skill mock`。

**真机代理**：

```bash
mock-skill start --name=demo --proxy-host=0.0.0.0 --allow-open-proxy
# 按日志填手机 Wi‑Fi 代理；HTTPS 加 --mitm=1（要 openssl）
```

见 [`references/e2e-and-device-proxy.md`](./references/e2e-and-device-proxy.md)。

**补空数据 / 导入 OpenAPI**：

```bash
mock-skill list-empty --name=demo
mock-skill import-openapi --from=./openapi.json --name=demo
```

**部分接口 mock、其余透传**：

```bash
mock-skill traffic selective --name=demo
mock-skill traffic allow "GET svc-a/v1/items" --name=demo
mock-skill start --name=demo --traffic=selective
```

**导出 MSW**：

```bash
mock-skill export-msw --out=./msw-handlers.js --name=demo
```

## 命令

| 命令 | 干什么 |
|------|--------|
| `init` | 扫描项目，生成 catalog |
| `start` / `stop` | 起停全局 mock+proxy（可多 catalog） |
| `rules list\|use\|save` | 共享 rule 文件：列出 / 应用 / 导出 |
| `scenario` / `set-case` | 切场景或单个接口响应 |
| `smoke [--ci]` | 冒烟 |
| `start --record` / `record` / `mock` / `merge` | 录真实响应、写回、切回 mock |
| `traffic` / `list-empty` / `import-openapi` / `export-msw` / `classify` / `generate` / `audit` | 精细控制 |

旧名仍可用：`session start|stop`、`set-scenario`、`capture-merge` 等。

`init` / `generate` 常用 flag：`--force` 清孤儿文件（默认不擦已录数据）；`--overwrite-capture` 才允许用法推断盖掉已录真值；`--strict-usage` 在追踪结果为空时失败。

## 文档

| 文档 | 内容 |
|------|------|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | 架构与设计 |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | 已锁定决策 |
| [`references/`](./references/) | 扫描、session、场景、E2E、坑 |
| [`SKILL.md`](./SKILL.md) | Agent 编排（可选） |
| [`docs/README.md`](./docs/README.md) | 文档索引 |

## 测试

```bash
npm test                  # 单测
npm run test:smoke        # fixture smoke
npm run test:upstream-e2e # multi-host
npm run test:all          # 全部
```
