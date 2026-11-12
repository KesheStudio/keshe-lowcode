import path from 'node:path';
import { FsStorageAdapter } from './fs-adapter.js';
import { recoverSite, recoverAllSites } from './recovery.js';
import { sanitizeSiteId } from './path-safety.js';

/** 数据根下的站点根：<dataRoot>/sites */
export function sitesRoot(dataRoot) {
  return path.join(path.resolve(dataRoot), 'sites');
}

/**
 * 并行会话接入口：创建某站点的存储适配器。
 * @param {string} dataRoot 绝对数据根（来自 platform.config.json → paths.dataDir）
 * @param {string} siteId   站点 id（小写 slug）
 * @param {Object} [options] { lockStaleMs }
 */
export function createSiteAdapter(dataRoot, siteId, options = {}) {
  const id = sanitizeSiteId(siteId);
  const siteDir = path.join(sitesRoot(dataRoot), id);
  return new FsStorageAdapter({ siteId: id, siteDir, ...options });
}

export { FsStorageAdapter, recoverSite, recoverAllSites };
export { VersionStore, VERSION_KEEP_COUNT, VERSION_KEEP_MS } from './versions.js';
export { createBackup, pruneBackups, BACKUP_KEEP_COUNT, BACKUP_KEEP_MS, BACKUP_MAX_BYTES } from './backups.js';
export { STORAGE_ERRORS, StorageError, StorageLockedError, RevConflictError, FileMissingError } from './errors.js';
export { normalizeRelPath } from './path-safety.js';
export { STORAGE_LAYOUT_VERSION } from './types.js';
