'use strict';

/**
 * Pure rule matcher extracted from runtime/proxy/server.js for testability.
 * Zero behavior change: first matching rule wins, in array order.
 *
 * @param {Array<{host?:string, pathPrefix?:string, methods?:string[]}>} rules
 * @param {string} hostname
 * @param {string} urlPath
 * @param {string} [method='GET']
 * @returns {object|null}
 */
function matchRule(rules, hostname, urlPath, method) {
  const m = (method || 'GET').toUpperCase();
  for (const rule of rules) {
    const hostOk =
      !rule.host ||
      rule.host === hostname ||
      rule.host === '*' ||
      (rule.host.startsWith('*.') && hostname.endsWith(rule.host.slice(1)));
    const pathOk =
      !rule.pathPrefix ||
      urlPath === rule.pathPrefix ||
      urlPath.startsWith(rule.pathPrefix.replace(/\/$/, '') + '/') ||
      urlPath.startsWith(rule.pathPrefix);
    const methodOk =
      !rule.methods ||
      rule.methods.map((x) => x.toUpperCase()).includes(m) ||
      rule.methods.includes('*');
    if (hostOk && pathOk && methodOk) return rule;
  }
  return null;
}

module.exports = { matchRule };
