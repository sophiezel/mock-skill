'use strict';

/**
 * L2 Vue template AST → normalized BindingGraph events.
 * Uses @vue/compiler-dom baseParse (directive AST + forParseResult).
 * Expression member chains parsed via TypeScript AST — not regex.
 */

const { baseParse, NodeTypes } = require('@vue/compiler-dom');

/**
 * Extract raw <template>...</template> inner HTML (first block).
 * Tag slicing only — field extraction is AST-only below.
 * @param {string} vueSource
 * @returns {string|null}
 */
function extractVueTemplateInner(vueSource) {
  if (!vueSource || typeof vueSource !== 'string') return null;
  const open = /<template\b[^>]*>/i.exec(vueSource);
  if (!open) return null;
  const start = open.index + open[0].length;
  const closeIdx = vueSource.toLowerCase().indexOf('</template>', start);
  if (closeIdx < 0) return null;
  return vueSource.slice(start, closeIdx);
}

function getTs() {
  try {
    return require('typescript');
  } catch {
    try {
      return require('ts-morph').ts;
    } catch {
      return null;
    }
  }
}

/**
 * Parse a simple member expression string via TypeScript AST.
 * @param {string} expr
 * @returns {{ root: string, members: string[] } | null}
 */
function parseMemberExpr(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const trimmed = expr.trim();
  if (!trimmed || trimmed.includes('(') || trimmed.includes('[')) return null;
  const ts = getTs();
  if (!ts) return null;
  const sf = ts.createSourceFile(
    'expr.ts',
    `(${trimmed})`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) return null;
  let node = stmt.expression;
  if (ts.isParenthesizedExpression(node)) node = node.expression;

  const parts = [];
  while (node) {
    if (ts.isPropertyAccessExpression(node)) {
      parts.unshift(node.name.text);
      node = node.expression;
    } else if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
      node = node.expression;
    } else if (ts.isIdentifier(node)) {
      parts.unshift(node.text);
      break;
    } else {
      return null;
    }
  }
  if (parts.length < 2) return null;
  return { root: parts[0], members: parts.slice(1) };
}

/**
 * @param {string} source
 * @returns {string|null}
 */
function parseSourceAlias(source) {
  if (!source || typeof source !== 'string') return null;
  const t = source.trim();
  if (!t || t.includes('(') || t.includes('[')) return null;
  const ts = getTs();
  if (!ts) return null;
  const sf = ts.createSourceFile(
    'src.ts',
    `(${t})`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) return null;
  let node = stmt.expression;
  if (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const parts = [];
    let cur = node;
    while (cur) {
      if (ts.isPropertyAccessExpression(cur)) {
        parts.unshift(cur.name.text);
        cur = cur.expression;
      } else if (ts.isIdentifier(cur)) {
        parts.unshift(cur.text);
        break;
      } else if (cur.kind === ts.SyntaxKind.ThisKeyword) {
        parts.unshift('this');
        break;
      } else {
        return null;
      }
    }
    return parts.join('.');
  }
  return null;
}

/**
 * Collect member events from an expression text via TS AST walk.
 * @param {string} text
 * @param {Array} events
 */
function collectMembersFromText(text, events) {
  if (!text || typeof text !== 'string') return;
  const mem = parseMemberExpr(text);
  if (mem) {
    events.push({ type: 'member', alias: mem.root, members: mem.members });
    return;
  }
  const ts = getTs();
  if (!ts) return;
  try {
    const sf = ts.createSourceFile(
      'e.ts',
      `void (${text});`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(n) {
      if (ts.isPropertyAccessExpression(n)) {
        const parts = [];
        let cur = n;
        let ok = true;
        while (cur) {
          if (ts.isPropertyAccessExpression(cur)) {
            parts.unshift(cur.name.text);
            cur = cur.expression;
          } else if (ts.isIdentifier(cur)) {
            parts.unshift(cur.text);
            break;
          } else {
            ok = false;
            break;
          }
        }
        if (ok && parts.length >= 2) {
          events.push({
            type: 'member',
            alias: parts[0],
            members: parts.slice(1),
          });
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(sf);
  } catch {
    /* ignore */
  }
}

/**
 * Walk template AST and emit BindingGraph events.
 * @param {string} templateInner
 * @returns {Array<object>}
 */
function collectTemplateBindingEvents(templateInner) {
  const events = [];
  if (!templateInner || !templateInner.trim()) return events;

  let ast;
  try {
    ast = baseParse(templateInner, {
      comments: false,
    });
  } catch {
    return events;
  }

  function exprText(exp) {
    if (!exp) return null;
    return exp.content || exp.loc?.source || null;
  }

  function walk(node) {
    if (!node) return;

    if (node.type === NodeTypes.ELEMENT) {
      for (const prop of node.props || []) {
        if (prop.type === NodeTypes.DIRECTIVE && prop.name === 'for') {
          const fp = prop.forParseResult;
          if (fp) {
            const sourceAlias = parseSourceAlias(exprText(fp.source) || '');
            const itemAlias = (exprText(fp.value) || '').trim();
            if (sourceAlias && itemAlias) {
              events.push({
                type: 'forSource',
                sourceAlias,
                itemAlias,
              });
            }
          } else {
            // Fallback: parse "item in list" via TS is awkward; skip if no forParseResult
            const raw = exprText(prop.exp);
            if (raw && raw.includes(' in ')) {
              const [left, right] = raw.split(/\s+in\s+/);
              const itemAlias = (left || '').replace(/[()]/g, '').split(',')[0].trim();
              const sourceAlias = parseSourceAlias((right || '').trim());
              if (sourceAlias && itemAlias) {
                events.push({ type: 'forSource', sourceAlias, itemAlias });
              }
            }
          }
        }
        if (prop.type === NodeTypes.DIRECTIVE && prop.exp) {
          collectMembersFromText(exprText(prop.exp), events);
        }
      }
      for (const c of node.children || []) walk(c);
      return;
    }

    if (node.type === NodeTypes.INTERPOLATION) {
      const content = node.content;
      collectMembersFromText(exprText(content), events);
      if (content && content.type === NodeTypes.COMPOUND_EXPRESSION) {
        for (const c of content.children || []) {
          if (c && typeof c === 'object') {
            collectMembersFromText(exprText(c), events);
          }
        }
      }
      return;
    }

    if (node.type === NodeTypes.ROOT || node.type === NodeTypes.IF_BRANCH) {
      for (const c of node.children || []) walk(c);
      return;
    }

    if (node.type === NodeTypes.IF) {
      for (const b of node.branches || []) walk(b);
    }
  }

  walk(ast);
  return events;
}

/**
 * Full .vue source → BindingGraph events from template.
 * @param {string} vueSource
 * @returns {Array<object>}
 */
function collectVueTemplateBindingEvents(vueSource) {
  const inner = extractVueTemplateInner(vueSource);
  if (!inner) return [];
  return collectTemplateBindingEvents(inner);
}

module.exports = {
  extractVueTemplateInner,
  collectTemplateBindingEvents,
  collectVueTemplateBindingEvents,
  parseMemberExpr,
  parseSourceAlias,
};
