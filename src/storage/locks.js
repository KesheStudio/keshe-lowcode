import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { StorageLockedError } from './errors.js';

/* ---------------- 进程内互斥 ---------------- */

const queues = new Map();

/**
 * 同一 key 串行执行；不同 key 互不影响。
 * 前一个任务失败不会卡死队列。
 */
export function withLocalLock(key, fn) {
  const previous = queues.get(key) || Promise.resolve();
  const run = previous.then(() => fn(), () => fn());
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/* ---------------- 跨进程站点锁 ---------------- */

const LOCK_HEARTBEAT_MS = 10000;

/**
 * 跨进程锁：<site>/.lowcode/locks/site.lock。
 * 获取失败抛 StorageLockedError（HTTP 423）。
 * 超过 staleMs 没心跳视为陈旧，可回收一次。
 */
export class SiteFileLock {
  constructor(lockPath, { siteId = '', staleMs = 60000 } = {}) {
    this.lockPath = lockPath;
    this.siteId = siteId;
    this.staleMs = staleMs;
    this.token = crypto.randomUUID();
    this.handle = null;
    this.heartbeat = null;
  }

  async acquire() {
    await fs.mkdir(this.fileDir(), { recursive: true });
    let acquired = await this.tryCreate();
    if (!acquired) {
      const holder = await this.readHolder();
      const heartbeatAt = holder && holder.heartbeatAt ? new Date(holder.heartbeatAt).getTime() : 0;
      const stale = !heartbeatAt || Date.now() - heartbeatAt > this.staleMs;
      if (stale) {
        await fs.unlink(this.lockPath).catch(() => {});
        acquired = await this.tryCreate();
      }
      if (!acquired) throw new StorageLockedError(this.siteId, holder);
    }
    this.heartbeat = setInterval(() => this.beat(), LOCK_HEARTBEAT_MS);
    if (this.heartbeat.unref) this.heartbeat.unref();
    return this;
  }

  fileDir() {
    const idx = this.lockPath.lastIndexOf('site.lock');
    return idx >= 0 ? this.lockPath.slice(0, idx) : this.lockPath;
  }

  async tryCreate() {
    try {
      this.handle = await fs.open(this.lockPath, 'wx');
      const payload = this.payload();
      await this.handle.writeFile(payload, 'utf8');
      await this.handle.sync();
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }
  }

  payload() {
    return JSON.stringify(
      {
        pid: process.pid,
        host: os.hostname(),
        token: this.token,
        siteId: this.siteId,
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString()
      },
      null,
      2
    );
  }

  async beat() {
    try {
      if (!this.handle) return;
      await this.handle.writeFile(this.payload(), 'utf8');
    } catch {
      /* 心跳失败只影响锁判定，不抛出 */
    }
  }

  async readHolder() {
    try {
      const text = await fs.readFile(this.lockPath, 'utf8');
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async release() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.handle) {
      await this.handle.close().catch(() => {});
      this.handle = null;
    }
    const holder = await this.readHolder();
    if (holder && holder.token === this.token) {
      await fs.unlink(this.lockPath).catch(() => {});
    }
  }
}
