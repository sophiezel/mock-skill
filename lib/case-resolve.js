'use strict';

/**
 * Resolve a mock case descriptor into an executable response plan.
 *
 * Input (from handler return or contract case):
 *   - plain JSON body (legacy): { code, data, message } → httpStatus 200, no delay/fault
 *   - descriptor: { httpStatus?, body?, delayMs?, fault? }
 *
 * Output:
 *   { httpStatus, body, delayMs, fault }
 *
 * fault: 'hang' (suspend until client timeout) | 'reset' (destroy socket) | undefined
 */

const CASE_ALIASES = {
  dep_fail: 'http_502',
};

const STANDARD_CASE_DEFAULTS = {
  success: { httpStatus: 200 },
  empty: { httpStatus: 200 },
  biz_error: { httpStatus: 200 },
  http_401: { httpStatus: 401 },
  http_403: { httpStatus: 403 },
  http_404: { httpStatus: 404 },
  http_500: { httpStatus: 500 },
  http_502: { httpStatus: 502 },
  slow: { httpStatus: 200, delayMs: 3000 },
  timeout: { httpStatus: 0, delayMs: 60000, fault: 'hang' },
  offline: { httpStatus: 0, fault: 'reset' },
};

function normalizeCaseId(id) {
  if (!id) return 'success';
  return CASE_ALIASES[id] || id;
}

function isDescriptor(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    ('httpStatus' in v || 'delayMs' in v || 'fault' in v || 'body' in v)
  );
}

/** First value that is not null/undefined (preserves 0 / false / ''). */
function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * @param {string} caseId
 * @param {object} caseEntry - contract case { id, response, httpStatus?, meta? } OR handler return
 * @returns {{ httpStatus:number, body:object, delayMs:number, fault?:string }}
 */
function resolveCase(caseId, caseEntry) {
  const id = normalizeCaseId(caseId);
  const defaults = STANDARD_CASE_DEFAULTS[id] || {};

  const raw = caseEntry || {};
  const response = raw.response || raw;
  const meta = raw.meta || response?.meta || {};

  const httpStatus = firstDefined(
    raw.httpStatus,
    response?.httpStatus,
    defaults.httpStatus,
    200,
  );
  const delayMs = firstDefined(
    raw.delayMs,
    meta.delayMs,
    response?.delayMs,
    defaults.delayMs,
    0,
  );
  const fault = firstDefined(raw.fault, meta.fault, response?.fault, defaults.fault);

  let body;
  if (response && typeof response === 'object' && 'data' in response) {
    body = response;
  } else if (isDescriptor(response)) {
    body = response.body || {};
  } else {
    body = response;
  }

  return { httpStatus, body, delayMs, fault };
}

/**
 * Pick a case entry from a cases map by id, falling back to success.
 */
function pickCase(casesMap, caseId) {
  if (!casesMap) return null;
  const id = normalizeCaseId(caseId);
  return casesMap[id] || casesMap.success || null;
}

module.exports = {
  resolveCase,
  pickCase,
  normalizeCaseId,
  isDescriptor,
  STANDARD_CASE_DEFAULTS,
  CASE_ALIASES,
};
