# 用法倒推（infer）

## 默认扫描（无 adapter）

1. **serviceBase**：`config/env` 中 `KEY: 'https://host/prefix'` 记为网关，pathname 深度 ≤1 不生成 mock  
2. **fetch**：`fetch(url)` / `fetch(url, { method })`（含相对路径）  
3. **axios**：`axios.get|post|put|delete|patch(url)`  
4. **createRequest**：`createRequest({ key })` + `uri` → `host + prefix + path`（内置）  
5. **字符串 URL / path literal**：绝对 URL 与多段 path 启发式  
6. **deny 列表**：`config/default.infer.json`（CDN/静态资源 host）  
7. **usage-io（ts-morph）**：导出符号引用 → 调用实参 / 属性链 / 枚举（可选 enrich）
   - **解构倒推**：`.then(({ data }) => …)` 与 `const { fields } = data` 通过 `BindingElement` 收集字段
   - **`export { name }`**：`const x = req(...)` + `export { x }` 绑定 `exportHint`（含 `as alias`）
8. **materialize** → contract cases（`@faker-js/faker` 仅给**已有字段**填占位值，不增删键）
9. **capture-merge** 回灌真实响应（字段与值均以抓包为准，覆盖 init 占位）

### 字段硬约束

- **禁止创造响应字段**：`success.data` 的键只能来自接口用法（响应解构 / `res.data.x`）或 `capture-merge` 真实 body。
- **禁止**把 UI state 改名（如 `setData({ cityId })`）扫进 shape。
- init 样例值仅为占位（faker 只填值、不增删键）；走主路径后执行 `mock-skill capture-merge` 用真实响应覆盖占位值，且真实 body 中出现的键可并入 contract（接口真返回，不算创造）。

### emptyData vs gaps

| 指标 | 含义 |
|------|------|
| **emptyData** | `materialize` 后 `success.data` 无键 |
| **gaps** | usage-io 缺口标记（如 `no_export_symbol`） |
| **skippedEmpty** | `response.source===empty` 且 gaps 含 `no_export_symbol` / `no_property_access` / `no_callsite` → **只写 contract、不渲空 handler、不进 proxy-rules** |
| **pruned*** | `--force` 时按本轮白名单删除无 `mock-skill:manual` 的孤儿 handler/contract |

### 扫描过滤

- 跳过 `e2e/`、`__mocks__`、`src/mock/`、`*.test.*` / `*.spec.*`
- pathLiteral 仅在邻近有 `createRequest` / `fetch` / `axios` / `request.get|post` 时收录
- 丢弃含 `${` 的路径；`prefix: ""` 仍使用 env pathname 拼 mock path
- `_default` 与真实 host 同 method+path（或 path 后缀）时去重；低置信且无 exportHint 的 `_default` 丢弃
- deny 列表见 `config/default.infer.json`（host suffix/keyword、可选 `denyPathSubstrings`）——**项目特有域名请写进该配置，勿改代码**
- `export async function` 包装内部 `req`、`export default { fn }`、`request.get({key,uri})` 均可绑定 `exportHint`

### 支持的文件类型

| 类型 | discover | usage-io 解构 | 备注 |
|------|----------|--------------|------|
| `.js` / `.mjs` / `.cjs` | ✅ | ✅ | `allowJs: true`，无注解时仅字段名 |
| `.jsx` | ✅ | ✅ | |
| `.ts` / `.tsx` | ✅ | ✅ | 有类型注解时字段更完整 |
| `.vue` | ✅ | ✅ | 抽取 `<script>` / `<script setup>` 正文为虚拟源文件；**不扫 `<template>`** |

不读取业务仓既有 `src/mock`。

## 可选 adapter

```bash
mock-skill init --adapter=create-request
```

- 从 `adapters/<name>.js` 加载；须导出 `{ name, extract({ content, rel, serviceBases }) }`
- 与默认扫描**叠加**（去重）；用于公司封装或漏扫补洞
- 内置已含 createRequest；显式 `--adapter` 便于发现与自定义扩展

## 覆盖缺口

contract.`coverage.gaps` 常见值：

- `no_callsite` / `no_property_access` / `no_export_symbol`
- `dynamic_key` / `props_shallow_only` / `ref_lookup_failed`

有 gap 时不得宣称 IO 完备；请补类型或跑 session + `mock-skill capture-merge`。
