/* 起步模板 · 服务端套用
   模板本体在渲染核心的 templates/starters.js，四套：文档站、落地页、仪表盘、认证中心。
   这里只负责把模板数据落进站点：写入页面与文章、外壳区块引用、主题，不动数据源与导出配置。
   页面 id / 路径冲突时自动加后缀，并同步改写外壳引用。 */
import Render from '../../../src/render/node.cjs';
import { asText, fail } from './model.js';

const PAGE_ID_RE = /^[a-zA-Z0-9_-]{1,48}$/;
/* 页面输出路径允许中文等 Unicode 字母数字（浏览器按百分号编码访问）。 */
const PAGE_PATH_RE = /^[\p{L}\p{N}][\p{L}\p{N}/_-]*\.html$/u;

function starterLib() {
  return Render.loadModule('./templates/starters.js');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function listStarters() {
  const library = starterLib();
  const items = library.listStarterTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    tags: Array.isArray(template.tags) ? template.tags.slice() : [],
    themeId: asText(template.themeId),
    kind: 'site',
    pageCount: Array.isArray(template.pages) ? template.pages.length : 0,
    pageTitles: (template.pages || []).map((page) => asText(page.title) || asText(page.id))
  }));
  return items;
}

export function getStarter(id) {
  const value = asText(id).trim();
  if (!PAGE_ID_RE.test(value)) {
    throw fail(422, 'LC_E_STARTER_ID', '起步模板 ID 不合法');
  }
  const template = starterLib().getStarterTemplate(value);
  if (!template) throw fail(404, 'LC_E_STARTER_NOT_FOUND', '起步模板不存在：' + value);
  return template;
}

function uniqueValue(base, taken) {
  const value = asText(base);
  if (!taken.has(value)) return value;
  let n = 2;
  while (taken.has(value + '-' + n)) n += 1;
  return value + '-' + n;
}

/* 页面路径的唯一化必须把后缀插在 .html 之前，否则会得到 index.html-2 这种
   不符合 PAGE_PATH_RE 的非法路径（BLD-03 / TPL-01）。 */
function uniquePath(base, taken) {
  const value = asText(base);
  if (!taken.has(value)) return value;
  const stem = value.replace(/\.html$/i, '');
  let n = 2;
  while (taken.has(stem + '-' + n + '.html')) n += 1;
  return stem + '-' + n + '.html';
}

function safeSlug(value, fallback) {
  const text = asText(value).trim().toLowerCase();
  const safe = text.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return safe || fallback;
}

/* 外壳区块里的 pageId 统一按映射改写，避免页面被改名后导航断链。 */
function remapShell(value, mapping) {
  if (Array.isArray(value)) return value.map((item) => remapShell(item, mapping));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === 'pageId') out[key] = mapping.get(asText(value[key])) || value[key];
    else out[key] = remapShell(value[key], mapping);
  }
  return out;
}

async function readJson(adapter, rel) {
  const text = await adapter.read(rel, { encoding: 'utf8' });
  return JSON.parse(text);
}

async function existingPages(adapter) {
  const entries = await adapter.list('pages', { recursive: false }).catch(() => []);
  const list = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.toLowerCase().endsWith('.json')) continue;
    try {
      const page = await readJson(adapter, entry.path);
      list.push(Object.assign({ id: entry.path.split('/').pop().replace(/\.json$/i, '') }, page));
    } catch {
      /* 坏页面不阻塞套用。 */
    }
  }
  return list;
}

