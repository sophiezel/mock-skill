'use strict';

/**
 * L7: merge proxy captures into contracts (additive only).
 */
const fs = require('fs');
const path = require('path');
const {
  ensureProjectDirs,
  projectDataDir,
  contractPath,
  mockHandlerPath,
  apiKey,
} = require('../lib/paths');
const { appendAudit } = require('../lib/audit');
const { renderHandler, loadExistingContracts } = require('./generate-mock');

function deepMergeShape(target, sample) {
  if (sample == null) return target;
  if (Array.isArray(sample)) {
    return {
      type: 'array',
      item:
        sample.length > 0
          ? deepMergeShape({ type: 'object', props: {} }, sample[0])
          : { type: 'unknown' },
    };
  }
  if (typeof sample !== 'object') {
    const t =
      typeof sample === 'number'
        ? 'number'
        : typeof sample === 'boolean'
          ? 'boolean'
          : 'string';
    return { type: t };
  }
  const props = { ...(target?.props || {}) };
  for (const [k, v] of Object.entries(sample)) {
    props[k] = deepMergeShape(props[k], v);
  }
  return { type: 'object', props };
}

function mergeDataAdditive(existing, incoming) {
  if (incoming == null) return existing;
  if (existing == null) return incoming;
  if (Array.isArray(incoming)) {
    if (!Array.isArray(existing) || existing.length === 0) return incoming;
    if (incoming.length === 0) return existing;
    return [
      mergeDataAdditive(existing[0] || {}, incoming[0]),
    ];
  }
  if (typeof incoming !== 'object') return existing ?? incoming;
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in out) || out[k] == null || out[k] === '') {
      out[k] = v;
    } else if (typeof v === 'object' && typeof out[k] === 'object') {
      out[k] = mergeDataAdditive(out[k], v);
    }
  }
  return out;
}

function captureMerge(projectSlug, opts = {}) {
  ensureProjectDirs(projectSlug);
  const capturesDir = path.join(projectDataDir(projectSlug), 'captures');
  if (!fs.existsSync(capturesDir)) {
    console.log('[mock-skill] no captures dir');
    return { merged: 0 };
  }

  const contracts = loadExistingContracts(projectSlug);
  let merged = 0;

  for (const f of fs.readdirSync(capturesDir)) {
    if (!f.endsWith('.json')) continue;
    let cap;
    try {
      cap = JSON.parse(fs.readFileSync(path.join(capturesDir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!cap.path || !cap.responseBody) continue;
    const host = cap.host || '_default';
    const method = (cap.method || 'GET').toUpperCase();
    const id = apiKey({ host, method, path: cap.path });
    let contract = contracts.get(id);
    if (!contract) {
      // try GET default
      contract = contracts.get(apiKey({ host, method: 'GET', path: cap.path }));
    }
    if (!contract) continue;

    let body = cap.responseBody;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        continue;
      }
    }
    const data =
      body && typeof body === 'object' && 'data' in body ? body.data : body;
    if (data == null) continue;

    const success = contract.cases?.find((c) => c.id === 'success');
    if (!success) continue;
    const prev = success.response?.data;
    const next = mergeDataAdditive(prev, data);
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;

    success.response.data = next;
    contract.response = contract.response || {};
    contract.response.source = 'usage+capture';
    contract.response.shape = deepMergeShape(
      contract.response.shape || { type: 'object', props: {} },
      data,
    );
    contract.coverage = contract.coverage || {
      request: { keysFound: [] },
      response: { pathsFound: [] },
      enums: [],
      gaps: [],
    };
    contract.coverage.gaps = (contract.coverage.gaps || []).filter(
      (g) => g !== 'no_property_access' && g !== 'no_export_symbol',
    );
    contract.coverage.response = {
      ...contract.coverage.response,
      confidence: 'high',
      pathsFound: [
        ...new Set([
          ...(contract.coverage.response.pathsFound || []),
          ...Object.keys(typeof data === 'object' && !Array.isArray(data) ? data : {}),
        ]),
      ],
    };

    const cPath = contractPath(projectSlug, contract.id);
    fs.writeFileSync(cPath, `${JSON.stringify(contract, null, 2)}\n`);

    const handlerFile = mockHandlerPath(projectSlug, contract.host, contract.path);
    if (fs.existsSync(handlerFile) && !fs.readFileSync(handlerFile, 'utf8').includes('mock-skill:manual')) {
      fs.writeFileSync(handlerFile, renderHandler(contract));
    }

    appendAudit(projectSlug, {
      command: 'capture-merge',
      taskId: opts.taskId || null,
      apiKey: contract.id,
      summary: 'merged capture response into contract',
    });
    merged++;
  }

  console.log(`[mock-skill] capture-merge merged=${merged}`);
  return { merged };
}

module.exports = { captureMerge, mergeDataAdditive, deepMergeShape };

if (require.main === module) {
  const { resolveProjectSlug } = require('../lib/paths');
  const slug = resolveProjectSlug(process.cwd(), process.argv[2]);
  captureMerge(slug);
}
