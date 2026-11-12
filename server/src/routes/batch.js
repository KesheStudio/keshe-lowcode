import { createSiteAdapter } from '../../../src/storage/index.js';
import { normalizeRelPath } from '../../../src/storage/path-safety.js';
import { RevConflictError } from '../../../src/storage/errors.js';

/**
 * 批量事务写：
 * POST /api/sites/:id/batch
 * body: { expectedRev?, ops: [ { type: "write", path, content } | { type: "delete", path } ] }
 * 返回: { ok, data: { rev, applied } }
 */
export function registerBatchRoutes(app, ctx) {
  app.post('/api/sites/:id/batch', async (request, reply) => {
    const body = request.body || {};
    const ops = Array.isArray(body.ops) ? body.ops : null;
    if (!ops || !ops.length) {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: 'ops 必须是非空数组' } });
    }

    const adapter = createSiteAdapter(ctx.paths.dataDir, request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    if (body.expectedRev != null) {
      const current = await adapter.rev();
      if (Number(body.expectedRev) !== current) throw new RevConflictError(body.expectedRev, current);
    }

    let applied = 0;
    await adapter.transaction(request.params.id, async (tx) => {
      for (const op of ops) {
        if (!op || typeof op.path !== 'string') {
          const error = new Error('每个 op 必须包含 path');
          error.statusCode = 400;
          throw error;
        }
        const target = normalizeRelPath(op.path);
        if (op.type === 'write') {
          if (typeof op.content !== 'string') {
            const error = new Error(`op(${op.path}) 缺少 content`);
            error.statusCode = 400;
            throw error;
          }
          await tx.write(target, op.content);
        } else if (op.type === 'delete') {
          await tx.delete(target);
        } else {
          const error = new Error(`不支持的 op.type：${op.type}`);
          error.statusCode = 400;
          throw error;
        }
        applied += 1;
      }
    });

    return { ok: true, data: { rev: await adapter.rev(), applied } };
  });
}
