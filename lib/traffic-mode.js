'use strict';

/**
 * WireMock-style traffic gate: catalog rules may exist, but runtime decides
 * whether a matched rule is served as mock or forwarded upstream.
 *
 * Modes:
 *   all-mock          — mock every matched rule (default / self-test)
 *   all-passthrough   — never mock; always upstream (record /联调)
 *   selective         — mock only stubIds in mockAllowlist (proxy/intercept)
 */

const VALID_MODES = new Set(['all-mock', 'all-passthrough', 'selective']);

/**
 * @param {string} [mode]
 * @returns {string}
 */
function normalizeTrafficMode(mode) {
  const m = String(mode || 'all-mock').toLowerCase();
  if (!VALID_MODES.has(m)) {
    throw new Error(
      `invalid trafficMode "${mode}"; expected: all-mock | all-passthrough | selective`,
    );
  }
  return m;
}

/**
 * @param {object|null} rule
 * @param {{ trafficMode?: string, mockAllowlist?: string[] }} opts
 * @returns {boolean}
 */
function shouldMock(rule, opts = {}) {
  if (!rule) return false;
  const mode = normalizeTrafficMode(opts.trafficMode || 'all-mock');
  if (mode === 'all-passthrough') return false;
  if (mode === 'all-mock') return true;
  // selective
  const list = Array.isArray(opts.mockAllowlist) ? opts.mockAllowlist : [];
  const id = rule.stubId || rule.id;
  if (!id) return false;
  return list.includes(id);
}

/**
 * Capture reason when a matched rule is intentionally not mocked.
 * @param {string} mode
 * @returns {string}
 */
function trafficPassthroughReason(mode) {
  const m = normalizeTrafficMode(mode || 'all-mock');
  if (m === 'all-passthrough') return 'traffic-passthrough';
  if (m === 'selective') return 'traffic-selective-miss';
  return 'miss';
}

module.exports = {
  VALID_MODES,
  normalizeTrafficMode,
  shouldMock,
  trafficPassthroughReason,
};
