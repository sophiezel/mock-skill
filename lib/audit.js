'use strict';

const fs = require('fs');
const path = require('path');
const { projectDataDir, ensureProjectDirs } = require('./paths');

function changelogPath(projectSlug) {
  ensureProjectDirs(projectSlug);
  return path.join(projectDataDir(projectSlug), 'audit', 'changelog.jsonl');
}

function appendAudit(projectSlug, entry) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    taskId: entry.taskId ?? null,
    ...entry,
  });
  fs.appendFileSync(changelogPath(projectSlug), `${line}\n`, 'utf8');
}

function readAudit(projectSlug, { taskId, api } = {}) {
  const file = changelogPath(projectSlug);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let rows = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (taskId) {
    rows = rows.filter((r) => r.taskId === taskId);
  }
  if (api) {
    rows = rows.filter(
      (r) =>
        r.apiKey === api ||
        (r.apiKey && r.apiKey.includes(api)) ||
        (r.path && r.path.includes(api)),
    );
  }
  return rows;
}

module.exports = { appendAudit, readAudit, changelogPath };
