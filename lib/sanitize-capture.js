'use strict';

/**
 * Minimal PII / token sanitization for captured responses.
 *
 * Applied in capture-merge before persisting real bodies, so secrets that
 * happened to be in the recorded response (e.g. a `token` field echoed back,
 * `Authorization` header) are not written into contracts / handlers on disk.
 *
 * Design:
 *  - Default sensitive key list is GENERIC (industry-standard words), no brand.
 *  - Match is case-insensitive on the leaf key name.
 *  - Immutable: returns a new structure; never mutates input.
 *  - Recurses through objects and arrays; redacts by replacing value with
 *    '[REDACTED]' (keeps the key so shape stays stable).
 *  - Project may extend via opts.sensitivePaths (merged with defaults).
 */

const DEFAULT_SENSITIVE_PATHS = [
  'authorization',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'password',
  'passwd',
  'secret',
  'apiKey',
  'api_key',
  'privateKey',
  'private_key',
  'cookie',
  'set-cookie',
  'ssn',
  'creditCard',
  'credit_card',
  'cvv',
];

const REDACTED = '[REDACTED]';

function _buildMatcher(extra) {
  const set = new Set(DEFAULT_SENSITIVE_PATHS.map((s) => s.toLowerCase()));
  for (const e of extra || []) set.add(String(e).toLowerCase());
  // Substring match: a key is sensitive if it contains any sensitive word
  // (case-insensitive). Catches `X-Token`, `userPassword`, `accessToken`, etc.
  return (key) => {
    const k = String(key).toLowerCase();
    for (const s of set) {
      if (k.includes(s)) return true;
    }
    return false;
  };
}

function _redact(value, isSensitive) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => _redact(item, isSensitive));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitive(k) ? REDACTED : _redact(v, isSensitive);
    }
    return out;
  }
  return value;
}

function sanitizeCapture(cap, opts = {}) {
  if (cap == null || typeof cap !== 'object') return cap == null ? {} : cap;
  const isSensitive = _buildMatcher(opts.sensitivePaths);
  const out = {};
  if (cap.requestHeaders && typeof cap.requestHeaders === 'object') {
    out.requestHeaders = {};
    for (const [k, v] of Object.entries(cap.requestHeaders)) {
      out.requestHeaders[k] = isSensitive(k) ? REDACTED : v;
    }
  }
  if (cap.responseBody !== undefined) {
    out.responseBody = _redact(cap.responseBody, isSensitive);
  }
  // carry through any other fields untouched
  for (const k of Object.keys(cap)) {
    if (!(k in out)) out[k] = cap[k];
  }
  return out;
}

module.exports = {
  sanitizeCapture,
  DEFAULT_SENSITIVE_PATHS,
};
