'use strict';

const { resolveProjectSlug, projectDataDir } = require('../lib/paths');
const { loadRuntimeState, saveRuntimeState } = require('../lib/session-config');
const { appendAudit } = require('../lib/audit');

function pidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryKill(pid, signal = 'SIGTERM') {
  if (!pidAlive(pid)) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function stopSession(opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const projectSlug = resolveProjectSlug(projectDir, opts.name);
  const state = loadRuntimeState(projectSlug);
  if (!state) {
    console.log('[mock-skill] no runtime state; nothing to stop');
    return { killed: false };
  }

  const sessionPid = state.mock?.pid;
  const chromePid = state.chromePid;
  let killedSession = false;
  let killedChrome = false;

  // Prefer signaling the foreground session process (owns mock+proxy servers)
  if (sessionPid && sessionPid !== process.pid) {
    killedSession = tryKill(sessionPid, 'SIGTERM');
    if (killedSession) {
      // brief wait then escalate
      const start = Date.now();
      while (pidAlive(sessionPid) && Date.now() - start < 1500) {
        /* spin */
      }
      if (pidAlive(sessionPid)) tryKill(sessionPid, 'SIGKILL');
    }
  }

  if (chromePid) {
    killedChrome = tryKill(chromePid, 'SIGTERM');
    if (killedChrome && pidAlive(chromePid)) {
      tryKill(chromePid, 'SIGKILL');
    }
  }

  saveRuntimeState(projectSlug, {
    ...state,
    stoppedAt: new Date().toISOString(),
    note: killedSession
      ? 'stop-session sent SIGTERM to session process'
      : 'stop-session: session pid not alive or is current process — closed state only',
  });
  appendAudit(projectSlug, {
    command: 'session stop',
    taskId: opts.taskId || state.taskId || null,
    summary: `stop killedSession=${killedSession} killedChrome=${killedChrome} pid=${sessionPid || '-'}`,
  });
  console.log(
    `[mock-skill] stop ${projectSlug}: sessionPid=${sessionPid || '-'} killed=${killedSession} chromePid=${chromePid || '-'} killed=${killedChrome}`,
  );
  console.log(`state: ${require('path').join(projectDataDir(projectSlug), 'runtime.json')}`);
  return { killed: killedSession || killedChrome, killedSession, killedChrome };
}

module.exports = { stopSession, pidAlive, tryKill };

if (require.main === module) {
  stopSession({ projectDir: process.cwd() });
}
