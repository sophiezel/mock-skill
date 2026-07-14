# 生成 Mock

- 输出：`.data/projects/<slug>/contracts/*.json` + `mocks/<host>/<path>/index.js`
- handler 支持 `caseId` / `x-mock-case`：`success` | `empty` | `biz_error`
- 手写保护：handler 含 `mock-skill:manual` 则不覆盖
- 冲突未决议：不覆盖该接口 handler
- 同步写 `proxy-rules.json`
