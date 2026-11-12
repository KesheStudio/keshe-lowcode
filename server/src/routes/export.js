import { randomUUID } from 'node:crypto';
import { exportSite, listBuilds, readBuildArtifact, readBuildRecord } from '../export/pipeline.js';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';

const BACKENDS = new Set(['none', 'rust', 'node', 'go']);
const TARGETS = new Set(['web-static', 'tauri-desktop']);
const JOB_TTL_MS = 30 * 60 * 1000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeBackend(input) {
  if (!input || typeof input !== 'object') return null;
  const language = String(input.language || '');
  if (!BACKENDS.has(language)) throw fail('LC_E_EXPORT_BACKEND', '后端语言只支持 rust / node / go');
  return { ...input, language };
}

function summarize(result, siteId) {
  return {
    buildId: result.buildId,
    artifactId: result.artifactId,
    status: result.status,
    bytes: result.record && result.record.artifact ? result.record.artifact.bytes : 0,
    sha256: result.record && result.record.artifact ? result.record.artifact.sha256 : '',
    checks: result.checks || [],
    warnings: result.warnings || [],
    failures: result.failures || [],
    pageErrors: result.pageErrors || [],
    estimate: result.estimate || null,
    cleanup: result.cleanup || null,
    downloadUrl: '/api/sites/' + encodeURIComponent(siteId) + '/builds/' +
      encodeURIComponent(result.buildId) + '/artifact.zip',
    recordUrl: '/api/sites/' + encodeURIComponent(siteId) + '/builds/' +
      encodeURIComponent(result.buildId)
  };
}

function exportError(reply, error) {
  const status = Number(error && error.statusCode) || 422;
  return reply.code(status).send({
    ok: false,
    error: {
      code: (error && error.code) || 'LC_E_EXPORT_FAILED',
      message: (error && error.message) || '导出失败'
    }
  });
}

function exportOptions(ctx, siteId, body) {
  return {
    platformRoot: ctx.platformRoot,
    paths: ctx.paths,
    siteId,
    target: body.target || 'web-static',
    scope: body.scope,
    /* 单次导出允许覆盖站点公开地址；不传则沿用 PUT /export/config 保存的值。 */
    web: body.web,
    minify: body.minify,
    snapshotSources: body.snapshotSources !== false,
    /* 集合数据默认随包导出；显式传 false 才只带集合定义。 */
    includeData: body.includeData !== false,
    backend: normalizeBackend(body.backend),
    desktop: body.desktop,
    version: body.version,
    platform: { name: ctx.config.platform.name, version: ctx.version }
  };
}

/**
 * 导出与构建记录接口（带 token）：
 * POST /api/sites/:siteId/export                 同步导出（兼容 CLI/测试）
 * POST /api/sites/:siteId/export/estimate        导出前体积预估（不写构建记录）
 * POST /api/sites/:siteId/export/jobs            创建导出任务，返回 jobId
 * GET  /api/sites/:siteId/export/jobs/:jobId     查询进度与结果
 * GET  /api/sites/:siteId/builds
 * GET  /api/sites/:siteId/builds/:buildId        构建记录
 * GET  /api/sites/:siteId/builds/:buildId/artifact.zip
 *
 * 导出产物只落在站点 builds/ 下；接口不返回绝对路径与密钥。
 */
