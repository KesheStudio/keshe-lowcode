/* 模板库路由：页面模板 / 站点模板的保存、列表、导入导出、套用、删除与恢复。
   站点模板只带走内容层（页面、组件、主题、导航、页脚），
   数据源、密钥、导出与后端配置一律不进模板。 */
import path from 'node:path';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { createBackup } from '../../../src/storage/backups.js';
import { normalizeStoredComponent } from '../components/model.js';
import { applyStarter, getStarter, listStarters } from '../templates/starters.js';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_KINDS,
  TEMPLATE_LIMITS,
  asText,
  collectComponentIds,
  exportPayload,
  fail,
  normalizeTemplateId,
  normalizeTemplateMeta,
  normalizeTemplateRecord,
  PAGE_EXTRA_FIELDS,
  pageExtraFields,
  pageSnapshot,
  slugifyId,
  templateInfo
} from '../templates/model.js';

const TEMPLATE_DIR = 'templates';
const TRASH_DIR = 'trash/templates';
/* 页面 id 可来自中文标题生成的别名，按码点限制长度。 */
const PAGE_ID_RE = /^[\p{L}\p{N}_-]{1,48}$/u;
/* 页面输出路径允许中文等 Unicode 字母数字（浏览器按百分号编码访问）。 */
const PAGE_PATH_RE = /^[\p{L}\p{N}][\p{L}\p{N}/_-]*\.html$/u;

function adapterFor(ctx, siteId) {
  return createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
}

function templateRel(id) {
  return TEMPLATE_DIR + '/' + id + '.json';
}

function trashRel(trashId) {
  return TRASH_DIR + '/' + trashId + '.json';
}

function pageRel(id) {
  return 'pages/' + id + '.json';
}

function siteOf(ctx, request) {
  const raw = request.params.siteId;
  try {
    const siteId = sanitizeSiteId(raw);
    return { siteId, adapter: adapterFor(ctx, siteId) };
  } catch {
    throw fail(400, 'LC_E_SITE_ID', '站点 ID 不合法');
  }
}

function fileMissing(error) {
  return Boolean(error && (error.code === 'ENOENT' || error.code === 'LC_E_NOT_FOUND'));
}

async function readJson(adapter, rel, code, message) {
  try {
    return JSON.parse(await adapter.read(rel, { encoding: 'utf8' }));
  } catch (error) {
    if (fileMissing(error)) throw fail(404, code || 'LC_E_NOT_FOUND', (message || '文件不存在') + '：' + rel);
    throw fail(422, code || 'LC_E_BAD_JSON', (message || '文件内容不是合法 JSON') + '：' + rel);
  }
}

function normalizeRecord(raw, rel) {
  const template = normalizeTemplateRecord(raw);
  template.id = asText(raw && raw.template && raw.template.id) || asText(template.id);
  const id = normalizeTemplateId(template.id || path.posix.basename(rel || '', '.json'));
  template.id = id;
  return template;
}

async function readTemplate(adapter, id) {
  const templateId = normalizeTemplateId(id);
  const raw = await readJson(adapter, templateRel(templateId), 'LC_E_TEMPLATE_NOT_FOUND', '模板不存在');
  const template = normalizeRecord(raw, templateRel(templateId));
  template.id = templateId;
  return template;
}

async function listRecords(adapter) {
  const entries = await adapter.list(TEMPLATE_DIR, { recursive: false }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.toLowerCase().endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await adapter.read(entry.path, { encoding: 'utf8' }));
      const template = normalizeRecord(raw, entry.path);
      out.push({ template, rel: entry.path });
    } catch {
      /* 坏文件不阻塞列表，详情页会单独报错。 */
    }
  }
  return out;
}

async function listTrashRecords(adapter) {
  const entries = await adapter.list(TRASH_DIR, { recursive: false }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.toLowerCase().endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await adapter.read(entry.path, { encoding: 'utf8' }));
      const info = templateInfo(raw && raw.template ? raw.template : {});
      out.push({
        trashId: path.posix.basename(entry.path, '.json'),
        deletedAt: asText(raw.deletedAt),
        originalId: asText(raw.originalId || info.id),
        template: info
      });
    } catch {
      /* 跳过坏信封。 */
    }
  }
  out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return out;
}

