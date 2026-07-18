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
  stubHandlerPath,
  stubId: makeStubId,
  apiKey,
} = require('../lib/paths');
const { appendAudit } = require('../lib/audit');
const { renderHandler, loadExistingContracts } = require('./generate-mock');
const { isPlaceholderValue } = require('../lib/materialize');
const { normalizeHostLabel } = require('../lib/upstream');

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

/**
 * Merge capture data into existing mock data.
 * Real capture wins over null/''/faker placeholders; nested objects recurse.
 * New keys from real response are added (they are API fields, not invented).
 */
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
  if (typeof incoming !== 'object') {
    // Scalar: real capture always preferred over placeholder / prior sample
    if (isPlaceholderValue(existing)) return incoming;
    return incoming;
  }
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in out) || isPlaceholderValue(out[k])) {
      out[k] = v;
    } else if (
      v != null &&
      typeof v === 'object' &&
      typeof out[k] === 'object' &&
      !Array.isArray(v) &&
      !Array.isArray(out[k])
    ) {
      out[k] = mergeDataAdditive(out[k], v);
    } else if (typeof v !== 'object' || v === null) {
      // Real leaf overwrites faker/init sample
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = mergeDataAdditive(out[k], v);
    }
  }
  return out;
}

function loadUpstreams(projectSlug) {
  const p = path.join(projectDataDir(projectSlug), 'upstreams.json');
  if (!fs.existsSync(p)) return { version: 1, upstreams: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { version: 1, upstreams: {} };
  }
}

function saveUpstreams(projectSlug, data) {
  const p = path.join(projectDataDir(projectSlug), 'upstreams.json');
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

function hostToUpstream(host, upstreams) {
  if (!host) return null;
  for (const [upId, info] of Object.entries(upstreams.upstreams || {})) {
    if ((info.hosts || []).includes(host)) return upId;
  }
  return null;
}

function captureMerge(projectSlug, opts = {}) {
  ensureProjectDirs(projectSlug);
  const capturesDir = opts.capturesDir || path.join(projectDataDir(projectSlug), 'captures');
  if (!fs.existsSync(capturesDir)) {
    console.log('[mock-skill] no captures dir');
    return { merged: 0 };
  }

  const contracts = loadExistingContracts(projectSlug);
  const upstreamsData = loadUpstreams(projectSlug);
  let merged = 0;
  let anyLearnedHost = false;
  const skipped = [];

  for (const f of fs.readdirSync(capturesDir)) {
    if (!f.endsWith('.json')) continue;
    let cap;
    try {
      cap = JSON.parse(fs.readFileSync(path.join(capturesDir, f), 'utf8'));
    } catch {
      skipped.push({ file: f, reason: 'invalid_json' });
      continue;
    }
    if (!cap.path) {
      skipped.push({ file: f, reason: 'missing_path' });
      continue;
    }
    if (!cap.responseBody) {
      skipped.push({
        file: f,
        reason: 'empty_responseBody',
        hint: 'capture had no body',
        host: cap.host,
        path: cap.path,
        method: cap.method,
      });
      continue;
    }
    const host = cap.host || '_default';
    const method = (cap.method || 'GET').toUpperCase();

    // Resolve upstream from host
    let upstreamId = hostToUpstream(host, upstreamsData);
    let learnedHost = false;

    if (!upstreamId && host !== '_default') {
      // Try to find a unique contract matching path+method
      const matches = [];
      for (const [id, c] of contracts) {
        if (c.path === cap.path && (c.method || ['GET']).includes(method)) {
          matches.push(c);
        }
      }
      if (matches.length === 1) {
        upstreamId = matches[0].upstreamId || '_default';
        // Learn the host into upstreams.json
        const up = upstreamsData.upstreams[upstreamId] || { hosts: [], canonicalHost: null };
        if (!up.hosts.includes(host)) {
          up.hosts.push(host);
          upstreamsData.upstreams[upstreamId] = up;
          learnedHost = true;
          anyLearnedHost = true;
        }
      } else {
        skipped.push({
          file: f,
          reason: 'unknown_or_ambiguous_host',
          host,
          path: cap.path,
          method,
          matchCount: matches.length,
        });
        continue;
      }
    }

    const id = makeStubId({ upstreamId: upstreamId || '_default', method, path: cap.path });
    let contract = contracts.get(id);
    if (!contract) {
      // Fallback: try old apiKey
      contract = contracts.get(apiKey({ host, method, path: cap.path }));
    }
    if (!contract) {
      skipped.push({ file: f, reason: 'no_contract', host, path: cap.path, method });
      continue;
    }

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
    if (JSON.stringify(prev) === JSON.stringify(next) && !learnedHost) continue;

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

    const cPath = contractPath(projectSlug, contract.id || id);
    fs.writeFileSync(cPath, `${JSON.stringify(contract, null, 2)}\n`);

    const handlerFile = stubHandlerPath(
      projectSlug,
      contract.upstreamId || upstreamId || '_default',
      method,
      contract.path,
    );
    if (fs.existsSync(handlerFile) && !fs.readFileSync(handlerFile, 'utf8').includes('mock-skill:manual')) {
      fs.writeFileSync(handlerFile, renderHandler(contract));
    }

    appendAudit(projectSlug, {
      command: 'capture-merge',
      taskId: opts.taskId || null,
      apiKey: contract.id || id,
      summary: learnedHost ? 'merged capture + learned host alias' : 'merged capture response into contract',
    });
    merged++;
  }

  if (anyLearnedHost) {
    saveUpstreams(projectSlug, upstreamsData);
  }

  if (skipped.length) {
    const report = path.join(
      projectDataDir(projectSlug),
      'reports',
      `capture-merge-skipped-${Date.now()}.json`,
    );
    fs.writeFileSync(report, `${JSON.stringify({ skipped }, null, 2)}\n`);
    console.log(
      `[mock-skill] capture-merge skipped=${skipped.length} (see ${report})`,
    );
  }
  console.log(`[mock-skill] capture-merge merged=${merged}`);
  return { merged, skipped };
}

module.exports = { captureMerge, mergeDataAdditive, deepMergeShape };

if (require.main === module) {
  const { resolveProjectSlug } = require('../lib/paths');
  const slug = resolveProjectSlug(process.cwd(), process.argv[2]);
  captureMerge(slug);
}
