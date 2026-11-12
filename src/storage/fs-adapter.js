import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeRelPath, resolveWithin, sanitizeSiteId } from './path-safety.js';
import { writeFileAtomic, hashOf, pathExists } from './atomic.js';
import { withLocalLock, SiteFileLock } from './locks.js';
import { StorageTx } from './txn.js';
import { RevStore } from './rev.js';
import { VersionStore } from './versions.js';
import { FileMissingError, RevConflictError } from './errors.js';

const INTERNAL_SEGMENTS = new Set(['.lowcode']);

function assertNotInternal(relPath) {
  const normalized = normalizeRelPath(relPath);
  const head = normalized.split('/')[0];
  if (INTERNAL_SEGMENTS.has(head)) {
    throw new FileMissingError(relPath);
  }
  return normalized;
}

/**
 * 本地文件系统实现（默认、唯一主存储）。
 * - 所有路径相对站点根，越界直接拒绝。
 * - 写默认原子；同一站点写入串行（进程内 Mutex + 跨进程 site.lock）。
 * - transaction 提交时统一 rename，失败整体回滚。
 */
export class FsStorageAdapter {
  constructor({ siteId, siteDir, lockStaleMs = 60000 } = {}) {
    this.siteId = sanitizeSiteId(siteId);
    this.siteDir = path.resolve(siteDir);
    this.lockStaleMs = lockStaleMs;
    this.revStore = new RevStore(this.siteDir);
    this.versionStore = new VersionStore(this.siteDir);
    this.lastVersionError = '';
  }

  /**
   * 写版本快照；派生数据失败不阻断主写入（记录在 lastVersionError 供诊断）。
   */
  async recordVersion(rev, changes, note = '') {
    try {
      await this.versionStore.record({ rev, changes, note });
      this.lastVersionError = '';
    } catch (error) {
      this.lastVersionError = error && error.message ? error.message : String(error);
    }
  }

  absolute(relPath) {
    return resolveWithin(this.siteDir, relPath);
  }

  async read(relPath, opts = {}) {
    const abs = this.absolute(assertNotInternal(relPath));
    const encoding = opts.encoding === 'buffer' ? null : 'utf8';
    try {
      const data = await fs.readFile(abs);
      return encoding ? data.toString(encoding) : data;
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new FileMissingError(relPath);
      throw error;
    }
  }

  async stat(relPath) {
    const abs = this.absolute(assertNotInternal(relPath));
    try {
      const [buffer, info] = await Promise.all([fs.readFile(abs), fs.stat(abs)]);
      return {
        path: normalizeRelPath(relPath),
        size: info.size,
        mtime: info.mtime.toISOString(),
        hash: await hashOf(buffer),
        exists: true
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { path: normalizeRelPath(relPath), size: 0, mtime: '', hash: '', exists: false };
      }
      throw error;
    }
  }

  async list(dir, opts = {}) {
    const isRoot = dir == null || dir === '' || dir === '.' || dir === '/';
    const baseAbs = isRoot ? this.siteDir : this.absolute(dir);
    const maxDepth = opts.recursive ? (opts.depth == null ? 8 : Number(opts.depth)) : 0;
    const results = [];

    async function walk(current, depth) {
      let entries = [];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (error) {
        if (error && error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        const rel = path.relative(this.siteDir, abs).split(path.sep).join('/');
        if (entry.isDirectory()) {
          results.push({ path: rel, kind: 'dir', size: 0, mtime: '' });
          if (maxDepth > 0 && depth < maxDepth) await walk.call(this, abs, depth + 1);
        } else if (entry.isFile()) {
          const info = await fs.stat(abs);
          results.push({ path: rel, kind: 'file', size: info.size, mtime: info.mtime.toISOString() });
        }
      }
    }

    await walk.call(this, baseAbs, 0);
    return results;
  }

  async write(relPath, data, opts = {}) {
    const normalized = assertNotInternal(relPath);
    const abs = this.absolute(normalized);
    return withLocalLock(`site:${this.siteId}`, async () => {
      const lock = await new SiteFileLock(path.join(this.siteDir, '.lowcode', 'locks', 'site.lock'), {
        siteId: this.siteId,
        staleMs: this.lockStaleMs
      }).acquire();
      try {
        if (opts.expectedRev != null) {
          const current = await this.revStore.read();
          if (Number(opts.expectedRev) !== current) throw new RevConflictError(opts.expectedRev, current);
        }
        const before = await fs.readFile(abs).catch(() => null);
        const bytes = Buffer.byteLength(data);
        if (opts.atomic === false) {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, data);
        } else {
          await writeFileAtomic(abs, data);
        }
        const hash = await hashOf(data);
        const rev = await this.revStore.bump();
        await this.recordVersion(rev, [{ path: normalized, before, after: data }], opts.note || 'write');
        return { path: normalized, rev, hash, bytes };
      } finally {
        await lock.release();
      }
    });
  }

