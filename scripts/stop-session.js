'use strict';

const { resolveProjectSlug, projectDataDir } = require('../lib/paths');
const { loadRuntimeState, saveRuntimeState } = require('../lib/session-config');
const { appendAudit } = require('../lib/audit');

function stopSession(opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const projectSlug = resolveProjectSlug(projectDir, opts.name);
  const state = loadRuntimeState(projectSlug);
  if (!state) {
    console.log('[mock-skill] no runtime state; nothing to stop');
    return;
  }
  // Foreground session is stopped via Ctrl+C; this cleans state file
  saveRuntimeState(projectSlug, {
    ...state,
    stoppedAt: new Date().toISOString(),
    note: 'stop-session invoked — if mock/proxy still listen, kill the start-session process',
  });
  appendAudit(projectSlug, {
    command: 'session stop',
    taskId: opts.taskId || state.taskId || null,
    summary: 'stop requested',
  });
  console.log(
    `[mock-skill] marked stop for ${projectSlug}. If servers still run, Ctrl+C the start-session terminal or kill pid ${state.mock?.pid}`,
  );
  console.log(`state: ${require('path').join(projectDataDir(projectSlug), 'runtime.json')}`);
}

module.exports = { stopSession };

if (require.main === module) {
  stopSession({ projectDir: process.cwd() });
}
