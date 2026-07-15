---
name: Fix Empty Data & Garbage Host Cleanup
overview: 系统级全链路修复方案——解决 init 产物中 62% 空数据、非 API host 污染、hash-router 路径、空目录残留四大类问题。四层防御：扫描过滤(L1) → 符号发现增强(L2) → 清理体系(L3) → 生成门禁(L4)。
todos:
  - id: l1-skip-mock-dir
    content: "L1.1: SKIP_DIRS 扩展，排除 mock/mocks/__mocks__ 目录"
    status: pending
  - id: l1-host-classification
    content: "L1.2: 新增 config/host-classification.json，三层 host 分类 + blockedPathPatterns"
    status: pending
  - id: l1-legacy-filter
    content: "L1.3: extractLegacyApis push() 增加 host/path 语义过滤 + isStaticAsset 扩展 .js"
    status: pending
  - id: l1-export-binding
    content: "L1.4: extractCreateRequestApis 扩展 export 识别模式（async function/re-export/default export）"
    status: pending
  - id: l2-no-export-heuristic
    content: "L2.1: infer-usage-io 无 exportHint 的 API 做 path 字面量启发式匹配"
    status: pending
  - id: l2-props-depth
    content: "L2.2: L5 浅 props 追踪深度从 1 提升到 3（解析 import 链）"
    status: pending
  - id: l3-garbage-cleanup
    content: "L3.1: cleanupGatewayOnlyMocks 升级为 cleanupGarbageMocks（hash-router + blocked host + 空目录）"
    status: pending
  - id: l3-force-clean
    content: "L3.2: --force 调用增强清理 + 报告增强（新增统计维度）"
    status: pending
  - id: l4-skeleton-tier
    content: "L4.1: 空数据 API 分级——no_export_symbol 只生成 skeleton contract 不生成 handler"
    status: pending
  - id: l4-host-check
    content: "L4.2: generateMocks 入口检查 host 可 mock 性（CDN/纯IP host 不生成 handler）"
    status: pending
isProject: false
---

# 修复空数据 Mock 与垃圾 Host 清理（全链路方案）

## 问题全景

`mock-skill init --force --name=jian-h5` 产物：

| 指标 | 数值 | 问题 |
|------|------|------|
| 发现 API | 236 | |
| 空数据 | 146 (62%) | 问题1 |
| usage-backed | 81 (34%) | |
| gapApis | ~170 | |
| 非 API host | www.w3.org, api.map.baidu.com, image-pub.guazistatic.com 等 10+ | 问题2 |
| hash-router path | che-web.guazi.com/#/newReport, guagua.guazi.com/im/#/guagua-sdk | 问题3 |
| 空 host 目录 | api.map.baidu.com 等 7 个空目录残留 | 问题2 |
| 静态资源 | downsc.chinaz.net/.../11582.mp3, 图片/js 等 | 问题2 |

---

## 根因分析

### 问题1: 62% 空数据

```
extractLegacyApis (regex) → 发现URL → 无export符号
  → enrichApisWithUsageIo 找不到引用 → responseShape 空 → materialize({}) → data:{}
```

| 根因 | 位置 | 影响面 |
|------|------|--------|
| 正则扫 URL 不绑定 export symbol | extractLegacyApis | 120+ API, gap=no_export_symbol |
| export 识别只覆盖 createRequest 模式 | extractCreateRequestApis | 漏掉 async function/re-export/default export |
| ts-morph 依赖 exportHint 才能 findReferences | enrichApisWithUsageIo | 无 export → 整个 L2-L6 富化跳过 |
| props 追踪深度仅 1 层 | enrichApisWithUsageIo L5 | 45 API, gap=props_shallow_only |
| 动态键 ElementAccess | enrichApisWithUsageIo | ~10 API, gap=dynamic_key |

### 问题2: 非 API host 被 mock

| 类别 | 示例 | 根因 |
|------|------|------|
| XML namespace | www.w3.org/2000/svg | absRe 正则匹配 xmlns 属性 |
| 百度地图 CDN | api.map.baidu.com | absRe 匹配 script src |
| 静态资源 CDN | image-pub.guazistatic.com, image-public.guazistatic.com | absRe 匹配 img src |
| 第三方素材 | downsc.chinaz.net/.../11582.mp3 | isStaticAsset 缺 .js 后缀 |
| 示例域名 | example.com | 代码中示例 URL |
| 图片/JS 静态资源 | *.js 文件引用 | isStaticAsset 正则未包含 .js |

### 问题3: hash-router 路径

```
src/mock/order.js 中 "https://che-web.guazi.com/#/newReport"
  → absRe 匹配 → path="/#/newReport"
  → dedupe 有 #/ 过滤但存量不清理
  → cleanupGatewayOnlyMocks 只清 depth≤1
```

