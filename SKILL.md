---
name: api-mock-orchestrator
description: >-
  Built-in HTTP mock runtime plus toggleable proxy for zero-intrusion frontend
  self-test. Discovers APIs from project usage, classifies new/modify/dependency/unrelated,
  generates mocks under .data/projects, and starts mock+proxy sessions.
  Use when the user mentions mock-skill, init mock, API mock, 自测 mock, 倒推接口,
  or backend not ready.
disable-model-invocation: true
---

# api-mock-orchestrator (mock-skill)

## Layout

- Repo: `/Users/xuwei/Profession/mock`
- CLI: `mock-skill`
- Data: `.data/projects/<projectSlug>/` (flat; one mock per host+path)
- Install: `scripts/install.sh`

## Five steps

1. **discover** — `infer-api-usage` scan frontend for host+path
2. **classify** — related? → `new` | `modify` | `dependency` | else `unrelated`
3. **contract** — new needs docs/`--related-from`; modify merges + conflict report; dependency/unrelated reuse or infer
4. **generate** — write contracts + `mocks/<host>/<path>/index.js`; unresolved conflicts do not overwrite
5. **session** — start built-in mock ± proxy; Chrome `--proxy-server`; `--task` for audit only

## Agent checklist

- [ ] Prefer CLI over ad-hoc scripts: `mock-skill init` / `session start`
- [ ] Remind `--task=<需求ID>` on 需求自测 for changelog traceability
- [ ] Never invent IO for `new` without docs/user definition (BLOCK generate)
- [ ] On modify conflicts: show `reports/contract-conflicts.md`, wait for resolution
- [ ] Do not edit business repo (unless user asks `--write-project-config`)
- [ ] Do not depend on Whistle/Charles
- [ ] CORS must allow localhost Origins; OPTIONS → 204
- [ ] soft miss: passthrough + capture; do not fail whole session for one unmocked API

## Commands

```bash
/Users/xuwei/Profession/mock/scripts/install.sh
cd <frontend>
mock-skill init [--task=ID] [--related-from=doc]
# 看 reports/* 与 coverage-summary.json 的 gapApis / emptyDataCount
mock-skill session start --task=ID --start-url=http://localhost:8080
# 走主路径后回灌运行时字段
mock-skill capture-merge --name=<projectSlug>
mock-skill audit --task=ID
mock-skill smoke
```

IO 反推用 ts-morph（引用 + 属性链 + 枚举）；不读 `src/mock`；不承诺零遗漏，缺口进 `coverage.gaps`。

## References

- `docs/DECISIONS.md` — 定稿决策
- `docs/README.md` — 文档索引与计划存档
- `references/classify-request.md`
- `references/contract-schema.md`
- `references/infer-from-usage.md`
- `references/generate-mock.md`
- `references/session-and-proxy.md`
- `references/pitfalls.md`
