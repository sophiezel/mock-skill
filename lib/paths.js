'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SESSION = path.join(ROOT, 'config', 'default.session.json');
const DEFAULT_RULES_DIR = path.join(ROOT, 'rules');

function getDataRoot() {
  return process.env.MOCK_SKILL_DATA_ROOT
    ? path.resolve(process.env.MOCK_SKILL_DATA_ROOT)
    : path.join(ROOT, '.data');
}

function getGlobalSessionPath() {
  return process.env.MOCK_SKILL_SESSION_FILE
    ? path.resolve(process.env.MOCK_SKILL_SESSION_FILE)
    : path.join(getDataRoot(), 'session.json');
}

function getGlobalRuntimePath() {
  return process.env.MOCK_SKILL_RUNTIME_FILE
    ? path.resolve(process.env.MOCK_SKILL_RUNTIME_FILE)
    : path.join(getDataRoot(), 'runtime.json');
}

/**
 * Resolve shared rules directory (not under projects/).
 * @param {string} [override]
 * @returns {string}
 */
function rulesDir(override) {
  if (override) return path.resolve(override);
  if (process.env.MOCK_SKILL_RULES_DIR) {
    return path.resolve(process.env.MOCK_SKILL_RULES_DIR);
  }
  return DEFAULT_RULES_DIR;
}

/**
 * List project slugs that have a proxy-rules.json catalog.
 * @returns {string[]}
 */
function listCatalogSlugs() {
  const root = path.join(getDataRoot(), 'projects');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => {
      const rules = path.join(root, name, 'proxy-rules.json');
      return fs.existsSync(rules);
    })
    .sort();
}

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
  return path.join(getDataRoot(), 'projects', projectSlug);
}

function chromeProfileDir(projectSlug) {
  return path.join(getDataRoot(), 'chrome-profiles', projectSlug);
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
    'scenarios',
    'exports',
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

/**
 * Build a stubId from upstream identity (NOT a FQDN host).
 * @param {{ upstreamId: string, method: string, path: string }} parts
 * @returns {string}
 */
function stubId({ upstreamId, method, path: p }) {
  const m = (method || 'GET').toUpperCase();
  const up = upstreamId || '_default';
  const pathname = p.startsWith('/') ? p : `/${p}`;
  return `${m} ${up}${pathname}`;
}

/**
 * Reject path segments that enable traversal or absolute escapes.
 * @param {string} relative
 */
function isUnsafeRelativePath(relative) {
  if (!relative) return false;
  if (path.isAbsolute(relative)) return true;
  const parts = relative.split(/[/\\]/);
  return parts.some((p) => p === '..' || p === '');
}

/**
 * Filesystem path for a stub handler under the new upstream catalog layout:
 *   mocks/<upstreamId>/<METHOD>/<cleanPath>/index.js
 * @param {string} projectSlug
 * @param {string} upstreamId
 * @param {string} method
 * @param {string} urlPath
 * @returns {string}
 */
function stubHandlerPath(projectSlug, upstreamId, method, urlPath) {
  const up = (upstreamId || '_default').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const m = (method || 'GET').toUpperCase();
  const relative = String(urlPath || '').replace(/^\//, '');
  if (isUnsafeRelativePath(relative)) {
    throw new Error(`unsafe path segments in stubHandlerPath: ${urlPath}`);
  }
  return path.join(
    projectDataDir(projectSlug),
    'mocks',
    up,
    m,
    relative,
    'index.js',
  );
}

/**
 * Parse a stubId back into { method, upstreamId, path }.
 * Format: `METHOD upstreamId/path`
 * @param {string} id
 * @returns {{ method: string, upstreamId: string, path: string }}
 */
function parseStubId(id) {
  const spaceIdx = String(id).indexOf(' ');
  if (spaceIdx === -1) {
    throw new Error(`invalid stubId: ${id}`);
  }
  const method = id.slice(0, spaceIdx).toUpperCase();
  const rest = id.slice(spaceIdx + 1);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`invalid stubId (no path): ${id}`);
  }
  const upstreamId = rest.slice(0, slashIdx);
  const pathname = rest.slice(slashIdx);
  return { method, upstreamId, path: pathname };
}

function pathDepth(pathname) {
  return String(pathname || '')
    .split('/')
    .filter(Boolean).length;
}

module.exports = {
  ROOT,
  getDataRoot,
  getGlobalSessionPath,
  getGlobalRuntimePath,
  DEFAULT_SESSION,
  DEFAULT_RULES_DIR,
  rulesDir,
  listCatalogSlugs,
  sanitizeSlug,
  resolveProjectSlug,
  projectDataDir,
  chromeProfileDir,
  ensureProjectDirs,
  contractPath,
  mockHandlerPath,
  apiKey,
  stubId,
  stubHandlerPath,
  parseStubId,
  pathDepth,
};

Object.defineProperty(module.exports, 'DATA_ROOT', {
  enumerable: true,
  get: getDataRoot,
});
Object.defineProperty(module.exports, 'GLOBAL_SESSION', {
  enumerable: true,
  get: getGlobalSessionPath,
});
Object.defineProperty(module.exports, 'GLOBAL_RUNTIME', {
  enumerable: true,
  get: getGlobalRuntimePath,
});
