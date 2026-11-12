import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic, pathExists } from './atomic.js';
import { normalizeRelPath } from './path-safety.js';

/** 保留策略：与 CONTRACTS 4.5 一致（D-45 把内容改为变更文件全量）。 */
export const VERSION_KEEP_COUNT = 100;
export const VERSION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.mp4'
]);

function isBinaryPath(relPath) {
  const lower = relPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && BINARY_EXT.has(lower.slice(dot));
}

function encodeFile(relPath, content) {
  if (content == null) {
    return { path: relPath, encoding: 'deleted', content: null, hash: '', bytes: 0 };
  }
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const binary = isBinaryPath(relPath);
  return {
    path: relPath,
    encoding: binary ? 'base64' : 'utf8',
    content: binary ? buffer.toString('base64') : buffer.toString('utf8'),
    hash: crypto.createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length
  };
}

/**
 * 站点版本历史（派生数据，写入失败不阻断主流程）。
 * 磁盘位置：
 *   <site>/versions/<rev>.json   单版本条目（变更文件全量）
 *   <site>/versions/index.json   索引（rev、parent、at、文件、字节数）
 * 保留：最近 100 条且不超过 30 天；最新一条永不删除。
 */
export class VersionStore {
  constructor(siteDir) {
    this.siteDir = path.resolve(siteDir);
    this.dir = path.join(this.siteDir, 'versions');
    this.indexFile = path.join(this.dir, 'index.json');
  }

  async readIndex() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
      return {
        schemaVersion: 1,
        siteId: parsed.siteId || path.basename(this.siteDir),
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        updatedAt: parsed.updatedAt || ''
      };
    } catch {
      return { schemaVersion: 1, siteId: path.basename(this.siteDir), entries: [], updatedAt: '' };
    }
  }

  async writeIndex(index) {
    await fs.mkdir(this.dir, { recursive: true });
    await writeFileAtomic(
      this.indexFile,
      JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2)
    );
  }

  /**
   * 记录一个版本。
   * @param {Object} input { rev, parentRev?, at?, note?, changes: [{ path, before, after }] }
   * before/after 为 string | Buffer | null（null 表示新增或删除）。
   * @returns {Object|null} 索引条目；没有实际变更时返回 null。
   */
  async record({ rev, parentRev, at, note, changes }) {
    const map = new Map();
    for (const change of changes || []) {
      if (!change || typeof change.path !== 'string') continue;
      const relPath = normalizeRelPath(change.path);
      const previous = map.get(relPath);
      map.set(relPath, {
        path: relPath,
        before: previous && previous.before != null ? previous.before : change.before ?? null,
        after: change.after ?? null
      });
    }

    const files = [];
    for (const change of map.values()) {
      if (change.before == null && change.after == null) continue;
      const file = encodeFile(change.path, change.after);
      files.push(file);
    }
    if (!files.length) return null;

    const created = at || new Date().toISOString();
    const entry = {
      schemaVersion: 1,
      siteId: path.basename(this.siteDir),
      rev: Number(rev),
      parent: parentRev == null ? Number(rev) - 1 : Number(parentRev),
      at: created,
      note: String(note || ''),
      kind: 'full',
      files
    };
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);

    await fs.mkdir(this.dir, { recursive: true });
    await writeFileAtomic(path.join(this.dir, `${entry.rev}.json`), JSON.stringify(entry, null, 2));

    const index = await this.readIndex();
    const without = index.entries.filter((item) => Number(item.rev) !== entry.rev);
    without.push({
      rev: entry.rev,
      parent: entry.parent,
      at: created,
      kind: entry.kind,
      files: files.map((file) => file.path),
      bytes
    });
    without.sort((a, b) => Number(a.rev) - Number(b.rev));
    const kept = await this.prune(without);
    index.entries = kept;
    await this.writeIndex(index);
    return kept.find((item) => Number(item.rev) === entry.rev) || null;
  }

  /** 计算保留集合：超过 100 条或早于 30 天的旧条目被删除，最新一条始终保留。 */
  async prune(entries) {
    const sorted = [...entries].sort((a, b) => Number(a.rev) - Number(b.rev));
    const latest = sorted[sorted.length - 1];
    const cutoff = Date.now() - VERSION_KEEP_MS;
    const kept = [];
    const removed = [];

    sorted.forEach((entry, index) => {
      const isLatest = entry === latest;
      const withinCount = sorted.length - index <= VERSION_KEEP_COUNT;
      const withinAge = !entry.at || new Date(entry.at).getTime() >= cutoff;
      if (isLatest || (withinCount && withinAge)) kept.push(entry);
      else removed.push(entry);
    });

    for (const entry of removed) {
      await fs.unlink(path.join(this.dir, `${entry.rev}.json`)).catch(() => {});
    }
    return kept;
  }

  async list() {
    const index = await this.readIndex();
    return [...index.entries].sort((a, b) => Number(b.rev) - Number(a.rev));
  }

  async get(rev) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.dir, `${Number(rev)}.json`), 'utf8'));
      return {
        ...parsed,
        files: Array.isArray(parsed.files) ? parsed.files : []
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async exists(rev) {
    return pathExists(path.join(this.dir, `${Number(rev)}.json`));
  }
}