  async delete(relPath, opts = {}) {
    const normalized = assertNotInternal(relPath);
    const abs = this.absolute(normalized);
    return withLocalLock(`site:${this.siteId}`, async () => {
      const lock = await new SiteFileLock(path.join(this.siteDir, '.lowcode', 'locks', 'site.lock'), {
        siteId: this.siteId,
        staleMs: this.lockStaleMs
      }).acquire();
      try {
        if (opts.expectedRev != null) {
          const current = await this.revStore.read();
          if (Number(opts.expectedRev) !== current) throw new RevConflictError(opts.expectedRev, current);
        }
        const info = await fs.stat(abs).catch(() => null);
        if (!info) throw new FileMissingError(normalized);
        const before = info.isFile() ? await fs.readFile(abs).catch(() => null) : null;
        if (info.isDirectory()) {
          if (!opts.recursive) {
            throw new FileMissingError(normalized);
          }
          await fs.rm(abs, { recursive: true, force: false });
        } else {
          await fs.unlink(abs);
        }
        const rev = await this.revStore.bump();
        await this.recordVersion(rev, [{ path: normalized, before, after: null }], opts.note || 'delete');
      } finally {
        await lock.release();
      }
    });
  }

  async move(from, to) {
    const fromNorm = assertNotInternal(from);
    const toNorm = assertNotInternal(to);
    const fromAbs = this.absolute(fromNorm);
    const toAbs = this.absolute(toNorm);
    return withLocalLock(`site:${this.siteId}`, async () => {
      const lock = await new SiteFileLock(path.join(this.siteDir, '.lowcode', 'locks', 'site.lock'), {
        siteId: this.siteId,
        staleMs: this.lockStaleMs
      }).acquire();
      try {
        const before = await fs.readFile(fromAbs).catch(() => null);
        await fs.mkdir(path.dirname(toAbs), { recursive: true });
        await fs.rename(fromAbs, toAbs).catch(async (error) => {
          if (error && error.code === 'EXDEV') {
            await fs.copyFile(fromAbs, toAbs);
            await fs.unlink(fromAbs);
          } else {
            throw error;
          }
        });
        const rev = await this.revStore.bump();
        await this.recordVersion(rev, [
          { path: fromNorm, before, after: null },
          { path: toNorm, before: null, after: before }
        ], 'move');
      } finally {
        await lock.release();
      }
    });
  }

  async transaction(_siteId, fn) {
    return withLocalLock(`site:${this.siteId}`, async () => {
      const lock = await new SiteFileLock(path.join(this.siteDir, '.lowcode', 'locks', 'site.lock'), {
        siteId: this.siteId,
        staleMs: this.lockStaleMs
      }).acquire();
      const tx = new StorageTx(this.siteDir, crypto.randomUUID());
      try {
        await tx.prepare();
        let result;
        try {
          result = await fn(tx);
        } catch (error) {
          await tx.rollback();
          throw error;
        }
        const commit = await tx.commit();
        if (commit.ops > 0) {
          const rev = await this.revStore.bump();
          const changes = await tx.collectChanges();
          await this.recordVersion(rev, changes, 'transaction');
        }
        return result;
      } finally {
        await tx.rollback().catch(() => {});
        await lock.release();
      }
    });
  }

  async rev() {
    return this.revStore.read();
  }

  async exists(relPath) {
    return pathExists(this.absolute(assertNotInternal(relPath)));
  }
}