export async function applyStarter(adapter, starter, options = {}) {
  const pages = await existingPages(adapter);
  const takenIds = new Set(pages.map((page) => asText(page.id)));
  const takenSlugs = new Set(pages.map((page) => asText(page.slug)));
  const takenPaths = new Set(pages.map((page) => asText(page.path)));

  /* 新建站点会先落一个空白默认首页；紧接着套用多页起步模板时，这个空首页
     应由模板首页替换，而不是留下重复的「首页」再把模板首页挤成 index.html-2。 */
  const starterPaths = (Array.isArray(starter.pages) ? starter.pages : []).map((def) => asText(def.path));
  const seededDefault = starterPaths.includes('index.html') &&
    pages.length === 1 &&
    asText(pages[0].id) === 'home' &&
    asText(pages[0].path) === 'index.html' &&
    !(Array.isArray(pages[0].blocks) ? pages[0].blocks.length : 0) &&
    !pages[0].overrides;
  if (seededDefault) {
    takenIds.delete('home');
    takenSlugs.delete(asText(pages[0].slug));
    takenPaths.delete('index.html');
  }

  const project = await readJson(adapter, 'project.json').catch(() => null);
  if (!project) throw fail(422, 'LC_E_PROJECT_MISSING', '站点缺少 project.json，无法套用起步模板');

  const created = [];
  const mapping = new Map();
  const notices = [];

  for (const def of Array.isArray(starter.pages) ? starter.pages : []) {
    const requestedId = asText(def.id) || 'page';
    const requestedPath = asText(def.path) || requestedId + '.html';
    if (!PAGE_PATH_RE.test(requestedPath)) {
      throw fail(422, 'LC_E_STARTER_PAGE', '起步模板页面路径不合法：' + requestedPath);
    }
    const id = uniqueValue(requestedId, takenIds);
    const slug = uniqueValue(safeSlug(asText(def.slug) || requestedId, id), takenSlugs);
    const finalPath = uniquePath(requestedPath, takenPaths);
    const page = {
      schemaVersion: 2,
      id,
      title: asText(def.title) || id,
      slug,
      path: finalPath,
      nav: def.nav !== false,
      layout: clone(def.layout && typeof def.layout === 'object' ? def.layout : { mode: 'flow' }),
      blocks: clone(Array.isArray(def.blocks) ? def.blocks : [])
    };
    if (def.shell && typeof def.shell === 'object') page.shell = clone(def.shell);
    if (def.article) {
      page.article = clone(def.article);
      if (page.article && typeof page.article === 'object' && page.article.id) {
        page.article.id = mapping.get(asText(page.article.id)) || asText(page.article.id);
      }
    }
    mapping.set(requestedId, id);
    takenIds.add(id);
    takenSlugs.add(slug);
    takenPaths.add(finalPath);
    created.push(page);
    if (id !== requestedId) notices.push('页面「' + page.title + '」ID 改为「' + id + '」');
    if (finalPath !== requestedPath) notices.push('页面「' + page.title + '」路径改为「' + finalPath + '」');
  }

  for (const page of created) {
    await adapter.write('pages/' + page.id + '.json', JSON.stringify(page, null, 2));
  }

  /* 模板首页用别的 id 接管 index.html 时，删掉被替换的空白默认页；
     若模板自己用了 home 这个 id，上面已覆盖同一文件，不能再删。 */
  if (seededDefault && !created.some((page) => page.id === 'home')) {
    await adapter.delete('pages/home.json', { note: '套用起步模板替换空白默认首页' }).catch(() => {});
  }

  /* 文章列表：文档站的目录与上下篇依赖这份顺序。 */
  const articles = [];
  for (const def of Array.isArray(starter.articles) ? starter.articles : []) {
    const originalId = asText(def.id);
    const id = mapping.get(originalId) || originalId;
    if (!id) continue;
    const page = created.find((item) => item.id === id);
    const article = {
      id,
      title: asText(def.title) || (page && page.title) || id,
      path: (page && page.path) || asText(def.path) || id + '.html',
      summary: asText(def.summary)
    };
    articles.push(article);
    await adapter.write('articles/' + id + '.json', JSON.stringify(article, null, 2));
  }

  const shellBlocks = remapShell(clone(Array.isArray(starter.shellBlocks) ? starter.shellBlocks : []), mapping);
  const source = starter.project && typeof starter.project === 'object' ? starter.project : {};
  project.template = { id: starter.id };
  project.shellBlocks = shellBlocks;
  ['navigation', 'footer', 'sidebar', 'breadcrumb'].forEach((key) => {
    if (source[key] && typeof source[key] === 'object') project[key] = clone(source[key]);
  });
  if (asText(starter.themeId)) {
    project.theme = Object.assign({}, project.theme, { activeId: asText(starter.themeId) });
  }
  await adapter.write('project.json', JSON.stringify(project, null, 2));

  return {
    mode: 'new',
    starter: { id: starter.id, name: starter.name },
    pages: created,
    articleCount: articles.length,
    appliedConfig: { shell: shellBlocks.length, themeId: asText(starter.themeId) },
    notices
  };
}
