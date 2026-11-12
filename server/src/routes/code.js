/* 代码覆盖 · 后端用户区文件 + 语法/最小运行检查
 *
 * 站点自己保存的后端用户区代码落在 data/sites/<siteId>/backend/<language>/<server 相对路径>，
 * 导出时覆盖模板里的同名用户区文件；生成区（generated/、main.*、manifest）不允许写入。
 * 页面级 / 实例级覆盖存在页面 JSON 里，不在这里落盘。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { checkCode, CHECK_LANGUAGES } from '../code/check.js';
import { USER_ZONES } from '../code/zones.js';
import { fail } from '../templates/model.js';

const BACKEND_DIR = 'backend';
const MAX_FILE_BYTES = 256 * 1024;

function siteContext(ctx, request) {
  try {
    const siteId = sanitizeSiteId(request.params.siteId);
    const siteDir = path.join(ctx.paths.dataDir, 'sites', siteId);
    return { siteId, siteDir };
  } catch {
    throw fail(400, 'LC_E_SITE_ID', '站点 ID 不合法');
  }
}

function zoneFor(language) {
  const key = String(language || '').toLowerCase();
  const zone = USER_ZONES[key];
  if (!zone) throw fail(400, 'LC_E_CODE_LANGUAGE', '不支持的后端语言：' + (language || '(空)'));
  return { key, zone };
}

function assertUserPath(zone, rel) {
  const value = String(rel || '').replace(/\\/g, '/');
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\0')) {
    throw fail(400, 'LC_E_CODE_PATH', '文件路径不合法：' + value);
  }
  if (!zone.prefixes.some((prefix) => value.startsWith(prefix))) {
    throw fail(400, 'LC_E_CODE_PATH', '只能修改用户区文件（' + zone.prefixes.join('、') + '）：' + value);
  }
  const ext = path.posix.extname(value).toLowerCase();
  if (!zone.extensions.includes(ext)) {
    throw fail(400, 'LC_E_CODE_PATH', '该语言不允许编辑 ' + (ext || '无扩展名') + ' 文件：' + value);
  }
  return value;
}

async function walk(dir, rel, visit) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel, visit);
    else if (entry.isFile()) await visit(childRel);
  }
}

async function readTemplateFiles(platformRoot, zone) {
  const root = path.join(platformRoot, zone.templateRoot);
  const items = [];
  await walk(root, '', async (rel) => {
    if (!zone.prefixes.some((prefix) => rel.startsWith(prefix))) return;
    const ext = path.posix.extname(rel).toLowerCase();
    if (!zone.extensions.includes(ext)) return;
    const body = await fs.readFile(path.join(root, rel), 'utf8').catch(() => null);
    if (body == null) return;
    items.push({ path: rel, template: body });
  });
  items.sort((a, b) => a.path.localeCompare(b.path));
  return items;
}

async function readSavedFiles(siteDir, language) {
  const root = path.join(siteDir, BACKEND_DIR, language);
  const items = {};
  await walk(root, '', async (rel) => {
    const body = await fs.readFile(path.join(root, rel), 'utf8').catch(() => null);
    if (body == null) return;
    const stat = await fs.stat(path.join(root, rel)).catch(() => null);
    items[rel] = { code: body, updatedAt: stat ? stat.mtime.toISOString() : '' };
  });
  return items;
}

async function backendPayload(ctx, siteId, siteDir, language) {
  const { key, zone } = zoneFor(language);
  const template = await readTemplateFiles(ctx.platformRoot, zone);
  const saved = await readSavedFiles(siteDir, key);
  const files = [];
  for (const item of template) {
    files.push({
      path: item.path,
      template: item.template,
      code: saved[item.path] ? saved[item.path].code : item.template,
      saved: Boolean(saved[item.path]),
      updatedAt: saved[item.path] ? saved[item.path].updatedAt : ''
    });
  }
  for (const rel of Object.keys(saved)) {
    if (template.some((item) => item.path === rel)) continue;
    files.push({ path: rel, template: null, code: saved[rel].code, saved: true, updatedAt: saved[rel].updatedAt });
  }
  return {
    siteId,
    language: key,
    label: zone.label,
    editor: zone.editor,
    prefixes: zone.prefixes,
    extensions: zone.extensions,
    files
  };
}

export function registerCodeRoutes(app, ctx) {
  app.get('/api/sites/:siteId/code/backend', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    const language = request.query && request.query.language;
    return { ok: true, data: await backendPayload(ctx, siteId, siteDir, language) };
  });

  app.put('/api/sites/:siteId/code/backend', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const { key, zone } = zoneFor(body.language);
    const rel = assertUserPath(zone, body.path);
    const code = String(body.code == null ? '' : body.code);
    if (Buffer.byteLength(code, 'utf8') > MAX_FILE_BYTES) {
      throw fail(413, 'LC_E_CODE_TOO_LARGE', '单个用户区文件不能超过 ' + MAX_FILE_BYTES / 1024 + ' KB');
    }
    const target = path.join(siteDir, BACKEND_DIR, key, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, code, 'utf8');
    const payload = await backendPayload(ctx, siteId, siteDir, key);
    return { ok: true, data: { siteId, language: key, path: rel, file: payload.files.find((item) => item.path === rel) } };
  });

  app.delete('/api/sites/:siteId/code/backend', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const { key, zone } = zoneFor(body.language);
    const rel = assertUserPath(zone, body.path);
    await fs.rm(path.join(siteDir, BACKEND_DIR, key, rel), { force: true });
    const payload = await backendPayload(ctx, siteId, siteDir, key);
    return { ok: true, data: { siteId, language: key, path: rel, file: payload.files.find((item) => item.path === rel) } };
  });

  app.post('/api/sites/:siteId/code/check', async (request) => {
    const { siteId } = siteContext(ctx, request);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const result = checkCode({ language: body.language, code: body.code, run: body.run !== false });
    return {
      ok: true,
      data: {
        siteId,
        languages: CHECK_LANGUAGES,
        ...result
      }
    };
  });
}
