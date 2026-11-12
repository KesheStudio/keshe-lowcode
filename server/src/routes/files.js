import { createSiteAdapter } from '../../../src/storage/index.js';
import path from 'node:path';
import { normalizeRelPath } from '../../../src/storage/path-safety.js';
import { createBackup } from '../../../src/storage/backups.js';

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.mp4']);

function isBinary(relPath) {
  const lower = relPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && BINARY_EXT.has(lower.slice(dot));
}

function adapterFor(ctx, siteId) {
  return createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
}

/**
 * 单文件接口：
 * GET    /api/sites/:id/file?path=&encoding=base64|utf8
 * PUT    /api/sites/:id/file?path=      body { content, contentBase64?, expectedRev? }
 * DELETE /api/sites/:id/file?path=      先写 backups/<timestamp>/ 再删
 */
export function registerFileRoutes(app, ctx) {
  app.get('/api/sites/:id/file', async (request) => {
    const rawPath = request.query && request.query.path;
    if (!rawPath) {
      const error = new Error('缺少 path 参数');
      error.statusCode = 400;
      throw error;
    }
    const relPath = normalizeRelPath(rawPath);
    const adapter = adapterFor(ctx, request.params.id);
    const encoding = (request.query && request.query.encoding) || (isBinary(relPath) ? 'base64' : 'utf8');
    const content = await adapter.read(relPath, { encoding: encoding === 'base64' ? 'buffer' : 'utf8' });
    const [stat, rev] = await Promise.all([adapter.stat(relPath), adapter.rev()]);
    return {
      ok: true,
      data: {
        path: relPath,
        rev,
        hash: stat.hash,
        size: stat.size,
        encoding: encoding === 'base64' ? 'base64' : 'utf8',
        content: encoding === 'base64' ? Buffer.from(content).toString('base64') : content
      }
    };
  });

  app.put('/api/sites/:id/file', async (request) => {
    const body = request.body || {};
    if (!request.query || !request.query.path) {
      const error = new Error('缺少 path 参数');
      error.statusCode = 400;
      throw error;
    }
    if (body.contentBase64 != null) {
      const target = normalizeRelPath(request.query.path);
      const adapter = adapterFor(ctx, request.params.id);
      const result = await adapter.write(target, Buffer.from(String(body.contentBase64), 'base64'), {
        expectedRev: body.expectedRev
      });
      return { ok: true, data: result };
    }
    if (typeof body.content !== 'string') {
      const error = new Error('body.content 必须是字符串');
      error.statusCode = 400;
      throw error;
    }
    const target = normalizeRelPath(request.query.path);
    const adapter = adapterFor(ctx, request.params.id);
    const result = await adapter.write(target, body.content, { expectedRev: body.expectedRev, atomic: body.atomic !== false });
    return { ok: true, data: result };
  });

  app.delete('/api/sites/:id/file', async (request, reply) => {
    if (!request.query || !request.query.path) {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: '缺少 path 参数' } });
    }
    const relPath = normalizeRelPath(request.query.path);
    const adapter = adapterFor(ctx, request.params.id);
    const stat = await adapter.stat(relPath);
    if (!stat.exists) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `文件不存在：${relPath}` } });
    }
    let backupPaths = [relPath];
    if (request.query.recursive) {
      const entries = await adapter.list(relPath, { recursive: true });
      backupPaths = entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path);
    }
    const backup = await createBackup(adapter.siteDir, {
      siteId: adapter.siteId,
      reason: 'delete',
      paths: backupPaths
    });
    await adapter.delete(relPath, { recursive: Boolean(request.query.recursive), note: 'delete' });
    return {
      ok: true,
      data: {
        path: relPath,
        backup: path.relative(adapter.siteDir, backup.dir).split(path.sep).join('/'),
        files: backup.manifest.files.length,
        rev: await adapter.rev()
      }
    };
  });
}
