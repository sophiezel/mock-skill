# Pitfalls

1. **用错浏览器** — 日常 Chrome 不走 proxy；看流量门禁/access log
2. **CORS** — 代理未注入 CORS 会导致 localhost 跨域失败；Hybrid WebView Origin 非 localhost 时需配 `cors.extraOrigins`
3. **HTTPS MITM** — v1 对 HTTPS 仅 CONNECT tunnel，不改写响应；mock 规则优先进 HTTP/可拦路径
4. **new 无文档** — 禁止臆造；task 模式下 BLOCK
5. **端口占用** — start 前探测，失败即报错
6. **误提交 .data** — 已 gitignore
7. **env 基址 ≠ 接口** — `KEY: 'https://host/prefix'` 是网关前缀，不会再生成根 mock；完整 path=`prefix+/external/...`
8. **空 data** — 无调用点属性访问时可能仍空；看 `coverage.gaps`，跑 session + `capture-merge`
9. **静态非完备** — `gapApis` 非空时勿宣称 IO 完备
10. **真机打不到代理** — 默认 `proxy.host=127.0.0.1`，真机须 `--proxy-host=0.0.0.0` 且电脑手机同局域网；勿在公共 Wi‑Fi 开 0.0.0.0
11. **E2E scenario 串台** — 并行 worker 共用 session 会互相覆盖 case；一 worker 一 session 或 `beforeEach`/`afterEach` 复位
12. **只生成 success** — 未生成/未切故障 case 就跑异常路径 E2E，实际没测到；E2E 前显式 `set-scenario`
