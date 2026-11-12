import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeRelPath, resolveWithin } from './path-safety.js';
import { hashOf, writeFileAtomic, pathExists } from './atomic.js';
import { PathUnsafeError, StorageError, STORAGE_ERRORS } from './errors.js';

function toRel(siteDir, absPath) {
  return path.relative(siteDir, absPath).split(path.sep).join('/');
}

/**
 * 事务：所有写入先落到 .lowcode/tmp/<txnId>/，提交时统一 rename。
 * 提交前把原文件移到 backup 区，任何一步失败可按逆序还原。
 */
export class StorageTx {
  constructor(siteDir, txnId) {
    this.siteDir = siteDir;
    this.txnId = txnId || crypto.randomUUID();
    this.tmpDir = path.join(siteDir, '.lowcode', 'tmp', this.txnId);
    this.manifestPath = path.join(siteDir, '.lowcode', 'txn', `${this.txnId}.json`);
    this.ops = [];
    this.state = 'new';
    this.finished = false;
    // 记录变更前内容，供提交成功后生成版本快照；只留在内存，不写事务清单。
    this.beforeSnapshots = new Map();
  }

  async prepare() {
    await fs.mkdir(path.join(this.tmpDir, 'files'), { recursive: true });
    await fs.mkdir(path.join(this.tmpDir, 'backup'), { recursive: true });
    await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
    await this.writeManifest('prepared');
    this.state = 'prepared';
  }

  assertWritablePath(relPath) {
    const normalized = normalizeRelPath(relPath);
    if (normalized.startsWith('.lowcode/')) {
      throw new PathUnsafeError(relPath, 'reserved-runtime-path');
    }
    return normalized;
  }

  async write(relPath, data) {
    if (this.finished) throw new StorageError(STORAGE_ERRORS.TXN_RECOVER, '事务已结束，不能再写入');
    const target = this.assertWritablePath(relPath);
    await this.captureBefore(target);
    const index = this.ops.length;
    const tempRel = `.lowcode/tmp/${this.txnId}/files/${index}`;
    const tempAbs = resolveWithin(this.siteDir, tempRel);
    await writeFileAtomic(tempAbs, data);
    const hash = await hashOf(data);
    this.ops.push({ type: 'write', target, temp: tempRel, backup: null, hash, bytes: Buffer.byteLength(data) });
  }

  async delete(relPath) {
    if (this.finished) throw new StorageError(STORAGE_ERRORS.TXN_RECOVER, '事务已结束，不能再删除');
    const target = this.assertWritablePath(relPath);
    await this.captureBefore(target);
    this.ops.push({ type: 'delete', target, temp: null, backup: null, hash: '', bytes: 0 });
  }

  /** 变更前内容读入内存；文件不存在（新增）或目录（删除目录）时为 null。 */
  async captureBefore(relPath) {
    if (this.beforeSnapshots.has(relPath)) return;
    const abs = resolveWithin(this.siteDir, relPath);
    const buffer = await fs.readFile(abs).catch(() => null);
    this.beforeSnapshots.set(relPath, buffer);
  }

  /**
   * 提交成功后收集变更集（before 来自内存，after 从已落盘文件读回）。
   * 供 FsStorageAdapter 写入 versions/<rev>.json。
   */
  async collectChanges() {
    const map = new Map();
    for (const op of this.ops) {
      if (op.type !== 'write' && op.type !== 'delete') continue;
      if (map.has(op.target)) continue;
      const before = this.beforeSnapshots.get(op.target) ?? null;
      const after = op.type === 'write'
        ? await fs.readFile(resolveWithin(this.siteDir, op.target)).catch(() => null)
        : null;
      map.set(op.target, { path: op.target, before, after });
    }
    return [...map.values()];
  }

  async writeManifest(state) {
    const payload = {
      txnId: this.txnId,
      siteId: path.basename(this.siteDir),
      state,
      startedAt: new Date().toISOString(),
      ops: this.ops
    };
    await writeFileAtomic(this.manifestPath, JSON.stringify(payload, null, 2));
  }

