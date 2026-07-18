'use strict';

const fs = require('fs');
const path = require('path');
const { rulesDir } = require('./paths');
const { loadSession, saveSession } = require('./session-config');

/**
 * @param {string} [dirOverride]
 * @returns {string}
 */
function ensureRulesDir(dirOverride) {
  const dir = rulesDir(dirOverride);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} [dirOverride]
 * @returns {string[]}
 */
function listRuleNames(dirOverride) {
  const dir = ensureRulesDir(dirOverride);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * @param {unknown} raw
 * @param {string} name
 */
function assertRuleShape(raw, name) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`invalid rule ${name}: expected object`);
  }
  if (!Array.isArray(raw.stubs)) {
    throw new Error(`invalid rule ${name}: stubs must be an array`);
  }
  for (let i = 0; i < raw.stubs.length; i++) {
    if (typeof raw.stubs[i] !== 'string' || !raw.stubs[i].trim()) {
      throw new Error(`invalid rule ${name}: stubs[${i}] must be non-empty string`);
    }
  }
  if (raw.cases != null) {
    if (typeof raw.cases !== 'object' || Array.isArray(raw.cases)) {
      throw new Error(`invalid rule ${name}: cases must be object`);
    }
    if (raw.cases.default != null && typeof raw.cases.default !== 'string') {
      throw new Error(`invalid rule ${name}: cases.default must be string`);
    }
    if (raw.cases.active != null) {
      if (
        typeof raw.cases.active !== 'object' ||
        Array.isArray(raw.cases.active)
      ) {
        throw new Error(`invalid rule ${name}: cases.active must be object`);
      }
      for (const [k, v] of Object.entries(raw.cases.active)) {
        if (typeof v !== 'string') {
          throw new Error(
            `invalid rule ${name}: cases.active["${k}"] must be string`,
          );
        }
      }
    }
  }
}

/**
 * Resolve one keyword to a rule file basename (without .json).
 * Exact match first; else unique substring/prefix match.
 * @param {string} keyword
 * @param {string} [dirOverride]
 * @returns {string}
 */
function resolveRuleKeyword(keyword, dirOverride) {
  const kw = String(keyword || '').trim();
  if (!kw) throw new Error('empty rules keyword');
  const names = listRuleNames(dirOverride);
  if (names.includes(kw)) return kw;

  const hits = names.filter(
    (n) => n.includes(kw) || n.startsWith(kw) || kw.startsWith(n),
  );
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    throw new Error(
      `no rule matching "${kw}" in ${rulesDir(dirOverride)} (have: ${
        names.join(', ') || 'none'
      })`,
    );
  }
  throw new Error(
    `ambiguous rule keyword "${kw}" matches: ${hits.join(', ')}`,
  );
}

/**
 * @param {string} name
 * @param {string} [dirOverride]
 */
function loadRuleFile(name, dirOverride) {
  const dir = ensureRulesDir(dirOverride);
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`rule file not found: ${file}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assertRuleShape(raw, name);
  return { name, file, stubs: [...raw.stubs], cases: raw.cases || null };
}

/**
 * @param {string[]} keywords
 * @param {string} [dirOverride]
 */
function loadAndMergeRules(keywords, dirOverride) {
  const keys = (keywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (!keys.length) {
    throw new Error('need at least one rules keyword');
  }
  /** @type {string[]} */
  const stubs = [];
  const seen = new Set();
  /** @type {{ default?: string, active: Record<string, string> }} */
  const cases = { active: {} };
  let hasCases = false;
  const resolved = [];

  for (const kw of keys) {
    const name = resolveRuleKeyword(kw, dirOverride);
    resolved.push(name);
    const rule = loadRuleFile(name, dirOverride);
    for (const s of rule.stubs) {
      if (!seen.has(s)) {
        seen.add(s);
        stubs.push(s);
      }
    }
    if (rule.cases) {
      hasCases = true;
      if (rule.cases.default) cases.default = rule.cases.default;
      if (rule.cases.active) {
        Object.assign(cases.active, rule.cases.active);
      }
    }
  }

  return {
    resolved,
    stubs,
    cases: hasCases
      ? {
          default: cases.default || 'success',
          active: cases.active,
        }
      : null,
  };
}

/**
 * Apply merged rules into global session (selective + allowlist).
 * @param {string[]} keywords
 * @param {{ rulesDir?: string }} [opts]
 */
function applyRulesToSession(keywords, opts = {}) {
  const merged = loadAndMergeRules(keywords, opts.rulesDir);
  const patch = {
    proxy: {
      trafficMode: 'selective',
      mockAllowlist: merged.stubs,
    },
    activeRules: merged.resolved,
  };
  if (merged.cases) {
    patch.cases = merged.cases;
  }
  const cfg = saveSession(patch);
  return { merged, session: cfg };
}

/**
 * Save current session allowlist/cases as a named rule file.
 * @param {string} name
 * @param {{ rulesDir?: string }} [opts]
 */
function saveRulesFromSession(name, opts = {}) {
  const safe = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (!safe) throw new Error('rules save: need a name');
  const cfg = loadSession();
  const stubs = Array.isArray(cfg.proxy?.mockAllowlist)
    ? [...cfg.proxy.mockAllowlist]
    : [];
  const body = {
    stubs,
    cases: {
      default: cfg.cases?.default || 'success',
      active: { ...(cfg.cases?.active || {}) },
    },
  };
  assertRuleShape(body, safe);
  const dir = ensureRulesDir(opts.rulesDir);
  const file = path.join(dir, `${safe}.json`);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return { name: safe, file, stubs: stubs.length };
}

/**
 * Parse CLI --rules values into keyword list.
 * @param {string|string[]|boolean|undefined} raw
 * @returns {string[]}
 */
function parseRulesKeywords(raw) {
  if (raw == null || raw === false || raw === true) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const p of parts) {
    for (const bit of String(p).split(/[,\s]+/)) {
      const s = bit.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

module.exports = {
  ensureRulesDir,
  listRuleNames,
  assertRuleShape,
  resolveRuleKeyword,
  loadRuleFile,
  loadAndMergeRules,
  applyRulesToSession,
  saveRulesFromSession,
  parseRulesKeywords,
  rulesDir,
};
