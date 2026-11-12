import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic, hashOf } from './atomic.js';
import { normalizeRelPath, resolveWithin } from './path-safety.js';

/** 备份保留：与 CONTRACTS 4.4 一致。 */
export const BACKUP_KEEP_COUNT = 10;
export const BACKUP_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeReason(reason) {
  return String(reason || 'manual')
    .replace(/[^A-Za-z0-9._\u4e00-\u9fa5-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'manual';
}

/** 从 `<YYYY-MM-DDTHH-mm-ss-SSSZ>-reason` 解析时间；解析失败按当前时间处理（不误删）。 */
function backupTime(name) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (!matched) return Date.now();
  return Date.UTC(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4]),
    Number(matched[5]),
    Number(matched[6]),
    Number(matched[7])
  );
}

async function dirSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(abs);
    else if (entry.isFile()) total += (await fs.stat(abs).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * 备份受影响文件 + manifest.json。
 * 目录：<site>/backups/<timestamp>-<reason>/
 *   files/<相对路径>  受影响源文件
 *   manifest.json     { siteId, createdAt, reason, files:[{path,hash,bytes}] }
 * @returns {Promise<{dir:string, manifest:Object}>}
 */
export async function createBackup(siteDir, { siteId, reason = 'manual', paths: relPaths = [], protect = [] } = {}) {
  const root = path.resolve(siteDir);
  const id = siteId || path.basename(root);
  const baseDir = path.join(root, 'backups', `${stamp()}-${safeReason(reason)}`);
  const files = [];
  let bytes = 0;

  for (const rawPath of relPaths) {
    let relPath;
    try {
      relPath = normalizeRelPath(rawPath);
    } catch {
      continue;
    }
    const sourceAbs = resolveWithin(root, relPath);
    const info = await fs.stat(sourceAbs).catch(() => null);
    if (!info || !info.isFile()) continue;
    const targetAbs = resolveWithin(baseDir, `files/${relPath}`);
    await fs.mkdir(path.dirname(targetAbs), { recursive: true });
    const buffer = await fs.readFile(sourceAbs);
    await writeFileAtomic(targetAbs, buffer);
    files.push({ path: relPath, hash: await hashOf(buffer), bytes: buffer.length });
    bytes += buffer.length;
  }

  const manifest = {
    schemaVersion: 1,
    siteId: id,
    createdAt: new Date().toISOString(),
    reason: String(reason),
    files,
    bytes
  };
  await writeFileAtomic(path.join(baseDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await pruneBackups(root, { protect });
  return { dir: baseDir, manifest };
}

/** 超保留数、超 30 天或累计超 2 GB 时从最旧删起；最新一份永不删除。 */
export async function pruneBackups(siteDir, { protect = [] } = {}) {
  const backupsDir = path.join(path.resolve(siteDir), 'backups');
  const entries = (await fs.readdir(backupsDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a)); // 文件名以 ISO 时间戳开头，倒序即从新到旧

  const cutoff = Date.now() - BACKUP_KEEP_MS;
  let accumulated = 0;
  const removed = [];

  for (let index = 0; index < entries.length; index += 1) {
    const name = entries[index];
    const abs = path.join(backupsDir, name);
    const size = await dirSize(abs);
    const withinCount = index < BACKUP_KEEP_COUNT;
    const withinAge = backupTime(name) >= cutoff;
    const withinSize = accumulated + size <= BACKUP_MAX_BYTES;
    if (index === 0 || protect.includes(name) || (withinCount && withinAge && withinSize)) {
      accumulated += size;
    } else {
      removed.push(abs);
    }
  }

  for (const dir of removed) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return { kept: entries.length - removed.length, removed: removed.length };
}
