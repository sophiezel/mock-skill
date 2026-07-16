# Session 与内置代理

## 开关

- `proxy.enabled` / CLI `--proxy=0|1`
- `--mock-port` / `--proxy-port`
- `--proxy-host`（默认 `127.0.0.1`；真机/E2E 用 `0.0.0.0`）
- `--scenario` 启动时初始场景

## 浏览器（桌面）

独立 Chrome：

```bash
Chrome --user-data-dir=.data/chrome-profiles/<slug> --proxy-server=127.0.0.1:<proxyPort>
```

登录：专用 profile 持久化；SSO/鉴权 host 可配 `passthroughHosts`。

## 真机 WebView

```bash
mock-skill session start --proxy-host=0.0.0.0
```

启动日志打印 `Wi-Fi 代理: <LAN_IP>:<proxyPort>`，在手机 Wi‑Fi 手动代理填写。详见 `e2e-and-device-proxy.md`。

## CORS

localhost / 127.0.0.1 Origin 默认放行；OPTIONS → 204；credentials 回显 Origin。Hybrid WebView 非 localhost Origin 走 `cors.extraOrigins`。

## soft 未命中

透传 + `captures/` 录制；写接口默认禁止透传。

## 场景热更新

`set-scenario` / `set-case` 写 session `cases.active`；proxy/mock 每请求 ≤1s 缓存读，无需重启。
