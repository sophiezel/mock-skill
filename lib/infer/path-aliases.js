'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read compilerOptions.paths (+ baseUrl) from tsconfig/jsconfig JSON (strip comments lightly).
 * @param {string} filePath
 * @returns {{ baseUrl?: string, paths?: Record<string, string[]> }|null}
 */
function readTsPathsFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  // Strip // and /* */ comments enough for typical jsconfig
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  try {
    const json = JSON.parse(stripped);
    const co = json.compilerOptions || {};
    if (!co.paths && !co.baseUrl) return null;
    return {
      baseUrl: co.baseUrl || '.',
      paths: co.paths || {},
    };
  } catch {
    return null;
  }
}

/**
 * Resolve effective baseUrl + paths for ts-morph / TypeScript.
 * Priority: profile.pathAliases overlay → tsconfig/jsconfig → convention @/~ → src/*
 * @param {string} projectDir
 * @param {object} [inferCfg]
 * @returns {{ baseUrl: string, paths: Record<string, string[]> }}
 */
function resolveCompilerPathOptions(projectDir, inferCfg = {}) {
  const abs = path.resolve(projectDir);
  let baseUrl = abs;
  /** @type {Record<string, string[]>} */
  let paths = {};

  const tsconfig = path.join(abs, 'tsconfig.json');
  const jsconfig = path.join(abs, 'jsconfig.json');
  const fromFile =
    (fs.existsSync(tsconfig) && readTsPathsFile(tsconfig)) ||
    (fs.existsSync(jsconfig) && readTsPathsFile(jsconfig)) ||
    null;

  if (fromFile) {
    baseUrl = path.resolve(abs, fromFile.baseUrl || '.');
    paths = { ...(fromFile.paths || {}) };
  } else if (fs.existsSync(path.join(abs, 'src'))) {
    // Vue CLI / Webpack / Vite common conventions when no jsconfig
    paths = {
      '@/*': ['src/*'],
      '~/*': ['src/*'],
    };
    baseUrl = abs;
  }

  const overlay = inferCfg.pathAliases || {};
  for (const [k, v] of Object.entries(overlay)) {
    if (Array.isArray(v)) paths[k] = v;
    else if (typeof v === 'string') paths[k] = [v];
  }

  return { baseUrl, paths };
}

module.exports = {
  readTsPathsFile,
  resolveCompilerPathOptions,
};
