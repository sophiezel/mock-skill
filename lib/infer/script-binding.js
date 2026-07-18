'use strict';

/**
 * L1 script AST → BindingGraph events (ts-morph nodes).
 * Shared helpers are injected to avoid circular requires with infer-usage-io.
 */

const { createBindingGraph, aliasKeysFromText } = require('./binding-graph');
const { getDeclarativeFieldSources, extractDataIndexes } = require('./declarative-field-sources');

const ITER_METHODS = new Set(['forEach', 'map', 'filter', 'find']);

/**
 * @param {object} opts
 * @param {object} opts.sf - ts-morph SourceFile
 * @param {object} opts.SyntaxKind
 * @param {Set} opts.receiverDefs
 * @param {object} opts.shape
 * @param {string[]} opts.responsePaths
 * @param {Function} opts.getPropertyAccessChain
 * @param {Function} opts.getPropertyAccessRootIdentifier
 * @param {Function} opts.isRegisteredReceiver
 * @param {Function} opts.unwrapDataPrefix
 * @param {Function} opts.isUnderDataPath
 * @param {Function} opts.shouldRejectEnvelopeField
 * @param {Function} opts.registerReceiver
 * @param {Array} [opts.fieldSources] - project-declared DeclarativeFieldSource plugins
 * @param {Function} [opts.resolveComponentFile] - (componentName: string) => ts-morph SourceFile | null
 */
