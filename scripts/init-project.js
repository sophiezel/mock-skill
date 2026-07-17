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
const { copyBuiltinScenarios } = require('../lib/scenario');

async function initProject(opts = {}) {
  const projectDir = path.resolve(opts.projectDir || process.cwd());
  const taskId = opts.taskId || null;
  const force = Boolean(opts.force);
  const overwriteCapture = Boolean(opts.overwriteCapture);
  const strictUsage = Boolean(opts.strictUsage);
  const relatedFrom = opts.relatedFrom || null;
  const nameOverride = opts.name || null;

  if (!fs.existsSync(projectDir)) {
    throw new Error(`projectDir not found: ${projectDir}`);
  }

  const projectSlug = resolveProjectSlug(projectDir, nameOverride);
  ensureProjectDirs(projectSlug);
  const copiedScenarios = copyBuiltinScenarios(projectSlug);

  console.log(`[mock-skill] init projectDir=${projectDir}`);
  console.log(`[mock-skill] projectSlug=${projectSlug} taskId=${taskId || 'adhoc'}`);

  const apis = inferApiUsage(projectDir, {
    withUsageIo: true,
    adapter: opts.adapter || null,
    forceRefresh: Boolean(opts.force),
  });
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
      exportKey: a.exportKey,
      confidence: a.confidence || r.confidence,
    };
  });

  writeClassifyResult(projectSlug, classified);

  const roles = classified.roles.map((r) => {
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
    overwriteCapture,
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
    `- usageBackedHints: ${gen.usageBackedHints || 0}`,
    `- emptyDataHints: ${gen.emptyDataHints || 0}`,
    `- skippedEmptyCount: ${gen.skippedEmptyCount || 0}`,
    `- prunedHandlers: ${gen.prunedHandlers || 0}`,
    `- prunedContracts: ${gen.prunedContracts || 0}`,
    `- enumBackedCount: ${gen.enumBackedCount || 0}`,
    `- TRACE_EMPTY: ${gen.traceEmptyCount || 0}`,
    `- bind_ambiguous: ${gen.bindAmbiguousCount || 0}`,
    `- capturePreserved: ${gen.capturePreservedCount || 0}`,
    `- gatewayFilteredRoles: ${gen.gatewayFilteredRoles || 0}`,
    '',
    '## Coverage note',
    '',
    '- **emptyData**：`success.data` 无字段（静态用法倒推未抽出 props）。含多环境 host 副本，数字会被放大。',
    '- **usageBackedHints / emptyDataHints**：按 `exportHint` 去重后的接口函数数，更接近「有多少 service 导出没抽到字段」。',
    '- **gaps**：静态分析声明的缺口（如 `no_export_symbol` / `no_callsite` / `TRACE_EMPTY` / `bind_ambiguous`）。',
    '- **TRACE_EMPTY**：有调用点但响应 shape 仍空——分层 trace 失败，不是「生成成功」。',
    '- **skippedEmpty**：`response.source===empty` 且 gaps 含 `no_export_symbol` → 只写 contract、不渲空 handler、不进 proxy-rules。',
    '- **prunedHandlers / prunedContracts**：`--force` 时删除不在本轮白名单且无 `mock-skill:manual` 的孤儿产物；**默认不擦除** `usage+capture` 真值。',
    '- **capture-merge**：显式命令，写入真实响应并以 capture 数据为准（`response.source=usage+capture`）。不是补洞/自动兜底。',
    '- **覆盖矩阵**：普通 `init`/`generate` 保留已有 capture；仅 `--overwrite-capture` 允许 usage/jsf 盖掉 capture；裸 `--force` 不擦 capture。',
    '- 噪音过滤：跳过 `e2e/`、`*.spec.*`、`src/mock/`；pathLiteral 需 request 上下文。',
    '- 项目差异：`<project>/.mock-skill/infer.json` 可覆盖 pathAliases / httpWrappers（合并 `config/default.infer.json`）。',
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
        usageBackedHints: gen.usageBackedHints,
        emptyDataHints: gen.emptyDataHints,
        skippedEmptyCount: gen.skippedEmptyCount,
        prunedHandlers: gen.prunedHandlers || 0,
        prunedContracts: gen.prunedContracts || 0,
        enumBackedCount: gen.enumBackedCount,
        traceEmptyCount: gen.traceEmptyCount || 0,
        bindAmbiguousCount: gen.bindAmbiguousCount || 0,
        capturePreservedCount: gen.capturePreservedCount || 0,
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
    summary: `discovered=${apiList.length} generated=${gen.generated} usageBacked=${gen.usageBackedCount} empty=${gen.emptyDataCount} TRACE_EMPTY=${gen.traceEmptyCount || 0} capturePreserved=${gen.capturePreservedCount || 0}`,
    reportPath,
  });

  console.log(`[mock-skill] report: ${reportPath}`);
  if (copiedScenarios.length) {
    console.log(`[mock-skill] scenarios copied: ${copiedScenarios.map((f) => f.replace(/\.json$/, '')).join(', ')}`);
  }
  console.log(
    `[mock-skill] done generated=${gen.generated} usageBacked=${gen.usageBackedCount} emptyData=${gen.emptyDataCount} usageBackedHints=${gen.usageBackedHints || 0} emptyDataHints=${gen.emptyDataHints || 0} TRACE_EMPTY=${gen.traceEmptyCount || 0} capturePreserved=${gen.capturePreservedCount || 0} skippedEmpty=${gen.skippedEmptyCount || 0} prunedHandlers=${gen.prunedHandlers || 0} prunedContracts=${gen.prunedContracts || 0} gaps=${(gen.gapApis || []).length}`,
  );

  if (strictUsage && (gen.traceEmptyCount || 0) > 0) {
    const err = new Error(
      `strict-usage: TRACE_EMPTY=${gen.traceEmptyCount} (callsite with empty response shape)`,
    );
    err.code = 'STRICT_USAGE';
    throw err;
  }

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
