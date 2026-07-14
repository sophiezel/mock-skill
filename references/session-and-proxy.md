# Session 与内置代理

## 开关

- `proxy.enabled` / CLI `--proxy=0|1`
- `--mock-port` / `--proxy-port`

## 浏览器

独立 Chrome：

```bash
Chrome --user-data-dir=.data/chrome-profiles/<slug> --proxy-server=127.0.0.1:<proxyPort>
```

登录：专用 profile 持久化；SSO host 可配 `passthroughHosts`。

## CORS

localhost / 127.0.0.1 Origin 放行；OPTIONS → 204；credentials 回显 Origin。

## soft 未命中

透传 + `captures/` 录制；写接口默认禁止透传。
