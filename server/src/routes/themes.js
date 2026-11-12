import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { listBuiltinThemes, loadSiteTheme, resolveThemeForRenderer, normalizeTheme, getBuiltinTheme } from '../themes.js';

const THEME_EDITOR_DIR = fileURLToPath(new URL('../../../src/theme/', import.meta.url));
const THEME_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

async function sendThemeEditorFile(reply, fileName, contentType, token) {
  let body;
  try {
    body = await fs.readFile(path.join(THEME_EDITOR_DIR, fileName), 'utf8');
  } catch {
    return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `主题编辑器文件缺失：${fileName}` } });
  }
  if (fileName === 'editor.html' && token) {
    body = body.split('__LC_TOKEN__').join(token);
  }
  return reply.type(contentType).header('cache-control', 'no-store').send(body);
}

/**
 * 主题接口（CONTRACTS 第 7 节 / D-46 / D-47）：
 * GET /theme/editor.html               → 主题编辑器页面（带 token 注入）
 * GET /theme/editor-app.js             → 编辑器脚本
 * GET /theme/lc-theme-runtime.js       → 主题运行时
 * GET /api/themes                      → 内置主题摘要列表
 * GET /api/sites/:id/themes            → 站点自有主题（完整 JSON，供编辑器列出）
 * GET /api/sites/:id/theme             → 站点当前主题（含归一化 JSON 与渲染用 CSS 变量）
 * GET /api/sites/:id/theme/:themeId    → 指定主题（同结构）
 * PUT /api/sites/:id/theme             → 保存当前主题、明暗模式与允许切换的主题集合；可写入完整主题令牌
 * 渲染层与导出只消费这里返回的 variables/light/dark，不直接读文件。
 */
