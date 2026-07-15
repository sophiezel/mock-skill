# 用法倒推（ts-morph）

## 管线

1. **serviceBase**：`config/env` 中 `KEY: 'https://host/prefix'` 记为网关，pathname 深度 ≤1 不生成 mock  
2. **createRequest**：`createRequest({ key })` + `uri` → `host + prefix + path`  
3. **usage-io（ts-morph）**：导出符号 `findReferences` → 调用实参 / 赋值别名 / `PropertyAccess` 链 / `===`·`switch` 枚举  
4. **materialize**：形状树 → `success.data` 示例  
5. **capture-merge**：session 透传响应差分回灌（只增不盲删）

不读取 `src/mock`。

## 覆盖缺口

contract.`coverage.gaps` 常见值：

- `no_callsite` / `no_property_access` / `no_export_symbol`
- `dynamic_key` / `props_shallow_only` / `ref_lookup_failed`

有 gap 时不得宣称 IO 完备；请补类型或跑 session + `mock-skill capture-merge`。
