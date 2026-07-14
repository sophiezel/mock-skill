# mock-skill

内置 Mock 运行时 + 可开关代理，用于前端需求自测：**不改业务仓代码**、不依赖 Whistle/Charles。

## 一键安装

```bash
/Users/xuwei/Profession/mock/scripts/install.sh
```

等价：

```bash
cd /Users/xuwei/Profession/mock && npm install && npm link
ln -sfn /Users/xuwei/Profession/mock ~/.agents/skills/api-mock-orchestrator
```

## 在业务项目预生成全部接口 Mock

```bash
cd /path/to/frontend-app
mock-skill init
mock-skill init --task=TR-1234 --related-from=./docs/req.md
```

数据落在（扁平，一项目一份）：

```
/Users/xuwei/Profession/mock/.data/projects/<projectSlug>/
```

`--task` 只做需求溯源（契约 history / `audit/changelog.jsonl`），**不**拆分 mock 目录。

## 自测 Session

```bash
mock-skill session start --task=TR-1234 --start-url=http://localhost:8080
# 使用打印出的【Mock 自测浏览器】（带 --proxy-server）
mock-skill smoke
# Ctrl+C 结束 session
```

开关与端口：

```bash
mock-skill session start --proxy=0 --mock-port=3901
mock-skill session start --proxy-port=19000
```

## CLI

| 命令 | 作用 |
|------|------|
| `mock-skill init` | 全量扫描并预生成 mock |
| `mock-skill classify` | 分类 |
| `mock-skill generate` | 按分类结果生成 |
| `mock-skill session start\|stop` | 起停 mock±proxy |
| `mock-skill set-case` | 切换用例 |
| `mock-skill smoke` | 冒烟 |
| `mock-skill audit --task=` | 追因 |

## Agent Skill

安装后通过 symlink 暴露为 `api-mock-orchestrator`。详见 [`SKILL.md`](./SKILL.md)。
