'use strict';

/**
 * File mtime cache for infer scans.
 * Keyed by projectDir + adapter; invalidated when any scanned file mtime changes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = new Map(); // cacheKey -> { fingerprint, result }

function fileFingerprint(files) {
  const parts = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      parts.push(`${f}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${f}:missing`);
    }
  }
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function cacheKey(projectDir, opts = {}) {
  const usageIo = opts.withUsageIo === false ? '0' : '1';
  return `${path.resolve(projectDir)}::${opts.adapter || ''}::io=${usageIo}`;
}

function getCached(projectDir, files, opts = {}) {
  const key = cacheKey(projectDir, opts);
  const fp = fileFingerprint(files);
  const hit = store.get(key);
  if (hit && hit.fingerprint === fp) {
    return { hit: true, value: hit.result, fingerprint: fp };
  }
  return { hit: false, fingerprint: fp, key };
}

function setCached(key, fingerprint, result) {
  // Store a shallow copy of the array (meta is non-enumerable — reattach after)
  store.set(key, { fingerprint, result });
}

function clearInferCache() {
  store.clear();
}

module.exports = {
  getCached,
  setCached,
  clearInferCache,
  fileFingerprint,
  cacheKey,
};
