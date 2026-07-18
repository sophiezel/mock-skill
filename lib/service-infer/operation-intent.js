'use strict';

/**
 * Deterministic operation intent from method + path + light usage hints.
 * @param {{ method?: string, path?: string, queryHints?: string[], bodyHints?: string[] }} api
 * @returns {'list'|'detail'|'create'|'update'|'delete'|'submit'|'query'|'unknown'}
 */
function inferOperationIntent(api = {}) {
  const method = String(api.method || 'GET').toUpperCase();
  const path = String(api.path || '');
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || '';
  const prev = segs[segs.length - 2] || '';

  const looksId =
    /^\{[^}]+\}$/.test(last) ||
    /^:/.test(last) ||
    /^(id|uuid|[a-z]+Id)$/i.test(last) ||
    (/^\d+$/.test(last) && prev.length > 0);

  const lowerPath = path.toLowerCase();
  if (/submit|approve|reject|confirm|cancel|login|logout|upload|import|export/.test(lowerPath)) {
    if (method === 'GET') return 'query';
    return 'submit';
  }

  if (method === 'GET') {
    if (looksId) return 'detail';
    if (/list|search|query|page/.test(lowerPath) || last.endsWith('s')) return 'list';
    return 'query';
  }
  if (method === 'POST') {
    if (/create|add|save|insert/.test(lowerPath)) return 'create';
    if (looksId) return 'update';
    return 'create';
  }
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  return 'unknown';
}

/**
 * Normalize a resource path by stripping trailing id segment.
 * /users/1 → /users, /users/{id} → /users
 * @param {string} path
 * @returns {{ basePath: string, hasId: boolean }}
 */
function splitResourcePath(path) {
  const segs = String(path || '').split('/').filter(Boolean);
  if (!segs.length) return { basePath: '/', hasId: false };
  const last = segs[segs.length - 1];
  const looksId =
    /^\{[^}]+\}$/.test(last) ||
    /^:/.test(last) ||
    /^(id|uuid|[a-z]+Id)$/i.test(last) ||
    /^\d+$/.test(last);
  if (looksId && segs.length >= 2) {
    return { basePath: '/' + segs.slice(0, -1).join('/'), hasId: true };
  }
  return { basePath: '/' + segs.join('/'), hasId: false };
}

/**
 * Cluster stubs of one upstream into CRUD resources (Crudio/VBR style).
 * @param {{ stubId: string, method: string, path: string, upstreamId?: string }[]} stubs
 * @returns {{ resource: string, basePath: string, upstreamId: string, ops: Record<string, string|null> }[]}
 */
function inferResourceClusters(stubs = []) {
  /** @type {Map<string, { resource: string, basePath: string, upstreamId: string, ops: Record<string, string|null> }>} */
  const byKey = new Map();

  for (const s of stubs) {
    const upstreamId = s.upstreamId || '_default';
    const method = String(s.method || 'GET').toUpperCase();
    const { basePath, hasId } = splitResourcePath(s.path);
    const key = `${upstreamId}::${basePath}`;
    if (!byKey.has(key)) {
      const resource = basePath.split('/').filter(Boolean).pop() || 'item';
      byKey.set(key, {
        resource,
        basePath,
        upstreamId,
        ops: {
          list: null,
          detail: null,
          create: null,
          update: null,
          delete: null,
        },
      });
    }
    const cluster = byKey.get(key);
    const intent = inferOperationIntent(s);
    const stubId = s.stubId || `${method} ${upstreamId}${s.path}`;

    if (intent === 'list' && method === 'GET' && !hasId) cluster.ops.list = stubId;
    else if (intent === 'detail' && method === 'GET' && hasId) cluster.ops.detail = stubId;
    else if (intent === 'create' && method === 'POST' && !hasId) cluster.ops.create = stubId;
    else if (intent === 'update' && (method === 'PUT' || method === 'PATCH') && hasId) {
      cluster.ops.update = stubId;
    } else if (intent === 'delete' && method === 'DELETE') cluster.ops.delete = stubId;
    else if (method === 'GET' && !hasId && !cluster.ops.list) cluster.ops.list = stubId;
    else if (method === 'GET' && hasId && !cluster.ops.detail) cluster.ops.detail = stubId;
    else if (method === 'POST' && !hasId && !cluster.ops.create) cluster.ops.create = stubId;
  }

  return [...byKey.values()].filter((c) => {
    const n = Object.values(c.ops).filter(Boolean).length;
    // Need at least list+create or detail+update/delete to be useful as CRUD
    return n >= 2 && (c.ops.list || c.ops.detail) && (c.ops.create || c.ops.update || c.ops.delete);
  });
}

module.exports = {
  inferOperationIntent,
  splitResourcePath,
  inferResourceClusters,
};