---

## 修复方案：四层防御

### L1: 扫描过滤（源头止血）

#### L1.1: SKIP_DIRS 扩展
```
当前: node_modules, dist, build, .git, coverage, .next, vendor, .data, __tests__
新增: mock, mocks, __mocks__
```
**影响**: 杜绝 src/mock/ 中 URL 二次污染。

#### L1.2: 新增 config/host-classification.json
```json
{
  "businessApiHosts": ["*.guazi-cloud.com", "*.guazi.com"],
  "blockedHosts": [
    "www.w3.org", "api.map.baidu.com", "*.baidu.com",
    "*.chinaz.net", "example.com", "*.guazistatic.com"
  ],
  "blockedPathPatterns": [
    { "pattern": "^/#/", "reason": "hash-router" },
    { "pattern": "\\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico|map|pdf|mp3|mp4)(\\?|$)", "reason": "static-asset" }
  ]
}
```

#### L1.3: extractLegacyApis push() 增强过滤
```javascript
const push = (partial) => {
  if (!partial.path || partial.path === '/') return;
  if (isStaticAsset(partial.path)) return;           // + .js
  if (isGatewayOnlyPath(partial.path, serviceBases)) return;
  if (partial.path.includes('#/') || partial.path.includes('#')) return;  // 新增
  if (shouldSkipHost(partial.host, blockedHosts)) return;                  // 新增
  if (shouldSkipPath(partial.path, blockedPathPatterns)) return;           // 新增
  apis.push(...)
}
```

#### L1.4: isStaticAsset 扩展
```
当前: /\.(mp3|mp4|png|jpe?g|gif|webp|svg|css|woff2?|ttf|ico|map|pdf)(\?.*)?$/i
新增 .js: /\.(mp3|mp4|png|jpe?g|gif|webp|svg|css|woff2?|ttf|ico|map|pdf|js)(\?.*)?$/i
```

#### L1.5: extractCreateRequestApis 扩展 export 识别
新增模式:
- `export async function getXxx() { return request("/path") }`
- `export function getXxx() { const r = createRequest(...); return r("/path") }`
- `export default { getXxx: request("/path") }`
- `export { getXxx } from './service'`

### L2: 符号发现增强

#### L2.1: 无 exportHint 启发式匹配
对 gap=no_export_symbol 的 API，在所有源文件中搜索 path 字面量附近的函数调用和属性访问。

#### L2.2: props 追踪深度 1→3
记录 JSX prop 映射 → 解析 import 链 → 在子组件中收集属性链 → 合并回 responseShape。

### L3: 清理体系

#### L3.1: cleanupGatewayOnlyMocks → cleanupGarbageMocks
```
Phase A: gateway-only (depth≤1)     [已有]
Phase B: hash-router (path 含 #/)   [新增]
Phase C: blocked host 全部清理       [新增]
Phase D: 空目录级联删除              [新增]
```

#### L3.2: --force 调用增强清理 + 报告维度
报告新增: `blockedHostFilteredCount`, `skeletonCount`, `hashRouterCleanedCount`, `orphanDirsCleanedCount`

### L4: 生成门禁

#### L4.1: 空数据分级
| 级别 | 条件 | 行为 |
|------|------|------|
| skeleton | gap=no_export_symbol 且无数据 | 只生成 contract, 不生成 handler |
| placeholder | 有 export 但无属性访问 | 生成 handler, data 标 PLACEHOLDER |
| rich | 有数据 | 正常生成 |

#### L4.2: Host 可 mock 性检查
- blocked host → 不生成
- 含 "static"/"image"/"cdn" 的 host → 不生成
- 纯 IP（非 localhost/127.0.0.1）→ 不生成

---

## 修改文件清单

| 优先级 | 文件 | 内容 |
|--------|------|------|
| P0 | `scripts/infer-api-usage.js` | L1.1/L1.3/L1.4/L1.5 |
| P0 | `config/host-classification.json` | L1.2 新增 |
| P1 | `scripts/generate-mock.js` | L3.1/L4.1/L4.2 |
| P1 | `scripts/infer-usage-io.js` | L2.1/L2.2 |
| P2 | `scripts/init-project.js` | L3.2 报告增强 |
| P2 | `docs/DECISIONS.md` | 追加 host 分类决策 |

## 预期效果

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| emptyDataCount | 146 (62%) | ~30-40 (14-17%) |
| 非 API mock | 10+ 个 | 0 |
| 空 host 目录 | 7 个 | 0 |
| no_export_symbol | 120+ | ~50-60 |
| props_shallow_only | ~45 | ~10-15 |
| usageBackedCount | 81 (34%) | ~150+ (63%+) |