  /** 提交；任何失败都自动回滚已处理的操作。 */
  async commit() {
    if (this.finished) throw new StorageError(STORAGE_ERRORS.TXN_RECOVER, '事务已提交或已回滚');
    await this.writeManifest('committing');
    this.state = 'committing';

    const processed = [];
    try {
      for (let index = 0; index < this.ops.length; index += 1) {
        const op = this.ops[index];
        const targetAbs = resolveWithin(this.siteDir, op.target);
        const backupRel = `.lowcode/tmp/${this.txnId}/backup/${index}`;

        if (await pathExists(targetAbs)) {
          const backupAbs = resolveWithin(this.siteDir, backupRel);
          await fs.mkdir(path.dirname(backupAbs), { recursive: true });
          await fs.rename(targetAbs, backupAbs).catch(async (error) => {
            if (error && error.code === 'EXDEV') {
              await fs.copyFile(targetAbs, backupAbs);
              await fs.unlink(targetAbs);
            } else {
              throw error;
            }
          });
          op.backup = backupRel;
        }

        if (op.type === 'write') {
          const tempAbs = resolveWithin(this.siteDir, op.temp);
          await fs.mkdir(path.dirname(targetAbs), { recursive: true });
          await fs.rename(tempAbs, targetAbs);
        }
        processed.push(op);
      }

      this.finished = true;
      this.state = 'done';
      await this.cleanup();
      return { txnId: this.txnId, ops: this.ops.length };
    } catch (error) {
      await this.restore(processed);
      await this.cleanup();
      this.finished = true;
      throw error;
    }
  }

  /** 逆序还原：有备份则还原；没有备份的新文件直接删除。 */
  async restore(processed) {
    const failures = [];
    for (let index = processed.length - 1; index >= 0; index -= 1) {
      const op = processed[index];
      const targetAbs = resolveWithin(this.siteDir, op.target);
      try {
        await fs.unlink(targetAbs).catch(() => {});
        if (op.backup) {
          const backupAbs = resolveWithin(this.siteDir, op.backup);
          await fs.mkdir(path.dirname(targetAbs), { recursive: true });
          await fs.rename(backupAbs, targetAbs);
        }
      } catch (error) {
        failures.push({ path: op.target, message: error.message });
      }
    }
    if (failures.length) {
      throw new StorageError(STORAGE_ERRORS.TXN_RECOVER, '事务回滚未完全成功，请查看站点备份目录', failures);
    }
  }

  async rollback() {
    if (this.finished) return;
    this.finished = true;
    this.state = 'rolled-back';
    await this.cleanup();
  }

  async cleanup() {
    await fs.rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(this.manifestPath).catch(() => {});
  }
}

/**
 * 启动恢复：扫描 .lowcode/txn 清单。
 * prepared → 清理临时区；committing → 还原到提交前；done → 清理。
 * 返回恢复记录，调用方写日志。
 */
export async function recoverTransactions(siteDir) {
  const txnDir = path.join(siteDir, '.lowcode', 'txn');
  const reports = [];
  let files = [];
  try {
    files = await fs.readdir(txnDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return reports;
    throw error;
  }

  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const manifestAbs = path.join(txnDir, name);
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestAbs, 'utf8'));
    } catch {
      await fs.unlink(manifestAbs).catch(() => {});
      reports.push({ txnId: name, action: 'dropped-bad-manifest' });
      continue;
    }

    if (manifest.state === 'committing') {
      const restored = await restoreManifest(siteDir, manifest);
      reports.push({ txnId: manifest.txnId, action: 'rolled-back', restored });
    } else {
      reports.push({ txnId: manifest.txnId, action: manifest.state === 'done' ? 'cleaned' : 'discarded' });
    }

    if (manifest.txnId) {
      await fs.rm(path.join(siteDir, '.lowcode', 'tmp', manifest.txnId), { recursive: true, force: true }).catch(() => {});
    }
    await fs.unlink(manifestAbs).catch(() => {});
  }
  return reports;
}

async function restoreManifest(siteDir, manifest) {
  const ops = Array.isArray(manifest.ops) ? manifest.ops : [];
  let restored = 0;
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index];
    if (!op || typeof op.target !== 'string') continue;
    const targetAbs = resolveWithin(siteDir, op.target);
    if (await pathExists(targetAbs)) {
      // 已落盘且 hash 匹配，视为前滚完成，不再回退
      if (op.type === 'write' && op.hash) {
        const actual = await hashOf(await fs.readFile(targetAbs));
        if (actual === op.hash) continue;
      }
    }
    if (op.backup) {
      const backupAbs = resolveWithin(siteDir, op.backup);
      if (await pathExists(backupAbs)) {
        await fs.unlink(targetAbs).catch(() => {});
        await fs.mkdir(path.dirname(targetAbs), { recursive: true });
        await fs.rename(backupAbs, targetAbs);
        restored += 1;
      }
    } else if (op.type === 'write') {
      await fs.unlink(targetAbs).catch(() => {});
      restored += 1;
    }
  }
  return restored;
}

/** 清理超过 1 小时的临时文件（按配置 tmpMaxAgeMs）。 */
export async function cleanStaleTemps(siteDir, maxAgeMs = 3600000) {
  const tmpRoot = path.join(siteDir, '.lowcode', 'tmp');
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;

  async function walk(dir, depth) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(abs);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(abs).catch(() => {});
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  }

  await walk(tmpRoot, 0);
  return removed;
}
