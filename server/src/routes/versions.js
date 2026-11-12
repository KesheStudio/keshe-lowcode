import path from 'node:path';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { VersionStore } from '../../../src/storage/versions.js';
import { createBackup } from '../../../src/storage/backups.js';
import { RevConflictError } from '../../../src/storage/errors.js';
import { normalizeRelPath } from '../../../src/storage/path-safety.js';

/**
 * 版本历史（CONTRACTS 4.5 / 16）：
 * GET  /api/sites/:id/versions                 → { entries }
 * GET  /api/sites/:id/versions/:rev            → 单版本详情（含文件内容）
 * POST /api/sites/:id/versions/:rev/restore    body { expectedRev? }
 *      → 先备份当前文件，再事务恢复该版本涉及的变更文件；不做整站回滚。
 */
export function registerVersionRoutes(app, ctx) {
  app.get('/api/sites/:id/versions', async (request) => {
    const adapter = createSiteAdapter(ctx.paths.dataDir, request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    const store = new VersionStore(adapter.siteDir);
    return { ok: true, data: { entries: await store.list() } };
  });

  app.get('/api/sites/:id/versions/:rev', async (request, reply) => {
    const adapter = createSiteAdapter(ctx.paths.dataDir, request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    const store = new VersionStore(adapter.siteDir);
    const entry = await store.get(request.params.rev);
    if (!entry) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `版本不存在：${request.params.rev}` } });
    }
    return { ok: true, data: entry };
  });

  app.post('/api/sites/:id/versions/:rev/restore', async (request, reply) => {
    const adapter = createSiteAdapter(ctx.paths.dataDir, request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    const store = new VersionStore(adapter.siteDir);
    const body = request.body || {};

    const current = await adapter.rev();
    if (body.expectedRev != null && Number(body.expectedRev) !== current) {
      throw new RevConflictError(body.expectedRev, current);
    }

    const entry = await store.get(request.params.rev);
    if (!entry) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `版本不存在：${request.params.rev}` } });
    }
    const files = entry.files || [];
    if (!files.length) {
      return { ok: true, data: { rev: current, restored: 0, skipped: 0, note: '该版本没有变更文件' } };
    }

    const backup = await createBackup(adapter.siteDir, {
      siteId: adapter.siteId,
      reason: `restore-${entry.rev}`,
      paths: files.map((file) => file.path)
    });

    let restored = 0;
    await adapter.transaction(adapter.siteId, async (tx) => {
      for (const file of files) {
        const relPath = normalizeRelPath(file.path);
        if (file.encoding === 'deleted') {
          await tx.delete(relPath);
        } else if (file.encoding === 'base64') {
          await tx.write(relPath, Buffer.from(String(file.content || ''), 'base64'));
        } else {
          await tx.write(relPath, String(file.content ?? ''));
        }
        restored += 1;
      }
    });

    return {
      ok: true,
      data: {
        rev: await adapter.rev(),
        restored,
        backup: path.relative(adapter.siteDir, backup.dir).split(path.sep).join('/')
      }
    };
  });
}
