'use strict';

function sampleForName(name) {
  if (!name) return null;
  if (/Id$/i.test(name) || name === 'id') return '1';
  if (/Name$/i.test(name) || /Title$/i.test(name)) return 'mock';
  if (/Count$/i.test(name) || /Total$/i.test(name) || /Num$/i.test(name)) return 0;
  if (/List$/i.test(name) || /Items$/i.test(name)) return [];
  if (/^(is|has|can|enable)/i.test(name)) return false;
  if (/Date$/i.test(name) || /Time$/i.test(name)) return '2026-01-01';
  return null;
}

/**
 * Materialize responseShape tree into a concrete sample object.
 */
function materialize(shape, fieldName = '') {
  if (!shape || typeof shape !== 'object') return {};
  if (shape.type === 'array') {
    const item = materialize(shape.item || { type: 'object', props: {} }, fieldName);
    return [item];
  }
  if (shape.type === 'string') {
    if (shape.enums?.length) return shape.enums[0];
    return sampleForName(fieldName) ?? '';
  }
  if (shape.type === 'number') {
    if (shape.enums?.length) return shape.enums[0];
    return sampleForName(fieldName) ?? 0;
  }
  if (shape.type === 'boolean') {
    if (shape.enums?.length) return Boolean(shape.enums[0]);
    return false;
  }
  if (shape.type === 'unknown') {
    if (shape.enums?.length) return shape.enums[0];
    const byName = sampleForName(fieldName);
    if (byName !== null) return byName;
    return null;
  }
  // object
  const out = {};
  const props = shape.props || {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = materialize(v, k);
  }
  return out;
}

function shapeToDataFields(shape, prefix = '') {
  const fields = {};
  if (!shape?.props) return fields;
  for (const [k, v] of Object.entries(shape.props)) {
    const path = prefix ? `${prefix}.${k}` : k;
    fields[path] = {
      type: v.type || 'unknown',
      enums: v.enums || [],
      note: 'inferred from usage',
    };
    if (v.type === 'object' && v.props) {
      Object.assign(fields, shapeToDataFields(v, path));
    }
    if (v.type === 'array' && v.item?.props) {
      Object.assign(fields, shapeToDataFields(v.item, `${path}[]`));
    }
  }
  return fields;
}

function buildEnumCases(shape, baseData) {
  const cases = [];
  if (!shape?.props) return cases;
  function walk(node, pathParts) {
    if (!node) return;
    if (node.enums?.length && pathParts.length) {
      for (const val of node.enums) {
        const data = JSON.parse(JSON.stringify(baseData));
        let cur = data;
        for (let i = 0; i < pathParts.length - 1; i++) {
          if (cur[pathParts[i]] == null || typeof cur[pathParts[i]] !== 'object') {
            cur[pathParts[i]] = {};
          }
          cur = cur[pathParts[i]];
        }
        cur[pathParts[pathParts.length - 1]] = val;
        const id = `state_${pathParts.join('_')}_${String(val)}`.replace(
          /[^a-zA-Z0-9_]/g,
          '_',
        );
        cases.push({
          id,
          when: { header: { 'x-mock-case': id } },
          response: { code: 0, data, message: '' },
        });
      }
    }
    if (node.props) {
      for (const [k, v] of Object.entries(node.props)) {
        walk(v, [...pathParts, k]);
      }
    }
  }
  walk(shape, []);
  return cases.slice(0, 20); // cap
}

module.exports = { materialize, shapeToDataFields, buildEnumCases, sampleForName };
