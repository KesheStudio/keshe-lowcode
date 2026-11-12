import { listSites } from '../sites.js';
import { CONTRACTS_VERSION } from '../config.js';

/**
 * 运行状态接口（带 token）：
 * GET /api/runtime → { ok, data: { status, platform, node, port, readOnly, sites, ... } }
 * 只暴露相对路径，不返回绝对路径或密钥。
 */
export function registerRuntimeRoutes(app, ctx) {
  app.get('/api/health', async () => ({
    ok: true,
    data: {
      status: ctx.runtime.readOnly ? 'readonly' : 'running',
      readOnly: ctx.runtime.readOnly,
      reason: ctx.runtime.readOnly ? ctx.runtime.readOnlyReason : '',
      bootError: ctx.bootError || null,
      startedAt: ctx.startedAt
    }
  }));

  app.get('/api/runtime', async () => {
    const sites = await listSites(ctx.paths);
    return {
      ok: true,
      data: {
        status: ctx.runtime.readOnly ? 'readonly' : 'running',
        platform: { name: ctx.config.platform.name, version: ctx.version },
        contractsVersion: CONTRACTS_VERSION,
        node: process.versions.node,
        host: ctx.config.platform.host,
        port: ctx.port,
        readOnly: ctx.runtime.readOnly,
        readOnlyReason: ctx.runtime.readOnlyReason,
        paths: {
          dataDir: ctx.config.paths.dataDir,
          exportsDir: ctx.config.paths.exportsDir,
          logsDir: ctx.config.paths.logsDir
        },
        sites: sites.length,
        siteList: sites,
        draftCache: { enabled: Boolean(ctx.config.draftCache.enabled) },
        uptimeMs: Date.now() - new Date(ctx.startedAt).getTime(),
        warnings: ctx.configWarnings || []
      }
    };
  });
}
