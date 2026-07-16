# 请求分类裁决

对每个 `host+path`：

1. 是否与本次需求相关（接口清单 / `--related-from` / 改动文件调用点）
2. 相关 → `new` | `modify` | `dependency`
3. 无关 → `unrelated`

| role | IO 来源 | mock |
|------|---------|------|
| new | 文档或用户给定；否则 BLOCK | 生成 |
| modify | 存量 + 文档；冲突明示 | 合并更新；未决议不覆盖 |
| dependency | 有则复用；无则用法倒推 | 复用/生成 |
| unrelated | 同 dependency | 复用/生成 |

## LLM / 人介入边界（§3.1）

| 场景 | 是否 LLM/人 |
|------|-------------|
| 有 `--task` / `--related-from` / 明确需求语义 | **是**（或人）：判定相关与 role |
| **无任务全量 init** | **否**：启发式全部标为 `dependency`（项目基线），不强行 LLM |
| `new` 无文档 IO | **是**（或人）+ 工具 BLOCK；禁止引擎臆造 |

`--task` 只写入 history/changelog，不拆目录。E2E 前显式 `set-scenario`；冲突未决议不 generate 覆盖。
