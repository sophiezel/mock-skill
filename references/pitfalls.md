# Pitfalls

1. **用错浏览器** — 日常 Chrome 不走 proxy；看流量门禁/access log
2. **CORS** — 代理未注入 CORS 会导致 localhost 跨域失败
3. **HTTPS MITM** — v1 对 HTTPS 仅 CONNECT tunnel，不改写响应；mock 规则优先进 HTTP/可拦路径
4. **new 无文档** — 禁止臆造；task 模式下 BLOCK
5. **端口占用** — start 前探测，失败即报错
6. **误提交 .data** — 已 gitignore
7. **env 基址 ≠ 接口** — `CARS_TASK: 'https://host/cars-task'` 是网关前缀，不会再生成根 mock；完整 path=`prefix+/external/...`
8. **空 data** — 无调用点属性访问时可能仍空；看 `coverage.gaps`，跑 session + `capture-merge`
9. **静态非完备** — `gapApis` 非空时勿宣称 IO 完备