export function registerThemeRoutes(app, ctx) {
  app.get('/theme/editor.html', async (_request, reply) => {
    return sendThemeEditorFile(reply, 'editor.html', 'text/html; charset=utf-8', ctx.token);
  });

  app.get('/theme/editor-app.js', async (_request, reply) => {
    return sendThemeEditorFile(reply, 'editor-app.js', 'text/javascript; charset=utf-8', ctx.token);
  });

  app.get('/theme/lc-theme-runtime.js', async (_request, reply) => {
    return sendThemeEditorFile(reply, 'lc-theme-runtime.js', 'text/javascript; charset=utf-8', ctx.token);
  });

  app.get('/api/themes', async () => {
    return { ok: true, data: { themes: await listBuiltinThemes() } };
  });

  app.get('/api/sites/:id/themes', async (request, reply) => {
    let siteId;
    try { siteId = sanitizeSiteId(request.params.id); } catch (error) {
      return reply.code(400).send({ ok: false, error: { code: error.code || 'LC_E_SITE_ID', message: '站点 ID 非法' } });
    }
    const adapter = createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
    if (!(await adapter.stat('site.json')).exists) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `站点不存在：${siteId}` } });
    }
    const entries = await adapter.list('themes');
    const themes = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue;
      let parsed;
      try {
        parsed = JSON.parse(await adapter.read(entry.path));
      } catch {
        continue;
      }
      const normalized = normalizeTheme(parsed, path.basename(entry.path, '.json'));
      if (normalized) themes.push(normalized);
    }
    themes.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, data: { themes } };
  });

  app.get('/api/sites/:id/theme', async (request, reply) => {
    const adapter = createSiteAdapter(ctx.paths.dataDir, request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    const exists = await adapter.stat('site.json');
    if (!exists.exists) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `站点不存在：${request.params.id}` } });
    }
    const loaded = await loadSiteTheme(ctx.paths.dataDir, request.params.id);
    return { ok: true, data: { source: loaded.source, theme: resolveThemeForRenderer(loaded.theme), themeJson: loaded.theme } };
  });

  app.get('/api/sites/:id/theme/:themeId', async (request, reply) => {
    const adapter = createSiteAdapter(ctx.paths.dataDir, request.params.id, { lockStaleMs: ctx.paths.lockStaleMs });
    const exists = await adapter.stat('site.json');
    if (!exists.exists) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `站点不存在：${request.params.id}` } });
    }
    const loaded = await loadSiteTheme(ctx.paths.dataDir, request.params.id, request.params.themeId);
    if (!loaded.theme) {
      const builtin = normalizeTheme(await getBuiltinTheme(request.params.themeId), request.params.themeId);
      if (!builtin) {
        return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `主题不存在：${request.params.themeId}` } });
      }
    }
    return { ok: true, data: { source: loaded.source, theme: resolveThemeForRenderer(loaded.theme), themeJson: loaded.theme } };
  });

  app.put('/api/sites/:id/theme', async (request, reply) => {
    let siteId;
    try { siteId = sanitizeSiteId(request.params.id); } catch (error) {
      return reply.code(400).send({ ok: false, error: { code: error.code || 'LC_E_SITE_ID', message: '站点 ID 非法' } });
    }
    const adapter = createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
    if (!(await adapter.stat('site.json')).exists) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_NOT_FOUND', message: `站点不存在：${siteId}` } });
    }
    let project;
    try {
      project = JSON.parse(await adapter.read('project.json'));
    } catch {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_PROJECT_MISSING', message: '站点缺少 project.json' } });
    }
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const theme = Object.assign({}, project.theme || {});
    let themeBody = null;
    if (body.themeJson !== undefined) {
      const raw = body.themeJson;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return reply.code(422).send({ ok: false, error: { code: 'LC_E_THEME', message: 'themeJson 必须是主题对象' } });
      }
      if (!raw.modes || typeof raw.modes !== 'object') {
        return reply.code(422).send({ ok: false, error: { code: 'LC_E_THEME', message: 'themeJson 缺少 modes 亮暗色令牌' } });
      }
      const normalized = normalizeTheme(raw);
      const id = String(normalized.id || '').toLowerCase();
      if (!THEME_ID_PATTERN.test(id)) {
        return reply.code(422).send({ ok: false, error: { code: 'LC_E_THEME', message: '主题 ID 需为 2-32 位小写字母、数字或连字符，且以字母开头' } });
      }
      themeBody = { ...normalized, id };
      theme.activeId = id;
    }
    if (body.activeId !== undefined) {
      const id = String(body.activeId || '').replace(/[^a-z0-9-]/gi, '');
      if (!id) return reply.code(422).send({ ok: false, error: { code: 'LC_E_THEME', message: 'activeId 不能为空' } });
      if (!themeBody) theme.activeId = id;
    }
    if (body.mode !== undefined) {
      theme.mode = ['light', 'dark', 'auto'].includes(body.mode) ? body.mode : 'auto';
    }
    if (body.allowSwitch !== undefined) {
      if (!Array.isArray(body.allowSwitch)) {
        return reply.code(422).send({ ok: false, error: { code: 'LC_E_THEME', message: 'allowSwitch 必须是数组' } });
      }
      theme.allowSwitch = body.allowSwitch.map((id) => String(id || '').replace(/[^a-z0-9-]/gi, '')).filter(Boolean).slice(0, 20);
    }
    if (themeBody) {
      theme.allowSwitch = (theme.allowSwitch || []).concat(themeBody.id)
        .map((id) => String(id || '').replace(/[^a-z0-9-]/gi, ''))
        .filter(Boolean)
        .filter((id, index, list) => list.indexOf(id) === index)
        .slice(0, 20);
    }
    project.theme = theme;
    if (!themeBody) {
      await adapter.write('project.json', JSON.stringify(project, null, 2) + '\n');
      return { ok: true, data: { theme } };
    }
    let previousId = '';
    if (body.previousId !== undefined && themeBody) {
      previousId = String(body.previousId || '').replace(/[^a-z0-9-]/gi, '');
      if (previousId && previousId !== themeBody.id) {
        let exists = false;
        try { exists = (await adapter.stat(`themes/${previousId}.json`)).exists; } catch { exists = false; }
        if (!exists) previousId = '';
      } else {
        previousId = '';
      }
    }
    await adapter.transaction(siteId, async (tx) => {
      if (previousId) await tx.delete(`themes/${previousId}.json`);
      await tx.write(`themes/${themeBody.id}.json`, JSON.stringify(themeBody, null, 2) + '\n');
      await tx.write('project.json', JSON.stringify(project, null, 2) + '\n');
    });
    return { ok: true, data: { theme, themeJson: themeBody } };
  });
}
