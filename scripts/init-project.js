'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveProjectSlug,
  ensureProjectDirs,
  projectDataDir,
} = require('../lib/paths');
const { appendAudit } = require('../lib/audit');
const { inferApiUsage } = require('./infer-api-usage');
const { classifyRequests, writeClassifyResult } = require('./classify-requests');
const {
  generateMocks,
  loadExistingContracts,
  listExistingMockKeys,
} = require('./generate-mock');

async function initProject(opts = {}) {
  const projectDir = path.resolve(opts.projectDir || process.cwd());
  const taskId = opts.taskId || null;
  const force = Boolean(opts.force);
  const relatedFrom = opts.relatedFrom || null;
  const nameOverride = opts.name || null;

  if (!fs.existsSync(projectDir)) {
    throw new Error(`projectDir not found: ${projectDir}`);
  }

  const projectSlug = resolveProjectSlug(projectDir, nameOverride);
  ensureProjectDirs(projectSlug);

  console.log(`[mock-skill] init projectDir=${projectDir}`);
  console.log(`[mock-skill] projectSlug=${projectSlug} taskId=${taskId || 'adhoc'}`);

  const apis = inferApiUsage(projectDir);
  console.log(`[mock-skill] discovered ${apis.length} APIs`);

  const existingContracts = loadExistingContracts(projectSlug);
  const existingMockKeys = listExistingMockKeys(projectSlug);

  const classified = classifyRequests({
    apis,
    taskId,
    relatedFrom,
    relatedPaths: opts.relatedPaths || [],
    modifiedFiles: opts.modifiedFiles || [],
    existingMockKeys,
    existingContracts,
  });

  writeClassifyResult(projectSlug, classified);

  // Unblock "new" when no task (baseline init never requires docs)
  const roles = classified.roles.map((r) => {
    if (!taskId && r.role === 'new') {
      return { ...r, role: 'unrelated', blocked: false };
    }
    if (!taskId) {
      return { ...r, blocked: false };
    }
    // task mode: new without docs stays blocked
    if (r.role === 'new' && !relatedFrom) {
      return { ...r, blocked: true };
    }
    if (r.role === 'new' && relatedFrom) {
      return { ...r, blocked: false };
    }
    return r;
  });

  const gen = generateMocks({
    projectSlug,
    roles,
    conflicts: classified.conflicts,
    taskId,
    force,
    merge: !force,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportName = taskId
    ? `init-${taskId}-${stamp}.md`
    : `init-${stamp}.md`;
  const reportPath = path.join(projectDataDir(projectSlug), 'reports', reportName);

  const md = [
    '# mock-skill init report',
    '',
    `- projectDir: \`${projectDir}\``,
    `- projectSlug: \`${projectSlug}\``,
    `- taskId: \`${taskId || 'adhoc'}\``,
    `- discovered: ${apis.length}`,
    `- generated: ${gen.generated}`,
    `- reused: ${gen.reused}`,
    `- skipped: ${gen.skipped}`,
    `- blocked(new without IO): ${gen.blocked.length}`,
    '',
    '## Roles summary',
    '',
    ...['new', 'modify', 'dependency', 'unrelated'].map((role) => {
      const n = roles.filter((r) => r.role === role).length;
      return `- ${role}: ${n}`;
    }),
    '',
    gen.blocked.length
      ? `## Blocked (provide docs / --related-from)\n\n${gen.blocked.map((b) => `- ${b}`).join('\n')}\n`
      : '',
    classified.conflicts.length
      ? `## Conflicts\n\nSee \`reports/contract-conflicts.md\` (${classified.conflicts.length})\n`
      : '',
    '## Next',
    '',
    '```bash',
    `mock-skill session start --name=${projectSlug}${taskId ? ` --task=${taskId}` : ''}`,
    '```',
    '',
  ].join('\n');

  fs.writeFileSync(reportPath, md);
  appendAudit(projectSlug, {
    command: 'init',
    taskId,
    summary: `discovered=${apis.length} generated=${gen.generated} reused=${gen.reused}`,
    reportPath,
  });

  if (opts.writeProjectConfig) {
    const cfg = {
      projectSlug,
      mockSkillRoot: path.resolve(__dirname, '..'),
      dataDir: projectDataDir(projectSlug),
    };
    fs.writeFileSync(
      path.join(projectDir, '.mock-skill.json'),
      `${JSON.stringify(cfg, null, 2)}\n`,
    );
    console.log('[mock-skill] wrote .mock-skill.json (optional)');
  }

  console.log(`[mock-skill] report: ${reportPath}`);
  console.log(
    `[mock-skill] done generated=${gen.generated} reused=${gen.reused} skipped=${gen.skipped} blocked=${gen.blocked.length}`,
  );

  return {
    projectSlug,
    projectDir,
    apis,
    roles,
    gen,
    reportPath,
  };
}

module.exports = { initProject };

if (require.main === module) {
  initProject({
    projectDir: process.argv[2] || process.cwd(),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
