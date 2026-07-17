'use strict';

/**
 * Lightweight stateful case picker (WireMock scenario subset).
 *
 * Config shape (from scenario JSON or session):
 * {
 *   times: {
 *     "<apiKey|ruleId>": [
 *       { "case": "http_500", "times": 2 },
 *       { "case": "success", "times": -1 }  // -1 = forever
 *     ]
 *   }
 * }
 *
 * Also supports global state machine:
 * {
 *   state: "Started",
 *   transitions: {
 *     "Started": { on: "retry", next: "Failed", case: "http_500" },
 *     "Failed": { on: "retry", next: "Started", case: "success" }
 *   }
 * }
 */

function createStatefulEngine(config = {}) {
  const hitCounts = new Map(); // key -> count
  let state = config.state || 'Started';
  const timesCfg = config.times || {};
  const transitions = config.transitions || null;

  function pickFromTimes(key) {
    const steps = timesCfg[key];
    if (!Array.isArray(steps) || steps.length === 0) return null;
    const n = hitCounts.get(key) || 0;
    hitCounts.set(key, n + 1);
    let cursor = 0;
    for (const step of steps) {
      const t = Number(step.times);
      if (t < 0) return step.case || step.caseId || 'success';
      if (n < cursor + t) return step.case || step.caseId || 'success';
      cursor += t;
    }
    const last = steps[steps.length - 1];
    return last.case || last.caseId || 'success';
  }

  function pick(apiKey, event = 'request') {
    if (timesCfg[apiKey]) {
      return pickFromTimes(apiKey);
    }
    if (transitions && typeof transitions === 'object') {
      const node = transitions[state];
      if (node && (!node.on || node.on === event || node.on === '*')) {
        const caseId = node.case || node.caseId || null;
        if (node.next) state = node.next;
        return caseId;
      }
    }
    return null;
  }

  function getState() {
    return state;
  }

  function reset() {
    hitCounts.clear();
    state = config.state || 'Started';
  }

  return { pick, getState, reset, hitCounts };
}

module.exports = { createStatefulEngine };
