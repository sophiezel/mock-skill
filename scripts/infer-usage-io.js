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

function unwrapDataPrefix(parts) {
  // res.data.foo → foo; data.foo → foo
  if (parts[0] === 'res' && parts[1] === 'data') return parts.slice(2);
  if (parts[0] === 'response' && parts[1] === 'data') return parts.slice(2);
  if (parts[0] === 'data') return parts.slice(1);
  if (parts[0] === 'result' && parts[1] === 'data') return parts.slice(2);
  return parts.slice(1); // drop root binding name
}

/**
 * @param {string} projectDir
 * @param {Array} apis
 */
function enrichApisWithUsageIo(projectDir, apis) {
  let Project;
  let SyntaxKind;
  try {
    ({ Project, SyntaxKind } = require('ts-morph'));
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
          jsx: 'react',
          noEmit: true,
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
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
    return (
      fp.includes(`${path.sep}src${path.sep}`) &&
      !fp.includes(`${path.sep}node_modules${path.sep}`) &&
      !/\.(test|spec)\./.test(fp)
    );
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
    const receiverNames = new Set(); // detail, res, data...
    let hasCall = false;
    let dynamicKeyRisk = false;

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
                const init =
                  d.getInitializer?.() ||
                  d.getFirstAncestorByKind?.(SyntaxKind.VariableDeclaration)?.getInitializer?.();
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

        // .then((res) => ...)
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
              if (params[0]) receiverNames.add(params[0].getName());
            }
          }
        }

        // await getXxx() assigned
        let walk = call.getParent();
        if (walk && walk.getKindName() === 'AwaitExpression') walk = walk.getParent();
        if (walk && walk.getKindName() === 'BinaryExpression') {
          const left = walk.getLeft?.() || walk.getChildren()[0];
          if (left && left.getKindName() === 'Identifier') {
            receiverNames.add(left.getText());
          }
        }
        if (walk && walk.getKindName() === 'VariableDeclaration') {
          const name = walk.getName();
          if (name) receiverNames.add(name.replace(/[{}\s]/g, '').split(',')[0]);
        }
        // setDetail(res) / setDetail(res.data)
        if (call.getKindName() === 'CallExpression') {
          /* already handled */
        }
      }

      // setState(apiResult) — CallExpression where arg contains ref? skip

      // Property access where identifier is export — rare
    }

    // Find setX from useState when then/await sets it — scan files that import export
    const importFiles = new Set();
    for (const ref of refs) {
      importFiles.add(ref.getSourceFile());
    }

    for (const sf of importFiles) {
      // Heuristic: getTaskDetail(...).then(res => setDetail(res / res.data))
      const text = sf.getFullText();
      if (!text.includes(exportName)) continue;

      // useState pair: [detail, setDetail]
      const stateRe =
        /const\s*\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*useState/g;
      let sm;
      const setters = new Map();
      while ((sm = stateRe.exec(text))) {
        setters.set(sm[2], sm[1]);
      }

      // setDetail( something with export or res )
      for (const [setter, stateName] of setters) {
        if (new RegExp(`${setter}\\s*\\(`).test(text) && text.includes(exportName)) {
          // If export is used in same file as setter, treat stateName as receiver
          receiverNames.add(stateName);
        }
      }

      // Always track common names if call exists in file
      if (hasCall || text.includes(`${exportName}(`)) {
        receiverNames.add('res');
        receiverNames.add('data');
        receiverNames.add('result');
        receiverNames.add('response');
      }

      // Collect property accesses
      for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const chain = getPropertyAccessChain(pa);
        if (!chain || chain.length < 2) continue;
        const root = chain[0];
        if (!receiverNames.has(root)) continue;

        // Skip .then .catch .data alone
        const rest = unwrapDataPrefix(chain);
        if (!rest.length) continue;
        if (rest[0] === 'then' || rest[0] === 'catch' || rest[0] === 'finally') {
          continue;
        }

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
            if (chain && receiverNames.has(chain[0])) {
              fieldPath = unwrapDataPrefix(chain).join('.');
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
          if (!chain || !receiverNames.has(chain[0])) continue;
          const fieldPath = unwrapDataPrefix(chain).join('.');
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
            const id = expr.getText();
            if (receiverNames.has(id) && (name === id || name === 'data' || name === 'detail' || name === 'info')) {
              // resolve component file — limited: search imported component
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
