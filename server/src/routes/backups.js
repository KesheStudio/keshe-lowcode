import fs from 'node:fs/promises';
import path from 'node:path';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { createBackup } from '../../../src/storage/backups.js';
import { hashOf, pathExists } from '../../../src/storage/atomic.js';
import { normalizeRelPath, resolveWithin } from '../../../src/storage/path-safety.js';
import { readSite } from '../sites.js';

const BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const UNSAFE_BACKUP_PREFIX = new Set(['.lowcode', 'backups']);

function fail(status, code, message, detail) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  error.detail = detail;
  return error;
}

function replyError(reply, error) {
  const status = Number(error.statusCode) || 500;
  return reply.code(status).send({
    ok: false,
    error: {
      code: error.code || 'LC_E_BACKUP',
      message: error.message,
      detail: error.detail,
      currentRev: error.currentRev
    }
  });
}

function expectedRevOf(request) {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const raw = body.expectedRev !== undefined && body.expectedRev !== null
    ? body.expectedRev
    : request.query && request.query.expectedRev;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const rev = Number(raw);
  if (!Number.isInteger(rev) || rev < 0) {
    throw fail(400, 'LC_E_DATA_VALIDATION', 'expectedRev 必须是非负整数');
  }
  return rev;
}

function backupDirOf(siteDir, name) {
  const raw = String(name || '');
  if (!BACKUP_NAME_RE.test(raw) || raw.includes('..')) {
    throw fail(400, 'LC_E_BACKUP_NAME', '备份名称非法');
  }
  return { name: raw, dir: resolveWithin(siteDir, `backups/${raw}`) };
}

function safeBackupPath(relPath) {
  let normalized;
  try {
    normalized = normalizeRelPath(relPath);
  } catch {
    throw fail(422, 'LC_E_BACKUP_INVALID', '备份清单包含非法路径：' + relPath);
  }
  const head = normalized.split('/')[0];
  if (UNSAFE_BACKUP_PREFIX.has(head)) {
    throw fail(422, 'LC_E_BACKUP_INVALID', '备份清单包含受保护路径：' + relPath);
  }
  return normalized;
}

async function readManifest(backupDir) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  } catch {
    throw fail(422, 'LC_E_BACKUP_INVALID', '备份清单不存在或不是合法 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
    throw fail(422, 'LC_E_BACKUP_INVALID', '备份清单结构不正确');
  }
  return {
    schemaVersion: parsed.schemaVersion || 1,
    siteId: String(parsed.siteId || ''),
    createdAt: String(parsed.createdAt || ''),
    reason: String(parsed.reason || 'manual'),
    bytes: Number(parsed.bytes) || 0,
    files: parsed.files.map((item) => ({
      path: safeBackupPath(item && item.path),
      hash: String((item && item.hash) || ''),
      bytes: Number((item && item.bytes)) || 0
    }))
  };
}

async function verifyBackupFiles(backupDir, manifest) {
  const problems = [];
  for (const file of manifest.files) {
    const source = resolveWithin(backupDir, `files/${file.path}`);
    try {
      const buffer = await fs.readFile(source);
      const hash = await hashOf(buffer);
      if (file.hash && hash !== file.hash) problems.push({ path: file.path, reason: 'hash-mismatch' });
      if (file.bytes && buffer.length !== file.bytes) problems.push({ path: file.path, reason: 'size-mismatch' });
    } catch {
      problems.push({ path: file.path, reason: 'missing' });
    }
  }
  return problems;
}

async function scopeOf(siteDir, manifest) {
  let overwrite = 0;
  let create = 0;
  let unchanged = 0;
  let changed = 0;
  const changedPaths = [];
  for (const file of manifest.files) {
    const target = resolveWithin(siteDir, file.path);
    const buffer = await fs.readFile(target).catch(() => null);
    if (buffer == null) {
      create += 1;
      continue;
    }
    overwrite += 1;
    if (file.hash && (await hashOf(buffer)) === file.hash) {
      unchanged += 1;
    } else {
      changed += 1;
      if (changedPaths.length < 20) changedPaths.push(file.path);
    }
  }
  return { total: manifest.files.length, overwrite, create, unchanged, changed, changedPaths };
}

async function listBackups(siteDir) {
  const root = path.join(siteDir, 'backups');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BACKUP_NAME_RE.test(entry.name)) continue;
    try {
      const manifest = await readManifest(path.join(root, entry.name));
      items.push({
        name: entry.name,
        createdAt: manifest.createdAt,
        reason: manifest.reason,
        fileCount: manifest.files.length,
        bytes: manifest.bytes
      });
    } catch (error) {
      items.push({
        name: entry.name,
        createdAt: '',
        reason: '损坏',
        fileCount: 0,
        bytes: 0,
        invalid: true
      });
    }
  }
  items.sort((a, b) => String(b.name).localeCompare(String(a.name)));
  return items;
}

