import fs from 'node:fs/promises';
import path from 'node:path';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { createBackup } from '../../../src/storage/backups.js';
import { writeFileAtomic } from '../../../src/storage/atomic.js';
import { slugify, createSite, listSites, readSite, siteTree, uniqueSiteId } from '../sites.js';

/**
 * 站点接口：
 * GET    /api/sites
 * POST   /api/sites         body { name, siteId?, type?: 'static'|'backend', backendLanguage?: 'rust'|'node'|'go' }
 * GET    /api/sites/:id
 * PATCH  /api/sites/:id     body { name?, slug? }
 * DELETE /api/sites/:id     移入 <data>/.trash/，不直接删除
 * GET    /api/sites/trash            回收站列表（含同名站点冲突信息）
 * POST   /api/sites/trash/:trashId/restore  恢复；同名时需 mode=rename|overwrite
 * GET    /api/sites/:id/tree
 * POST   /api/sites/:id/backup
 * GET    /api/sites/:id/usage
 */
export function registerSiteRoutes(app, ctx) {
  app.get('/api/sites', async () => ({ ok: true, data: await listSites(ctx.paths) }));

  app.post('/api/sites', async (request, reply) => {
    const body = request.body || {};
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: '站点名称不能为空', field: 'name' } });
    }
    const type = body.type === 'backend' ? 'backend' : 'static';
    const backendLanguage = type === 'backend' ? String(body.backendLanguage || 'rust') : 'none';
    if (type === 'backend' && !['rust', 'node', 'go'].includes(backendLanguage)) {
      return reply.code(422).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: '后端语言只支持 rust / node / go', field: 'backendLanguage' } });
    }
    const created = await createSite(ctx.paths, { name: body.name, siteId: body.siteId, type, backendLanguage });
    return reply.code(201).send({
      ok: true,
      data: {
        siteId: created.siteId,
        name: created.name,
        type: created.type,
        backendLanguage: created.backendLanguage,
        path: `sites/${created.siteId}`
      }
    });
  });

  /* 回收站：静态路径必须注册在 /api/sites/:id 之前，避免被当成站点 id。 */
  app.get('/api/sites/trash', async () => ({ ok: true, data: { items: await listTrash(ctx.paths) } }));

  app.post('/api/sites/trash/:trashId/restore', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    try {
      return { ok: true, data: await restoreTrash(ctx.paths, request.params.trashId, body) };
    } catch (error) {
      const status = Number(error.statusCode) || (error.code === 'LC_E_PATH_UNSAFE' ? 400 : 500);
      return reply.code(status).send({
        ok: false,
        error: { code: error.code || 'LC_E_SITE_RESTORE', message: error.message, detail: error.detail }
      });
    }
  });

  app.get('/api/sites/:id', async (request) => {
    const detail = await readSite(ctx.paths, request.params.id);
    return { ok: true, data: detail };
  });

  app.patch('/api/sites/:id', async (request, reply) => {
    const body = request.body || {};
    const loaded = await readSite(ctx.paths, request.params.id);
    const nextName = body.name != null ? String(body.name).trim() : loaded.site.name;
    if (!nextName) {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: '站点名称不能为空', field: 'name' } });
    }
    const nextSlug = body.slug != null ? String(body.slug).trim() : loaded.site.slug;
    if (nextSlug && !/^[a-z0-9-]{1,40}$/.test(nextSlug)) {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: 'slug 只能包含小写字母、数字和连字符', field: 'slug' } });
    }
    if (loaded.site.status === 'needs-repair') {
      return reply.code(409).send({ ok: false, error: { code: 'LC_E_SITE_NEEDS_REPAIR', message: '站点需要修复，暂时不能修改元信息' } });
    }

    const adapter = createSiteAdapter(ctx.paths.dataDir, loaded.site.siteId || request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    const now = new Date().toISOString();
    const siteMeta = { ...loaded.site, name: nextName, slug: nextSlug || slugify(nextName), updatedAt: now };
    const project = loaded.project && typeof loaded.project === 'object' ? { ...loaded.project } : null;
    if (project) {
      project.site = { ...(project.site || {}), name: nextName };
    }

    await adapter.transaction(adapter.siteId, async (tx) => {
      await tx.write('site.json', JSON.stringify(siteMeta, null, 2));
      if (project) await tx.write('project.json', JSON.stringify(project, null, 2));
    });

    return {
      ok: true,
      data: { siteId: adapter.siteId, name: nextName, slug: siteMeta.slug, updatedAt: now, rev: await adapter.rev() }
    };
  });

  app.delete('/api/sites/:id', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    const siteId = loaded.site.siteId || request.params.id;
    const trashDir = path.join(ctx.paths.dataDir, '.trash');
    await fs.mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashId = `${siteId}-${stamp}`;
    const target = path.join(trashDir, trashId);
    await fs.rename(loaded.siteDir, target);
    return {
      ok: true,
      data: {
        siteId,
        trashed: true,
        trashId,
        trashPath: path.relative(ctx.paths.dataDir, target).split(path.sep).join('/'),
        note: '站点已移入回收站，可在首页恢复'
      }
    };
  });

  app.get('/api/sites/:id/tree', async (request) => {
    return { ok: true, data: await siteTree(ctx.paths, request.params.id) };
  });

  app.post('/api/sites/:id/backup', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    const siteId = loaded.site.siteId || request.params.id;
    const sourceFiles = (await walkFiles(loaded.siteDir))
      .filter((rel) => classify(rel) === 'source')
      .filter((rel) => rel !== '.gitignore');
    const backup = await createBackup(loaded.siteDir, {
      siteId,
      reason: (request.body && request.body.reason) || 'manual',
      paths: sourceFiles
    });
    return {
      ok: true,
      data: {
        siteId,
        backup: path.relative(loaded.siteDir, backup.dir).split(path.sep).join('/'),
        files: backup.manifest.files.length,
        bytes: backup.manifest.bytes
      }
    };
  });

  app.get('/api/sites/:id/usage', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.id);
    const files = await walkFiles(loaded.siteDir);
    const usage = { source: 0, builds: 0, versions: 0, backups: 0, cache: 0, total: 0 };
    for (const rel of files) {
      const size = await fs.stat(path.join(loaded.siteDir, rel)).then((stat) => stat.size).catch(() => 0);
      usage[classify(rel)] += size;
      usage.total += size;
    }
    return {
      ok: true,
      data: {
        siteId: loaded.site.siteId || request.params.id,
        categories: { source: usage.source, builds: usage.builds, versions: usage.versions, backups: usage.backups, cache: usage.cache },
        total: usage.total
      }
    };
  });
}

