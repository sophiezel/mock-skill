'use strict';

/**
 * L3 BindingGraph — file-type-agnostic response-path propagation.
 * Alias keys and shape paths come only from AST; no field-name allowlists.
 */

/**
 * @typedef {{ kind: 'root' }} RootBinding
 * @typedef {{ kind: 'path', path: string[] }} PathBinding
 * @typedef {{ kind: 'item', path: string[] }} ItemBinding
 * @typedef {RootBinding | PathBinding | ItemBinding} Binding
 */

/**
 * @param {object} shape
 * @param {string[]} responsePaths
 */
function createBindingGraph(shape, responsePaths = []) {
  /** @type {Map<string, Binding>} */
  const aliases = new Map();

  function ensureProp(parts) {
    let cur = shape;
    if (!shape.props) shape.props = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!cur.props) cur.props = {};
      if (!cur.props[p]) {
        cur.props[p] =
          i === parts.length - 1
            ? { type: 'unknown' }
            : { type: 'object', props: {} };
      }
      if (i < parts.length - 1) {
        if (cur.props[p].type === 'unknown' || cur.props[p].type === 'array') {
          // Digging through array leaf → treat as object props on item? Prefer object container
          if (cur.props[p].type === 'array' && cur.props[p].item) {
            cur = cur.props[p].item;
            if (!cur.props) cur.props = {};
            continue;
          }
          cur.props[p] = {
            type: 'object',
            props: cur.props[p].props || {},
            enums: cur.props[p].enums,
          };
        }
        if (!cur.props[p].props) cur.props[p].props = {};
        cur = cur.props[p];
      } else {
        cur = cur.props[p];
      }
    }
    return cur;
  }

  function getNodeAtPath(parts) {
    if (!parts.length) return shape;
    let cur = shape;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!cur.props?.[p]) return null;
      cur = cur.props[p];
    }
    return cur;
  }

  /**
   * Mark shape node at path as array (nested under object props, or root).
   * @param {string[]} parts
   */
  function markArray(parts) {
    if (!parts.length) {
      shape.type = 'array';
      if (!shape.item) shape.item = { type: 'object', props: {} };
      if (!shape.item.props) shape.item.props = {};
      responsePaths.push('[]');
      return shape;
    }
    const leaf = ensureProp(parts);
    leaf.type = 'array';
    if (!leaf.item) leaf.item = { type: 'object', props: {} };
    if (!leaf.item.props) leaf.item.props = {};
    // Clear conflicting object-only dig if we had unknown
    responsePaths.push([...parts, '[]'].join('.'));
    return leaf;
  }

  /**
   * @param {string[]} arrayPath
   * @param {string[]} memberParts
   */
  function ensureItemProp(arrayPath, memberParts) {
    if (!memberParts.length) return;
    markArray(arrayPath);
    const arrNode = arrayPath.length ? getNodeAtPath(arrayPath) : shape;
    const item = arrNode.item || { type: 'object', props: {} };
    arrNode.item = item;
    if (!item.props) item.props = {};
    let cur = item;
    for (let i = 0; i < memberParts.length; i++) {
      const p = memberParts[i];
      if (!cur.props) cur.props = {};
      if (!cur.props[p]) {
        cur.props[p] =
          i === memberParts.length - 1
            ? { type: 'unknown' }
            : { type: 'object', props: {} };
      }
      if (i < memberParts.length - 1) {
        if (!cur.props[p].props) {
          cur.props[p] = { type: 'object', props: {}, enums: cur.props[p].enums };
        }
        cur = cur.props[p];
      }
    }
    responsePaths.push(
      [...arrayPath, '[]', ...memberParts].filter(Boolean).join('.').replace(/^\./, ''),
    );
  }

  /**
   * Record object field under path (non-item).
   * @param {string[]} parts
   */
  function ensureField(parts) {
    if (!parts.length) return;
    ensureProp(parts);
    responsePaths.push(parts.join('.'));
  }

  /**
   * Bind alias under multiple keys (this.x and x).
   * @param {string} aliasKey
   * @param {Binding} binding
   */
  function bindAlias(aliasKey, binding) {
    if (!aliasKey || !binding) return;
    aliases.set(aliasKey, binding);
    if (aliasKey.startsWith('this.')) {
      aliases.set(aliasKey.slice(5), binding);
    } else if (!aliasKey.includes('.')) {
      aliases.set(`this.${aliasKey}`, binding);
    }
  }

  /** @param {string} aliasKey */
  function resolveAlias(aliasKey) {
    if (!aliasKey) return null;
    return aliases.get(aliasKey) || aliases.get(aliasKey.replace(/^this\./, '')) || null;
  }

  /**
   * Apply member access on an alias.
   * @param {string} aliasKey
   * @param {string[]} memberParts
   */
  function applyMember(aliasKey, memberParts) {
    if (!memberParts?.length) return;
    const SKIP = new Set(['map', 'filter', 'forEach', 'find', 'length', 'push', 'concat', 'slice']);
    if (memberParts.some((p) => SKIP.has(p))) return;
    const b = resolveAlias(aliasKey);
    if (!b) return;
    if (b.kind === 'item') {
      ensureItemProp(b.path, memberParts);
      return;
    }
    if (b.kind === 'root') {
      ensureField(memberParts);
      return;
    }
    if (b.kind === 'path') {
      // If path is already an array binding used as collection, members are item props
      const node = getNodeAtPath(b.path);
      if (node && node.type === 'array') {
        ensureItemProp(b.path, memberParts);
        return;
      }
      ensureField([...b.path, ...memberParts]);
    }
  }

  /**
   * Register for-loop / forEach item alias for an array path.
   * @param {string} itemAlias
   * @param {string[]} arrayPath
   */
  function bindItemAlias(itemAlias, arrayPath) {
    markArray(arrayPath);
    bindAlias(itemAlias, { kind: 'item', path: [...arrayPath] });
  }

  /**
   * Industry-style transfer: fixed event kinds (Assign / MemberRead / IterItem /
   * ObjLiteralProp / JsxPropLink) plus legacy template events.
   * @param {object} ev
   */
  function applyTransfer(ev) {
    if (!ev || !ev.type) return;

    // --- canonical transfers ---
    if (ev.type === 'Assign') {
      const alias = ev.alias;
      if (!alias || !ev.binding || ev.binding.envelope) return;
      const b = ev.binding;
      if (b.kind === 'root') {
        bindAlias(alias, { kind: 'root' });
        if (ev.asArray) markArray([]);
      } else if (b.kind === 'path') {
        bindAlias(alias, { kind: 'path', path: [...b.path] });
        ensureField(b.path);
        if (ev.asArray) markArray(b.path);
      } else if (b.kind === 'item') {
        bindAlias(alias, { kind: 'item', path: [...(b.path || [])] });
      }
      return;
    }
    if (ev.type === 'MemberRead') {
      if (ev.alias && ev.members?.length) {
        applyMember(ev.alias, ev.members);
      } else if (ev.path?.length) {
        ensureField(ev.path);
      }
      return;
    }
    if (ev.type === 'IterItem') {
      if (ev.itemAlias && Array.isArray(ev.arrayPath)) {
        bindItemAlias(ev.itemAlias, ev.arrayPath);
      }
      return;
    }
    if (ev.type === 'ObjLiteralProp') {
      // setState({ list: res.data.list }) → bind state.list + ensure field
      if (!ev.stateAlias || !ev.prop || !ev.binding || ev.binding.envelope) return;
      const key = `${ev.stateAlias}.${ev.prop}`;
      if (ev.binding.kind === 'path') {
        ensureField(ev.binding.path);
        if (ev.asArray) markArray(ev.binding.path);
        bindAlias(key, { kind: 'path', path: [...ev.binding.path] });
      } else if (ev.binding.kind === 'root') {
        bindAlias(key, { kind: 'root' });
        if (ev.asArray) markArray([]);
      }
      return;
    }
    if (ev.type === 'JsxPropLink') {
      if (!Array.isArray(ev.arrayPath)) return;
      markArray(ev.arrayPath);
      for (const di of ev.dataIndexes || []) {
        if (di) ensureItemProp(ev.arrayPath, [di]);
      }
      return;
    }

    // --- legacy template events (compat) ---
    if (ev.type === 'markArray' && ev.path) {
      markArray(ev.path);
      return;
    }
    if (ev.type === 'aliasAssign' && ev.alias && ev.path) {
      applyTransfer({
        type: 'Assign',
        alias: ev.alias,
        binding: ev.path.length
          ? { kind: 'path', path: [...ev.path] }
          : { kind: 'root' },
        asArray: ev.asArray,
      });
      return;
    }
    if (ev.type === 'forSource' && ev.sourceAlias && ev.itemAlias) {
      const b = resolveAlias(ev.sourceAlias);
      if (!b) return;
      const arrayPath =
        b.kind === 'path' ? b.path : b.kind === 'root' ? [] : b.path;
      if (b.kind === 'item') return;
      applyTransfer({ type: 'IterItem', itemAlias: ev.itemAlias, arrayPath });
      return;
    }
    if (ev.type === 'member' && ev.alias && ev.members) {
      applyTransfer({
        type: 'MemberRead',
        alias: ev.alias,
        members: ev.members,
      });
    }
  }

  function applyEvent(ev) {
    applyTransfer(ev);
  }

  /**
   * Worklist drain — process transfer events to fixpoint (bounded).
   * @param {object[]} events
   */
  function drainTransfers(events) {
    if (!events?.length) return;
    const q = [...events];
    let guard = 0;
    while (q.length && guard++ < 10000) {
      applyTransfer(q.shift());
    }
  }

  return {
    shape,
    responsePaths,
    aliases,
    ensureProp,
    ensureField,
    markArray,
    ensureItemProp,
    bindAlias,
    resolveAlias,
    applyMember,
    bindItemAlias,
    applyEvent,
    applyTransfer,
    drainTransfers,
    getNodeAtPath,
  };
}

/**
 * Normalize LHS / source text to alias keys.
 * @param {string} text
 */
function aliasKeysFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const t = text.trim();
  if (!t) return [];
  const keys = [t];
  if (t.startsWith('this.')) keys.push(t.slice(5));
  else if (!t.includes('.') && !t.includes('[')) keys.push(`this.${t}`);
  return keys;
}

module.exports = {
  createBindingGraph,
  aliasKeysFromText,
};
