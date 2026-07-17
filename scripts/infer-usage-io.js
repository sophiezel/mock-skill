'use strict';

/**
 * L2–L6 usage IO enrichment via ts-morph.
 * Tracks export references → call args → assignment aliases → property chains → enums.
 */

const fs = require('fs');
const path = require('path');

function emptyShape() {
  return { type: 'object', props: {} };
}

function ensureProp(shape, parts) {
  let cur = shape;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!cur.props) cur.props = {};
    if (!cur.props[p]) {
      cur.props[p] =
        i === parts.length - 1
          ? { type: 'unknown' }
          : { type: 'object', props: {} };
    }
    // Prefer object if we dig deeper
    if (i < parts.length - 1) {
      if (cur.props[p].type === 'unknown' || cur.props[p].type === 'array') {
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

function addEnum(shape, fieldPath, value, source) {
  const parts = fieldPath.split('.').filter(Boolean);
  if (!parts.length) return;
  const leaf = ensureProp(shape, parts);
  if (!leaf.enums) leaf.enums = [];
  if (!leaf.enums.some((e) => e === value || (e && e.value === value))) {
    leaf.enums.push(value);
  }
  leaf.enumSource = source;
}

function collectObjectLiteralKeys(node) {
  const keys = [];
  if (!node || !node.getProperties) return keys;
  for (const prop of node.getProperties()) {
    try {
      if (prop.getName) keys.push(prop.getName());
      else if (prop.getNameNode) keys.push(prop.getNameNode().getText());
    } catch {
      /* ignore */
    }
  }
  return keys;
}

function getPropertyAccessChain(node) {
  // Returns ['detail','foo','bar'] from detail.foo.bar
  const parts = [];
  let cur = node;
  while (cur) {
    const kind = cur.getKindName();
    if (kind === 'PropertyAccessExpression') {
      parts.unshift(cur.getName());
      cur = cur.getExpression();
    } else if (kind === 'ElementAccessExpression') {
      return null; // dynamic — gap
    } else if (kind === 'Identifier') {
      parts.unshift(cur.getText());
      break;
    } else if (kind === 'CallExpression' || kind === 'AwaitExpression') {
      break;
    } else {
      break;
    }
  }
  return parts;
}

const ENVELOPE_KEYS = new Set(['code', 'message', 'msg', 'success', 'error']);

function unwrapDataPrefix(parts) {
  // res.data.foo → foo; data.foo → foo
  if (parts[0] === 'res' && parts[1] === 'data') return parts.slice(2);
  if (parts[0] === 'response' && parts[1] === 'data') return parts.slice(2);
  if (parts[0] === 'data') return parts.slice(1);
  if (parts[0] === 'result' && parts[1] === 'data') return parts.slice(2);
  return parts.slice(1); // drop root binding name
}

/** True when original access path is under an explicit response `.data` segment. */
function isUnderDataPath(parts) {
  if (!parts || !parts.length) return false;
  if (parts[0] === 'data') return true;
  if (parts[0] === 'res' && parts[1] === 'data') return true;
  if (parts[0] === 'response' && parts[1] === 'data') return true;
  if (parts[0] === 'result' && parts[1] === 'data') return true;
  return false;
}

/**
 * Reject envelope keys at shape root unless the source path was under `.data`.
 * Prevents `res.code` → shape.code pollution while allowing `res.data.code`.
 */
function shouldRejectEnvelopeField(fullPath, shapePath) {
  if (!shapePath || !shapePath.length) return false;
  if (!ENVELOPE_KEYS.has(shapePath[0])) return false;
  return !isUnderDataPath(fullPath);
}

/**
 * Register a receiver by its definition name node (Identifier on
 * BindingElement / Parameter / VariableDeclaration). Also stores the parent
 * declaration so getDefinitionNodes() hits match either form.
 * @param {Set<object>} receiverDefs
 * @param {object} nameNode
 */
function registerReceiver(receiverDefs, nameNode) {
  if (!nameNode || !receiverDefs) return;
  try {
    receiverDefs.add(nameNode);
    const parent = nameNode.getParent?.();
    if (parent) {
      const kind = parent.getKindName();
      if (
        kind === 'BindingElement' ||
        kind === 'Parameter' ||
        kind === 'VariableDeclaration'
      ) {
        receiverDefs.add(parent);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * True if identifier's definition nodes intersect registered receivers.
 * Same textual name with a different definition (e.g. useState `data` vs
 * `.then(({ data })`) never matches.
 */
function isRegisteredReceiver(idNode, receiverDefs) {
  if (!idNode || !receiverDefs || !receiverDefs.size) return false;
  if (idNode.getKindName() !== 'Identifier') return false;
  try {
    if (receiverDefs.has(idNode)) return true;
    const defs = idNode.getDefinitionNodes?.() || [];
    for (const d of defs) {
      if (receiverDefs.has(d)) return true;
      if (d.getNameNode) {
        const nn = d.getNameNode();
        if (nn && receiverDefs.has(nn)) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Root Identifier of a PropertyAccessExpression chain, or null. */
function getPropertyAccessRootIdentifier(node) {
  let cur = node;
  while (cur) {
    const kind = cur.getKindName();
    if (kind === 'PropertyAccessExpression') {
      cur = cur.getExpression();
    } else if (kind === 'Identifier') {
      return cur;
    } else {
      return null;
    }
  }
  return null;
}

/**
 * Extract receiver defs + shape fields from a .then() callback parameter.
 * Handles: (res) => ...  and  ({ data }) => ...  and  ({ data: { x } }) => ...
 */
function collectBindingFromParam(param, receiverDefs, shape, responsePaths) {
  try {
    const nameNode = param.getNameNode();
    if (!nameNode) return;
    if (nameNode.getKindName() === 'Identifier') {
      registerReceiver(receiverDefs, nameNode);
      return;
    }
    if (nameNode.getKindName() === 'ObjectBindingPattern') {
      for (const be of nameNode.getElements()) {
        collectBindingElement(be, [], receiverDefs, shape, responsePaths);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Process one BindingElement at a given shape-path prefix.
 * Registers destructured API fields in the shape.
 * Only envelope bindings (e.g. `{ data }` / `{ data: payload }` where unwrap yields
 * empty path) become receivers — leaf fields like `city_id` must NOT, or UI renames
 * (setData({ cityId })) get confused with response roots.
 */
function collectBindingElement(be, prefixPath, receiverDefs, shape, responsePaths) {
  try {
    if (be.getKindName() !== 'BindingElement') return;
    const propNameNode = be.getPropertyNameNode();
    const boundNode = be.getNameNode();
    // Property name from source object; falls back to bound name when shorthand.
    const propName = propNameNode ? propNameNode.getText() : boundNode?.getText();
    if (!propName) return;
    const fullPath = [...prefixPath, propName];
    // Register in shape (unwrap data-prefix convention: shape root = response.data)
    const shapePath = unwrapDataPrefix(fullPath);
    if (shapePath.length && !shouldRejectEnvelopeField(fullPath, shapePath)) {
      ensureProp(shape, shapePath);
      responsePaths.push(shapePath.join('.'));
    }
    // Nested destructuring: { data: { x } }
    if (boundNode && boundNode.getKindName() === 'ObjectBindingPattern') {
      for (const nested of boundNode.getElements()) {
        collectBindingElement(nested, fullPath, receiverDefs, shape, responsePaths);
      }
    } else if (boundNode && boundNode.getKindName() === 'Identifier') {
      // Envelope payload only: .then(({ data }) =>) / ({ data: payload }) =>
      // Do NOT register error/code/message/success as receivers.
      const PAYLOAD = new Set(['data', 'result', 'payload']);
      if (shapePath.length === 0 && PAYLOAD.has(propName)) {
        registerReceiver(receiverDefs, boundNode);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the receiver identifier from a VariableDeclaration initializer,
 * handling `data || {}` / `data ?? {}` fallback patterns.
 * Returns the init Identifier when it resolves to a registered receiver def.
 */
function resolveReceiverInit(init, receiverDefs) {
  if (!init) return null;
  if (init.getKindName() === 'Identifier') {
    return isRegisteredReceiver(init, receiverDefs) ? init : null;
  }
  if (init.getKindName() === 'BinaryExpression') {
    const op = init.getOperatorToken?.()?.getText();
    if (op === '||' || op === '??') {
      const left = init.getLeft();
      if (left.getKindName() === 'Identifier' && isRegisteredReceiver(left, receiverDefs)) {
        return left;
      }
    }
  }
  return null;
}

/**
 * Walk projectDir for .vue files (excluding node_modules, tests, etc.).
 */
function walkVue(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const SKIP = new Set([
    'node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'vendor', '.data', '__tests__',
  ]);
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.env') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP.has(ent.name)) continue;
      walkVue(full, out);
    } else if (path.extname(ent.name) === '.vue') {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} projectDir
 * @param {Array} apis
 */
function enrichApisWithUsageIo(projectDir, apis) {
  let Project;
  let SyntaxKind;
  let ScriptTarget;
  let ModuleKind;
  let ModuleResolutionKind;
  try {
    ({ Project, SyntaxKind, ScriptTarget, ModuleKind, ModuleResolutionKind } =
      require('ts-morph'));
  } catch (e) {
    throw new Error(`ts-morph not installed: ${e.message}`);
  }

  const tsconfig = path.join(projectDir, 'tsconfig.json');
  const project = fs.existsSync(tsconfig)
    ? new Project({
        tsConfigFilePath: tsconfig,
        skipAddingFilesFromTsConfig: false,
        compilerOptions: { allowJs: true, checkJs: false, noEmit: true },
      })
    : new Project({
        compilerOptions: {
          allowJs: true,
          checkJs: false,
          jsx: 2, // JsxEmit.React
          noEmit: true,
          target: ScriptTarget.ES2020,
          module: ModuleKind.ESNext,
          moduleResolution: ModuleResolutionKind.NodeJs,
        },
      });

  if (!fs.existsSync(tsconfig)) {
    const src = path.join(projectDir, 'src');
    if (fs.existsSync(src)) {
      project.addSourceFilesAtPaths([
        `${src}/**/*.{ts,tsx,js,jsx}`,
        `!**/node_modules/**`,
        `!**/*.test.*`,
        `!**/*.spec.*`,
      ]);
    }
  }

  // Add .vue script blocks as virtual source files so ts-morph can resolve
  // references across service ↔ page boundaries within the same Project.
  const { extractVueScriptBlocks, virtualScriptPath } = require('../lib/vue-script');
  const vueFiles = walkVue(projectDir);
  for (const vueFile of vueFiles) {
    let vueContent;
    try {
      vueContent = fs.readFileSync(vueFile, 'utf8');
    } catch {
      continue;
    }
    const blocks = extractVueScriptBlocks(vueContent);
    const rel = path.relative(projectDir, vueFile).replace(/\\/g, '/');
    blocks.forEach((blk, i) => {
      if (!blk.content || !blk.content.trim()) return;
      const vPath = path.join(projectDir, virtualScriptPath(rel, i, blk.lang));
      try {
        project.createSourceFile(vPath, blk.content, { overwrite: true });
      } catch {
        /* ignore duplicate */
      }
    });
  }

  // Index export name → api keys
  const exportToApis = new Map();
  for (const api of apis) {
    const hints = api.exportHints || (api.exportHint ? [api.exportHint] : []);
    for (const h of hints) {
      if (!exportToApis.has(h)) exportToApis.set(h, []);
      exportToApis.get(h).push(api);
    }
  }

  // Also map by scanning source for export const X matching path in nearby createRequest
  // Already have exportHint from infer

  const sourceFiles = project.getSourceFiles().filter((sf) => {
    const fp = sf.getFilePath();
    if (fp.includes(`${path.sep}node_modules${path.sep}`)) return false;
    if (/\.(test|spec)\./.test(fp)) return false;
    // Include src/ files and virtual .vue script files (path contains .vue.__script)
    if (fp.includes('.vue.__script')) return true;
    return fp.includes(`${path.sep}src${path.sep}`);
  });

  // Build declaration map: export name → Node
  const exportDecls = new Map();
  for (const sf of sourceFiles) {
    for (const decl of sf.getExportedDeclarations()) {
      const [name, decls] = decl;
      if (!exportToApis.has(name)) continue;
      if (decls[0]) exportDecls.set(name, decls[0]);
    }
  }

  // Fallback: exportHint may be a local binding used in `export default { name }`
  // without a named export — resolve VariableDeclaration / FunctionDeclaration by name.
  for (const name of exportToApis.keys()) {
    if (exportDecls.has(name)) continue;
    for (const sf of sourceFiles) {
      let found = null;
      for (const vd of sf.getVariableDeclarations()) {
        if (vd.getName() === name) {
          found = vd;
          break;
        }
      }
      if (!found) {
        for (const fn of sf.getFunctions()) {
          if (fn.getName() === name) {
            found = fn;
            break;
          }
        }
      }
      if (found) {
        exportDecls.set(name, found);
        break;
      }
    }
  }

  let processed = 0;
  for (const [exportName, decl] of exportDecls) {
    const relatedApis = exportToApis.get(exportName) || [];
    if (!relatedApis.length) continue;

    const shape = emptyShape();
    const queryKeys = new Set();
    const bodyKeys = new Set();
    const responsePaths = [];
    const enums = [];
    const gaps = new Set();
    /** @type {Map<string, Set<object>>} filePath → response receiver definition nodes */
    const receiversByFile = new Map();
    let hasCall = false;
    let dynamicKeyRisk = false;

    function fileReceivers(sf) {
      const fp = sf.getFilePath();
      if (!receiversByFile.has(fp)) receiversByFile.set(fp, new Set());
      return receiversByFile.get(fp);
    }

    function registerAssignmentReceiver(localReceivers, leftOrDecl) {
      if (!leftOrDecl) return;
      try {
        if (leftOrDecl.getKindName() === 'VariableDeclaration') {
          const nn = leftOrDecl.getNameNode();
          if (!nn) return;
          // const data = await api()
          if (nn.getKindName() === 'Identifier') {
            registerReceiver(localReceivers, nn);
            return;
          }
          // const { error, data } = await api()  — envelope BindingElements
          if (nn.getKindName() === 'ObjectBindingPattern') {
            for (const be of nn.getElements()) {
              collectBindingElement(be, [], localReceivers, shape, responsePaths);
            }
          }
          return;
        }
        if (leftOrDecl.getKindName() === 'Identifier') {
          const defs = leftOrDecl.getDefinitionNodes?.() || [];
          if (defs.length) {
            for (const d of defs) {
              if (d.getNameNode) {
                const nn = d.getNameNode();
                if (nn && nn.getKindName() === 'Identifier') {
                  registerReceiver(localReceivers, nn);
                } else {
                  registerReceiver(localReceivers, d);
                }
              } else {
                registerReceiver(localReceivers, d);
              }
            }
          } else {
            registerReceiver(localReceivers, leftOrDecl);
          }
        }
      } catch {
        /* ignore */
      }
    }

    let refs = [];
    try {
      if (typeof decl.findReferencesAsNodes === 'function') {
        refs = decl.findReferencesAsNodes();
      } else if (decl.getNameNode) {
        const nameNode = decl.getNameNode();
        if (nameNode && nameNode.findReferencesAsNodes) {
          refs = nameNode.findReferencesAsNodes();
        }
      }
    } catch {
      gaps.add('ref_lookup_failed');
    }

    for (const ref of refs) {
      const parent = ref.getParent();
      if (!parent) continue;

      // CallExpression: getTaskDetail(...)
      let call = parent;
      if (call.getKindName() === 'PropertyAccessExpression') {
        call = call.getParent();
      }
      if (call && call.getKindName() === 'CallExpression') {
        hasCall = true;
        const localReceivers = fileReceivers(ref.getSourceFile());
        const args = call.getArguments();
        for (const arg of args) {
          if (arg.getKindName() === 'ObjectLiteralExpression') {
            for (const k of collectObjectLiteralKeys(arg)) {
              // Prefer body for POST
              const method = (relatedApis[0].method || 'GET').toUpperCase();
              if (method === 'GET' || method === 'DELETE') queryKeys.add(k);
              else bodyKeys.add(k);
            }
          } else if (arg.getKindName() === 'Identifier') {
            // Try to resolve variable init
            try {
              const defs = arg.getDefinitionNodes?.() || [];
              for (const d of defs) {
                // VariableDeclaration
                if (d.getKindName() === 'VariableDeclaration') {
                  const i = d.getInitializer();
                  if (i && i.getKindName() === 'ObjectLiteralExpression') {
                    for (const k of collectObjectLiteralKeys(i)) {
                      const method = (relatedApis[0].method || 'GET').toUpperCase();
                      if (method === 'GET') queryKeys.add(k);
                      else bodyKeys.add(k);
                    }
                  }
                }
              }
            } catch {
              /* ignore */
            }
          } else if (arg.getKindName() === 'ElementAccessExpression') {
            dynamicKeyRisk = true;
            gaps.add('dynamic_key');
          }
        }

        // .then((res) => ...) or .then(({ data }) => ...)
        const callParent = call.getParent();
        if (
          callParent &&
          callParent.getKindName() === 'PropertyAccessExpression' &&
          callParent.getName() === 'then'
        ) {
          const thenCall = callParent.getParent();
          if (thenCall && thenCall.getKindName() === 'CallExpression') {
            const cb = thenCall.getArguments()[0];
            if (cb && (cb.getKindName() === 'ArrowFunction' || cb.getKindName() === 'FunctionExpression')) {
              const params = cb.getParameters();
              if (params[0]) {
                collectBindingFromParam(params[0], localReceivers, shape, responsePaths);
              }
            }
          }
        }

        // await getXxx() assigned — register definition nodes, not bare names
        let walk = call.getParent();
        if (walk && walk.getKindName() === 'AwaitExpression') walk = walk.getParent();
        if (walk && walk.getKindName() === 'BinaryExpression') {
          const left = walk.getLeft?.() || walk.getChildren()[0];
          registerAssignmentReceiver(localReceivers, left);
        }
        if (walk && walk.getKindName() === 'VariableDeclaration') {
          registerAssignmentReceiver(localReceivers, walk);
        }
      }
    }

    // Scan files that reference the export — receivers are per-file to avoid
    // FileA `.then(({ data })` enabling FileB UI `data.cityId` pollution.
    const importFiles = new Set();
    for (const ref of refs) {
      importFiles.add(ref.getSourceFile());
    }

    for (const sf of importFiles) {
      const text = sf.getFullText();
      if (!text.includes(exportName)) continue;
      const receiverDefs = fileReceivers(sf);

      // Collect property accesses — match by definition node, not name string
      for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const chain = getPropertyAccessChain(pa);
        if (!chain || chain.length < 2) continue;
        const rootId = getPropertyAccessRootIdentifier(pa);
        if (!rootId || !isRegisteredReceiver(rootId, receiverDefs)) continue;

        // Skip .then .catch .data alone
        const rest = unwrapDataPrefix(chain);
        if (!rest.length) continue;
        if (rest[0] === 'then' || rest[0] === 'catch' || rest[0] === 'finally') {
          continue;
        }
        if (shouldRejectEnvelopeField(chain, rest)) continue;

        // Mark array if .map/.length/.filter on last-1
        const copy = [...rest];
        if (['map', 'filter', 'forEach', 'length', 'find'].includes(copy[copy.length - 1])) {
          copy.pop();
          if (copy.length) {
            const leaf = ensureProp(shape, copy);
            leaf.type = 'array';
            if (!leaf.item) leaf.item = { type: 'object', props: {} };
          }
        } else {
          ensureProp(shape, copy);
          responsePaths.push(copy.join('.'));
        }

        // Element access sibling — check parent
        const grand = pa.getParent();
        if (grand && grand.getKindName() === 'ElementAccessExpression') {
          dynamicKeyRisk = true;
          gaps.add('dynamic_key');
        }
      }

      // Destructuring: const { a, b } = data  /  const { x } = res.data
      for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const nameNode = vd.getNameNode();
        if (!nameNode || nameNode.getKindName() !== 'ObjectBindingPattern') continue;
        const init = vd.getInitializer();
        const srcId = resolveReceiverInit(init, receiverDefs);
        if (!srcId) continue;
        const srcName = srcId.getText();
        for (const be of nameNode.getElements()) {
          collectBindingElement(be, [srcName], receiverDefs, shape, responsePaths);
        }
      }

      // Enums: status === 1, detail.status === 'x'
      for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
        try {
          const op = bin.getOperatorToken().getText();
          if (!['===', '!==', '==', '!='].includes(op)) continue;
          const left = bin.getLeft();
          const right = bin.getRight();
          let fieldPath = null;
          let lit = null;
          if (left.getKindName() === 'PropertyAccessExpression') {
            const chain = getPropertyAccessChain(left);
            const rootId = getPropertyAccessRootIdentifier(left);
            if (chain && rootId && isRegisteredReceiver(rootId, receiverDefs)) {
              const rest = unwrapDataPrefix(chain);
              if (rest.length && !shouldRejectEnvelopeField(chain, rest)) {
                fieldPath = rest.join('.');
              }
            }
            if (
              right.getKindName() === 'StringLiteral' ||
              right.getKindName() === 'NumericLiteral' ||
              right.getKindName() === 'TrueKeyword' ||
              right.getKindName() === 'FalseKeyword'
            ) {
              lit = right.getLiteralValue?.() ?? JSON.parse(right.getText());
            }
          }
          if (fieldPath && lit !== null && lit !== undefined) {
            addEnum(shape, fieldPath, lit, 'comparison');
            enums.push({ field: fieldPath, values: [lit], source: 'comparison' });
          }
        } catch {
          /* ignore */
        }
      }

      // switch(detail.status)
      for (const sw of sf.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
        try {
          const expr = sw.getExpression();
          if (expr.getKindName() !== 'PropertyAccessExpression') continue;
          const chain = getPropertyAccessChain(expr);
          const rootId = getPropertyAccessRootIdentifier(expr);
          if (!chain || !rootId || !isRegisteredReceiver(rootId, receiverDefs)) continue;
          const rest = unwrapDataPrefix(chain);
          if (!rest.length || shouldRejectEnvelopeField(chain, rest)) continue;
          const fieldPath = rest.join('.');
          for (const clause of sw.getClauses()) {
            if (clause.getKindName() !== 'CaseClause') continue;
            const ce = clause.getExpression();
            if (!ce) continue;
            if (
              ce.getKindName() === 'StringLiteral' ||
              ce.getKindName() === 'NumericLiteral'
            ) {
              const lit = ce.getLiteralValue?.() ?? JSON.parse(ce.getText());
              addEnum(shape, fieldPath, lit, 'switch');
              enums.push({ field: fieldPath, values: [lit], source: 'switch' });
            }
          }
        } catch {
          /* ignore */
        }
      }

      // Shallow props: <Child detail={detail} /> or data={detail}
      for (const jsx of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
        try {
          const name = jsx.getNameNode?.()?.getText?.() || jsx.getName?.();
          const init = jsx.getInitializer();
          if (!init) continue;
          const expr = init.getExpression?.() || init;
          if (expr && expr.getKindName() === 'Identifier') {
            if (
              isRegisteredReceiver(expr, receiverDefs) &&
              (name === expr.getText() || name === 'data' || name === 'detail' || name === 'info')
            ) {
              gaps.add('props_shallow_only');
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!hasCall && refs.length <= 1) {
      gaps.add('no_callsite');
    }
    if (!responsePaths.length && !Object.keys(shape.props || {}).length) {
      gaps.add('no_property_access');
    }

    // Merge into related APIs
    const coverage = {
      request: {
        keysFound: [...queryKeys, ...bodyKeys],
        dynamicKeyRisk,
        confidence:
          queryKeys.size || bodyKeys.size
            ? 'high'
            : gaps.has('no_callsite')
              ? 'low'
              : 'medium',
      },
      response: {
        pathsFound: [...new Set(responsePaths)],
        confidence: responsePaths.length
          ? 'high'
          : gaps.has('no_property_access')
            ? 'low'
            : 'medium',
      },
      enums: mergeEnumEntries(enums),
      gaps: [...gaps],
    };

    for (const api of relatedApis) {
      api.queryHints = [...queryKeys];
      api.bodyHints = [...bodyKeys];
      api.responseShape = shape;
      api.responseHints = Object.keys(shape.props || {});
      api.coverage = coverage;
      api.confidence =
        coverage.response.confidence === 'high' ||
        coverage.request.confidence === 'high'
          ? 'high'
          : api.confidence;
    }
    processed++;
  }

  // APIs without exportHint get gap
  for (const api of apis) {
    if (!api.coverage) {
      api.coverage = {
        request: { keysFound: [], dynamicKeyRisk: false, confidence: 'low' },
        response: { pathsFound: [], confidence: 'low' },
        enums: [],
        gaps: ['no_export_symbol'],
      };
      api.responseShape = api.responseShape || emptyShape();
    }
  }

  console.log(
    `[mock-skill] usage-io enriched ${processed}/${exportDecls.size} exports (${apis.length} apis)`,
  );
  return apis;
}

function mergeEnumEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.field)) {
      map.set(e.field, { field: e.field, values: [], source: e.source });
    }
    const cur = map.get(e.field);
    for (const v of e.values) {
      if (!cur.values.includes(v)) cur.values.push(v);
    }
  }
  return [...map.values()];
}

module.exports = { enrichApisWithUsageIo, emptyShape, ensureProp };

if (require.main === module) {
  const { inferApiUsage } = require('./infer-api-usage');
  const dir = process.argv[2] || process.cwd();
  const apis = inferApiUsage(dir, { withUsageIo: true });
  const sample = apis.filter((a) => a.responseHints?.length).slice(0, 5);
  console.log(JSON.stringify(sample, null, 2));
}