function usedIds(records) {
  return new Set(records.map((item) => item.template.id));
}

function uniqueId(base, taken) {
  const id = normalizeTemplateId(base);
  if (!taken.has(id)) return id;
  let n = 2;
  while (taken.has(id + '-' + n)) n += 1;
  return id + '-' + n;
}

function uniqueName(base, taken) {
  const name = asText(base).trim() || '未命名模板';
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(name + '（' + n + '）')) n += 1;
  return name + '（' + n + '）';
}

async function readAllPages(adapter) {
  const entries = await adapter.list('pages', { recursive: false }).catch(() => []);
  const pages = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.toLowerCase().endsWith('.json')) continue;
    const page = await readJson(adapter, entry.path, 'LC_E_TEMPLATE_PAGE', '页面内容不可读');
    pages.push(Object.assign({ id: path.posix.basename(entry.path, '.json') }, page));
  }
  pages.sort((a, b) => asText(a.path || a.id).localeCompare(asText(b.path || b.id), 'zh-CN'));
  return pages;
}

/** 把模板引用到的自定义组件一并快照，套用时缺哪个补哪个。 */
async function snapshotComponents(adapter, componentIds) {
  const components = [];
  for (const id of componentIds) {
    if (!PAGE_ID_RE.test(id)) continue;
    try {
      const raw = await readJson(adapter, 'components/' + id + '.json');
      const normalized = normalizeStoredComponent(raw);
      normalized.id = id;
      components.push(normalized);
    } catch {
      /* 引用存在但组件文件缺失时不阻塞保存，套用时会给提示。 */
    }
  }
  return components;
}

async function siteName(adapter, fallback) {
  try {
    const site = JSON.parse(await adapter.read('site.json', { encoding: 'utf8' }));
    return asText(site.name) || fallback;
  } catch {
    return fallback;
  }
}

async function readProject(adapter) {
  try {
    return JSON.parse(await adapter.read('project.json', { encoding: 'utf8' }));
  } catch {
    return { schemaVersion: 2, navigation: { items: [] }, footer: { text: '' }, theme: {} };
  }
}

async function snapshotSiteConfig(adapter, project) {
  const config = {
    site: {
      description: asText(project && project.site && project.site.description),
      language: asText(project && project.site && project.site.language) || 'zh-CN'
    },
    navigation: project && project.navigation ? project.navigation : { items: [] },
    footer: project && project.footer ? project.footer : { text: '' },
    theme: {
      activeId: asText(project && project.theme && project.theme.activeId)
    },
    themes: []
  };
  const entries = await adapter.list('themes', { recursive: false }).catch(() => []);
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.toLowerCase().endsWith('.json')) continue;
    try {
      config.themes.push(JSON.parse(await adapter.read(entry.path, { encoding: 'utf8' })));
    } catch {
      /* 坏主题文件跳过。 */
    }
  }
  return config;
}

function stamp() {
  return new Date().toISOString();
}

