# Changelog

## 1.1.0 — 2026-07-17

### Security
- Mock router path jail: reject `..` / outside-`mocksRoot` resolution (RCE fix)
- LAN bind (`0.0.0.0`) forces `missPolicy=reject` unless `--allow-open-proxy`
- CONNECT tunneling denied by default (except `passthroughHosts` / allow-open-proxy)
- Proxy request body limit (10mb) + upstream timeout; TLS `rejectUnauthorized` defaults true

### Fixed
- Fixture smoke gate was failing (72×) and scenario verify could false-green on empty rules
- Legacy fetch/axios wrappers now bind `exportHint` by function body line range
- `session stop` now SIGTERM/SIGKILL session + Chrome PIDs
- Dead dependency `http-proxy` removed (proxy is self-implemented)

### Added
- Optional HTTPS MITM (`--mitm=1`, local CA via openssl, matched hosts only)
- `import-openapi` / `export-msw` CLI commands
- Query/header `when` matching on proxy rules; light stateful `times` / `transitions` in scenarios
- Infer mtime cache; handler mtime require cache
- GitHub Actions CI (Node 18/20); `c8` coverage script; eslint
- capture-merge skip report when responseBody empty

### Docs
- Honest HTTPS status: rewrite requires `--mitm=1` or external MITM; CONNECT-only otherwise
- Contract schema / generate-mock references aligned with full case set; `when` on cases noted as proxy-header driven today
