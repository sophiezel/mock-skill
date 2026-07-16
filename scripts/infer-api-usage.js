'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  'vendor',
  '.data',
  '__tests__',
]);

const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const STATIC_EXT =
  /\.(mp3|mp4|png|jpe?g|gif|webp|svg|css|woff2?|ttf|ico|map|pdf)(\?.*)?$/i;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.env') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(full, out);
    } else if (EXT.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

function pathDepth(pathname) {
  return pathname.split('/').filter(Boolean).length;
}

function joinPrefix(prefix, uri) {
  const p = (prefix || '').replace(/\/+$/, '');
  const u = uri.startsWith('/') ? uri : `/${uri}`;
  if (!p) return u;
  if (u === p || u.startsWith(`${p}/`)) return u;
  return `${p}${u}`;
}

/**
 * Discover service bases from env/config: KEY: 'https://host[/prefix]'
 */
function discoverServiceBases(projectDir) {
  const files = walk(projectDir).filter((f) => {
    const rel = path.relative(projectDir, f);
    return (
      /(?:^|\/)(config|env|environments?)\//i.test(rel) ||
      /env\.(js|ts|mjs|cjs)$/i.test(rel) ||
      /config\.(js|ts)$/i.test(path.basename(rel))
    );
  });

  /** @type {Map<string, { key: string, host: string, prefix: string, url: string }>} */
  const byKey = new Map();
  const keyUrlRe =
    /\b([A-Z][A-Z0-9_]*)\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/g;
  const baseUrlRe = /baseURL\s*[:=]\s*['"`](https?:\/\/[^'"`]+)['"`]/g;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    let m;
    keyUrlRe.lastIndex = 0;
    while ((m = keyUrlRe.exec(content))) {
      try {
        const u = new URL(m[2]);
        if (STATIC_EXT.test(u.pathname)) continue;
        const prefix = u.pathname.replace(/\/+$/, '') || '';
        const depth = pathDepth(prefix || '/');
        // Always register KEY; even host-only (depth 0)
        const entry = {
          key: m[1],
          host: u.host,
          prefix: prefix || '',
          url: m[2],
          depth,
        };
        const prev = byKey.get(m[1]);
        // Generic preference: keep the entry with a deeper prefix (more specific),
        // otherwise keep the first seen. No company-specific host preference.
        if (!prev || entry.depth > prev.depth) {
          byKey.set(m[1], entry);
        }
      } catch {
        /* ignore */
      }
    }
    baseUrlRe.lastIndex = 0;
    while ((m = baseUrlRe.exec(content))) {
      try {
        const u = new URL(m[1]);
        const prefix = u.pathname.replace(/\/+$/, '') || '';
        byKey.set(`__baseURL__${u.host}`, {
          key: '__baseURL__',
          host: u.host,
          prefix,
          url: m[1],
          depth: pathDepth(prefix || '/'),
        });
      } catch {
        /* ignore */
      }
    }
  }

  return [...byKey.values()];
}

function isGatewayOnlyPath(pathname, serviceBases) {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return true;
  if (pathDepth(p) <= 1) {
    // Exact match to a known service prefix
    return serviceBases.some((b) => b.prefix === p || `/${b.prefix}` === p);
  }
  return false;
}

function isStaticAsset(pathname) {
  return STATIC_EXT.test(pathname || '');
}

/**
 * Extract APIs from one file using createRequest + path literals.
 */
function extractCreateRequestApis(content, file, serviceBases) {
  const apis = [];
  const keyMap = new Map(serviceBases.map((b) => [b.key, b]));
  const varToKey = new Map();

  // const xxx = request.createRequest({ key: "CARS_TASK" ...})
  const createRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*[^\n]*createRequest\s*\(\s*\{([^}]*)\}\s*\)/g;
  let m;
  while ((m = createRe.exec(content))) {
    const varName = m[1];
    const body = m[2];
    const keyM = body.match(/key\s*:\s*['"`]([^'"`]+)['"`]/);
    const prefixM = body.match(/prefix\s*:\s*['"`]([^'"`]*)['"`]/);
    if (!keyM) continue;
    const base = keyMap.get(keyM[1]);
    if (!base) {
      varToKey.set(varName, {
        key: keyM[1],
        host: null,
        prefix: prefixM ? prefixM[1] : '',
      });
      continue;
    }
    const prefix =
      prefixM && prefixM[1] === ''
        ? ''
        : prefixM
          ? prefixM[1]
          : base.prefix;
    varToKey.set(varName, {
      key: base.key,
      host: base.host,
      prefix: prefix || '',
    });
  }

  // xxx("/external/...") or xxx({ uri: "...", type: "post" })
  for (const [varName, base] of varToKey) {
    const callStrRe = new RegExp(
      `\\b${varName}\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)`,
      'g',
    );
    while ((m = callStrRe.exec(content))) {
      const uri = m[1].split('?')[0];
      if (!uri.startsWith('/')) continue;
      const fullPath = joinPrefix(base.prefix, uri);
      if (isGatewayOnlyPath(fullPath, serviceBases) || isStaticAsset(fullPath)) {
        continue;
      }
      const line = content.slice(0, m.index).split(/\n/).length;
      apis.push({
        method: 'GET',
        host: base.host || '_default',
        path: fullPath,
        evidence: `${file}:${line}`,
        confidence: base.host ? 'high' : 'medium',
        exportHint: null,
        queryHints: [],
        bodyHints: [],
        responseHints: [],
        responseShape: null,
        serviceKey: base.key,
      });
    }

    const callObjRe = new RegExp(
      `\\b${varName}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
      'g',
    );
    while ((m = callObjRe.exec(content))) {
      const obj = m[1];
      const uriM = obj.match(/uri\s*:\s*['"`]([^'"`]+)['"`]/);
      if (!uriM) continue;
      const uri = uriM[1].split('?')[0];
      if (!uri.startsWith('/')) continue;
      const typeM = obj.match(/type\s*:\s*['"`]([^'"`]+)['"`]/);
      const method = (typeM ? typeM[1] : 'get').toUpperCase();
      const fullPath = joinPrefix(base.prefix, uri);
      if (isGatewayOnlyPath(fullPath, serviceBases) || isStaticAsset(fullPath)) {
        continue;
      }
      const line = content.slice(0, m.index).split(/\n/).length;
      apis.push({
        method: method === 'FORM' ? 'POST' : method,
        host: base.host || '_default',
        path: fullPath,
        evidence: `${file}:${line}`,
        confidence: base.host ? 'high' : 'medium',
        exportHint: null,
        queryHints: [],
        bodyHints: [],
        responseHints: [],
        responseShape: null,
        serviceKey: base.key,
      });
    }
  }

  // export const foo = varName("/path") — reliable export binding
  const exportStrRe =
    /export\s+const\s+(\w+)\s*=\s*(\w+)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = exportStrRe.exec(content))) {
    const exportName = m[1];
    const base = varToKey.get(m[2]);
    if (!base) continue;
    const uri = m[3].split('?')[0];
    const fullPath = joinPrefix(base.prefix, uri);
    const line = content.slice(0, m.index).split(/\n/).length;
    const hit = apis.find(
      (a) => a.path === fullPath && a.host === (base.host || '_default'),
    );
    if (hit) hit.exportHint = exportName;
    else if (!isGatewayOnlyPath(fullPath, serviceBases)) {
      apis.push({
        method: 'GET',
        host: base.host || '_default',
        path: fullPath,
        evidence: `${file}:${line}`,
        confidence: 'high',
        exportHint: exportName,
        queryHints: [],
        bodyHints: [],
        responseHints: [],
        responseShape: null,
        serviceKey: base.key,
      });
    }
  }

  const exportObjRe =
    /export\s+const\s+(\w+)\s*=\s*(\w+)\s*\(\s*\{[\s\S]*?uri\s*:\s*['"`]([^'"`]+)['"`][\s\S]*?type\s*:\s*['"`]([^'"`]+)['"`]/g;
  while ((m = exportObjRe.exec(content))) {
    const exportName = m[1];
    const base = varToKey.get(m[2]);
    if (!base) continue;
    const uri = m[3].split('?')[0];
    const method = (m[4] || 'get').toUpperCase();
    const fullPath = joinPrefix(base.prefix, uri);
    const hit = apis.find(
      (a) =>
        a.path === fullPath &&
        a.host === (base.host || '_default') &&
        a.method === method,
    );
    if (hit) hit.exportHint = exportName;
  }

  // Fallback: nearby line match for multiline export const x = req(\n  "/path"
  const exportRe = /export\s+const\s+(\w+)\s*=\s*(\w+)\s*\(/g;
  while ((m = exportRe.exec(content))) {
    const exportName = m[1];
    if (!varToKey.has(m[2])) continue;
    const exportLine = content.slice(0, m.index).split(/\n/).length;
    let best = null;
    let bestDist = 6;
    for (const api of apis) {
      if (api.exportHint) continue;
      const line = Number(String(api.evidence).split(':').pop());
      const dist = Math.abs(line - exportLine);
      if (dist < bestDist) {
        best = api;
        bestDist = dist;
      }
    }
    if (best) best.exportHint = exportName;
  }

  return apis;
}

function extractLegacyApis(content, file, serviceBases) {
  const apis = [];
  const push = (partial) => {
    if (!partial.path || isStaticAsset(partial.path)) return;
    if (isGatewayOnlyPath(partial.path, serviceBases)) return;
    // If path equals a service prefix only — skip
    if (
      serviceBases.some(
        (b) =>
          b.prefix &&
          (partial.path === b.prefix ||
            (partial.host === b.host && partial.path === b.prefix)),
      )
    ) {
      return;
    }
    apis.push({
      method: (partial.method || 'GET').toUpperCase(),
      host: partial.host || '_default',
      path: partial.path,
      evidence: `${file}:${partial.line || 0}`,
      confidence: partial.confidence || 'medium',
      exportHint: null,
      queryHints: partial.queryHints || [],
      bodyHints: partial.bodyHints || [],
      responseHints: partial.responseHints || [],
      responseShape: null,
    });
  };

  const lines = content.split(/\r?\n/);
  const absRe = /(['"`])https?:\/\/([^'"`/?#]+)(\/[^'"`]*)?\1/g;
  const axiosUrlRe =
    /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const fetchUrlRe = /\bfetch\s*\(\s*(['"`])([^'"`]+)\1/gi;
  // Generic: any quoted multi-segment path literal (e.g. '/v1/users', '/users/{id}').
  // Host is resolved from matching service-base prefix; no hardcoded gateway names.
  const pathLiteralRe =
    /['"`](\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._{}$\-]+(?:\?[^'"`]*)?)['"`]/g;

  const prefixByHost = new Map();
  for (const b of serviceBases) {
    if (!prefixByHost.has(b.host)) prefixByHost.set(b.host, []);
    prefixByHost.get(b.host).push(b);
  }

  function methodFromFetchLine(line, fromIndex) {
    const slice = line.slice(fromIndex);
    const m = /method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i.exec(slice);
    if (m) return m[1].toUpperCase();
    return 'GET';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    // Skip pure env assignment lines of gateway bases
    if (/^\s*[A-Z][A-Z0-9_]*\s*:\s*['"`]https?:\/\//.test(line)) {
      continue;
    }

    const hasFetch = /\bfetch\s*\(/.test(line);
    const hasAxios = /\baxios\./.test(line);

    absRe.lastIndex = 0;
    let m;
    while ((m = absRe.exec(line))) {
      // Dedicated fetch/axios extractors own method detection on these lines
      if (hasFetch || hasAxios) continue;
      const p = (m[3] || '/').split('?')[0];
      if (!p || p === '/') continue;
      if (isGatewayOnlyPath(p, serviceBases)) continue;
      push({
        host: m[2],
        path: p,
        method: /post/i.test(line) ? 'POST' : 'GET',
        line: lineNo,
        confidence: 'high',
      });
    }

    axiosUrlRe.lastIndex = 0;
    while ((m = axiosUrlRe.exec(line))) {
      const raw = m[2];
      if (raw.startsWith('http')) {
        try {
          const u = new URL(raw);
          if (isGatewayOnlyPath(u.pathname, serviceBases)) continue;
          push({
            method: m[1].toUpperCase(),
            host: u.host,
            path: u.pathname,
            line: lineNo,
            confidence: 'high',
          });
        } catch {
          /* ignore */
        }
      } else if (raw.startsWith('/')) {
        const full = raw.split('?')[0];
        if (isGatewayOnlyPath(full, serviceBases)) continue;
        push({
          method: m[1].toUpperCase(),
          host: '_default',
          path: full,
          line: lineNo,
          confidence: 'medium',
        });
      }
    }

    fetchUrlRe.lastIndex = 0;
    while ((m = fetchUrlRe.exec(line))) {
      const raw = m[2];
      const method = methodFromFetchLine(line, m.index);
      if (raw.startsWith('http')) {
        try {
          const u = new URL(raw.replace(/\$\{[^}]+\}/g, '1'));
          if (isGatewayOnlyPath(u.pathname, serviceBases)) continue;
          push({
            method,
            host: u.host,
            path: u.pathname,
            line: lineNo,
            confidence: 'high',
          });
        } catch {
          /* ignore */
        }
      } else if (raw.startsWith('/')) {
        const full = raw.split('?')[0];
        if (isGatewayOnlyPath(full, serviceBases)) continue;
        push({
          method,
          host: '_default',
          path: full,
          line: lineNo,
          confidence: 'medium',
        });
      }
    }
  }

  pathLiteralRe.lastIndex = 0;
  let pm;
  while ((pm = pathLiteralRe.exec(content))) {
    const p = pm[1].split('?')[0];
    if (isGatewayOnlyPath(p, serviceBases)) continue;
    // Resolve host from matching prefix
    let host = '_default';
    for (const b of serviceBases) {
      if (b.prefix && (p === b.prefix || p.startsWith(`${b.prefix}/`))) {
        host = b.host;
        break;
      }
    }
    const line = content.slice(0, pm.index).split(/\n/).length;
    if (!apis.some((a) => a.path === p && a.host === host)) {
      push({
        method: 'GET',
        host,
        path: p,
        line,
        confidence: host === '_default' ? 'low' : 'medium',
      });
    }
  }

  return apis;
}

function dedupe(apis) {
  const map = new Map();
  for (const a of apis) {
    const host = a.host || '_default';
    // Skip hash-router / UI paths
    if ((a.path || '').includes('#/')) continue;
    const key = `${a.method.toUpperCase()} ${host}${a.path}`;
    if (!map.has(key)) {
      map.set(key, {
        ...a,
        host,
        evidences: [a.evidence],
        exportHints: a.exportHint ? [a.exportHint] : [],
      });
    } else {
      const cur = map.get(key);
      cur.evidences.push(a.evidence);
      if (a.exportHint) cur.exportHints.push(a.exportHint);
      if (a.confidence === 'high') cur.confidence = 'high';
    }
  }
  let list = [...map.values()].map((a) => ({
    ...a,
    exportHint: a.exportHints?.[0] || null,
  }));

  // Drop _default/external/... when a fully-qualified host+prefix API exists for same suffix
  const fullSuffixes = new Set(
    list
      .filter((a) => a.host && a.host !== '_default')
      .map((a) => {
        const idx = a.path.indexOf('/external/');
        return idx >= 0 ? a.path.slice(idx) : a.path;
      }),
  );
  list = list.filter((a) => {
    if (a.host !== '_default') return true;
    if (a.path.startsWith('/external/')) {
      return !fullSuffixes.has(a.path);
    }
    return true;
  });
  return list;
}

function loadInferConfig() {
  try {
    const file = path.join(__dirname, '..', 'config', 'default.infer.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { denyHostSuffixes: [], denyHostKeywords: [] };
  }
}

function isDeniedHost(host, cfg) {
  if (!host || host === '_default') return false;
  const h = host.toLowerCase();
  const suffixes = cfg?.denyHostSuffixes || [];
  const keywords = cfg?.denyHostKeywords || [];
  if (suffixes.some((s) => h.endsWith(s.toLowerCase()))) return true;
  if (keywords.some((k) => h.includes(k.toLowerCase()))) return true;
  return false;
}

function loadAdapter(name) {
  if (!name) return null;
  const safe = String(name);
  if (!/^[a-zA-Z0-9_-]+$/.test(safe)) {
    throw new Error(`invalid adapter name: ${name}`);
  }
  const file = path.join(__dirname, '..', 'adapters', `${safe}.js`);
  if (!fs.existsSync(file)) {
    throw new Error(`adapter not found: ${name} (expected adapters/${safe}.js)`);
  }
  // Fresh require so tests can swap; adapters are small.
  delete require.cache[require.resolve(file)];
  return require(file);
}

function inferApiUsage(projectDir, opts = {}) {
  const serviceBases = discoverServiceBases(projectDir);
  const inferCfg = loadInferConfig();
  const adapter = opts.adapter ? loadAdapter(opts.adapter) : null;
  const files = walk(projectDir);
  const all = [];
  let gatewayFilteredCount = 0;

  // Count filtered gateway URLs for report
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.length > 1_500_000) continue;
    const rel = path.relative(projectDir, file);

    // Count abs URLs that are gateway-only
    const absRe = /(['"`])https?:\/\/([^'"`/?#]+)(\/[^'"`]*)?\1/g;
    let m;
    while ((m = absRe.exec(content))) {
      const p = (m[3] || '/').split('?')[0];
      if (p && isGatewayOnlyPath(p, serviceBases)) gatewayFilteredCount++;
    }

    all.push(...extractCreateRequestApis(content, rel, serviceBases));
    // Prefer services directory for createRequest; still run legacy for others
    if (!/src\/services\//.test(rel.replace(/\\/g, '/'))) {
      all.push(...extractLegacyApis(content, rel, serviceBases));
    } else {
      // Also catch literal /cars-task/external in services
      all.push(...extractLegacyApis(content, rel, serviceBases));
    }
    if (adapter && typeof adapter.extract === 'function') {
      const extra = adapter.extract({ content, rel, serviceBases }) || [];
      all.push(...extra);
    }
  }

  const deduped = dedupe(all);
  const filtered = deduped.filter((a) => !isDeniedHost(a.host, inferCfg));

  // Optionally enrich with ts-morph usage IO
  let enriched = filtered;
  if (opts.withUsageIo !== false) {
    try {
      const { enrichApisWithUsageIo } = require('./infer-usage-io');
      enriched = enrichApisWithUsageIo(projectDir, deduped);
    } catch (err) {
      console.warn(
        `[mock-skill] usage-io enrich skipped: ${err.message}`,
      );
      enriched = filtered;
    }
  }

  Object.defineProperty(enriched, 'meta', {
    value: {
      serviceBases,
      gatewayFilteredCount,
      adapter: adapter ? adapter.name || opts.adapter : null,
    },
    enumerable: false,
    writable: true,
  });
  return enriched;
}

module.exports = {
  inferApiUsage,
  discoverServiceBases,
  joinPrefix,
  isGatewayOnlyPath,
  pathDepth,
  extractCreateRequestApis,
  loadAdapter,
};

if (require.main === module) {
  const dir = process.argv[2] || process.cwd();
  const result = inferApiUsage(dir);
  console.log(JSON.stringify(result, null, 2));
}
