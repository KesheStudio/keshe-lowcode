import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 原子写：同目录临时文件 → fsync → rename。
 * Windows 上 rename 覆盖已存在文件是允许的；跨卷时退化为“复制 + rename”。
 */
export async function writeFileAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpName = `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`;
  const tmpPath = path.join(dir, tmpName);

  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      await fs.copyFile(tmpPath, targetPath);
      await fs.unlink(tmpPath).catch(() => {});
    } else {
      await fs.unlink(tmpPath).catch(() => {});
      throw error;
    }
  }
  await fsyncDir(dir);
  return targetPath;
}

/** 目录 fsync 是 best-effort：Windows 部分文件系统不支持，失败只记录不抛。 */
export async function fsyncDir(dir) {
  let handle;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch {
    /* best-effort */
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export async function hashOf(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return hashOf(buffer);
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** 递归复制目录；exclude 为相对路径（posix，可多级）。 */
export async function copyDir(source, target, { exclude = [], filter } = {}) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    if (filter && !filter(entry.name, entry)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const nextExclude = exclude
        .filter((prefix) => prefix.startsWith(entry.name + '/'))
        .map((prefix) => prefix.slice(entry.name.length + 1));
      await copyDir(from, to, { exclude: nextExclude, filter });
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}
