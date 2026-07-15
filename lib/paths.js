'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(ROOT, '.data');
const DEFAULT_SESSION = path.join(ROOT, 'config', 'default.session.json');

function sanitizeSlug(raw) {
  if (!raw || typeof raw !== 'string') return 'unnamed';
  let s = raw.trim();
  if (s.startsWith('@')) {
    const slash = s.indexOf('/');
    if (slash !== -1) s = s.slice(slash + 1);
  }
  s = s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'unnamed';
}

function resolveProjectSlug(projectDir, nameOverride) {
  if (nameOverride) return sanitizeSlug(nameOverride);
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return sanitizeSlug(pkg.name);
    } catch (_) {
      /* ignore */
    }
  }
  return sanitizeSlug(path.basename(projectDir));
}

function projectDataDir(projectSlug) {
  return path.join(DATA_ROOT, 'projects', projectSlug);
}

function chromeProfileDir(projectSlug) {
  return path.join(DATA_ROOT, 'chrome-profiles', projectSlug);
}

function ensureProjectDirs(projectSlug) {
  const base = projectDataDir(projectSlug);
  for (const sub of [
    'contracts',
    'mocks',
    'classify',
    'captures',
    'reports',
    'audit',
  ]) {
    fs.mkdirSync(path.join(base, sub), { recursive: true });
  }
  fs.mkdirSync(chromeProfileDir(projectSlug), { recursive: true });
  return base;
}

function contractPath(projectSlug, apiKey) {
  const safe = apiKey.replace(/[^a-zA-Z0-9._-]+/g, '__');
  return path.join(projectDataDir(projectSlug), 'contracts', `${safe}.json`);
}

function mockHandlerPath(projectSlug, host, urlPath) {
  const cleanHost = (host || '_default').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const cleanPath = urlPath.replace(/^\//, '').replace(/\.\./g, '');
  return path.join(projectDataDir(projectSlug), 'mocks', cleanHost, cleanPath, 'index.js');
}

function apiKey({ host, method, path: p }) {
  const m = (method || 'GET').toUpperCase();
  const h = host || '_default';
  const pathname = p.startsWith('/') ? p : `/${p}`;
  return `${m} ${h}${pathname}`;
}

function pathDepth(pathname) {
  return String(pathname || '')
    .split('/')
    .filter(Boolean).length;
}

module.exports = {
  ROOT,
  DATA_ROOT,
  DEFAULT_SESSION,
  sanitizeSlug,
  resolveProjectSlug,
  projectDataDir,
  chromeProfileDir,
  ensureProjectDirs,
  contractPath,
  mockHandlerPath,
  apiKey,
  pathDepth,
};
