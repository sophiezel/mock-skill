'use strict';

/**
 * OpenAPI / Swagger import → classify-compatible roles for generateMocks.
 * Usage: mock-skill import-openapi --from=./openapi.json [--task=ID]
 */

const fs = require('fs');
const path = require('path');
const {
  resolveProjectSlug,
  ensureProjectDirs,
  projectDataDir,
} = require('../lib/paths');
const { appendAudit } = require('../lib/audit');
const { writeClassifyResult } = require('./classify-requests');
const { generateMocks } = require('./generate-mock');

function schemaToShape(schema, components = {}) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', props: {} };
  }
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').pop();
    const resolved =
      components.schemas?.[name] ||
      components[name];
    return schemaToShape(resolved, components);
  }
  if (schema.type === 'array') {
    return { type: 'array', item: schemaToShape(schema.items, components) };
  }
  if (schema.type === 'object' || schema.properties) {
    const props = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      props[k] = schemaToShape(v, components);
    }
    return { type: 'object', props };
  }
  const t = schema.type || 'string';
  return { type: t === 'integer' ? 'number' : t };
}

function extractHost(spec) {
  if (spec.servers?.[0]?.url) {
    try {
      const u = new URL(spec.servers[0].url);
      return { host: u.host, basePath: u.pathname.replace(/\/$/, '') || '' };
    } catch {
      /* ignore */
    }
  }
  if (spec.host) {
    const scheme = (spec.schemes && spec.schemes[0]) || 'https';
    const basePath = spec.basePath || '';
    return { host: spec.host, basePath, scheme };
  }
  return { host: '_default', basePath: '' };
}

function importOpenApi(opts = {}) {
  const from = opts.from || opts['from'];
  if (!from) throw new Error('Usage: mock-skill import-openapi --from=<openapi.json|yaml>');
  const abs = path.resolve(opts.projectDir || process.cwd(), from);
  if (!fs.existsSync(abs)) throw new Error(`OpenAPI file not found: ${abs}`);

  const raw = fs.readFileSync(abs, 'utf8');
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch {
    throw new Error('OpenAPI YAML not supported in v1 — convert to JSON first');
  }

  const projectDir = path.resolve(opts.projectDir || process.cwd());
  const projectSlug = resolveProjectSlug(projectDir, opts.name);
  ensureProjectDirs(projectSlug);
  const taskId = opts.taskId || opts.task || null;
  const { host, basePath } = extractHost(spec);
  const components = spec.components || spec.definitions || {};
  const paths = spec.paths || {};
  const roles = [];

  for (const [p, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
        continue;
      }
      const fullPath = `${basePath || ''}${p}`.replace(/\{[^}]+\}/g, '1') || '/';
      const success =
        op.responses?.['200'] ||
        op.responses?.['201'] ||
        op.responses?.default;
      const schema =
        success?.content?.['application/json']?.schema ||
        success?.schema ||
        null;
      // unwrap envelope data if present
      const rawShape = schemaToShape(schema, components);
      const shape = rawShape.props?.data ? rawShape.props.data : rawShape;
      const apiKey = `${method.toUpperCase()} ${host}${fullPath}`;
      roles.push({
        apiKey,
        method: method.toUpperCase(),
        host,
        path: fullPath,
        relatedToTask: Boolean(taskId),
        role: 'dependency',
        confidence: 'high',
        hasMock: false,
        evidences: [`openapi:${from}`],
        responseHints: Object.keys(shape.props || {}),
        queryHints: [],
        bodyHints: [],
        blocked: false,
        lastTaskId: taskId,
        responseShape: shape,
        coverage: {
          request: { keysFound: [], confidence: 'medium' },
          response: {
            pathsFound: Object.keys(shape.props || {}),
            confidence: 'high',
          },
          enums: [],
          gaps: [],
        },
        exportHint: op.operationId || null,
        source: 'openapi',
      });
    }
  }

  const classified = {
    taskId,
    roles,
    conflicts: [],
    source: 'openapi',
    from: abs,
  };
  writeClassifyResult(projectSlug, classified);

  const gen = generateMocks({
    projectSlug,
    roles,
    conflicts: [],
    taskId,
    force: Boolean(opts.force),
    merge: !opts.force,
  });

  appendAudit(projectSlug, {
    command: 'import-openapi',
    taskId,
    summary: `from=${from} roles=${roles.length} generated=${gen.generated}`,
  });

  const report = path.join(
    projectDataDir(projectSlug),
    'reports',
    `openapi-import-${Date.now()}.json`,
  );
  fs.writeFileSync(report, `${JSON.stringify({ roles: roles.length, gen }, null, 2)}\n`);
  console.log(`[mock-skill] import-openapi roles=${roles.length} generated=${gen.generated}`);
  console.log(`[mock-skill] report ${report}`);
  return { roles, gen, projectSlug };
}

module.exports = { importOpenApi, schemaToShape, extractHost };

if (require.main === module) {
  const from = process.argv.find((a) => a.startsWith('--from='))?.slice(7);
  importOpenApi({ from, projectDir: process.cwd() });
}
