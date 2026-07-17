'use strict';

/**
 * Structural discovery of prefix → origin host maps.
 * Matches objects shaped like:
 *   { prefixList: string[], originConfig: Record<env, 'https://host[/prefix]'> }
 * Does NOT bind to symbol names (e.g. ORIGIN_LIST).
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ prefix: string, host: string, originPrefix: string, env: string, originUrl: string }} PrefixOriginEntry
 */

/**
 * Parse an absolute or protocol-relative URL into host + pathname prefix.
 * @param {string} raw
 * @returns {{ host: string, originPrefix: string }|null}
 */
function parseOriginUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let url = raw.trim();
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    if (!u.host) return null;
    return {
      host: u.host,
      originPrefix: u.pathname.replace(/\/+$/, '') || '',
    };
  } catch {
    return null;
  }
}

/**
 * Extract prefixList string literals from a source snippet.
 * @param {string} block
 * @returns {string[]}
 */
function extractPrefixList(block) {
  const listM = /prefixList\s*:\s*\[([^\]]*)\]/.exec(block);
  if (!listM) return [];
  const out = [];
  const re = /['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(listM[1]))) {
    const p = m[1].trim();
    if (p) out.push(p);
  }
  return out;
}

/**
 * Extract originConfig env → url pairs from a source snippet.
 * @param {string} block
 * @returns {Array<{ env: string, url: string }>}
 */
function extractOriginConfig(block) {
  const cfgM = /originConfig\s*:\s*\{([\s\S]*?)\}/.exec(block);
  if (!cfgM) return [];
  const out = [];
  const re =
    /([A-Za-z_][\w]*)\s*:\s*['"`]((?:https?:)?\/\/[^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(cfgM[1]))) {
    out.push({ env: m[1], url: m[2] });
  }
  return out;
}

/**
 * Scan file content for structural prefix→origin entries.
 * @param {string} content
 * @returns {PrefixOriginEntry[]}
 */
function extractPrefixOriginEntriesFromContent(content) {
  if (!content || !/prefixList/.test(content) || !/originConfig/.test(content)) {
    return [];
  }
  /** @type {PrefixOriginEntry[]} */
  const entries = [];
  // Split on objects that look like they contain both keys (heuristic windows)
  const re =
    /\{\s*prefixList\s*:\s*\[[^\]]*\]\s*,\s*originConfig\s*:\s*\{[\s\S]*?\}\s*,?\s*\}/g;
  let m;
  while ((m = re.exec(content))) {
    const block = m[0];
    const prefixes = extractPrefixList(block);
    const origins = extractOriginConfig(block);
    for (const prefix of prefixes) {
      for (const { env, url } of origins) {
        const parsed = parseOriginUrl(url);
        if (!parsed) continue;
        entries.push({
          prefix,
          host: parsed.host,
          originPrefix: parsed.originPrefix,
          env,
          originUrl: url.startsWith('//') ? `https:${url}` : url,
        });
      }
    }
  }
  // Alternate order: originConfig before prefixList
  const re2 =
    /\{\s*originConfig\s*:\s*\{[\s\S]*?\}\s*,\s*prefixList\s*:\s*\[[^\]]*\]\s*,?\s*\}/g;
  while ((m = re2.exec(content))) {
    const block = m[0];
    const prefixes = extractPrefixList(block);
    const origins = extractOriginConfig(block);
    for (const prefix of prefixes) {
      for (const { env, url } of origins) {
        const parsed = parseOriginUrl(url);
        if (!parsed) continue;
        if (
          entries.some(
            (e) =>
              e.prefix === prefix &&
              e.host === parsed.host &&
              e.env === env,
          )
        ) {
          continue;
        }
        entries.push({
          prefix,
          host: parsed.host,
          originPrefix: parsed.originPrefix,
          env,
          originUrl: url.startsWith('//') ? `https:${url}` : url,
        });
      }
    }
  }
  return entries;
}

/**
 * Discover all prefix→origin maps under a project.
 * @param {string} projectDir
 * @param {string[]} [files]
 * @returns {PrefixOriginEntry[]}
 */
function discoverPrefixOriginMaps(projectDir, files) {
  const fileList = files || [];
  /** @type {PrefixOriginEntry[]} */
  const all = [];
  const seen = new Set();
  for (const file of fileList) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.length > 1_500_000) continue;
    for (const e of extractPrefixOriginEntriesFromContent(content)) {
      const key = `${e.prefix}|${e.host}|${e.originPrefix}|${e.env}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(e);
    }
  }
  return all;
}

/**
 * Resolve a relative request path against prefix maps.
 * Match rule: longest prefix where path.startsWith(prefix) (stable, not name-bound).
 * Returns one entry per matching origin env (multi-host expansion).
 *
 * @param {string} urlPath - must start with /
 * @param {PrefixOriginEntry[]} maps
 * @returns {Array<{ host: string, path: string, confidence: string }>}
 */
function resolveRelativePath(urlPath, maps) {
  if (!urlPath || !urlPath.startsWith('/')) return [];
  const list = maps || [];
  if (!list.length) {
    return [{ host: '_default', path: urlPath.split('?')[0], confidence: 'low' }];
  }

  // Longest matching prefix wins
  let bestPrefix = '';
  for (const e of list) {
    if (
      urlPath === e.prefix ||
      urlPath.startsWith(e.prefix.endsWith('/') ? e.prefix : `${e.prefix}`)
    ) {
      // Prefer longer prefixes (e.g. /cars-task over /)
      if (e.prefix.length > bestPrefix.length) bestPrefix = e.prefix;
    }
  }
  // Special-case prefix '/' : only if nothing longer matched and path is relative
  if (!bestPrefix) {
    const rootEntries = list.filter((e) => e.prefix === '/');
    if (rootEntries.length) {
      bestPrefix = '/';
    } else {
      return [{ host: '_default', path: urlPath.split('?')[0], confidence: 'low' }];
    }
  }

  const cleanPath = urlPath.split('?')[0];
  const matched = list.filter((e) => e.prefix === bestPrefix);
  /** @type {Map<string, { host: string, path: string, confidence: string }>} */
  const byHost = new Map();
  for (const e of matched) {
    // Runtime interceptor: originUrl + relativeUrl → absolute.
    // Mock key uses host of origin + (origin.pathname + relative path).
    const joined = e.originPrefix
      ? `${e.originPrefix.replace(/\/+$/, '')}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`
      : cleanPath;
    const host = e.host;
    const key = `${host}|${joined}`;
    if (!byHost.has(key)) {
      byHost.set(key, {
        host,
        path: joined,
        confidence: 'high',
      });
    }
  }
  return [...byHost.values()];
}

module.exports = {
  parseOriginUrl,
  extractPrefixOriginEntriesFromContent,
  discoverPrefixOriginMaps,
  resolveRelativePath,
};