export function registerExportRoutes(app, ctx) {
  const jobs = new Map();

  function sweepJobs() {
    const now = Date.now();
    for (const [jobId, job] of jobs) {
      if (now - job.createdAt > JOB_TTL_MS) jobs.delete(jobId);
    }
  }

  app.post('/api/sites/:siteId/export', async (request, reply) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const body = request.body || {};
    let result;
    try {
      result = await exportSite(exportOptions(ctx, siteId, body));
    } catch (error) {
      return exportError(reply, error);
    }
    if (!result.ok) {
      return reply.code(422).send({
        ok: false,
        error: {
          code: 'LC_E_EXPORT_CHECKS',
          message: '导出前置校验未通过，产物没有生成',
          detail: result.failures
        },
        data: {
          buildId: result.buildId,
          checks: result.checks,
          warnings: result.warnings,
          pageErrors: result.pageErrors || [],
          estimate: result.estimate || null
        }
      });
    }
    return { ok: true, data: summarize(result, siteId) };
  });

  app.post('/api/sites/:siteId/export/estimate', async (request, reply) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const body = request.body || {};
    if (!TARGETS.has(String(body.target || 'web-static'))) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'LC_E_EXPORT_TARGET', message: '导出目标只支持 Web 静态或 Tauri 桌面' }
      });
    }
    let result;
    try {
      result = await exportSite({ ...exportOptions(ctx, siteId, body), dryRun: true });
    } catch (error) {
      return exportError(reply, error);
    }
    return {
      ok: true,
      data: {
        canExport: result.ok,
        estimate: result.estimate,
        checks: result.checks,
        warnings: result.warnings,
        failures: result.failures,
        pageErrors: result.pageErrors
      }
    };
  });

  app.post('/api/sites/:siteId/export/jobs', async (request, reply) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const body = request.body || {};
    if (!TARGETS.has(String(body.target || 'web-static'))) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'LC_E_EXPORT_TARGET', message: '导出目标只支持 Web 静态或 Tauri 桌面' }
      });
    }
    sweepJobs();
    let options;
    try {
      options = exportOptions(ctx, siteId, body);
    } catch (error) {
      return exportError(reply, error);
    }
    const jobId = randomUUID();
    const job = {
      jobId,
      siteId,
      status: 'running',
      stage: 'queued',
      percent: 0,
      message: '准备导出',
      createdAt: Date.now(),
      startedAt: new Date().toISOString(),
      finishedAt: '',
      result: null,
      error: null
    };
    jobs.set(jobId, job);

    exportSite({
      ...options,
      onProgress: (progress) => {
        if (job.status !== 'running') return;
        job.stage = progress.stage || job.stage;
        job.percent = Number(progress.percent) || 0;
        job.message = progress.message || job.message;
      }
    }).then((result) => {
      job.finishedAt = new Date().toISOString();
      job.result = summarize(result, siteId);
      if (!result.ok) {
        job.status = 'failed';
        job.error = {
          code: 'LC_E_EXPORT_CHECKS',
          message: '导出前置校验未通过，产物没有生成',
          detail: result.failures || []
        };
        return;
      }
      job.status = 'done';
      job.stage = 'done';
      job.percent = 100;
      job.message = '构建完成';
    }).catch((error) => {
      job.finishedAt = new Date().toISOString();
      job.status = 'failed';
      job.stage = 'failed';
      job.error = { code: error.code || 'LC_E_EXPORT_FAILED', message: error.message };
    });

    return reply.code(202).send({
      ok: true,
      data: { jobId, status: job.status, stage: job.stage, percent: job.percent, message: job.message }
    });
  });

  app.get('/api/sites/:siteId/export/jobs/:jobId', async (request, reply) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const job = jobs.get(String(request.params.jobId || ''));
    if (!job || job.siteId !== siteId) {
      return reply.code(404).send({
        ok: false,
        error: { code: 'LC_E_EXPORT_JOB_NOT_FOUND', message: '导出任务不存在或已过期' }
      });
    }
    return {
      ok: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        stage: job.stage,
        percent: job.percent,
        message: job.message,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        result: job.result,
        error: job.error
      }
    };
  });

  app.get('/api/sites/:siteId/builds', async (request) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const builds = await listBuilds(ctx.paths, siteId);
    return { ok: true, data: { builds } };
  });

  app.get('/api/sites/:siteId/builds/:buildId', async (request, reply) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const record = await readBuildRecord(ctx.paths, siteId, request.params.buildId);
    if (!record) {
      return reply.code(404).send({
        ok: false,
        error: { code: 'LC_E_BUILD_NOT_FOUND', message: '构建记录不存在' }
      });
    }
    return { ok: true, data: { record } };
  });

  app.get('/api/sites/:siteId/builds/:buildId/artifact.zip', async (request, reply) => {
    const siteId = sanitizeSiteId(request.params.siteId);
    const artifact = await readBuildArtifact(ctx.paths, siteId, request.params.buildId);
    if (!artifact) {
      return reply.code(404).send({
        ok: false,
        error: { code: 'LC_E_BUILD_NOT_FOUND', message: '构建产物不存在' }
      });
    }
    return reply
      .type('application/zip')
      .header('Content-Disposition', 'attachment; filename="' + artifact.name + '"')
      .send(artifact.body);
  });
}
