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

  const apis = inferApiUsage(projectDir, { withUsageIo: true });
  const meta = apis.meta || {};
  // apis is array with meta property
  const apiList = Array.isArray(apis) ? apis : [];
  console.log(`[mock-skill] discovered ${apiList.length} APIs`);
  if (meta.gatewayFilteredCount) {
    console.log(
      `[mock-skill] filtered gateway/base URLs≈${meta.gatewayFilteredCount}`,
    );
  }

  const existingContracts = loadExistingContracts(projectSlug);
  const existingMockKeys = listExistingMockKeys(projectSlug);

  const classified = classifyRequests({
    apis: apiList,
    taskId,
    relatedFrom,
    relatedPaths: opts.relatedPaths || [],
    modifiedFiles: opts.modifiedFiles || [],
    existingMockKeys,
    existingContracts,
  });

  // Carry enrichment fields from apis onto roles
  const apiByKey = new Map(
    apiList.map((a) => [
      `${(a.method || 'GET').toUpperCase()} ${a.host || '_default'}${a.path}`,
      a,
    ]),
  );
  classified.roles = classified.roles.map((r) => {
    const a = apiByKey.get(r.apiKey);
    if (!a) return r;
    return {
      ...r,
      queryHints: a.queryHints || r.queryHints,
      bodyHints: a.bodyHints || r.bodyHints,
      responseHints: a.responseHints || r.responseHints,
      responseShape: a.responseShape,
      coverage: a.coverage,
      exportHint: a.exportHint,
      confidence: a.confidence || r.confidence,
    };
  });

  writeClassifyResult(projectSlug, classified);

  const roles = classified.roles.map((r) => {
    if (!taskId && r.role === 'new') {
      return { ...r, role: 'unrelated', blocked: false };
    }
    if (!taskId) return { ...r, blocked: false };
    if (r.role === 'new' && !relatedFrom) return { ...r, blocked: true };
    if (r.role === 'new' && relatedFrom) return { ...r, blocked: false };
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
  const reportPath = path.join(
    projectDataDir(projectSlug),
    'reports',
    reportName,
  );

  const gapLines = (gen.gapApis || [])
    .slice(0, 40)
    .map((g) => `- \`${g.id}\`: ${g.gaps.join(', ')}`);

  const md = [
    '# mock-skill init report',
    '',
    `- projectDir: \`${projectDir}\``,
    `- projectSlug: \`${projectSlug}\``,
    `- taskId: \`${taskId || 'adhoc'}\``,
    `- discovered: ${apiList.length}`,
    `- generated: ${gen.generated}`,
    `- reused: ${gen.reused}`,
    `- skipped: ${gen.skipped}`,
    `- blocked: ${gen.blocked.length}`,
    `- removedGatewayOnly: ${gen.removedGateway || 0}`,
    `- usageBackedCount: ${gen.usageBackedCount || 0}`,
    `- emptyDataCount: ${gen.emptyDataCount || 0}`,
    `- enumBackedCount: ${gen.enumBackedCount || 0}`,
    `- gatewayFilteredRoles: ${gen.gatewayFilteredRoles || 0}`,
    '',
    '## Coverage note',
    '',
    '静态分析不保证零遗漏。`gapApis` 列出缺口；请跑 `session` 走主路径并用 `capture-merge` 回灌。',
    '',
    '## Roles summary',
    '',
    ...['new', 'modify', 'dependency', 'unrelated'].map((role) => {
      const n = roles.filter((r) => r.role === role).length;
      return `- ${role}: ${n}`;
    }),
    '',
    gapLines.length
      ? `## gapApis (sample)\n\n${gapLines.join('\n')}\n`
      : '',
    '## Next',
    '',
    '```bash',
    `mock-skill session start --name=${projectSlug}${taskId ? ` --task=${taskId}` : ''}`,
    '# after browsing main flows:',
    `mock-skill capture-merge --name=${projectSlug}`,
    '```',
    '',
  ].join('\n');

  fs.writeFileSync(reportPath, md);
  fs.writeFileSync(
    path.join(projectDataDir(projectSlug), 'reports', 'coverage-summary.json'),
    `${JSON.stringify(
      {
        discovered: apiList.length,
        usageBackedCount: gen.usageBackedCount,
        emptyDataCount: gen.emptyDataCount,
        enumBackedCount: gen.enumBackedCount,
        gapApis: gen.gapApis,
        removedGateway: gen.removedGateway,
      },
      null,
      2,
    )}\n`,
  );

  appendAudit(projectSlug, {
    command: 'init',
    taskId,
    summary: `discovered=${apiList.length} generated=${gen.generated} usageBacked=${gen.usageBackedCount} empty=${gen.emptyDataCount}`,
    reportPath,
  });

  console.log(`[mock-skill] report: ${reportPath}`);
  console.log(
    `[mock-skill] done generated=${gen.generated} usageBacked=${gen.usageBackedCount} emptyData=${gen.emptyDataCount} gaps=${(gen.gapApis || []).length}`,
  );

  return {
    projectSlug,
    projectDir,
    apis: apiList,
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
