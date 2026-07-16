'use strict';

const { resolveProjectSlug } = require('../lib/paths');
const { loadSession, saveSession } = require('../lib/session-config');
const { appendAudit } = require('../lib/audit');

function setCase(opts = {}) {
  const projectSlug = resolveProjectSlug(
    opts.projectDir || process.cwd(),
    opts.name,
  );
  const apiId = opts.apiId;
  const caseId = opts.caseId;
  if (!apiId || !caseId) {
    throw new Error('Usage: mock-skill set-case <apiId> <caseId>');
  }
  const cfg = loadSession(projectSlug);
  const active = { ...(cfg.cases?.active || {}) };
  active[apiId] = caseId;
  saveSession(projectSlug, { cases: { ...cfg.cases, active } });
  appendAudit(projectSlug, {
    command: 'set-case',
    taskId: opts.taskId || null,
    apiKey: apiId,
    summary: `case=${caseId}`,
  });
  console.log(`[mock-skill] set case ${apiId} -> ${caseId}`);
  console.log('[mock-skill] session picks up via ≤1s cache; no restart needed');
}

module.exports = { setCase };

if (require.main === module) {
  setCase({
    apiId: process.argv[2],
    caseId: process.argv[3],
  });
}
