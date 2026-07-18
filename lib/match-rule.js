'use strict';

/**
 * Pure rule matcher. First matching rule wins, in array order.
 *
 * Rule fields:
 * - host, pathPrefix, methods (existing)
 * - when?: { query?: Record<string,string>, header?: Record<string,string> }
 *
 * @param {Array<object>} rules
 * @param {string} hostname
 * @param {string} urlPath
 * @param {string} [method='GET']
 * @param {{ query?: object, headers?: object }} [ctx]
 * @returns {object|null}
 */
function matchWhen(when, ctx = {}) {
  if (!when || typeof when !== 'object') return true;
  const query = ctx.query || {};
  const headers = ctx.headers || {};

  if (when.query && typeof when.query === 'object') {
    for (const [k, v] of Object.entries(when.query)) {
      if (String(query[k] ?? '') !== String(v)) return false;
    }
  }
  if (when.header && typeof when.header === 'object') {
    for (const [k, v] of Object.entries(when.header)) {
      const hv = headers[k] ?? headers[k.toLowerCase()];
      if (String(hv ?? '') !== String(v)) return false;
    }
  }
  return true;
}

function matchRule(rules, hostname, urlPath, method, ctx = {}) {
  const m = (method || 'GET').toUpperCase();
  for (const rule of rules) {
    const hostOk = matchHost(rule, hostname);
    const pathOk =
      !rule.pathPrefix ||
      urlPath === rule.pathPrefix ||
      urlPath.startsWith(rule.pathPrefix.replace(/\/$/, '') + '/') ||
      urlPath.startsWith(rule.pathPrefix);
    const methodOk =
      !rule.methods ||
      rule.methods.map((x) => x.toUpperCase()).includes(m) ||
      rule.methods.includes('*');
    const whenOk = matchWhen(rule.when, ctx);
    if (hostOk && pathOk && methodOk && whenOk) return rule;
  }
  return null;
}

/**
 * Host matching: hosts[] array takes priority over single host field.
 * @param {object} rule
 * @param {string} hostname
 * @returns {boolean}
 */
function matchHost(rule, hostname) {
  if (rule.hosts && rule.hosts.length > 0) {
    return rule.hosts.some((h) => hostMatches(h, hostname));
  }
  if (rule.host) {
    return hostMatches(rule.host, hostname);
  }
  // No host constraint → matches any host
  return true;
}

function hostMatches(pattern, hostname) {
  if (!pattern || pattern === '*') return true;
  if (pattern === hostname) return true;
  if (pattern.startsWith('*.')) {
    return hostname.endsWith(pattern.slice(1));
  }
  return false;
}

module.exports = { matchRule, matchWhen, matchHost, hostMatches };
