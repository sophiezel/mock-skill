'use strict';

/**
 * Per-upstreamId in-memory store (Microcks-style scope).
 * Supports KV + named collections for CRUD-ish flows.
 */

/** @type {Map<string, ServiceStore>} */
const stores = new Map();

/** @type {{ at: string, stubId?: string, method?: string, path?: string, upstreamId?: string }[]} */
const journal = [];
const JOURNAL_MAX = 200;

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

class ServiceStore {
  /**
   * @param {string} upstreamId
   */
  constructor(upstreamId) {
    this.upstreamId = upstreamId;
    /** @type {Map<string, { value: any, expiresAt: number|null }>} */
    this.kv = new Map();
    /** @type {Map<string, Map<string, any>>} */
    this.collections = new Map();
  }

  /**
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlSec] TTL seconds; omit = no expiry
   */
  put(key, value, ttlSec) {
    const expiresAt =
      ttlSec != null && Number(ttlSec) > 0
        ? Date.now() + Number(ttlSec) * 1000
        : null;
    this.kv.set(String(key), { value: clone(value), expiresAt });
    return value;
  }

  /**
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const entry = this.kv.get(String(key));
    if (!entry) return null;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.kv.delete(String(key));
      return null;
    }
    return clone(entry.value);
  }

  /**
   * @param {string} key
   */
  delete(key) {
    return this.kv.delete(String(key));
  }

  /**
   * @param {string} name
   * @returns {Map<string, any>}
   */
  collection(name) {
    const n = String(name || 'default');
    if (!this.collections.has(n)) this.collections.set(n, new Map());
    return this.collections.get(n);
  }

  /**
   * @param {string} name
   * @param {string} id
   * @param {any} record
   */
  collectionPut(name, id, record) {
    const col = this.collection(name);
    const row = { ...(clone(record) || {}), id: String(id) };
    col.set(String(id), row);
    return clone(row);
  }

  /**
   * @param {string} name
   * @param {string} id
   */
  collectionGet(name, id) {
    const col = this.collection(name);
    const row = col.get(String(id));
    return row == null ? null : clone(row);
  }

  /**
   * @param {string} name
   * @returns {any[]}
   */
  collectionList(name) {
    return [...this.collection(name).values()].map(clone);
  }

  /**
   * @param {string} name
   * @param {string} id
   */
  collectionDelete(name, id) {
    return this.collection(name).delete(String(id));
  }

  reset() {
    this.kv.clear();
    this.collections.clear();
  }

  snapshot() {
    return {
      upstreamId: this.upstreamId,
      kvKeys: [...this.kv.keys()],
      collections: Object.fromEntries(
        [...this.collections.entries()].map(([k, v]) => [k, v.size]),
      ),
    };
  }
}

/**
 * @param {string} upstreamId
 * @returns {ServiceStore}
 */
function getStore(upstreamId) {
  const id = String(upstreamId || '_default');
  if (!stores.has(id)) stores.set(id, new ServiceStore(id));
  return stores.get(id);
}

/**
 * @param {string} [upstreamId] omit = reset all
 */
function resetStore(upstreamId) {
  if (upstreamId == null || upstreamId === '' || upstreamId === '*') {
    for (const s of stores.values()) s.reset();
    stores.clear();
    return { reset: 'all' };
  }
  const s = getStore(upstreamId);
  s.reset();
  return { reset: upstreamId };
}

/**
 * @param {{ stubId?: string, method?: string, path?: string, upstreamId?: string }} entry
 */
function appendJournal(entry) {
  journal.push({
    at: new Date().toISOString(),
    stubId: entry.stubId || null,
    method: entry.method || null,
    path: entry.path || null,
    upstreamId: entry.upstreamId || null,
  });
  while (journal.length > JOURNAL_MAX) journal.shift();
}

/**
 * @param {number} [limit]
 */
function readJournal(limit = 50) {
  const n = Math.max(1, Math.min(JOURNAL_MAX, Number(limit) || 50));
  return journal.slice(-n);
}

function clearJournal() {
  journal.length = 0;
}

/** @internal */
function _resetAllForTests() {
  resetStore('*');
  clearJournal();
}

module.exports = {
  ServiceStore,
  getStore,
  resetStore,
  appendJournal,
  readJournal,
  clearJournal,
  _resetAllForTests,
};
