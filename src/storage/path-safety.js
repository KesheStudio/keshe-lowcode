import path from 'node:path';
import { PathUnsafeError } from './errors.js';

const WINDOWS_RESERVED = /[<>:"|?*\u0000-\u001f]/;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * 把外部传入的相对路径规范化为 posix 相对路径。
 * 拒绝：绝对路径、盘符、`..`、空段、Windows 非法字符、保留设备名。
 */
export function normalizeRelPath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathUnsafeError(String(input), 'empty');
  }
  const raw = input.replace(/\\/g, '/');
  if (raw.startsWith('/')) throw new PathUnsafeError(input, 'absolute');
  if (/^[a-zA-Z]:/.test(raw)) throw new PathUnsafeError(input, 'drive-letter');

  const segments = raw.split('/');
  const cleaned = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw new PathUnsafeError(input, 'parent-traversal');
    if (WINDOWS_RESERVED.test(segment)) throw new PathUnsafeError(input, 'illegal-character');
    if (/[. ]$/.test(segment)) throw new PathUnsafeError(input, 'trailing-dot-or-space');
    if (RESERVED_NAMES.test(segment)) throw new PathUnsafeError(input, 'reserved-name');
    cleaned.push(segment);
  }
  if (!cleaned.length) throw new PathUnsafeError(input, 'empty');
  return cleaned.join('/');
}

/** 在 root 内解析相对路径，二次确认结果没有越界。 */
export function resolveWithin(root, relPath) {
  const normalized = normalizeRelPath(relPath);
  const base = path.resolve(root);
  const target = path.resolve(base, ...normalized.split('/'));
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!target.startsWith(prefix)) throw new PathUnsafeError(relPath, 'escapes-root');
  return target;
}

/** 站点 id：小写 slug + 允许的 ASCII，防止路径注入。 */
export function sanitizeSiteId(value) {
  const text = String(value || '').trim();
  if (!text) throw new PathUnsafeError(text, 'empty-site-id');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(text)) {
    throw new PathUnsafeError(text, 'invalid-site-id');
  }
  return text;
}
