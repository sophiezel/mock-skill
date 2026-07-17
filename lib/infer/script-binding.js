'use strict';

/**
 * L1 script AST → BindingGraph events (ts-morph nodes).
 * Shared helpers are injected to avoid circular requires with infer-usage-io.
 */

const { createBindingGraph, aliasKeysFromText } = require('./binding-graph');

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
      if (resolved.binding.kind === 'path') arrayPath = [...resolved.binding.path];
      else if (resolved.binding.kind === 'root') arrayPath = [];
      else continue;

      graph.markArray(arrayPath);

      const cb = call.getArguments()[0];
      if (
        cb &&
        (cb.getKindName() === 'ArrowFunction' || cb.getKindName() === 'FunctionExpression')
      ) {
        const params = cb.getParameters();
        if (params[0]) {
          const pnn = params[0].getNameNode?.() || params[0];
          if (pnn.getKindName?.() === 'Identifier') {
            const itemName = pnn.getText();
            graph.bindItemAlias(itemName, arrayPath);
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
                  graph.ensureItemProp(arrayPath, [propName]);
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
          graph.ensureItemProp(itemBind.path, rest);
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

  return graph;
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

module.exports = {
  applyScriptBindingGraph,
  applyTemplateEvents,
  createBindingGraph,
  aliasKeysFromText,
};
