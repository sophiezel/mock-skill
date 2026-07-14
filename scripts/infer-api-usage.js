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
]);

const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs']);

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

function extractFromContent(content, file) {
  const apis = [];
  const push = (partial) => {
    apis.push({
      method: (partial.method || 'GET').toUpperCase(),
      host: partial.host || null,
      path: partial.path,
      evidence: `${file}:${partial.line || 0}`,
      confidence: partial.confidence || 'medium',
      queryHints: partial.queryHints || [],
      bodyHints: partial.bodyHints || [],
      responseHints: partial.responseHints || [],
    });
  };

  const lines = content.split(/\r?\n/);
  const absRe = /(['"`])https?:\/\/([^'"`/?#]+)(\/[^'"`]*)?\1/g;
  const baseUrlRe = /baseURL\s*[:=]\s*['"`](https?:\/\/[^'"`]+)['"`]/g;
  const reqRe = /\b(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const fetchRe = /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const axiosUrlRe =
    /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const pathOnlyRe = /['"`](\/(?:api|external|v\d+)[^'"`]*)['"`]/g;

  const baseHosts = [];
  let m;
  while ((m = baseUrlRe.exec(content))) {
    try {
      baseHosts.push(new URL(m[1]).host);
    } catch {
      /* ignore */
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    absRe.lastIndex = 0;
    while ((m = absRe.exec(line))) {
      const p = (m[3] || '/').split('?')[0];
      // Ignore bare origin (baseURL) without API path
      if (!p || p === '/') continue;
      push({
        host: m[2],
        path: p,
        method: /post/i.test(line) ? 'POST' : /put/i.test(line) ? 'PUT' : 'GET',
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
        push({
          method: m[1].toUpperCase(),
          host: baseHosts[0] || null,
          path: raw.split('?')[0],
          line: lineNo,
          confidence: baseHosts[0] ? 'high' : 'medium',
        });
      }
    }

    reqRe.lastIndex = 0;
    while ((m = reqRe.exec(line))) {
      const raw = m[2];
      if (!raw.startsWith('/') && !raw.startsWith('http')) continue;
      if (raw.startsWith('http')) {
        try {
          const u = new URL(raw);
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
      } else {
        push({
          method: m[1].toUpperCase(),
          host: baseHosts[0] || null,
          path: raw.split('?')[0],
          line: lineNo,
          confidence: 'medium',
        });
      }
    }

    fetchRe.lastIndex = 0;
    while ((m = fetchRe.exec(line))) {
      const raw = m[1];
      if (raw.startsWith('http')) {
        try {
          const u = new URL(raw);
          push({
            method: /method:\s*['"`]POST/i.test(line) ? 'POST' : 'GET',
            host: u.host,
            path: u.pathname,
            line: lineNo,
            confidence: 'high',
          });
        } catch {
          /* ignore */
        }
      } else if (raw.startsWith('/')) {
        push({
          method: 'GET',
          host: baseHosts[0] || null,
          path: raw.split('?')[0],
          line: lineNo,
          confidence: 'medium',
        });
      }
    }

    const destr = line.match(
      /\{\s*([^}]+)\s*\}\s*=\s*(?:res(?:ponse)?|data|result)/i,
    );
    if (destr && apis.length) {
      const fields = destr[1]
        .split(',')
        .map((s) => s.trim().split(':')[0].trim())
        .filter(Boolean);
      apis[apis.length - 1].responseHints = fields;
    }
  }

  pathOnlyRe.lastIndex = 0;
  while ((m = pathOnlyRe.exec(content))) {
    const p = m[1].split('?')[0];
    if (p.length < 4) continue;
    if (!apis.some((a) => a.path === p)) {
      const idx = content.slice(0, m.index).split(/\n/).length;
      push({
        method: 'GET',
        host: baseHosts[0] || null,
        path: p,
        line: idx,
        confidence: 'low',
      });
    }
  }

  return apis;
}

function dedupe(apis) {
  const map = new Map();
  for (const a of apis) {
    const host = a.host || '_default';
    const key = `${a.method.toUpperCase()} ${host}${a.path}`;
    if (!map.has(key)) {
      map.set(key, { ...a, host, evidences: [a.evidence] });
    } else {
      const cur = map.get(key);
      cur.evidences.push(a.evidence);
      if (a.confidence === 'high') cur.confidence = 'high';
      cur.responseHints = [
        ...new Set([...(cur.responseHints || []), ...(a.responseHints || [])]),
      ];
    }
  }
  return [...map.values()];
}

function inferApiUsage(projectDir) {
  const files = walk(projectDir);
  const all = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.length > 1_500_000) continue;
    all.push(...extractFromContent(content, path.relative(projectDir, file)));
  }
  return dedupe(all);
}

module.exports = { inferApiUsage };

if (require.main === module) {
  const dir = process.argv[2] || process.cwd();
  console.log(JSON.stringify(inferApiUsage(dir), null, 2));
}