function applyScriptBindingGraph(opts) {
  const {
    sf,
    SyntaxKind,
    receiverDefs,
    shape,
    responsePaths,
    getPropertyAccessChain,
    getPropertyAccessRootIdentifier,
    isRegisteredReceiver,
    unwrapDataPrefix,
    isUnderDataPath,
    shouldRejectEnvelopeField,
    registerReceiver,
    fieldSources,
    resolveComponentFile,
  } = opts;

  const graph = createBindingGraph(shape, responsePaths);
  /** @type {Set<object>} */
  const itemReceiverDefs = new Set();

  /**
   * Resolve expression to a Binding, or null.
   */
  function resolveExpr(expr) {
    if (!expr) return null;
    const kind = expr.getKindName();

    if (
      kind === 'ParenthesizedExpression' ||
      kind === 'AwaitExpression' ||
      kind === 'NonNullExpression'
    ) {
      return resolveExpr(expr.getExpression?.());
    }

    if (kind === 'ConditionalExpression') {
      const whenTrue = resolveExpr(expr.getWhenTrue?.() || expr.getChildAtIndex?.(2));
      const whenFalse = resolveExpr(expr.getWhenFalse?.() || expr.getChildAtIndex?.(4));
      if (whenTrue?.binding && !whenTrue.binding.envelope) return whenTrue;
      if (whenFalse?.binding && !whenFalse.binding.envelope) return whenFalse;
      return null;
    }

    if (kind === 'BinaryExpression') {
      const op = expr.getOperatorToken?.()?.getText?.();
      if (op === '&&' || op === '||' || op === '??') {
        const left = resolveExpr(expr.getLeft());
        const right = resolveExpr(expr.getRight());
        const preferArray = op === '||' || op === '??';
        // Prefer the side that carries a response binding
        if (
          right?.binding &&
          (right.binding.kind === 'path' ||
            right.binding.kind === 'root' ||
            right.binding.kind === 'item') &&
          !right.binding.envelope
        ) {
          return {
            binding: right.binding,
            asArray: preferArray || right.asArray,
          };
        }
        if (
          left?.binding &&
          (left.binding.kind === 'path' ||
            left.binding.kind === 'root' ||
            left.binding.kind === 'item') &&
          !left.binding.envelope
        ) {
          return {
            binding: left.binding,
            asArray: preferArray || left.asArray,
          };
        }
      }
      return null;
    }

    if (kind === 'ArrayLiteralExpression') {
      return null; // bare []
    }

    if (kind === 'Identifier') {
      const name = expr.getText();
      const aliased = graph.resolveAlias(name);
      if (aliased) return { binding: aliased, asArray: false };
      if (isRegisteredReceiver(expr, receiverDefs)) {
        // data / result / payload → root; res → treat PA only
        if (name === 'data' || name === 'result' || name === 'payload') {
          return { binding: { kind: 'root' }, asArray: false };
        }
        // res / response as root for further PA — not a shape path alone
        return { binding: { kind: 'root', envelope: true, name }, asArray: false };
      }
      return null;
    }

    if (kind === 'PropertyAccessExpression') {
      const chain = getPropertyAccessChain(expr);
      if (!chain || !chain.length) return null;

      // Nested alias keys from setState ObjectLiteral (tableData.list → path)
      const fullKey = chain.join('.');
      const fullAliased = graph.resolveAlias(fullKey);
      if (fullAliased) return { binding: fullAliased, asArray: false };

      // this.xxx as alias (ThisKeyword / ThisExpression)
      if (chain[0] === 'this' && chain.length >= 2) {
        const key = chain.join('.');
        const aliased =
          graph.resolveAlias(key) || graph.resolveAlias(chain.slice(1).join('.'));
        if (aliased) return { binding: aliased, asArray: false };
        // unbound this.xxx — no response binding
        return null;
      }

      // bare alias.foo (chain root is alias name)
      if (chain.length >= 1) {
        const rootAlias = graph.resolveAlias(chain[0]);
        if (rootAlias) {
          if (chain.length === 1) return { binding: rootAlias, asArray: false };
          if (rootAlias.kind === 'path') {
            return {
              binding: {
                kind: 'path',
                path: [...rootAlias.path, ...chain.slice(1)],
              },
              asArray: false,
            };
          }
          if (rootAlias.kind === 'item') {
            return {
              binding: rootAlias,
              asArray: false,
              itemMembers: chain.slice(1),
            };
          }
          if (rootAlias.kind === 'root') {
            return {
              binding: { kind: 'path', path: [...chain.slice(1)] },
              asArray: false,
            };
          }
        }
      }

      const rootId = getPropertyAccessRootIdentifier(expr);
      if (!rootId || !isRegisteredReceiver(rootId, receiverDefs)) return null;
      const rest = unwrapDataPrefix(chain);
      if (rest.length === 0 && isUnderDataPath(chain)) {
        return { binding: { kind: 'root' }, asArray: false };
      }
      if (!rest.length) return null;
      if (shouldRejectEnvelopeField(chain, rest)) return null;
      return { binding: { kind: 'path', path: [...rest] }, asArray: false };
    }

    return null;
  }

  function leftAliasKey(left) {
    if (!left) return null;
    const kind = left.getKindName();
    if (kind === 'Identifier') return left.getText();
    if (kind === 'PropertyAccessExpression') {
      const chain = getPropertyAccessChain(left);
      return chain ? chain.join('.') : null;
    }
    return null;
  }

  // Pass 1a: variable declarations first (const result = res.data.list || [])
  // so later assigns can resolve identifier aliases
  try {
    for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = vd.getInitializer();
      if (!init) continue;
      const nn = vd.getNameNode();
      if (!nn || nn.getKindName() !== 'Identifier') continue;
      const resolved = resolveExpr(init);
      if (!resolved?.binding || resolved.binding.envelope) continue;
      const name = nn.getText();
      if (resolved.binding.kind === 'root') {
        graph.bindAlias(name, { kind: 'root' });
        if (resolved.asArray) graph.markArray([]);
      } else if (resolved.binding.kind === 'path') {
        graph.bindAlias(name, { kind: 'path', path: [...resolved.binding.path] });
        graph.ensureField(resolved.binding.path);
        if (resolved.asArray) graph.markArray(resolved.binding.path);
      }
    }
  } catch {
    /* ignore */
  }

  // Pass 1b: assignments — bind aliases from response paths
  try {
    for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const op = bin.getOperatorToken()?.getText?.();
      if (op !== '=') continue;
      const right = bin.getRight();
      const left = bin.getLeft();
      const resolved = resolveExpr(right);
      if (!resolved?.binding) continue;
      const { binding, asArray } = resolved;
      if (binding.envelope) continue; // bare res without .data path
      const key = leftAliasKey(left);
      if (!key) continue;

      if (binding.kind === 'root') {
        // this.x = res.data  → alias to root, often array payload
        graph.bindAlias(key, { kind: 'root' });
        if (asArray) graph.markArray([]);
        continue;
      }
      if (binding.kind === 'path') {
        graph.bindAlias(key, { kind: 'path', path: [...binding.path] });
        graph.ensureField(binding.path);
        if (asArray) graph.markArray(binding.path);
        continue;
      }
    }
  } catch {
    /* ignore */
  }

  // Pass 1c: React setState — ObjectLiteral props OR single-arg setX(res.data||[])
  const transferEvents = [];
  try {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callexpr = call.getExpression();
      if (!callexpr || callexpr.getKindName() !== 'Identifier') continue;
      const setterName = callexpr.getText();
      if (!/^set[A-Z]/.test(setterName)) continue;
      const arg0 = call.getArguments()[0];
      if (!arg0) continue;
      const stateName =
        setterName.charAt(3).toLowerCase() + setterName.slice(4);

      if (arg0.getKindName() === 'ObjectLiteralExpression') {
        for (const prop of arg0.getProperties()) {
          if (prop.getKindName?.() !== 'PropertyAssignment') continue;
          let propName;
          try {
            propName = prop.getName?.() || prop.getNameNode?.()?.getText?.();
          } catch {
            continue;
          }
          if (!propName || propName.startsWith('{') || propName.startsWith('[')) {
            continue;
          }
          const init = prop.getInitializer?.();
          if (!init) continue;
          const resolved = resolveExpr(init);
          if (!resolved?.binding || resolved.binding.envelope) continue;
          transferEvents.push({
            type: 'ObjLiteralProp',
            stateAlias: stateName,
            prop: propName,
            binding: resolved.binding,
            asArray: resolved.asArray,
          });
        }
        continue;
      }

      // setDetectOptions(res?.data || []) / setOriginData(res.data)
      const resolved = resolveExpr(arg0);
      if (!resolved?.binding || resolved.binding.envelope) continue;
      transferEvents.push({
        type: 'Assign',
        alias: stateName,
        binding: resolved.binding,
        asArray:
          resolved.asArray ||
          resolved.binding.kind === 'root' ||
          (resolved.binding.kind === 'path' &&
            resolved.binding.path.length === 0),
      });
    }
  } catch {
    /* ignore */
  }
  if (transferEvents.length) graph.drainTransfers(transferEvents);

  // Pass 2: forEach/map on bound paths → item aliases
  try {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callexpr = call.getExpression();
      if (!callexpr || callexpr.getKindName() !== 'PropertyAccessExpression') continue;
      const method = callexpr.getName();
      if (!ITER_METHODS.has(method)) continue;
      const obj = callexpr.getExpression();
      const resolved = resolveExpr(obj);
      if (!resolved?.binding || resolved.binding.envelope) continue;

      let arrayPath = [];
      let under = null;
      if (resolved.binding.kind === 'path') {
        arrayPath = [...resolved.binding.path];
      } else if (resolved.binding.kind === 'root') {
        arrayPath = [];
      } else if (
        resolved.binding.kind === 'item' &&
        resolved.itemMembers?.length
      ) {
        // detail.itemList.map((item) => ...)
        arrayPath = [...resolved.binding.path];
        under = [...resolved.itemMembers];
        if (resolved.binding.under?.length) {
          under = [...resolved.binding.under, ...under];
        }
      } else {
        continue;
      }

      if (under) {
        graph.markNestedItemArray(arrayPath, under);
      } else {
        graph.markArray(arrayPath);
      }

      const cb = call.getArguments()[0];
      if (
        cb &&
        (cb.getKindName() === 'ArrowFunction' ||
          cb.getKindName() === 'FunctionExpression')
      ) {
        const params = cb.getParameters();
        if (params[0]) {
          const pnn = params[0].getNameNode?.() || params[0];
          if (pnn.getKindName?.() === 'Identifier') {
            const itemName = pnn.getText();
            graph.bindItemAlias(itemName, arrayPath, under);
            registerReceiver(itemReceiverDefs, pnn);
          } else if (pnn.getKindName?.() === 'ObjectBindingPattern') {
            for (const be of pnn.getElements()) {
              try {
                const propNameNode = be.getPropertyNameNode?.();
                const boundNode = be.getNameNode?.();
                const propName = propNameNode
                  ? propNameNode.getText()
                  : boundNode?.getText();
                if (propName && boundNode?.getKindName?.() === 'Identifier') {
                  graph.ensureItemProp(arrayPath, [propName], under);
                  registerReceiver(itemReceiverDefs, boundNode);
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Pass 3: property access on item receivers / aliases
  try {
    for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const chain = getPropertyAccessChain(pa);
      if (!chain || chain.length < 2) continue;
      const rootId = getPropertyAccessRootIdentifier(pa);
      if (!rootId) continue;
      const rootName = rootId.getText();

      if (isRegisteredReceiver(rootId, itemReceiverDefs)) {
        const rest = chain.slice(1);
        if (!rest.length) continue;
        if (ITER_METHODS.has(rest[rest.length - 1]) || rest[rest.length - 1] === 'length') {
          continue;
        }
        const itemBind = graph.resolveAlias(rootName);
        if (itemBind && itemBind.kind === 'item') {
          graph.ensureItemProp(itemBind.path, rest, itemBind.under || null);
        }
        continue;
      }

      // alias.member where alias is array path → item props OR nested field
      const aliased = graph.resolveAlias(rootName);
      if (aliased) {
        const rest = chain.slice(1);
        if (!rest.length) continue;
        if (ITER_METHODS.has(rest[rest.length - 1]) || rest[rest.length - 1] === 'length') {
          const arrPath = aliased.kind === 'path' ? aliased.path : [];
          graph.markArray(arrPath);
          continue;
        }
        graph.applyMember(rootName, rest);
      }
    }
  } catch {
    /* ignore */
  }

  // Pass 4: Ant Design Table dataSource+columns / Select options+fieldNames
  try {
    applyTableDataIndexBindings(sf, SyntaxKind, graph, resolveExpr);
    applySelectFieldNamesBindings(sf, SyntaxKind, graph, resolveExpr);
    applyProjectFieldSources(sf, SyntaxKind, graph, resolveExpr, fieldSources);
  } catch {
    /* ignore */
  }

  // Pass 5: bounded one-layer cross-file props-drill.
  // For JSX like <Child detail={payload} /> where Child is an imported
  // component, read Child's param field accesses (detail.name) and link
  // them back to the parent payload binding. Bounded: one layer only,
  // no transitive drill into grandchild components.
  try {
    applyCrossFilePropsDrill(sf, SyntaxKind, graph, resolveExpr, resolveComponentFile);
  } catch {
    /* ignore */
  }

  return graph;
}

/**
 * Apply project-declared DeclarativeFieldSource plugins (non-builtin).
 * Builtin Table/Select patterns are handled above; this loop only processes
 * plugins a project registers via infer.json `declarativeFieldSources[]`,
 * each declaring { dataSourceProp, columnsProp, fieldKey }.
 */
function applyProjectFieldSources(sf, SyntaxKind, graph, resolveExpr, fieldSources) {
  if (!Array.isArray(fieldSources) || fieldSources.length === 0) return;
  const builtinNames = new Set(getDeclarativeFieldSources([]).map((p) => p.name));
  for (const plugin of fieldSources) {
    if (!plugin || builtinNames.has(plugin.name)) continue; // builtins already handled
    if (!plugin.dataSourceProp || !plugin.columnsProp || !plugin.fieldKey) continue;
    applyGenericDeclarativeBinding(
      sf,
      SyntaxKind,
      graph,
      resolveExpr,
      plugin.dataSourceProp,
      plugin.columnsProp,
      plugin.fieldKey,
    );
  }
}

/**
 * Generic declarative binding: find JSX attributes named `dataSourceProp`
 * (bound to a response-rooted binding) and `columnsProp` (array literal),
 * group them by their parent JSX element, then read `fieldKey` from each
 * column object and emit JsxPropLink transfers (same mechanism as the
 * built-in Table handler) so the fields become array-item props.
 *
 * Mirrors applyTableDataIndexBindings but parameterized by prop names so
 * project-declared plugins (e.g. rows/fields/key) work without code changes.
 */
function applyGenericDeclarativeBinding(
  sf,
  SyntaxKind,
  graph,
  resolveExpr,
  dataSourceProp,
  columnsProp,
  fieldKey,
) {
  if (!sf.getDescendantsOfKind) return;
  /** @type {Map<object, { dataSource?: object, columns?: object }>} */
  const byParent = new Map();
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode?.()?.getText?.() || attr.getName?.();
    if (name !== dataSourceProp && name !== columnsProp) continue;
    const parent = attr.getParent?.();
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, {});
    const slot = byParent.get(parent);
    const init = attr.getInitializer?.();
    const expr = init?.getExpression?.() || init;
    if (name === dataSourceProp) slot.dataSource = expr;
    if (name === columnsProp) slot.columns = expr;
  }

  /** @type {{ type: 'JsxPropLink', arrayPath: string[], dataIndexes: string[] }[]} */
  const jsxTransfers = [];
  for (const slot of byParent.values()) {
    if (!slot.dataSource) continue;
    const resolved = resolveExpr(slot.dataSource);
    if (!resolved?.binding) continue;
    let arrayPath = null;
    if (resolved.binding.kind === 'path') {
      arrayPath = [...resolved.binding.path];
      graph.markArray?.(arrayPath);
    } else if (resolved.binding.kind === 'root') {
      arrayPath = [];
      graph.markArray?.([]);
    } else if (resolved.binding.kind === 'item') {
      continue;
    }
    if (arrayPath === null) continue;

    let fields = [];
    if (slot.columns) {
      fields = extractDataIndexes(slot.columns, SyntaxKind, fieldKey);
    }
    if (!fields.length) {
      // Fallback: scan file for a const <columnsProp> = [...] declaration
      for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (vd.getName?.() !== columnsProp) continue;
        const init = vd.getInitializer();
        if (init) {
          fields = extractDataIndexes(init, SyntaxKind, fieldKey);
          if (fields.length) break;
        }
      }
    }
    for (const f of fields) {
      if (!f) continue;
      jsxTransfers.push({
        type: 'JsxPropLink',
        arrayPath,
        dataIndexes: [f],
      });
    }
  }
  if (jsxTransfers.length) {
    // coalesce dataIndexes per arrayPath (same as built-in Table handler)
    const byPath = new Map();
    for (const ev of jsxTransfers) {
      const key = ev.arrayPath.join('.');
      if (!byPath.has(key)) {
        byPath.set(key, {
          type: 'JsxPropLink',
          arrayPath: ev.arrayPath,
          dataIndexes: [],
        });
      }
      byPath.get(key).dataIndexes.push(...ev.dataIndexes);
    }
    graph.drainTransfers?.([...byPath.values()]);
  }
}

/**
 * Extract string dataIndex values from a columns array expression / identifier.
 * @param {object} expr
 * @param {object} SyntaxKind
 * @param {number} [depth]
 * @returns {string[]}
 */
function collectDataIndexFromColumnsExpr(expr, SyntaxKind, depth = 0) {
  if (!expr || depth > 4) return [];
  const kind = expr.getKindName?.();
  if (kind === 'ArrayLiteralExpression') {
    const out = [];
    for (const el of expr.getElements()) {
      if (el.getKindName() !== 'ObjectLiteralExpression') continue;
      for (const prop of el.getProperties()) {
        if (prop.getKindName?.() !== 'PropertyAssignment') continue;
        const name = prop.getName?.();
        if (name !== 'dataIndex') continue;
        const init = prop.getInitializer?.();
        if (!init) continue;
        if (
          init.getKindName() === 'StringLiteral' ||
          init.getKindName() === 'NoSubstitutionTemplateLiteral'
        ) {
          const v = init.getLiteralValue?.() ?? init.getText()?.replace(/^['"`]|['"`]$/g, '');
          if (v && v !== 'action' && v !== 'operation') out.push(String(v));
        }
      }
      // render(_, record) => record.foo
      for (const prop of el.getProperties()) {
        if (prop.getKindName?.() !== 'PropertyAssignment') continue;
        if (prop.getName?.() !== 'render') continue;
        const init = prop.getInitializer?.();
        if (
          !init ||
          (init.getKindName() !== 'ArrowFunction' &&
            init.getKindName() !== 'FunctionExpression')
        ) {
          continue;
        }
        const params = init.getParameters?.() || [];
        const recordParam = params[1];
        if (!recordParam) continue;
        const rName =
          recordParam.getNameNode?.()?.getKindName?.() === 'Identifier'
            ? recordParam.getNameNode().getText()
            : recordParam.getName?.();
        if (!rName) continue;
        try {
          for (const pa of init.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
            const chain = getPropertyAccessChainSafe(pa);
            if (chain && chain[0] === rName && chain.length >= 2) {
              const mem = chain[1];
              if (mem && !ITER_METHODS.has(mem)) out.push(mem);
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return out;
  }
  if (kind === 'Identifier') {
    try {
      const defs = expr.getDefinitionNodes?.() || [];
      for (const d of defs) {
        if (d.getKindName() === 'VariableDeclaration') {
          const init = d.getInitializer();
          if (init) return collectDataIndexFromColumnsExpr(init, SyntaxKind, depth + 1);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

function getPropertyAccessChainSafe(pa) {
  try {
    const parts = [];
    let cur = pa;
    while (cur) {
      const k = cur.getKindName();
      if (k === 'PropertyAccessExpression') {
        parts.unshift(cur.getName());
        cur = cur.getExpression();
      } else if (k === 'Identifier') {
        parts.unshift(cur.getText());
        break;
      } else if (k === 'ElementAccessExpression' || k === 'CallExpression') {
        break;
      } else if (k === 'ParenthesizedExpression' || k === 'NonNullExpression') {
        cur = cur.getExpression?.();
      } else {
        break;
      }
    }
    return parts.length ? parts : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} sf
 * @param {object} SyntaxKind
 * @param {object} graph
 * @param {Function} resolveExpr
 * @param {Function} getPropertyAccessChain
 */
function applyTableDataIndexBindings(sf, SyntaxKind, graph, resolveExpr) {
  /** @type {object[]} */
  const jsxTransfers = [];
  // Group by parent JsxOpeningElement / JsxSelfClosingElement
  /** @type {Map<object, { dataSource?: object, columns?: object }>} */
  const byParent = new Map();
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode?.()?.getText?.() || attr.getName?.();
    if (name !== 'dataSource' && name !== 'columns') continue;
    const parent = attr.getParent?.();
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, {});
    const slot = byParent.get(parent);
    const init = attr.getInitializer?.();
    const expr = init?.getExpression?.() || init;
    if (name === 'dataSource') slot.dataSource = expr;
    if (name === 'columns') slot.columns = expr;
  }

  for (const slot of byParent.values()) {
    if (!slot.dataSource) continue;
    const resolved = resolveExpr(slot.dataSource);
    if (!resolved?.binding) continue;
    let arrayPath = null;
    if (resolved.binding.kind === 'path') {
      arrayPath = [...resolved.binding.path];
      graph.markArray(arrayPath);
    } else if (resolved.binding.kind === 'root') {
      arrayPath = [];
      graph.markArray([]);
    } else if (resolved.binding.kind === 'item') {
      continue;
    }
    if (arrayPath === null) continue;

    // Prefer columns prop on same Table; else scan file for const columns = [...]
    let dataIndexes = [];
    if (slot.columns) {
      dataIndexes = collectDataIndexFromColumnsExpr(slot.columns, SyntaxKind);
    }
    if (!dataIndexes.length) {
      for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (vd.getName?.() !== 'columns') continue;
        const init = vd.getInitializer();
        if (init) {
          dataIndexes = collectDataIndexFromColumnsExpr(init, SyntaxKind);
          if (dataIndexes.length) break;
        }
      }
    }
    for (const di of dataIndexes) {
      jsxTransfers.push({
        type: 'JsxPropLink',
        arrayPath,
        dataIndexes: [di],
      });
    }
  }
  if (jsxTransfers.length) {
    // coalesce dataIndexes per arrayPath
    const byPath = new Map();
    for (const ev of jsxTransfers) {
      const key = ev.arrayPath.join('.');
      if (!byPath.has(key)) {
        byPath.set(key, {
          type: 'JsxPropLink',
          arrayPath: ev.arrayPath,
          dataIndexes: [],
        });
      }
      byPath.get(key).dataIndexes.push(...ev.dataIndexes);
    }
    graph.drainTransfers([...byPath.values()]);
  }
}

/**
 * Ant Design Select: options={alias} + fieldNames={{ label, value }} → item props.
 * Also covers optionFilterProp='itemName' as an item field hint.
 */
function applySelectFieldNamesBindings(sf, SyntaxKind, graph, resolveExpr) {
  /** @type {object[]} */
  const transfers = [];
  /** @type {Map<object, { options?: object, fieldNames?: object, optionFilterProp?: string }>} */
  const byParent = new Map();

  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode?.()?.getText?.() || attr.getName?.();
    if (
      name !== 'options' &&
      name !== 'fieldNames' &&
      name !== 'optionFilterProp'
    ) {
      continue;
    }
    const parent = attr.getParent?.();
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, {});
    const slot = byParent.get(parent);
    const init = attr.getInitializer?.();
    const expr = init?.getExpression?.() || init;
    if (name === 'options') slot.options = expr;
    if (name === 'fieldNames') slot.fieldNames = expr;
    if (name === 'optionFilterProp') {
      if (
        expr &&
        (expr.getKindName() === 'StringLiteral' ||
          expr.getKindName() === 'NoSubstitutionTemplateLiteral')
      ) {
        slot.optionFilterProp =
          expr.getLiteralValue?.() ??
          expr.getText()?.replace(/^['"`]|['"`]$/g, '');
      }
    }
  }

  for (const slot of byParent.values()) {
    if (!slot.options) continue;
    const resolved = resolveExpr(slot.options);
    if (!resolved?.binding) continue;
    let arrayPath = null;
    if (resolved.binding.kind === 'path') {
      arrayPath = [...resolved.binding.path];
    } else if (resolved.binding.kind === 'root') {
      arrayPath = [];
    } else {
      continue;
    }
    graph.markArray(arrayPath);

    const fields = [];
    if (slot.fieldNames && slot.fieldNames.getKindName?.() === 'ObjectLiteralExpression') {
      for (const prop of slot.fieldNames.getProperties()) {
        if (prop.getKindName?.() !== 'PropertyAssignment') continue;
        const pname = prop.getName?.();
        if (pname !== 'label' && pname !== 'value' && pname !== 'options') {
          continue;
        }
        const init = prop.getInitializer?.();
        if (
          init &&
          (init.getKindName() === 'StringLiteral' ||
            init.getKindName() === 'NoSubstitutionTemplateLiteral')
        ) {
          const v =
            init.getLiteralValue?.() ??
            init.getText()?.replace(/^['"`]|['"`]$/g, '');
          if (v) fields.push(String(v));
        }
      }
    }
    if (slot.optionFilterProp) fields.push(slot.optionFilterProp);

    if (fields.length) {
      transfers.push({
        type: 'JsxPropLink',
        arrayPath,
        dataIndexes: [...new Set(fields)],
      });
    }
  }
  if (transfers.length) graph.drainTransfers(transfers);
}

/**
 * Apply template binding events onto an existing graph.
 * @param {object} graph
 * @param {Array<object>} events
 */
function applyTemplateEvents(graph, events) {
  if (!graph || !events?.length) return;
  for (const ev of events) {
    graph.applyEvent(ev);
  }
}

/**
 * Bounded one-layer cross-file props-drill.
 *
 * For each JSX element in the parent file whose tag is an imported
 * component (e.g. `<DetailCard detail={payload} />`), resolve the
 * component's source file, find the component's parameter matching the
 * prop name, collect `param.field` MemberReads in the component body, and
 * emit JsxPropLink transfers so those fields become part of the parent
 * binding's shape.
 *
 * Bounded: ONE layer only (no transitive drill into grandchild components),
 * no store/module analysis, no dynamic keys. Anything deeper stays a
 * `TRACE_EMPTY` / `props_shallow_only` gap to be filled by capture/OpenAPI.
 *
 * @param {object} sf - parent ts-morph SourceFile
 * @param {object} SyntaxKind
 * @param {object} graph
 * @param {Function} resolveExpr
 * @param {Function} [resolveComponentFile] - (componentName) => SourceFile | null
 */
function applyCrossFilePropsDrill(sf, SyntaxKind, graph, resolveExpr, resolveComponentFile) {
  if (!sf.getDescendantsOfKind || typeof resolveComponentFile !== 'function') return;
  // Collect both self-closing and paired JSX elements.
  const elements = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
  ];
  if (!elements.length) return;

  /** @type {{ type: 'JsxPropLink', arrayPath: string[], dataIndexes: string[] }[]} */
  const jsxTransfers = [];

  for (const el of elements) {
    const opening =
      el.getKindName?.() === 'JsxSelfClosingElement'
        ? el
        : el.getOpeningElementNode?.();
    if (!opening) continue;
    const tagNameNode = opening.getTagNameNode?.();
    if (!tagNameNode) continue;
    const componentName = tagNameNode.getText?.();
    if (!componentName || !/^[A-Z]/.test(componentName)) continue; // only component tags
    const childSf = resolveComponentFile(componentName);
    if (!childSf) continue;

    // Gather props on this JSX element: propName → initializer expression
    /** @type {Map<string, object>} */
    const props = new Map();
    const attrs = opening.getAttributes?.() || [];
    for (const attr of attrs) {
      if (attr.getKindName?.() !== 'JsxAttribute') continue;
      const name = attr.getNameNode?.()?.getText?.() || attr.getName?.();
      const init = attr.getInitializer?.();
      const expr = init?.getExpression?.() || init;
      if (name && expr) props.set(name, expr);
    }
    if (!props.size) continue;

    // Find the component's parameter names in the child file.
    const paramNames = collectComponentParamNames(childSf, SyntaxKind, componentName);
    if (!paramNames.length) continue;

    for (const [propName, propExpr] of props) {
      // The prop name must match one of the component's parameter names
      // (direct param `detail` or destructured `{ detail }`).
      if (!paramNames.includes(propName)) continue;
      const resolved = resolveExpr(propExpr);
      if (!resolved?.binding) continue;
      let arrayPath = null;
      if (resolved.binding.kind === 'path') {
        arrayPath = [...resolved.binding.path];
        graph.markArray?.(arrayPath);
      } else if (resolved.binding.kind === 'root') {
        arrayPath = [];
        graph.markArray?.([]);
      } else if (resolved.binding.kind === 'item') {
        // payload is an array item: drill into item props
        arrayPath = null; // handled below via item binding
      } else {
        continue;
      }
      // Collect field reads on the matching param in the child component body.
      const fields = collectParamMemberReads(childSf, SyntaxKind, propName);
      if (!fields.length) continue;
      if (arrayPath) {
        for (const f of fields) {
          jsxTransfers.push({ type: 'JsxPropLink', arrayPath, dataIndexes: [f] });
        }
      } else if (resolved.binding.kind === 'item') {
        // Item binding: add fields as item props directly via MemberRead on item
        for (const f of fields) {
          graph.addMemberRead?.(resolved.binding, f, { source: 'cross-file-props-drill' });
        }
      }
    }
  }

  if (jsxTransfers.length) {
    const byPath = new Map();
    for (const ev of jsxTransfers) {
      const key = ev.arrayPath.join('.');
      if (!byPath.has(key)) {
        byPath.set(key, { type: 'JsxPropLink', arrayPath: ev.arrayPath, dataIndexes: [] });
      }
      byPath.get(key).dataIndexes.push(...ev.dataIndexes);
    }
    graph.drainTransfers?.([...byPath.values()]);
  }
}

/**
 * Collect parameter names of a component declaration in a child source file.
 * Handles: function DetailCard({ detail }) {...} and const DetailCard = ({ detail }) => {...}
 * @returns {string[]}
 */
function collectComponentParamNames(childSf, SyntaxKind, componentName) {
  const names = [];
  const seen = new Set();
  const push = (n) => {
    if (n && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  };
  try {
    // Function declarations: function DetailCard(props) { ... }
    for (const fn of childSf.getFunctions?.() || []) {
      if (fn.getName?.() !== componentName) continue;
      collectParamNamesFromDecl(fn, SyntaxKind, push);
    }
    // Variable declarations: const DetailCard = (props) => {...}
    for (const vd of childSf.getVariableStatements?.() || []) {
      for (const d of vd.getDeclarations()) {
        if (d.getName?.() !== componentName) continue;
        const init = d.getInitializer?.();
        if (!init) continue;
        const fnLike =
          init.getKindName?.() === 'ArrowFunction' ||
          init.getKindName?.() === 'FunctionExpression'
            ? init
            : null;
        if (!fnLike) continue;
        collectParamNamesFromDecl(fnLike, SyntaxKind, push);
      }
    }
    // Exported function/const by name via getExportedDeclarations
    for (const [name, decls] of childSf.getExportedDeclarations?.() || []) {
      if (name !== componentName) continue;
      for (const d of decls) {
        collectParamNamesFromDecl(d, SyntaxKind, push);
      }
    }
  } catch {
    /* ignore */
  }
  return names;
}

function collectParamNamesFromDecl(decl, SyntaxKind, push) {
  let params = [];
  try {
    params = decl.getParameters?.() || [];
  } catch {
    params = [];
  }
  for (const p of params) {
    const nn = p.getNameNode?.();
    if (!nn) continue;
    if (nn.getKindName?.() === 'Identifier') {
      push(nn.getText?.());
    } else if (nn.getKindName?.() === 'ObjectBindingPattern') {
      for (const be of nn.getElements?.() || []) {
        const propName = be.getPropertyNameNode?.()?.getText?.() || be.getNameNode?.()?.getText?.();
        if (propName) push(propName);
      }
    }
  }
}

/**
 * Collect `param.field` MemberRead field names in a child source file for a
 * given parameter name. Bounded to direct property accesses (param.field,
 * param?.field); does not follow nested props or store.
 * @returns {string[]}
 */
function collectParamMemberReads(childSf, SyntaxKind, paramName) {
  const out = [];
  const seen = new Set();
  try {
    for (const pa of childSf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const obj = pa.getExpression?.();
      if (!obj || obj.getKindName?.() !== 'Identifier') continue;
      if (obj.getText?.() !== paramName) continue;
      const propNode = pa.getNameNode?.();
      if (!propNode) continue;
      const field = propNode.getText?.();
      if (!field || seen.has(field)) continue;
      seen.add(field);
      out.push(field);
    }
  } catch {
    /* ignore */
  }
  return out;
}

module.exports = {
  applyScriptBindingGraph,
  applyTemplateEvents,
  createBindingGraph,
  aliasKeysFromText,
};
