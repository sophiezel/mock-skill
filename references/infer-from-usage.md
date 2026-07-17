# 用法倒推（infer）

## 产品原则

1. **静态优先**：init 尽量发现接口，并从用法倒推响应字段，使多数常规项目不抓包也能自测主路径。  
2. **可扩展**：项目差异进 `<projectDir>/.mock-skill/infer.json`（合并 [`config/default.infer.json`](../config/default.infer.json)），不在引擎里为单仓写死。  
3. **capture-merge = 补洞与增强**（**现有功能完整保留**）：缺键、真实样例值、静态抽不出时使用——不是 init 前置条件，也不削弱既有合并语义。  
4. **禁止臆造字段**：键只来自用法倒推或 capture-merge / OpenAPI；faker 只填值不增键。

## 默认扫描（无 adapter）

1. **infer profile**：`config/default.infer.json` ← `.mock-skill/infer.json`（pathAliases / httpWrappers / deny）  
2. **serviceBase**：`config/env` 中 `KEY: 'https://host/prefix'` 记为网关，pathname 深度 ≤1 不生成 mock  
3. **host 变量**：`src` 内 `apiPrefix = '//host'` 等赋值（含 IIFE 多环境）全部收集；模板 path 按变量 **全环境展开**  
4. **HTTP 封装注册表**：默认 `$HTTP` / `http` / `request` / `api` / `apiClient` 等；项目 `httpWrappers` 可追加  
5. **fetch** / **axios** / **createRequest**（内置）  
6. **字符串 URL / path literal**：绝对 URL 与多段 path（导航 URL 不收录：`location.href` / `createWebView` 等）  
7. **deny 列表**：CDN/静态资源 host（profile 可追加）  
8. **usage-io** — 静态倒推响应字段（主路径），分层如下：
   - **L1 Script AST**（`ts-morph`）：`.ts/.tsx/.js/.jsx` 与 `.vue` 的 `<script>` 虚拟文件  
   - **L2 Markup AST**（`@vue/compiler-dom`）：`.vue` 的 `<template>`（`v-for` / 插值 / 绑定中的成员访问）  
   - **L3 BindingGraph**：响应路径 → 别名 → 数组性（由 `forEach`/`|| []`/`v-for` 等用法推断，**无字段名白名单**）→ `item.props`  
   - 路径别名：tsconfig/jsconfig `paths`；无配置且有 `src/` 时默认 `@/*`、`~/*` → `src/*`  
   - **调用点双通道**：`findReferences` + **import-name 回退**  
   - 解构 / 短路 / 可选链 / `export { name }` 绑定 `exportHint`  
9. **materialize** → contract cases（faker 只填已有键；嵌套 array + item.props → `[{…}]`）  
10. **capture-merge**（可选增强）回灌真实响应  

### 字段硬约束

- **禁止创造响应字段**：`success.data` 的键只能来自接口用法或 `capture-merge` 真实 body。  
- **禁止**把 UI state 改名（如 `setData({ cityId })`）扫进 shape。  
- init 样例值仅为占位；需要真实值时再 `session` + `capture-merge`（功能与语义不变）。

### emptyData vs gaps

| 指标 | 含义 |
|------|------|
| **usageBacked** | 静态倒推出非空 `success.data`（含已知数组 payload `[]` / item 占位；含多 host 副本） |
| **emptyData** | `materialize` 后无可用 data（静态缺口；**含多环境 host 膨胀**） |
| **usageBackedHints / emptyDataHints** | 按 `exportHint` 去重，更接近「多少接口函数」有/无字段 |
| **gaps** | usage-io 缺口（如 `no_export_symbol` / `no_callsite`） |
| **skippedEmpty** | `response.source===empty` 且 `no_export_symbol` → 只写 contract、不渲 handler |
| **pruned*** | `--force` 时按白名单删除无 `mock-skill:manual` 的孤儿 |

### 扫描过滤

- 跳过 `e2e/`、`__mocks__`、`src/mock/`、`*.test.*` / `*.spec.*`
- pathLiteral 仅在邻近有请求上下文（含注册表封装）时收录
- 丢弃路径段内未解析的 `${id}`；`` `${hostVar}/static/path` `` 由封装提取器展开
- deny 见 `config/default.infer.json` / 项目 infer.json

### 支持的文件类型

| 类型 | discover | usage-io | 备注 |
|------|----------|----------|------|
| `.js` / `.mjs` / `.cjs` | ✅ | L1 ts-morph | `allowJs: true` |
| `.jsx` | ✅ | L1（含 JSX 表达式） | |
| `.ts` / `.tsx` | ✅ | L1 | |
| `.vue` | ✅ | L1 script + **L2 template AST** | script 虚拟文件；template 经 `@vue/compiler-dom` |

不读取业务仓既有 `src/mock`。

## 项目 infer.json 示例

```json
{
  "pathAliases": { "@/*": ["src/*"] },
  "httpWrappers": [
    {
      "callee": "$API",
      "methods": { "get": "GET", "post": "POST", "getP": "GET", "postP": "POST" }
    }
  ]
}
```

路径：`<projectDir>/.mock-skill/infer.json`。

## 可选 adapter

```bash
mock-skill init --adapter=create-request
```

- 从 `adapters/<name>.js` 加载；须导出 `{ name, extract({ content, rel, serviceBases }) }`
- 与默认扫描**叠加**（去重）

## 覆盖缺口

contract.`coverage.gaps` 常见值：

- `no_callsite` / `no_property_access` / `no_export_symbol`
- `dynamic_key` / `props_shallow_only` / `ref_lookup_failed`

有 gap 时不得宣称 IO 完备。优先检查用法是否下钻字段；仍缺键时用完整 `capture-merge` 补洞（不阉割）。
