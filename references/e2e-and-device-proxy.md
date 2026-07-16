# E2E 与真机代理

适用：桌面 Playwright E2E + Hybrid 真机 WebView E2E。业务代码零改。

## 桌面 Playwright

```bash
mock-skill session start --start-url=http://localhost:8080
```

Playwright 配置指向本 skill proxy：

```js
// playwright.config.js
export default {
  use: {
    proxy: { server: 'http://127.0.0.1:18999' },
  },
};
```

用例切场景：

```js
import { execSync } from 'node:child_process';

test.beforeAll(() => {
  execSync('mock-skill set-scenario e2e-fault');
});
test.afterAll(() => {
  execSync('mock-skill set-scenario e2e-happy');
});
```

## 真机 WebView（Wi‑Fi 手动代理）

1. 电脑与真机同一局域网
2. 启动时 bind 到 LAN：

```bash
mock-skill session start --proxy-host=0.0.0.0 --start-url=http://localhost:8080
```

3. 启动日志会打印 `Wi-Fi 代理: <LAN_IP>:<proxyPort>`，在手机 Wi‑Fi → 手动代理 填写该 host/port
4. 手机 WebView 打开 H5，请求自动经本 skill proxy → mock / 透传

### 安全提示

- **仅信任局域网，勿在公共 Wi‑Fi 开 0.0.0.0**
- 桌面-only 仍可用 `127.0.0.1`（默认）

## HTTPS 边界

当前 HTTPS 仅 CONNECT 隧道透传，**不改写响应**。完整 MITM 为 P2 后续能力。

可行折中：

- 开发环境后端走 HTTP，mock 命中 HTTP
- 或前置已装 CA 的调试代理（如 Whistle）做 HTTPS MITM，再链到本 skill
- 真机 HTTPS mock 需本地 CA + 信任（P2）

## CORS / Hybrid WebView

WebView `Origin` 常非 localhost（`null`、自定义 scheme、`https://localhost` 壳）。默认仅放行 localhost。

非 localhost Origin 在 `session.json` 配置：

```json
{
  "cors": {
    "allowLocalhost": true,
    "extraOrigins": ["https://your-h5-host", "*.your-app-scheme"]
  }
}
```

不实现「万能 Origin」；按需显式加。

## Appium 真机 E2E

Appium 驱动 WebView；网络层仍靠手机 Wi‑Fi 代理 → 本 skill `proxyPort`。`beforeAll` 调 `set-scenario`，与桌面同。
