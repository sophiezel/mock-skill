'use strict';

const fs = require('fs');
const path = require('path');
const {
  projectDataDir,
  listCatalogSlugs,
  sanitizeSlug,
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

/**
 * Resolve which catalogs to mount.
 * @param {{ names?: string|string[], allIfEmpty?: boolean }} opts
 * @returns {string[]}
 */
function resolveActiveCatalogs(opts = {}) {
  const named = parseNameList(opts.names);
  if (named.length) {
    for (const slug of named) {
      const rulesPath = path.join(projectDataDir(slug), 'proxy-rules.json');
      if (!fs.existsSync(rulesPath)) {
        throw new Error(
          `catalog not found for --name=${slug} (missing ${rulesPath})`,
        );
      }
    }
    return named;
  }
  if (opts.allIfEmpty === false) return [];
  const all = listCatalogSlugs();
  if (!all.length) {
    throw new Error(
      'no catalogs to mount: run init --name=<slug> or pass --name=',
    );
  }
  return all;
}

/**
 * Merge proxy-rules from multiple catalogs. Fail on stubId conflict.
 * @param {string[]} slugs
 * @returns {{
 *   rules: object[],
 *   stubToCatalog: Record<string, string>,
 *   catalogs: string[],
 * }}
 */
function mergeCatalogs(slugs) {
  if (!Array.isArray(slugs) || !slugs.length) {
    throw new Error('mergeCatalogs: need at least one catalog slug');
  }
  /** @type {Record<string, string>} */
  const stubToCatalog = {};
  /** @type {object[]} */
  const rules = [];
  /** @type {Record<string, string[]>} */
  const conflicts = {};

  for (const slug of slugs) {
    const rulesPath = path.join(projectDataDir(slug), 'proxy-rules.json');
    if (!fs.existsSync(rulesPath)) {
      throw new Error(`missing proxy-rules.json for catalog ${slug}`);
    }
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
      const stubId = rule.stubId || rule.id;
      if (!stubId) continue;
      if (stubToCatalog[stubId] && stubToCatalog[stubId] !== slug) {
        if (!conflicts[stubId]) {
          conflicts[stubId] = [stubToCatalog[stubId]];
        }
        if (!conflicts[stubId].includes(slug)) {
          conflicts[stubId].push(slug);
        }
        continue;
      }
      stubToCatalog[stubId] = slug;
      rules.push({
        ...rule,
        stubId,
        catalog: slug,
        projectSlug: slug,
      });
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

  return { rules, stubToCatalog, catalogs: [...slugs] };
}

/**
 * @param {string} catalogSlug
 * @returns {string}
 */
function mocksRootFor(catalogSlug) {
  return path.join(projectDataDir(catalogSlug), 'mocks');
}

/**
 * @param {string} catalogSlug
 * @returns {string}
 */
function capturesDirFor(catalogSlug) {
  return path.join(projectDataDir(catalogSlug), 'captures');
}

module.exports = {
  parseNameList,
  resolveActiveCatalogs,
  mergeCatalogs,
  mocksRootFor,
  capturesDirFor,
};
