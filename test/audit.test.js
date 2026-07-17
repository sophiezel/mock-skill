'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { appendAudit, readAudit } = require('../lib/audit');
const { projectDataDir, ensureProjectDirs } = require('../lib/paths');

test('audit: append and filter by taskId/api', () => {
  const slug = `audit-test-${Date.now()}`;
  ensureProjectDirs(slug);
  try {
    appendAudit(slug, { command: 'init', taskId: 'T1', apiKey: 'GET h/p', summary: 'a' });
    appendAudit(slug, { command: 'smoke', taskId: 'T2', apiKey: 'POST h/q', summary: 'b' });
    appendAudit(slug, { command: 'bad', taskId: 'T1', summary: 'c' });

    // corrupt line tolerance
    const file = path.join(projectDataDir(slug), 'audit', 'changelog.jsonl');
    fs.appendFileSync(file, 'not-json\n');

    const all = readAudit(slug);
    assert.ok(all.length >= 3);
    const t1 = readAudit(slug, { taskId: 'T1' });
    assert.equal(t1.length, 2);
    const api = readAudit(slug, { api: 'GET h/p' });
    assert.equal(api.length, 1);
    assert.equal(api[0].command, 'init');
  } finally {
    fs.rmSync(projectDataDir(slug), { recursive: true, force: true });
  }
});
