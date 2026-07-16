# 用法倒推（infer）

## 默认扫描（无 adapter）

1. **serviceBase**：`config/env` 中 `KEY: 'https://host/prefix'` 记为网关，pathname 深度 ≤1 不生成 mock  
2. **fetch**：`fetch(url)` / `fetch(url, { method })`（含相对路径）  
3. **axios**：`axios.get|post|put|delete|patch(url)`  
4. **createRequest**：`createRequest({ key })` + `uri` → `host + prefix + path`（内置）  
5. **字符串 URL / path literal**：绝对 URL 与多段 path 启发式  
6. **deny 列表**：`config/default.infer.json`（CDN/静态资源 host）  
7. **usage-io（ts-morph）**：导出符号引用 → 调用实参 / 属性链 / 枚举（可选 enrich）  
8. **materialize** → contract cases；**capture-merge** 回灌

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
