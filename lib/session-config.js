'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_SESSION,
  projectDataDir,
  ensureProjectDirs,
  chromeProfileDir,
  ROOT,
} = require('./paths');

function deepMerge(base, over) {
  if (!over) return { ...base };
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object'
    ) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadDefault() {
  return JSON.parse(fs.readFileSync(DEFAULT_SESSION, 'utf8'));
}

function loadSession(projectSlug) {
  ensureProjectDirs(projectSlug);
  const file = path.join(projectDataDir(projectSlug), 'session.json');
  const defaults = loadDefault();
  const localRoot = path.join(ROOT, 'session.local.json');
  let cfg = defaults;
  if (fs.existsSync(localRoot)) {
    cfg = deepMerge(cfg, JSON.parse(fs.readFileSync(localRoot, 'utf8')));
  }
  if (fs.existsSync(file)) {
    cfg = deepMerge(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  cfg.projectSlug = projectSlug;
  cfg.mock = cfg.mock || {};
  cfg.mock.mocksRoot =
    cfg.mock.mocksRoot || path.join(projectDataDir(projectSlug), 'mocks');
  cfg.browser = cfg.browser || {};
  cfg.browser.userDataDir =
    cfg.browser.userDataDir || chromeProfileDir(projectSlug);
  return cfg;
}

function saveSession(projectSlug, partial) {
  ensureProjectDirs(projectSlug);
  const file = path.join(projectDataDir(projectSlug), 'session.json');
  const current = loadSession(projectSlug);
  const next = deepMerge(current, partial);
  delete next.projectSlug;
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return loadSession(projectSlug);
}

function runtimeStatePath(projectSlug) {
  return path.join(projectDataDir(projectSlug), 'runtime.json');
}

function saveRuntimeState(projectSlug, state) {
  ensureProjectDirs(projectSlug);
  fs.writeFileSync(
    runtimeStatePath(projectSlug),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

function loadRuntimeState(projectSlug) {
  const file = runtimeStatePath(projectSlug);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  loadDefault,
  loadSession,
  saveSession,
  saveRuntimeState,
  loadRuntimeState,
  deepMerge,
};