export function registerTemplateRoutes(app, ctx) {
  /* 元信息：分类、类型、限制与回收站条目数。 */
  app.get('/api/sites/:siteId/templates/meta', async (request) => {
    const { siteId, adapter } = siteOf(ctx, request);
    const trash = await listTrashRecords(adapter);
    return {
      ok: true,
      data: {
        siteId,
        categories: TEMPLATE_CATEGORIES,
        kinds: TEMPLATE_KINDS,
        limits: TEMPLATE_LIMITS,
        trashCount: trash.length
      }
    };
  });

  /* 起步模板：平台内置的四套完整站点骨架，不落盘，直接按站点套用。 */
  app.get('/api/templates/starters', async () => ({ ok: true, data: { items: listStarters() } }));

  app.get('/api/sites/:siteId/templates/starters', async (request) => {
    const { siteId } = siteOf(ctx, request);
    return { ok: true, data: { siteId, items: listStarters() } };
  });

  app.post('/api/sites/:siteId/templates/starters/:starterId/apply', async (request, reply) => {
    const { siteId, adapter } = siteOf(ctx, request);
    const starter = getStarter(request.params.starterId);
    const result = await applyStarter(adapter, starter);
    reply.code(201);
    return { ok: true, data: Object.assign({ siteId }, result) };
  });

  /* 列表：返回摘要与标签集合，搜索/筛选在页面侧完成。 */
  app.get('/api/sites/:siteId/templates', async (request) => {
    const { siteId, adapter } = siteOf(ctx, request);
    const records = await listRecords(adapter);
    const items = records.map((item) => templateInfo(item.template));
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const tags = [];
    for (const item of items) {
      for (const tag of item.tags) if (!tags.includes(tag)) tags.push(tag);
    }
    tags.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { ok: true, data: { siteId, items, tags } };
  });

  app.get('/api/sites/:siteId/templates/trash', async (request) => {
    const { siteId, adapter } = siteOf(ctx, request);
    return { ok: true, data: { siteId, items: await listTrashRecords(adapter) } };
  });

  /* 保存页面为模板 / 保存整站为模板。 */
  app.post('/api/sites/:siteId/templates', async (request, reply) => {
    const { siteId, adapter } = siteOf(ctx, request);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const kind = body.kind === 'site' ? 'site' : 'page';
    const records = await listRecords(adapter);
    const takenIds = usedIds(records);
    const takenNames = new Set(records.map((item) => item.template.name));
    const now = stamp();
    const displayName = await siteName(adapter, siteId);
    let pages;
    let pageSource;
    let config;

    if (kind === 'page') {
      const pageId = asText(body.pageId).trim();
      if (!PAGE_ID_RE.test(pageId)) throw fail(422, 'LC_E_TEMPLATE_SOURCE', '请选择要保存的页面');
      let page;
      try {
        page = await readJson(adapter, pageRel(pageId), 'LC_E_TEMPLATE_SOURCE', '要保存的页面不存在');
      } catch (error) {
        if (error.statusCode === 404) throw fail(404, 'LC_E_TEMPLATE_SOURCE', '要保存的页面不存在：' + pageId);
        throw error;
      }
      pages = [pageSnapshot(Object.assign({ id: pageId }, page), pageId)];
      pageSource = { pageId, pageTitle: pages[0].title };
    } else {
      const all = await readAllPages(adapter);
      if (!all.length) throw fail(422, 'LC_E_TEMPLATE_SOURCE', '当前站点还没有页面，不能存成站点模板');
      if (all.length > TEMPLATE_LIMITS.pagesMax) {
        throw fail(422, 'LC_E_TEMPLATE_PAGES', '站点页面超过 ' + TEMPLATE_LIMITS.pagesMax + ' 个，暂不支持整体存成模板');
      }
      pages = all.map((page) => pageSnapshot(page, page.id));
      config = await snapshotSiteConfig(adapter, await readProject(adapter));
      pageSource = {};
    }

    const meta = normalizeTemplateMeta({
      name: body.name,
      kind,
      category: body.category,
      tags: body.tags,
      description: body.description
    });
    if (takenNames.has(meta.name)) {
      throw fail(409, 'LC_E_TEMPLATE_NAME', '已有同名模板：' + meta.name);
    }
    const requestedId = asText(body.id).trim();
    const baseId = requestedId ? normalizeTemplateId(requestedId) : slugifyId(meta.name, kind + '-template');
    const id = uniqueId(baseId, takenIds);
    const componentIds = collectComponentIds(pages);
    const components = await snapshotComponents(adapter, componentIds);
    const template = {
      id,
      name: meta.name,
      kind,
      category: meta.category,
      tags: meta.tags,
      description: meta.description,
      source: Object.assign({ siteId, siteName: displayName, savedAt: now }, pageSource),
      createdAt: now,
      updatedAt: now,
      components
    };
    if (kind === 'site') {
      template.pages = pages;
      template.config = config;
    } else {
      template.page = pages[0];
    }
    await adapter.write(templateRel(id), JSON.stringify(exportPayload(template), null, 2));
    reply.code(201);
    return { ok: true, data: { template, info: templateInfo(template) } };
  });

  /* 导入：接受本平台导出的信封，也接受裸模板本体。 */
  app.post('/api/sites/:siteId/templates/import', async (request, reply) => {
    const { siteId, adapter } = siteOf(ctx, request);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    let raw;
    if (typeof body.content === 'string') {
      if (Buffer.byteLength(body.content) > TEMPLATE_LIMITS.importBytes) {
        throw fail(422, 'LC_E_TEMPLATE_SIZE', '模板文件超过 ' + Math.round(TEMPLATE_LIMITS.importBytes / 1024) + ' KB');
      }
      try {
        raw = JSON.parse(body.content);
      } catch {
        throw fail(422, 'LC_E_TEMPLATE_FORMAT', '模板文件不是合法 JSON');
      }
    } else if (body.template && typeof body.template === 'object' && body.template.format === undefined) {
      raw = { format: 'lowcode-template', schemaVersion: 1, template: body.template };
    } else {
      raw = body;
    }

    let template;
    try {
      template = normalizeTemplateRecord(raw);
    } catch (error) {
      throw error;
    }
    const records = await listRecords(adapter);
    const takenIds = usedIds(records);
    const takenNames = new Set(records.map((item) => item.template.name));
    const now = stamp();
    const id = uniqueId(asText(template.id) || slugifyId(template.name, 'imported-template'), takenIds);
    const name = uniqueName(template.name, takenNames);
    const componentIds = collectComponentIds(template.kind === 'site' ? template.pages : [template.page]);
    const provided = new Set((Array.isArray(template.components) ? template.components : []).map((item) => asText(item.id)));
    const missing = componentIds.filter((item) => !provided.has(item));
    const final = Object.assign({}, template, {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      source: Object.assign({}, template.source, { siteId, siteName: await siteName(adapter, siteId), importedAt: now })
    });
    await adapter.write(templateRel(id), JSON.stringify(exportPayload(final), null, 2));
    const notices = [];
    if (id !== template.id) notices.push('模板 ID 改为「' + id + '」');
    if (name !== template.name) notices.push('模板名称改为「' + name + '」');
    if (missing.length) notices.push('模板未包含组件：' + missing.join('、') + '，套用时需要先补齐组件');
    reply.code(201);
    return { ok: true, data: { template: final, info: templateInfo(final), notices } };
  });

  app.get('/api/sites/:siteId/templates/:templateId/export', async (request, reply) => {
    const { adapter } = siteOf(ctx, request);
    const template = await readTemplate(adapter, request.params.templateId);
    const payload = exportPayload(template);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="' + template.id + '.template.json"');
    return payload;
  });

  app.get('/api/sites/:siteId/templates/:templateId', async (request) => {
    const { adapter } = siteOf(ctx, request);
    const template = await readTemplate(adapter, request.params.templateId);
    return { ok: true, data: { template, info: templateInfo(template) } };
  });

  /* 只改模板信息，不动内容。 */
  app.put('/api/sites/:siteId/templates/:templateId', async (request) => {
    const { adapter } = siteOf(ctx, request);
    const template = await readTemplate(adapter, request.params.templateId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const records = await listRecords(adapter);
    const meta = normalizeTemplateMeta({
      name: body.name != null ? body.name : template.name,
      kind: template.kind,
      category: body.category != null ? body.category : template.category,
      tags: body.tags != null ? body.tags : template.tags,
      description: body.description != null ? body.description : template.description
    });
    const clash = records.some((item) => item.template.id !== template.id && item.template.name === meta.name);
    if (clash) throw fail(409, 'LC_E_TEMPLATE_NAME', '已有同名模板：' + meta.name);
    const next = Object.assign(template, meta, { updatedAt: stamp() });
    await adapter.write(templateRel(next.id), JSON.stringify(exportPayload(next), null, 2));
    return { ok: true, data: { template: next, info: templateInfo(next) } };
  });

  /* 删除进回收站，可恢复。 */
  app.delete('/api/sites/:siteId/templates/:templateId', async (request) => {
    const { adapter } = siteOf(ctx, request);
    const template = await readTemplate(adapter, request.params.templateId);
    const deletedAt = stamp();
    const trashId = template.id + '-' + deletedAt.replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
    const envelope = {
      trashId,
      deletedAt,
      originalId: template.id,
      originalPath: templateRel(template.id),
      template
    };
    await adapter.write(trashRel(trashId), JSON.stringify(envelope, null, 2));
    await adapter.delete(templateRel(template.id));
    return { ok: true, data: { trashed: { trashId, deletedAt, originalId: template.id } } };
  });

  app.post('/api/sites/:siteId/templates/trash/:trashId/restore', async (request) => {
    const { adapter } = siteOf(ctx, request);
    let envelope;
    try {
      envelope = JSON.parse(await adapter.read(trashRel(request.params.trashId), { encoding: 'utf8' }));
    } catch (error) {
      if (fileMissing(error)) throw fail(404, 'LC_E_TEMPLATE_TRASH', '回收站里没有这条模板');
      throw fail(422, 'LC_E_TEMPLATE_TRASH', '回收站记录损坏');
    }
    const records = await listRecords(adapter);
    const takenIds = usedIds(records);
    const takenNames = new Set(records.map((item) => item.template.name));
    const original = envelope && envelope.template && typeof envelope.template === 'object' ? envelope.template : {};
    const template = normalizeTemplateRecord({ format: 'lowcode-template', schemaVersion: 1, template: original });
    const originalId = asText(template.id) || asText(envelope.originalId) || 'restored-template';
    const originalName = asText(template.name);
    const id = uniqueId(originalId, takenIds);
    const name = uniqueName(originalName, takenNames);
    template.id = id;
    template.name = name;
    template.updatedAt = stamp();
    await adapter.write(templateRel(id), JSON.stringify(exportPayload(template), null, 2));
    await adapter.delete(trashRel(request.params.trashId));
    const notices = [];
    if (id !== originalId) notices.push('模板 ID 改为「' + id + '」');
    if (name !== originalName) notices.push('模板名称改为「' + name + '」');
    return { ok: true, data: { template, info: templateInfo(template), notices } };
  });

  /* 套用：新建页面，或覆盖现有页面（需要确认）。 */
  app.post('/api/sites/:siteId/templates/:templateId/apply', async (request, reply) => {
    const { siteId, adapter } = siteOf(ctx, request);
    const template = await readTemplate(adapter, request.params.templateId);
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const mode = body.mode === 'overwrite' ? 'overwrite' : 'new';
    const confirmed = Boolean(body.confirm) || String((request.query && request.query.confirm) || '') === '1';

    /* 先把模板引用的组件补齐；已存在的绝不覆盖。 */
    const installedComponents = [];
    const skippedComponents = [];
    const existingComponentIds = new Set();
    const componentEntries = await adapter.list('components', { recursive: false }).catch(() => []);
    for (const entry of componentEntries) {
      if (entry.kind === 'file' && entry.path.toLowerCase().endsWith('.json')) {
        existingComponentIds.add(path.posix.basename(entry.path, '.json'));
      }
    }
    for (const component of Array.isArray(template.components) ? template.components : []) {
      const id = asText(component && component.id).trim();
      if (!id || id.startsWith('builtin:')) continue;
      if (existingComponentIds.has(id)) {
        skippedComponents.push(id);
        continue;
      }
      const normalized = normalizeStoredComponent(component);
      normalized.id = id;
      await adapter.write('components/' + id + '.json', JSON.stringify(normalized, null, 2));
      installedComponents.push(id);
      existingComponentIds.add(id);
    }

    if (mode === 'overwrite' && template.kind === 'site') {
      throw fail(422, 'LC_E_TEMPLATE_APPLY', '站点模板不支持覆盖现有页面，请使用新建页面');
    }

    const pages = await readAllPages(adapter);

    if (mode === 'overwrite') {
      const pageId = asText(body.pageId).trim();
      if (!PAGE_ID_RE.test(pageId)) throw fail(422, 'LC_E_TEMPLATE_APPLY', '请选择要覆盖的页面');
      const target = pages.find((page) => page.id === pageId);
      if (!target) throw fail(404, 'LC_E_TEMPLATE_APPLY', '要覆盖的页面不存在：' + pageId);
      if (!confirmed) {
        throw fail(409, 'LC_E_TEMPLATE_OVERWRITE', '套用会覆盖页面「' + asText(target.title || target.id) + '」的当前内容', {
          page: { id: target.id, title: asText(target.title), path: asText(target.path) },
          template: { id: template.id, name: template.name },
          message: '确认后会用模板内容替换页面区块与布局，原页面会先备份。'
        });
      }
      await createBackup(adapter.siteDir, {
        siteId,
        reason: 'template-overwrite-' + template.id,
        paths: [pageRel(target.id)]
      });
      const def = template.page;
      const next = Object.assign({}, target, {
        schemaVersion: 2,
        title: asText(body.title).trim() || asText(target.title) || def.title,
        nav: def.nav !== false,
        layout: def.layout,
        blocks: JSON.parse(JSON.stringify(def.blocks))
      });
      /* 覆盖时双端字段要跟模板走：模板没有移动端就删掉，避免留下旧页面的移动端内容。 */
      if (def.independentUi === true && Array.isArray(def.blocksMobile)) {
        next.independentUi = true;
        next.blocksMobile = JSON.parse(JSON.stringify(def.blocksMobile));
      } else {
        delete next.independentUi;
        delete next.blocksMobile;
      }
      /* 页面级设置同样以模板为准：模板没有的字段要清掉，避免旧页面设置残留。 */
      const extras = pageExtraFields(def);
      for (const key of PAGE_EXTRA_FIELDS) {
        if (key in extras) next[key] = extras[key];
        else delete next[key];
      }
      await adapter.write(pageRel(target.id), JSON.stringify(next, null, 2));
      return {
        ok: true,
        data: {
          mode,
          pages: [next],
          overwritten: { id: target.id, title: asText(target.title), path: asText(target.path) },
          installedComponents,
          skippedComponents,
          notices: ['页面已覆盖，原内容已备份']
        }
      };
    }

    /* 新建：页面模板建一页，站点模板建全部页面。 */
    const sources = template.kind === 'site' ? template.pages : [template.page];
    const takenIds = new Set(pages.map((page) => asText(page.id)));
    const takenSlugs = new Set(pages.map((page) => asText(page.slug)));
    const takenPaths = new Set(pages.map((page) => asText(page.path)));
    const created = [];
    const mapping = new Map();
    const notices = [];

    for (const def of sources) {
      const requestedTitle = sources.length === 1
        ? asText(body.title).trim() || def.title
        : def.title;
      const requestedSlug = sources.length === 1
        ? asText(body.slug).trim() || def.slug || def.id
        : def.slug || def.id;
      const requestedPath = sources.length === 1 && asText(body.path).trim()
        ? asText(body.path).trim().replace(/^\/+/, '')
        : asText(def.path);
      const requestedId = sources.length === 1
        ? asText(body.id).trim() || asText(body.slug).trim() || def.id
        : def.id;
      const baseSlug = uniqueValue(safeSlug(requestedSlug, 'page'), takenSlugs);
      const baseId = uniqueValue(safeSlug(requestedId || baseSlug, baseSlug), takenIds);
      if (requestedPath && !PAGE_PATH_RE.test(requestedPath)) {
        throw fail(422, 'LC_E_TEMPLATE_PATH', '页面输出路径「' + requestedPath + '」不合法，必须相对站点根并以 .html 结尾');
      }
      const basePath = uniquePath(requestedPath || (baseId + '.html'), takenPaths);
      const page = {
        schemaVersion: 2,
        id: baseId,
        title: requestedTitle,
        slug: baseSlug,
        path: basePath,
        nav: def.nav !== false,
        layout: JSON.parse(JSON.stringify(def.layout || { mode: 'flow' })),
        blocks: JSON.parse(JSON.stringify(def.blocks))
      };
      if (def.independentUi === true && Array.isArray(def.blocksMobile)) {
        page.independentUi = true;
        page.blocksMobile = JSON.parse(JSON.stringify(def.blocksMobile));
      }
      Object.assign(page, pageExtraFields(def));
      await adapter.write(pageRel(page.id), JSON.stringify(page, null, 2));
      created.push(page);
      mapping.set(def.id, page.id);
      takenIds.add(page.id);
      takenSlugs.add(page.slug);
      takenPaths.add(page.path);
      if (page.id !== def.id) notices.push('页面「' + page.title + '」id 改为「' + page.id + '」');
      if (page.path !== (def.path || def.id + '.html')) notices.push('页面「' + page.title + '」输出路径改为「' + page.path + '」');
    }

    let configApplied = false;
    if (template.kind === 'site' && body.applyConfig) {
      const config = template.config && typeof template.config === 'object' ? template.config : {};
      const project = await readProject(adapter);
      const themes = Array.isArray(config.themes) ? config.themes : [];
      const existingThemes = new Set();
      const themeEntries = await adapter.list('themes', { recursive: false }).catch(() => []);
      for (const entry of themeEntries) {
        if (entry.kind === 'file') existingThemes.add(path.posix.basename(entry.path, '.json'));
      }
      for (const theme of themes) {
        const themeId = asText(theme && theme.id).trim();
        if (!themeId || existingThemes.has(themeId)) continue;
        await adapter.write('themes/' + themeId + '.json', JSON.stringify(theme, null, 2));
        existingThemes.add(themeId);
      }
      const nav = config.navigation && Array.isArray(config.navigation.items) ? config.navigation : null;
      if (nav && nav.items.length) {
        const items = [];
        for (const item of nav.items) {
          const mapped = mapping.get(asText(item.pageId));
          if (!mapped) continue;
          items.push({ id: asText(item.id) || mapped, label: asText(item.label) || mapped, pageId: mapped });
        }
        if (items.length) {
          project.navigation = { items };
          configApplied = true;
        }
      }
      if (config.footer && typeof config.footer === 'object') {
        project.footer = config.footer;
        configApplied = true;
      }
      const activeId = asText(config.theme && config.theme.activeId);
      if (activeId && existingThemes.has(activeId)) {
        project.theme = Object.assign({}, project.theme, { activeId });
        configApplied = true;
      }
      if (configApplied) {
        await adapter.write('project.json', JSON.stringify(project, null, 2));
      }
    }

    reply.code(201);
    return {
      ok: true,
      data: {
        mode: 'new',
        pages: created,
        configApplied,
        installedComponents,
        skippedComponents,
        notices
      }
    };
  });
}

/* 中文等 Unicode 字母数字保留进别名（URL 里百分号编码即可），emoji 与标点剔除；
   剔除后没有字母数字时才退化为 fallback。按码点截断，避免把代理对切成半个字符。 */
function safeSlug(value, fallback) {
  const text = asText(value).trim().toLowerCase();
  const safe = Array.from(text.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, 48).join('');
  return safe && /[\p{L}\p{N}]/u.test(safe) ? safe : fallback;
}

function uniqueValue(base, taken) {
  const value = asText(base);
  if (!taken.has(value)) return value;
  let n = 2;
  while (taken.has(value + '-' + n)) n += 1;
  return value + '-' + n;
}

/* 页面路径冲突时把后缀加在 .html 之前，保持路径始终满足 PAGE_PATH_RE（BLD-03 / TPL-01）。 */
function uniquePath(base, taken) {
  const value = asText(base);
  if (!taken.has(value)) return value;
  const stem = value.replace(/\.html$/i, '');
  let n = 2;
  while (taken.has(stem + '-' + n + '.html')) n += 1;
  return stem + '-' + n + '.html';
}
