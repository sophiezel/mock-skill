'use strict';

/**
 * Escape a callee identifier for use in RegExp (supports $HTTP).
 * @param {string} name
 */
function escapeCallee(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build method alternation and verb→HTTP map from a wrapper entry.
 * @param {{ callee: string, methods: Record<string, string> }} wrapper
 */
function wrapperMethodParts(wrapper) {
  const verbs = Object.keys(wrapper.methods || {});
  const map = {};
  for (const [v, m] of Object.entries(wrapper.methods || {})) {
    map[v.toLowerCase()] = String(m).toUpperCase();
  }
  return {
    calleeRe: escapeCallee(wrapper.callee),
    verbAlt: verbs.map(escapeCallee).join('|') || 'get|post',
    methodMap: map,
  };
}

/**
 * Resolve HTTP method from wrapper verb.
 * @param {string} verb
 * @param {Record<string, string>} methodMap
 */
function resolveWrapperMethod(verb, methodMap) {
  const key = String(verb || '').toLowerCase();
  if (methodMap[key]) return methodMap[key];
  if (key.startsWith('post') || key === 'put' || key === 'patch') return 'POST';
  if (key === 'delete' || key === 'del') return 'DELETE';
  if (key === 'put') return 'PUT';
  if (key === 'patch') return 'PATCH';
  return 'GET';
}

/**
 * Regex that matches any configured wrapper callee on a line (for abs URL skip / REQ_CTX).
 * @param {Array<{ callee: string }>} wrappers
 */
function buildWrapperPresenceRe(wrappers) {
  const parts = (wrappers || []).map((w) => escapeCallee(w.callee));
  if (!parts.length) return /\$HTTP\./;
  return new RegExp(`(?:${parts.join('|')})\\.`);
}

/**
 * Build REQ_CTX-style fragment for pathLiteral proximity.
 * @param {Array<{ callee: string, methods: Record<string, string> }>} wrappers
 */
function buildReqCtxRe(wrappers) {
  const wrapParts = [];
  for (const w of wrappers || []) {
    const { calleeRe, verbAlt } = wrapperMethodParts(w);
    wrapParts.push(`${calleeRe}\\.(?:${verbAlt})\\s*\\(`);
  }
  // Bare `request(` / registered callees as direct-call proximity (CallShape AST
  // is the primary discoverer; this only helps pathLiteral heuristics).
  const bareCallees = (wrappers || [])
    .map((w) => escapeCallee(w.callee))
    .filter(Boolean);
  const bareAlt = bareCallees.length
    ? `|${bareCallees.map((c) => `${c}\\s*\\(`).join('|')}`
    : '';
  const base =
    'createRequest|fetch\\s*\\(|axios\\.|request\\.(get|post|put|delete|patch)\\s*\\(';
  const wrapAlt = wrapParts.length ? `|${wrapParts.join('|')}` : '';
  return new RegExp(`\\b(${base}${wrapAlt}${bareAlt})`);
}

/**
 * Extract APIs from configured HTTP wrappers: callee.verb(`${hostVar}/path`) and abs URLs.
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} opts.file
 * @param {Map<string, Array<{host:string,prefix:string}>>} opts.hostVars
 * @param {Array} opts.serviceBases
 * @param {Array} opts.wrappers
 * @param {function} opts.isGatewayOnlyPath
 * @param {function} opts.parseHostUrlLiteral
 * @param {function} opts.pathDepth
 * @param {function} opts.push - (partial) => void
 */
function extractHttpWrapperApis(opts) {
  const {
    content,
    hostVars,
    serviceBases,
    wrappers,
    isGatewayOnlyPath,
    parseHostUrlLiteral,
    pathDepth,
    push,
  } = opts;

  for (const wrapper of wrappers || []) {
    const { calleeRe, verbAlt, methodMap } = wrapperMethodParts(wrapper);

    const httpTplRe = new RegExp(
      `${calleeRe}\\.(${verbAlt})\\s*\\(\\s*\`\\s*\\$\\{\\s*(\\w+)\\s*\\}\\s*([^\\\`]*)\``,
      'gi',
    );
    const httpAbsRe = new RegExp(
      `${calleeRe}\\.(${verbAlt})\\s*\\(\\s*(['"\`])((?:https?:)?\\/\\/[^'"\`]+)\\2`,
      'gi',
    );

    let hm;
    httpTplRe.lastIndex = 0;
    while ((hm = httpTplRe.exec(content))) {
      const method = resolveWrapperMethod(hm[1], methodMap);
      const varName = hm[2];
      let suffix = (hm[3] || '').split('?')[0].trim();
      if (/\$\{/.test(suffix)) continue;
      if (!suffix.startsWith('/')) suffix = `/${suffix}`;
      if (!suffix || suffix === '/') continue;
      const hosts = hostVars.get(varName) || [];
      if (hosts.length === 0) continue;
      const lineNo = content.slice(0, hm.index).split(/\n/).length;
      for (const h of hosts) {
        push({
          method,
          host: h.host,
          path: suffix,
          line: lineNo,
          confidence: 'high',
        });
      }
    }

    httpAbsRe.lastIndex = 0;
    while ((hm = httpAbsRe.exec(content))) {
      const method = resolveWrapperMethod(hm[1], methodMap);
      const parsed = parseHostUrlLiteral(hm[3]);
      if (!parsed) continue;
      let p = parsed.prefix || '/';
      if (!p.startsWith('/')) p = `/${p}`;
      if (p === '/' || !p.slice(1)) continue;
      if (isGatewayOnlyPath(p, serviceBases)) continue;
      if (typeof pathDepth === 'function' && pathDepth(p) <= 0) continue;
      const lineNo = content.slice(0, hm.index).split(/\n/).length;
      push({
        method,
        host: parsed.host,
        path: p,
        line: lineNo,
        confidence: 'high',
      });
    }
  }
}

module.exports = {
  escapeCallee,
  wrapperMethodParts,
  resolveWrapperMethod,
  buildWrapperPresenceRe,
  buildReqCtxRe,
  extractHttpWrapperApis,
};
