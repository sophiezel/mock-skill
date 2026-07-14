'use strict';

function isAllowedOrigin(origin, corsCfg = {}) {
  if (!origin) return false;
  if (corsCfg.allowLocalhost !== false) {
    if (
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
      /^https?:\/\/\[::1\](:\d+)?$/i.test(origin)
    ) {
      return true;
    }
  }
  if (/guazi(?:-cloud|-apps)?\.com/i.test(origin)) return true;
  const extras = corsCfg.extraOrigins || [];
  return extras.some((o) => o === origin || (o.startsWith('*') && origin.endsWith(o.slice(1))));
}

function applyCorsHeaders(req, res, corsCfg = {}) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, corsCfg)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (corsCfg.allowCredentials !== false) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Vary', 'Origin');
  }

  const requestedHeaders = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requestedHeaders ||
      'Content-Type, Authorization, Identity, guazisso, x-ganji-token, pai-token, Accept, Referer, User-Agent, request-id, x-mock-case',
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,DELETE,OPTIONS,PATCH',
  );
}

function handleOptions(req, res, corsCfg) {
  applyCorsHeaders(req, res, corsCfg);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.statusCode = 204;
  res.end();
}

module.exports = { isAllowedOrigin, applyCorsHeaders, handleOptions };
