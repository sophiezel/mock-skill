'use strict';

/**
 * Preload for `npm test`: redirect all .data writes to a temp dir so the
 * repo `.data/services` / `.data/projects` are never filled with test junk.
 * Individual tests may still override MOCK_SKILL_DATA_ROOT.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.MOCK_SKILL_DATA_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-skill-test-'));
  process.env.MOCK_SKILL_DATA_ROOT = tmp;
  const cleanup = () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
}
