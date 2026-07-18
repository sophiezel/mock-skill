'use strict';

const fs = require('fs');
const path = require('path');
const {
  projectDataDir,
  serviceDataDir,
  listCatalogSlugs,
  listServiceIds,
  sanitizeSlug,
  sanitizeUpstreamId,
  parseStubId,
  ensureServiceDirs,
} = require('./paths');

/**
 * Parse --name values: string | string[] | "a,b".
 * @param {string|string[]|null|undefined} raw
 * @returns {string[]}
 */
function parseNameList(raw) {
  if (raw == null || raw === false || raw === true) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const p of parts) {
    for (const bit of String(p).split(',')) {
      const s = sanitizeSlug(bit.trim());
      if (s && s !== 'unnamed' && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

function projectIndexPath(projectSlug) {
  return path.join(projectDataDir(projectSlug), 'index.json');
}

/**
 * @param {string} projectSlug
 * @param {{ stubs?: string[], upstreams?: string[], source?: string }} data
 */
function writeProjectIndex(projectSlug, data = {}) {
  const dir = projectDataDir(projectSlug);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    projectSlug,
    stubs: [...new Set(data.stubs || [])].sort(),
    upstreams: [...new Set((data.upstreams || []).map(sanitizeUpstreamId))].sort(),
    source: data.source || null,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(projectIndexPath(projectSlug), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * @param {string} projectSlug
 * @returns {{ version: number, stubs: string[], upstreams: string[] }|null}
 */
function readProjectIndex(projectSlug) {
  const p = projectIndexPath(projectSlug);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Upsert rules into a service's proxy-rules.json (by stubId).
 * @param {string} upstreamId
 * @param {object[]} rules
 * @returns {object[]}
 */
function upsertServiceRules(upstreamId, rules) {
  ensureServiceDirs(upstreamId);
  const rulesPath = path.join(serviceDataDir(upstreamId), 'proxy-rules.json');
  /** @type {Map<string, object>} */
  const byId = new Map();
  if (fs.existsSync(rulesPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      if (Array.isArray(prev)) {
        for (const r of prev) {
          const id = r.stubId || r.id;
          if (id) byId.set(id, r);
        }
      }
    } catch {
      /* ignore */
    }
  }
  for (const r of rules || []) {
    const id = r.stubId || r.id;
    if (!id) continue;
    byId.set(id, {
      ...r,
      stubId: id,
      upstreamId: sanitizeUpstreamId(r.upstreamId || upstreamId),
    });
  }
  const list = [...byId.values()];
  fs.writeFileSync(rulesPath, `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

/**
 * Load proxy-rules for one service.
 * @param {string} upstreamId
 * @returns {object[]}
 */
function loadServiceRules(upstreamId) {
  const rulesPath = path.join(serviceDataDir(upstreamId), 'proxy-rules.json');
  if (!fs.existsSync(rulesPath)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Resolve which mount keys to use (project slugs and/or service ids).
 * Empty → all services (fallback: all legacy project catalogs).
 * @param {{ names?: string|string[], allIfEmpty?: boolean }} opts
 * @returns {string[]}
 */
function resolveActiveCatalogs(opts = {}) {
  const named = parseNameList(opts.names);
  if (named.length) {
    for (const key of named) {
      const hasProject =
        fs.existsSync(projectIndexPath(key)) ||
        fs.existsSync(path.join(projectDataDir(key), 'proxy-rules.json'));
      const hasService = fs.existsSync(
        path.join(serviceDataDir(key), 'proxy-rules.json'),
      );
      if (!hasProject && !hasService) {
        throw new Error(
          `catalog not found for --name=${key} (no project index/proxy-rules or service)`,
        );
      }
    }
    return named;
  }
  if (opts.allIfEmpty === false) return [];
  const services = listServiceIds();
  if (services.length) return services;
  const all = listCatalogSlugs();
  if (!all.length) {
    throw new Error(
      'no catalogs to mount: run init --name=<slug> or pass --name=',
    );
  }
  return all;
}

/**
 * Expand a mount key into service upstreamIds + optional legacy project rules.
 * @param {string} key
 * @returns {{ services: string[], legacyProject: string|null }}
 */
function expandMountKey(key) {
  const idx = readProjectIndex(key);
  if (idx && idx.upstreams && idx.upstreams.length) {
    return { services: idx.upstreams.map(sanitizeUpstreamId), legacyProject: null };
  }
  const svcRules = path.join(serviceDataDir(key), 'proxy-rules.json');
  if (fs.existsSync(svcRules)) {
    return { services: [sanitizeUpstreamId(key)], legacyProject: null };
  }
  const projRules = path.join(projectDataDir(key), 'proxy-rules.json');
  if (fs.existsSync(projRules)) {
    return { services: [], legacyProject: key };
  }
  return { services: [], legacyProject: null };
}

/**
 * Merge proxy-rules from projects (via index→services) and/or services.
 * @param {string[]} keys
 * @returns {{
 *   rules: object[],
 *   stubToCatalog: Record<string, string>,
 *   catalogs: string[],
 * }}
 */
function mergeCatalogs(keys) {
  if (!Array.isArray(keys) || !keys.length) {
    throw new Error('mergeCatalogs: need at least one catalog slug');
  }

  /** @type {Set<string>} */
  const serviceSet = new Set();
  /** @type {string[]} */
  const legacyProjects = [];

  for (const key of keys) {
    const { services, legacyProject } = expandMountKey(key);
    for (const s of services) serviceSet.add(s);
    if (legacyProject) legacyProjects.push(legacyProject);
  }

  /** @type {Record<string, string>} */
  const stubToCatalog = {};
  /** @type {object[]} */
  const rules = [];
  /** @type {Record<string, string[]>} */
  const conflicts = {};

  function addRule(rule, catalogKey) {
    const stubId = rule.stubId || rule.id;
    if (!stubId) return;
    if (stubToCatalog[stubId] && stubToCatalog[stubId] !== catalogKey) {
      if (!conflicts[stubId]) conflicts[stubId] = [stubToCatalog[stubId]];
      if (!conflicts[stubId].includes(catalogKey)) {
        conflicts[stubId].push(catalogKey);
      }
      return;
    }
    stubToCatalog[stubId] = catalogKey;
    rules.push({
      ...rule,
      stubId,
      catalog: catalogKey,
      projectSlug: catalogKey,
      upstreamId: rule.upstreamId || catalogKey,
    });
  }

  for (const up of [...serviceSet].sort()) {
    for (const rule of loadServiceRules(up)) {
      addRule(rule, up);
    }
  }

  for (const slug of legacyProjects) {
    const rulesPath = path.join(projectDataDir(slug), 'proxy-rules.json');
    let list;
    try {
      list = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    } catch (e) {
      throw new Error(`invalid proxy-rules.json for ${slug}: ${e.message}`);
    }
    if (!Array.isArray(list)) {
      throw new Error(`proxy-rules.json for ${slug} must be an array`);
    }
    for (const rule of list) {
      addRule(rule, slug);
    }
  }

  const conflictIds = Object.keys(conflicts);
  if (conflictIds.length) {
    const lines = conflictIds
      .slice(0, 20)
      .map((id) => `  ${id} ← ${conflicts[id].join(', ')}`)
      .join('\n');
    throw new Error(
      `stubId conflict across catalogs (${conflictIds.length}):\n${lines}${
        conflictIds.length > 20 ? '\n  …' : ''
      }`,
    );
  }

  return {
    rules,
    stubToCatalog,
    catalogs: [...serviceSet, ...legacyProjects],
  };
}

/**
 * Mocks root for a catalog key (service or legacy project).
 * @param {string} catalogSlug
 * @returns {string}
 */
function mocksRootFor(catalogSlug) {
  const svc = serviceDataDir(catalogSlug);
  if (fs.existsSync(path.join(svc, 'mocks'))) {
    return path.join(svc, 'mocks');
  }
  return path.join(projectDataDir(catalogSlug), 'mocks');
}

/**
 * Mocks root for a stubId (service layout).
 * @param {string} stubId
 * @returns {string|null}
 */
function mocksRootForStub(stubId) {
  try {
    const { upstreamId } = parseStubId(stubId);
    return path.join(serviceDataDir(upstreamId), 'mocks');
  } catch {
    return null;
  }
}

/**
 * Captures dir: prefer service, else project.
 * @param {string} catalogSlug
 * @returns {string}
 */
function capturesDirFor(catalogSlug) {
  const base = serviceDataDir(catalogSlug);
  if (fs.existsSync(base) || listServiceIds().includes(catalogSlug)) {
    const svc = path.join(base, 'captures');
    fs.mkdirSync(svc, { recursive: true });
    return svc;
  }
  return path.join(projectDataDir(catalogSlug), 'captures');
}

module.exports = {
  parseNameList,
  resolveActiveCatalogs,
  mergeCatalogs,
  mocksRootFor,
  mocksRootForStub,
  capturesDirFor,
  writeProjectIndex,
  readProjectIndex,
  upsertServiceRules,
  loadServiceRules,
  expandMountKey,
};