/* ----------------------------- 站点回收站 ----------------------------- */

const TRASH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function trashDirOf(paths, trashId) {
  const name = String(trashId || '');
  if (!TRASH_ID_RE.test(name) || name.includes('..')) {
    const error = new Error('回收站条目名称非法');
    error.statusCode = 400;
    error.code = 'LC_E_TRASH_ID';
    throw error;
  }
  const dir = path.join(paths.dataDir, '.trash', name);
  const root = path.resolve(paths.dataDir, '.trash');
  if (!path.resolve(dir).startsWith(root + path.sep)) {
    const error = new Error('回收站条目名称非法');
    error.statusCode = 400;
    error.code = 'LC_E_TRASH_ID';
    throw error;
  }
  return { name, dir };
}

function siteIdFromTrashName(name) {
  return String(name || '').replace(/-\d{4}-\d{2}-\d{2}T[0-9A-Za-z-]+Z(?:-replaced)?$/, '');
}

async function readTrashMeta(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'site.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function describeTrashEntry(paths, name) {
  const { dir } = trashDirOf(paths, name);
  const info = await fs.stat(dir).catch(() => null);
  if (!info || !info.isDirectory()) return null;
  const meta = await readTrashMeta(dir);
  const fallbackId = siteIdFromTrashName(name);
  const siteId = String((meta && meta.siteId) || fallbackId || name);
  const pages = await fs.readdir(path.join(dir, 'pages')).catch(() => []);
  const project = await fs.readFile(path.join(dir, 'project.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
  const backendLanguage = String((project && project.export && project.export.backend && project.export.backend.language) || 'none');
  const existingMeta = await fs.readFile(path.join(paths.dataDir, 'sites', siteId, 'site.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
  const existing = await fs.stat(path.join(paths.dataDir, 'sites', siteId)).then((stat) => stat.isDirectory()).catch(() => false);
  return {
    trashId: name,
    siteId,
    name: String((meta && meta.name) || siteId),
    type: backendLanguage === 'none' ? 'static' : 'backend',
    backendLanguage,
    pageCount: pages.filter((file) => file.endsWith('.json')).length,
    deletedAt: info.mtime.toISOString(),
    conflict: existing
      ? { siteId, name: String((existingMeta && existingMeta.name) || siteId) }
      : null
  };
}

async function listTrash(paths) {
  const trashRoot = path.join(paths.dataDir, '.trash');
  const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const item = await describeTrashEntry(paths, entry.name).catch(() => null);
    if (item) items.push(item);
  }
  items.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return items;
}

async function restoreTrash(paths, trashId, body) {
  const { name, dir } = trashDirOf(paths, trashId);
  const info = await fs.stat(dir).catch(() => null);
  if (!info || !info.isDirectory()) {
    const error = new Error('回收站条目不存在：' + name);
    error.statusCode = 404;
    error.code = 'LC_E_TRASH_NOT_FOUND';
    throw error;
  }

  const meta = await readTrashMeta(dir);
  const fallback = siteIdFromTrashName(name);
  const preferredId = String((meta && meta.siteId) || fallback || '');
  let originalId;
  try {
    originalId = sanitizeSiteId(preferredId);
  } catch {
    originalId = slugify(preferredId || name);
  }

  const sitesRoot = path.join(paths.dataDir, 'sites');
  const targetDir = path.join(sitesRoot, originalId);
  const targetExists = await fs.stat(targetDir).then((stat) => stat.isDirectory()).catch(() => false);
  const mode = String(body.mode || '').toLowerCase();
  let targetId = originalId;
  let replacedTrashId = '';

  if (targetExists) {
    if (mode !== 'rename' && mode !== 'overwrite') {
      const error = new Error('同名站点已存在，请选择改名恢复或覆盖恢复');
      error.statusCode = 409;
      error.code = 'LC_E_SITE_EXISTS';
      error.detail = {
        siteId: originalId,
        name: String((meta && meta.name) || originalId),
        options: ['rename', 'overwrite'],
        conflict: await describeTrashEntry(paths, name).then((item) => item && item.conflict)
      };
      throw error;
    }
    if (mode === 'rename') {
      if (body.siteId != null && String(body.siteId).trim()) {
        targetId = sanitizeSiteId(String(body.siteId).trim());
        if (await fs.stat(path.join(sitesRoot, targetId)).then(() => true).catch(() => false)) {
          const error = new Error('目标站点 ID 已存在：' + targetId);
          error.statusCode = 409;
          error.code = 'LC_E_SITE_EXISTS';
          throw error;
        }
      } else {
        targetId = await uniqueSiteId(paths, originalId + '-restored');
      }
    }
  }

  await fs.mkdir(sitesRoot, { recursive: true });

  if (targetExists && mode === 'overwrite') {
    /* 覆盖不是静默删除：先把现有站点整体移入回收站，仍可再次恢复。 */
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    replacedTrashId = `${originalId}-${stamp}-replaced`;
    await fs.mkdir(path.join(paths.dataDir, '.trash'), { recursive: true });
    await fs.rename(targetDir, path.join(paths.dataDir, '.trash', replacedTrashId));
  }

  const restoredDir = path.join(sitesRoot, targetId);
  try {
    await fs.rename(dir, restoredDir);
  } catch (error) {
    if (replacedTrashId) {
      await fs.rename(path.join(paths.dataDir, '.trash', replacedTrashId), targetDir).catch(() => {});
    }
    throw error;
  }

  if (meta) {
    const nextMeta = { ...meta, siteId: targetId, updatedAt: new Date().toISOString() };
    if (targetId !== originalId) nextMeta.slug = slugify(targetId);
    else if (!nextMeta.slug) nextMeta.slug = slugify(nextMeta.name || targetId);
    await writeFileAtomic(path.join(restoredDir, 'site.json'), JSON.stringify(nextMeta, null, 2));
  }

  return {
    siteId: targetId,
    originalSiteId: originalId,
    name: String((meta && meta.name) || targetId),
    mode: targetExists ? mode : 'rename',
    restored: true,
    replacedTrashId: replacedTrashId || undefined
  };
}

/** 站点目录的相对文件清单；派生目录仍保留在清单里，由 classify 分类。 */
async function walkFiles(root, prefix = '') {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

/** 五类占用：源文件 / 构建 / 版本 / 备份 / 缓存。 */
function classify(rel) {
  const top = rel.split('/')[0];
  if (top === 'builds') return 'builds';
  if (top === 'versions') return 'versions';
  if (top === 'backups') return 'backups';
  if (top === '.lowcode') return 'cache';
  return 'source';
}