async function applyRestore(adapter, backupDir, manifest, currentSiteId) {
  await adapter.transaction(adapter.siteId, async (tx) => {
    for (const file of manifest.files) {
      const source = resolveWithin(backupDir, `files/${file.path}`);
      const buffer = await fs.readFile(source);
      if (file.hash && (await hashOf(buffer)) !== file.hash) {
        throw fail(422, 'LC_E_BACKUP_CORRUPT', '备份文件校验失败：' + file.path);
      }
      let content = buffer;
      /* 备份里的 site.json 可能来自改名之前；站点 ID 必须与当前目录一致，否则路由会错位。 */
      if (file.path === 'site.json') {
        try {
          const meta = JSON.parse(buffer.toString('utf8'));
          if (meta && meta.siteId !== currentSiteId) {
            meta.siteId = currentSiteId;
            content = Buffer.from(JSON.stringify(meta, null, 2));
          }
        } catch {
          /* 由后续读取暴露损坏，恢复流程本身不额外拦截。 */
        }
      }
      await tx.write(file.path, content);
    }
  });
}

/**
 * 数据源 · 备份列表与恢复：
 * GET  /api/sites/:siteId/backups
 * GET  /api/sites/:siteId/backups/:name
 * POST /api/sites/:siteId/backups/:name/restore
 */
export function registerBackupRoutes(app, ctx) {
  app.get('/api/sites/:siteId/backups', async (request) => {
    const loaded = await readSite(ctx.paths, request.params.siteId);
    return { ok: true, data: { siteId: loaded.site.siteId, items: await listBackups(loaded.siteDir) } };
  });

  app.get('/api/sites/:siteId/backups/:name', async (request, reply) => {
    try {
      const loaded = await readSite(ctx.paths, request.params.siteId);
      const { name, dir } = backupDirOf(loaded.siteDir, request.params.name);
      const manifest = await readManifest(dir);
      const problems = await verifyBackupFiles(dir, manifest);
      const scope = await scopeOf(loaded.siteDir, manifest);
      return {
        ok: true,
        data: {
          name,
          createdAt: manifest.createdAt,
          reason: manifest.reason,
          bytes: manifest.bytes,
          fileCount: manifest.files.length,
          valid: problems.length === 0,
          problems: problems.slice(0, 20),
          scope
        }
      };
    } catch (error) {
      return replyError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/backups/:name/restore', async (request, reply) => {
    let safetyBackup = '';
    try {
      const loaded = await readSite(ctx.paths, request.params.siteId);
      const { name, dir } = backupDirOf(loaded.siteDir, request.params.name);
      const manifest = await readManifest(dir);
      const problems = await verifyBackupFiles(dir, manifest);
      if (problems.length) {
        throw fail(422, 'LC_E_BACKUP_CORRUPT', '备份文件不完整或已损坏，不能在当前状态上恢复', problems);
      }

      const adapter = createSiteAdapter(ctx.paths.dataDir, loaded.site.siteId, { lockStaleMs: ctx.paths.lockStaleMs });
      const expectedRev = expectedRevOf(request);
      if (expectedRev != null) {
        const current = await adapter.rev();
        if (Number(expectedRev) !== current) {
          throw fail(409, 'LC_E_REV_CONFLICT', `版本冲突：期望 rev ${expectedRev}，当前 rev ${current}`, {
            expected: expectedRev,
            current
          });
        }
      }

      /* 恢复前先把当前状态完整备份；这份安全备份不参与保留清理。 */
      const existingPaths = [];
      for (const file of manifest.files) {
        if (await pathExists(resolveWithin(loaded.siteDir, file.path))) existingPaths.push(file.path);
      }
      const safety = await createBackup(loaded.siteDir, {
        siteId: loaded.site.siteId,
        reason: `pre-restore-${name}`,
        paths: existingPaths,
        protect: [name]
      });
      safetyBackup = path.relative(loaded.siteDir, safety.dir).split(path.sep).join('/');

      try {
        await applyRestore(adapter, dir, manifest, loaded.site.siteId);
      } catch (error) {
        /* 写回失败时从安全备份退回；恢复前不存在的新文件要删掉。 */
        let rolledBack = false;
        let rollbackError = '';
        try {
          const preManifest = safety.manifest;
          const newlyCreated = manifest.files
            .map((file) => file.path)
            .filter((relPath) => !existingPaths.includes(relPath));
          await adapter.transaction(adapter.siteId, async (tx) => {
            for (const file of preManifest.files) {
              const source = resolveWithin(safety.dir, `files/${file.path}`);
              const buffer = await fs.readFile(source);
              await tx.write(file.path, buffer);
            }
            for (const relPath of newlyCreated) {
              if (await pathExists(resolveWithin(loaded.siteDir, relPath))) await tx.delete(relPath);
            }
          });
          rolledBack = true;
        } catch (rollbackFailure) {
          rollbackError = rollbackFailure.message;
        }
        throw fail(
          500,
          'LC_E_BACKUP_RESTORE_FAILED',
          rolledBack
            ? '备份恢复失败，已自动退回恢复前状态'
            : '备份恢复失败，且自动退回未完成，请使用安全备份手动恢复',
          {
            reason: error.message,
            rolledBack,
            rollbackError: rollbackError || undefined,
            safetyBackup
          }
        );
      }

      const scope = await scopeOf(loaded.siteDir, manifest);
      return {
        ok: true,
        data: {
          name,
          restored: manifest.files.length,
          overwritten: existingPaths.length,
          created: manifest.files.length - existingPaths.length,
          unchanged: scope.unchanged,
          safetyBackup,
          rev: await adapter.rev()
        }
      };
    } catch (error) {
      return replyError(reply, error);
    }
  });
}
