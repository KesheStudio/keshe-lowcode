import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { normalizeRelPath, sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { loadSiteData } from '../export/pipeline.js';
import { registerBaseBlocks, baseBlockSchemas } from '../export/base-blocks.js';
import { readFlow } from '../flow/store.js';
import { startPreview, previewInfo } from '../flow/preview.js';

const require = createRequire(import.meta.url);
const Render = require('../../../src/render/node.cjs');
const Mermaid = require('../../../shared/mermaid.js');

const ASSET_MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf']
]);

/* 容器和自定义组件由引擎特判，不属于可注册区块，这里补上面板需要的 schema。 */
const STRUCTURAL_SCHEMAS = [
  {
    type: 'container',
    name: '容器',
    store: 'block',
    props: {
      title: { type: 'string', label: '容器标题', default: '' },
      variant: { type: 'enum', label: '布局', options: [
        { value: 'card', label: '卡片（流式）' },
        { value: 'columns', label: '分栏' },
        { value: 'free', label: '自由定位' },
        { value: 'accordion', label: '折叠面板' }
      ], default: 'card' },
      columns: { type: 'number', label: '分栏数（1–6）', min: 1, max: 6, default: 2 },
      open: { type: 'boolean', label: '折叠面板默认展开', default: true }
    }
  }
];

function escapeAttr(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

function builderCss(mode, pageSize) {
  var lines = [
    'html { color-scheme: ' + (mode === 'dark' ? 'dark' : 'light') + '; }',
    'html, body { margin: 0; padding: 0; min-height: 100%; background: var(--lc-color-bg, #f4f0e6); color: var(--lc-color-ink, #1d2320); }',
    'body { min-height: 100vh; }',
    '.lc-page { min-height: 100vh; }',
    '[data-lc-canvas-empty] {',
    '  position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;',
    '  padding: 32px; text-align: center; pointer-events: none;',
    '}',
    '[data-lc-canvas-empty] .lc-canvas-empty-card {',
    '  max-width: 340px; padding: 24px 28px; border: 1px dashed var(--lc-color-line-strong, #b9b2a1);',
    '  border-radius: var(--lc-radius-md, 10px); background: var(--lc-color-surface, #fffefb);',
    '  box-shadow: var(--lc-shadow-sm, 0 1px 2px rgba(0,0,0,.06));',
    '}',
    '[data-lc-canvas-empty] strong { display: block; margin-bottom: 6px; font-size: var(--lc-text-md, 15px); }',
    '[data-lc-canvas-empty] span { color: var(--lc-color-muted, #6d756e); font-size: var(--lc-text-sm, 13px); line-height: 1.6; }',
    '[data-lc-builder] .lc-block { position: relative; }',
    '[data-lc-builder] .lc-block:hover { outline: 1px dashed var(--lc-color-accent-line, #8ea08e); outline-offset: 3px; }',
    '[data-lc-builder] .lc-block[data-lc-selected="true"] { outline: 2px solid var(--lc-color-accent, #3e6a56); outline-offset: 3px; }',
    '[data-lc-builder] .lc-block[data-lc-drop="before"] { box-shadow: inset 0 3px 0 var(--lc-color-accent, #3e6a56); }',
    '[data-lc-builder] .lc-block[data-lc-drop="after"] { box-shadow: inset 0 -3px 0 var(--lc-color-accent, #3e6a56); }',
    '[data-lc-builder] .lc-block[data-lc-drop="inside"] { outline: 2px dashed var(--lc-color-accent, #3e6a56); outline-offset: 2px; }',
    '[data-lc-builder] .lc-block[data-lc-selected="true"]::before {',
    '  content: attr(data-lc-type); position: absolute; top: -21px; left: -2px; z-index: 3;',
    '  padding: 1px 7px; border-radius: 4px; background: var(--lc-color-accent-fill, #3e6a56);',
    '  color: var(--lc-color-on-accent, #fbfaf5); font: 11px/1.6 var(--lc-font-mono, monospace);',
    '  pointer-events: none; white-space: nowrap;',
    '}',
    '[data-lc-builder] a, [data-lc-builder] button, [data-lc-builder] input,',
    '[data-lc-builder] select, [data-lc-builder] textarea, [data-lc-builder] summary { pointer-events: none; }',
    '[data-lc-builder] a { cursor: default; }'
  ];
  /* 页面限高时把滚动交给 .lc-page，外层文档不再出现滚动条。 */
  if (pageSize && pageSize.maxHeight) {
    lines.push('html, body { height: 100%; }');
    lines.push('body { overflow: hidden; }');
  }
  return lines.join('\n');
}

/* 画布预览与导出共用同一份官方 mermaid 运行时：只在页面确实有图块时注入，
   库走平台 /vendor（预览资源路由不读平台目录），bootstrap 负责主题与失败降级。 */
function mermaidTags(html) {
  if (!Mermaid.hasMermaidMarkup(html)) return '';
  return '<script src="/vendor/mermaid.min.js"></script>\n' + Mermaid.bootstrap();
}

/* 预览文档跑在平台同源的真实地址上，页面里的 `/api/...` 需要转到站点后端预览：
   这里把同源的 `/api/*` 请求改写到 `/preview-api/<siteId>/<sessionId>/api/*`，
   由平台服务端转发到 `startPreview` 起的站点后端，避免跨域预检。 */
function previewApiShim(apiBase) {
  const base = JSON.stringify(String(apiBase || ''));
  return [
    '<script>(function(){',
    'var BASE=' + base + ';',
    'var ORIGIN=window.location.origin;',
    'function rewrite(url){',
    '  if(typeof url!=="string" && !(url instanceof URL)) return url;',
    '  try{',
    '    var u=new URL(String(url), document.baseURI);',
    '    if(u.origin!==ORIGIN) return url;',
    '    if(u.pathname.indexOf("/api/")!==0) return url;',
    '    return BASE+u.pathname+u.search+u.hash;',
    '  }catch(e){ return url; }',
    '}',
    'var nativeFetch=window.fetch;',
    'if(nativeFetch){ window.fetch=function(input,init){',
    '  try{',
    '    if(typeof input==="string"||input instanceof URL){ input=rewrite(input); }',
    '    else if(input&&typeof input==="object"&&typeof input.url==="string"){',
    '      var next=rewrite(input.url);',
    '      if(next!==input.url) input=new Request(next,input);',
    '    }',
    '  }catch(e){ /* 改写失败时按原样请求 */ }',
    '  return nativeFetch.call(this,input,init);',
    '}; }',
    'var nativeOpen=XMLHttpRequest.prototype.open;',
    'XMLHttpRequest.prototype.open=function(method,url){',
    '  try{ arguments[1]=rewrite(url); }catch(e){ /* 保持原样 */ }',
    '  return nativeOpen.apply(this,arguments);',
    '};',
    '})();<\/script>'
  ].join('\n');
}

function previewDocument(input) {
  const { siteId, sessionId, page, themeId, mode, css, html, scriptsHtml, empty, pageSize } = input;
  const base = '/preview/' + encodeURIComponent(siteId) + '/' + sessionId + '/';
  const apiBase = '/preview-api/' + encodeURIComponent(siteId) + '/' + sessionId;
  const emptyHtml = empty
    ? '<div data-lc-canvas-empty><div class="lc-canvas-empty-card"><strong>页面还没有内容</strong>' +
      '<span>从左侧组件库拖入一个组件，或点击画布上的区块开始编辑。</span></div></div>'
    : '';
  return [
    '<!doctype html>',
    '<html lang="zh-CN" data-lc-theme="' + escapeAttr(themeId || '') + '" data-lc-mode="' + escapeAttr(mode) + '" data-lc-builder="1">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeAttr(page.title || '页面预览') + '</title>',
    '<base href="' + escapeAttr(base) + '">',
    previewApiShim(apiBase),
    '<style id="lc-preview-theme">\n' + css + '\n</style>',
    '<style id="lc-preview-builder">\n' + builderCss(mode, pageSize) + '\n</style>',
    '</head>',
    '<body>',
    html,
    emptyHtml,
    scriptsHtml || '',
    mermaidTags(html),
    '<script src="/assets/canvas-bridge.js"><\/script>',
    '</body>',
    '</html>'
  ].join('\n');
}

/* ---------------- 画布预览会话 ----------------
   预览文档放在内存里，浏览器通过同源地址 /preview/<siteId>/<sessionId> 加载，
   不再用 srcdoc（不透明源会触发跨域预检）。会话带 TTL 与数量上限，避免长期占用内存。 */
const PREVIEW_SESSION_TTL_MS = 30 * 60 * 1000;
const PREVIEW_SESSION_MAX = 48;
const previewSessions = new Map();
/* 同一个站点的后端预览只启动一次，并发请求共享同一个启动 Promise。 */
const previewBoots = new Map();

function newPreviewId() {
  return randomUUID().replace(/-/g, '').slice(0, 24);
}

function prunePreviewSessions() {
  const now = Date.now();
  for (const [id, entry] of previewSessions) {
    if (now - entry.touchedAt > PREVIEW_SESSION_TTL_MS) previewSessions.delete(id);
  }
  while (previewSessions.size > PREVIEW_SESSION_MAX) {
    let oldestId = '';
    let oldestAt = Infinity;
    for (const [id, entry] of previewSessions) {
      if (entry.touchedAt < oldestAt) {
        oldestAt = entry.touchedAt;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    previewSessions.delete(oldestId);
  }
}

function storePreviewSession(siteId, id, documentHtml) {
  prunePreviewSessions();
  previewSessions.set(id, { siteId, document: documentHtml, createdAt: Date.now(), touchedAt: Date.now() });
}

function readPreviewSession(siteId, sessionId) {
  const entry = previewSessions.get(String(sessionId || ''));
  if (!entry || entry.siteId !== siteId) return null;
  if (Date.now() - entry.touchedAt > PREVIEW_SESSION_TTL_MS) {
    previewSessions.delete(String(sessionId));
    return null;
  }
  entry.touchedAt = Date.now();
  return entry;
}

async function ensureSitePreview(ctx, siteId) {
  const current = previewInfo(siteId, 'node');
  if (current && current.running) return current;
  const key = siteId + ':node';
  if (previewBoots.has(key)) return previewBoots.get(key);
  const boot = (async () => {
    const siteDir = path.join(ctx.paths.dataDir, 'sites', siteId);
    const flow = await readFlow(siteDir, siteId, 'node');
    const started = await startPreview({
      paths: ctx.paths,
      siteId,
      siteDir,
      flowDoc: flow.doc,
      target: 'node'
    });
    return { url: started.url, port: started.port };
  })().finally(() => previewBoots.delete(key));
  previewBoots.set(key, boot);
  return boot;
}

function pageFile(pageId) {
  const id = String(pageId || '').trim();
  if (!id || /[\\/]/.test(id)) {
    const error = new Error('页面标识不合法');
    error.statusCode = 400;
    throw error;
  }
  return 'pages/' + id + '.json';
}

async function readPageFile(ctx, siteId, pageId) {
  const adapter = createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
  const rel = pageFile(pageId);
  const stat = await adapter.stat(rel);
  if (!stat.exists) {
    const error = new Error('页面不存在：' + pageId);
    error.statusCode = 404;
    throw error;
  }
  const text = await adapter.read(rel, { encoding: 'utf8' });
  let page;
  try {
    page = JSON.parse(text);
  } catch (error) {
    const invalid = new Error('页面 JSON 解析失败：' + error.message);
    invalid.statusCode = 422;
    throw invalid;
  }
  return { page, path: rel, rev: await adapter.rev(), hash: stat.hash };
}

function registeredRenderer(site) {
  if (!Render.ready) {
    const error = new Error('渲染层缺少模块：' + (Render.missing || []).join(', '));
    error.statusCode = 500;
    throw error;
  }
  const registry = Render.createRegistry();
  Render.registerBuiltinComponents(registry);
  registerBaseBlocks(registry);
  return Render.createRenderer(site, { preview: true, registry });
}

function siteIdOf(request) {
  return sanitizeSiteId(request.params.id);
}

/* ---------------- 资源导入（页面 / 组件 / 模板） ---------------- */

const IMPORT_MAX_BYTES = 512 * 1024;
const IMPORT_KINDS = new Set(['page', 'component', 'template']);
/* 页面输出路径允许中文等 Unicode 字母数字（浏览器按百分号编码访问）。 */
const PAGE_PATH_RE = /^[\p{L}\p{N}][\p{L}\p{N}/_-]*\.html$/u;

function importFail(status, code, message) {
  const error = new Error(message);
  error.statusCode = status;
  error.importCode = code;
  return error;
}

function readImportPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const kind = String(payload.kind || '');
  if (!IMPORT_KINDS.has(kind)) {
    throw importFail(400, 'LC_E_IMPORT_KIND', '导入类型必须是 page / component / template');
  }
  const filename = String(payload.filename || '').trim();
  const content = payload.content;
  if (typeof content !== 'string' || !content) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '文件内容为空，无法导入');
  }
  const bytes = Buffer.byteLength(content);
  if (bytes > IMPORT_MAX_BYTES) {
    throw importFail(413, 'LC_E_IMPORT_SIZE',
      '文件超过 512 KB（' + Math.ceil(bytes / 1024) + ' KB），请拆分后再导入');
  }
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '文件不是合法 JSON：' + error.message);
  }
  return { kind, filename, data };
}

function knownBlockTypes() {
  const types = new Set(['container', 'component']);
  baseBlockSchemas().forEach((schema) => types.add(schema.type));
  const builtin = typeof Render.componentsSchemas === 'function' ? Render.componentsSchemas() : [];
  builtin.forEach((schema) => types.add(schema.type));
  return types;
}

function nextBlockId(used) {
  let id;
  do { id = 'b-' + randomUUID().slice(0, 8); } while (used.has(id));
  return id;
}

function normalizeImportBlocks(blocks, ctx, label, renames) {
  if (!Array.isArray(blocks)) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', label + ' 缺少 blocks 数组');
  }
  const renamed = renames || Object.create(null);
  blocks.forEach((block, index) => {
    const at = label + '第 ' + (index + 1) + ' 个区块';
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      throw importFail(422, 'LC_E_IMPORT_FORMAT', at + ' 不是对象');
    }
    const type = typeof block.type === 'string' ? block.type.trim() : '';
    if (!type) throw importFail(422, 'LC_E_IMPORT_FORMAT', at + ' 缺少 type');
    if (!ctx.types.has(type)) {
      throw importFail(422, 'LC_E_IMPORT_FORMAT', at + ' 的类型「' + type + '」不在当前区块库中');
    }
    const originalId = typeof block.id === 'string' && block.id ? block.id : '';
    if (!originalId || ctx.ids.has(block.id)) {
      block.id = nextBlockId(ctx.ids);
      if (originalId) renamed[originalId] = block.id;
    }
    ctx.ids.add(block.id);
    if (type === 'component') {
      const componentId = String(block.componentId || '');
      if (!ctx.componentIds.has(componentId)) {
        throw importFail(422, 'LC_E_IMPORT_FORMAT', at + ' 引用的组件不存在：' + (componentId || '（空）'));
      }
    }
    if (type === 'container') {
      if (!Array.isArray(block.blocks)) block.blocks = [];
      else normalizeImportBlocks(block.blocks, ctx, at + ' 的子级：', renames);
    } else if (Array.isArray(block.blocks)) {
      normalizeImportBlocks(block.blocks, ctx, at + ' 的子级：', renames);
    }
  });
  return blocks;
}

/* 导入时被换掉的 id 可能还留在绑定目标、锚点 href 里；按端各自重映射，
   避免改名后的区块和引用指向另一端的同名区块。 */
const CODE_REMAP_KEYS = new Set(['html', 'css', 'js', 'script']);

function escapeRegExpText(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* 自定义 JS/CSS 里可能写死区块 id：只按完整 id 匹配替换，并把替换次数记进 ctx 供导入提示。 */
function remapImportedCodeIds(text, map, ctx) {
  const ids = Object.keys(map).sort((a, b) => b.length - a.length);
  if (!ids.length) return text;
  const pattern = new RegExp('(?<![A-Za-z0-9_-])(' + ids.map(escapeRegExpText).join('|') +
    ')(?![A-Za-z0-9_-])', 'g');
  return text.replace(pattern, (match, id) => {
    if (ctx) ctx.codeRemaps = (ctx.codeRemaps || 0) + 1;
    return map[id];
  });
}

function remapImportedRefs(value, map, key, ctx) {
  if (typeof value === 'string') {
    if (map[value]) return map[value];
    if (key === 'target' || key === 'targetId' || key === 'selector' || key === 'href') {
      return value.replace(/#([A-Za-z0-9_-]+)/g, function (match, id) {
        return map[id] ? '#' + map[id] : match;
      });
    }
    if (CODE_REMAP_KEYS.has(key)) return remapImportedCodeIds(value, map, ctx);
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = remapImportedRefs(value[i], map, '', ctx);
    return value;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (childKey) {
      value[childKey] = remapImportedRefs(value[childKey], map, childKey, ctx);
    });
  }
  return value;
}

/* 组件/模板 id 仍只允许 ASCII，避免中文 id 进入组件与模板的既有校验。 */
function safeSlug(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  const safe = text.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return safe || fallback;
}

/* 页面别名保留中文等 Unicode 字母数字（URL 里百分号编码即可），emoji 与标点剔除；
   剔除后没有字母数字时才退化为 fallback。按码点截断，避免把代理对切成半个字符。 */
function safePageSlug(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  const safe = Array.from(text.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, 48).join('');
  return safe && /[\p{L}\p{N}]/u.test(safe) ? safe : fallback;
}

function uniqueValue(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + '-' + n)) n += 1;
  return base + '-' + n;
}

async function loadTemplateFiles(adapter) {
  const entries = await adapter.list('templates').catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.toLowerCase().endsWith('.json')) continue;
    try {
      const text = await adapter.read(entry.path, { encoding: 'utf8' });
      out.push({ path: entry.path, data: JSON.parse(text) });
    } catch (error) { /* 坏文件跳过，列表里不显示 */ }
  }
  return out;
}

function templateInfo(entry) {
  const data = entry && entry.data;
  const template = data && data.format === 'lowcode-template' && data.template && typeof data.template === 'object'
    ? data.template
    : null;
  if (!template) return null;
  const kind = template.kind === 'site' ? 'site' : 'page';
  const pages = kind === 'site' ? (Array.isArray(template.pages) ? template.pages : []) : [template.page];
  const id = String(template.id || entry.path.replace(/^templates\//, '').replace(/\.json$/i, ''));
  return {
    id,
    name: String(template.name || id || '未命名模板'),
    kind,
    description: String(template.description || ''),
    pageCount: pages.filter((page) => page && typeof page === 'object').length
  };
}

function importContext(loaded, templateFiles) {
  const components = loaded.site.components || [];
  const pages = loaded.site.pages || [];
  return {
    types: knownBlockTypes(),
    ids: new Set(),
    componentIds: new Set(components.map((component) => String(component.id || ''))),
    componentNames: new Set(components.map((component) => String(component.name || ''))),
    pageIds: new Set(pages.map((page) => String(page.id || ''))),
    slugs: new Set(pages.map((page) => String(page.slug || ''))),
    paths: new Set(pages.map((page) => String(page.path || ''))),
    templateIds: new Set(templateFiles.map((entry) => templateInfo(entry)).filter(Boolean).map((info) => info.id))
  };
}

function normalizePageImport(raw, filename, ctx) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  let page = payload;
  if (payload.format === 'lowcode-page') {
    if (Number(payload.schemaVersion) !== 1) {
      throw importFail(422, 'LC_E_IMPORT_FORMAT', '页面文件 schemaVersion 是 ' + payload.schemaVersion + '，只接受 1');
    }
    page = payload.page;
  }
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '页面文件里没有 page 对象');
  }
  if (page.schemaVersion != null && Number(page.schemaVersion) !== 2) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '只支持 schemaVersion 2 的页面，收到 ' + page.schemaVersion);
  }
  if (typeof page.title !== 'string' || !page.title.trim()) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '页面缺少标题（title）');
  }
  if (!Array.isArray(page.blocks)) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '页面缺少 blocks 区块数组');
  }
  const fallback = safePageSlug(filename.replace(/\.json$/i, ''), 'page');
  const requestedSlug = safePageSlug(page.slug, safePageSlug(page.id, fallback));
  const requestedId = safePageSlug(page.id, requestedSlug);
  const slug = uniqueValue(requestedSlug, ctx.slugs);
  const id = uniqueValue(requestedId, ctx.pageIds);
  let htmlPath = String(page.path || '').trim().replace(/^\/+/, '');
  if (htmlPath && !PAGE_PATH_RE.test(htmlPath)) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '页面输出路径「' + htmlPath + '」不合法，必须相对站点根并以 .html 结尾');
  }
  let finalPath = htmlPath || (id + '.html');
  if (ctx.paths.has(finalPath)) {
    const base = finalPath.replace(/\.html$/i, '');
    let n = 2;
    while (ctx.paths.has(base + '-' + n + '.html')) n += 1;
    finalPath = base + '-' + n + '.html';
  }
  const desktopRenames = Object.create(null);
  const mobileRenames = Object.create(null);
  const blocks = normalizeImportBlocks(page.blocks, ctx, '页面', desktopRenames);
  /* 双端独立 UI 的移动端区块也要走同一套校验，并与桌面端共享 id 占用表，
     防止两端出现重复 id 导致绑定/锚点串台。旧页面没有这个字段时保持原样。 */
  const blocksMobile = Array.isArray(page.blocksMobile)
    ? normalizeImportBlocks(page.blocksMobile, ctx, '页面移动端', mobileRenames)
    : null;
  const codeRemapsBefore = ctx.codeRemaps || 0;
  if (Object.keys(desktopRenames).length) remapImportedRefs(blocks, desktopRenames, '', ctx);
  if (blocksMobile && Object.keys(mobileRenames).length) {
    remapImportedRefs(blocksMobile, mobileRenames, '', ctx);
  }
  const notices = [];
  if ((ctx.codeRemaps || 0) > codeRemapsBefore) {
    notices.push('自定义 JS/CSS 中写死的区块 id 已按导入后的新 id 替换，请检查代码引用是否仍然正确');
  }
  if (id !== requestedId) notices.push('页面 id 改为「' + id + '」');
  if (finalPath !== (htmlPath || requestedId + '.html')) notices.push('输出路径改为「' + finalPath + '」');
  const imported = Object.assign({}, page, {
    schemaVersion: 2,
    id,
    title: page.title.trim(),
    slug,
    path: finalPath,
    nav: page.nav !== false,
    blocks
  });
  if (blocksMobile) imported.blocksMobile = blocksMobile;
  else delete imported.blocksMobile;
  return {
    page: imported,
    notices
  };
}

function fieldsFromTemplate(template) {
  const keys = [];
  const re = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
  let match;
  while ((match = re.exec(String(template || '')))) {
    if (keys.indexOf(match[1]) === -1) keys.push(match[1]);
  }
  return keys;
}

/* 组件字段既可能是旧格式的字符串键，也可能是新格式的字段定义对象。 */
function componentFieldDefinitions(component) {
  const list = Array.isArray(component && component.fields) ? component.fields : [];
  return list.map((item, index) => {
    if (typeof item === 'string') {
      return { id: item, label: item, type: 'text', required: false, options: [], defaultValue: '' };
    }
    const source = item && typeof item === 'object' ? item : {};
    return {
      id: String(source.id || source.key || ('field-' + (index + 1))),
      label: String(source.label || source.id || source.key || ('字段 ' + (index + 1))),
      type: String(source.type || 'text'),
      required: Boolean(source.required),
      options: Array.isArray(source.options) ? source.options.slice() : [],
      defaultValue: source.defaultValue === undefined ? '' : source.defaultValue
    };
  });
}

function builderPropFromField(field) {
  if (field.type === 'enum') {
    const options = field.options.map((value) => ({ value: String(value), label: String(value) }));
    return { type: 'enum', label: field.label, options, default: field.defaultValue };
  }
  if (field.type === 'number') return { type: 'number', label: field.label, default: field.defaultValue === '' ? 0 : field.defaultValue };
  if (field.type === 'boolean') return { type: 'boolean', label: field.label, default: Boolean(field.defaultValue) };
  return { type: 'string', label: field.label, default: String(field.defaultValue == null ? '' : field.defaultValue) };
}

function normalizeComponentImport(raw, filename, ctx) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  let component = payload;
  if (payload.format === 'lowcode-component') {
    if (Number(payload.schemaVersion) !== 1) {
      throw importFail(422, 'LC_E_IMPORT_FORMAT', '组件文件 schemaVersion 是 ' + payload.schemaVersion + '，只接受 1');
    }
    component = payload.component;
  }
  if (!component || typeof component !== 'object' || Array.isArray(component)) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '组件文件里没有 component 对象');
  }
  if (typeof component.name !== 'string' || !component.name.trim()) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '组件缺少名称（name）');
  }
  if (typeof component.template !== 'string' || !component.template.trim()) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '组件缺少 HTML 模板（template）');
  }
  const name = component.name.trim();
  const fallback = safeSlug(filename.replace(/\.json$/i, '').replace(/\.component$/i, ''), 'comp');
  const requestedId = safeSlug(component.id, fallback);
  const id = uniqueValue(requestedId, ctx.componentIds);
  const notices = [];
  let finalName = name;
  if (ctx.componentNames.has(finalName)) {
    finalName = name + '（导入）';
    let n = 2;
    while (ctx.componentNames.has(finalName)) {
      finalName = name + '（导入 ' + n + '）';
      n += 1;
    }
    notices.push('名称改为「' + finalName + '」');
  }
  if (id !== requestedId) notices.push('组件 id 改为「' + id + '」');
  const fields = Array.isArray(component.fields) && component.fields.length
    ? component.fields
    : fieldsFromTemplate(component.template);
  return {
    component: {
      schemaVersion: 1,
      id,
      name: finalName,
      description: String(component.description || ''),
      category: String(component.category || 'other'),
      icon: String(component.icon || 'box'),
      tags: Array.isArray(component.tags) ? component.tags.slice() : [],
      template: component.template,
      css: String(component.css || ''),
      js: String(component.js || ''),
      fields
    },
    notices
  };
}

function normalizeTemplateImport(raw, filename, ctx) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  if (payload.format !== 'lowcode-template') {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '不是模板文件（缺少 format: lowcode-template）');
  }
  if (Number(payload.schemaVersion) !== 1) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '模板文件 schemaVersion 是 ' + payload.schemaVersion + '，只接受 1');
  }
  const template = payload.template;
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '模板文件里没有 template 对象');
  }
  if (typeof template.name !== 'string' || !template.name.trim()) {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '模板缺少名称（name）');
  }
  const kind = template.kind === 'site' ? 'site' : 'page';
  if (kind === 'page') {
    if (!template.page || typeof template.page !== 'object') {
      throw importFail(422, 'LC_E_IMPORT_FORMAT', '页面模板缺少 page 对象');
    }
    normalizeImportBlocks(template.page.blocks || [], ctx, '模板页面');
  } else {
    if (!Array.isArray(template.pages) || !template.pages.length) {
      throw importFail(422, 'LC_E_IMPORT_FORMAT', '整站模板缺少非空的 pages 数组');
    }
    template.pages.forEach((page, index) => {
      normalizeImportBlocks(page && page.blocks ? page.blocks : [], ctx, '模板第 ' + (index + 1) + ' 个页面');
    });
  }
  const fallback = safeSlug(filename.replace(/\.json$/i, '').replace(/\.template$/i, ''), 'template');
  const requestedId = safeSlug(template.id, fallback);
  const id = uniqueValue(requestedId, ctx.templateIds);
  const notices = [];
  if (id !== requestedId) notices.push('模板 id 改为「' + id + '」');
  return {
    template: Object.assign({}, template, {
      id,
      name: template.name.trim(),
      kind,
      description: String(template.description || '')
    }),
    notices
  };
}

function normalizeTemplatePage(def, ctx, templateId) {
  if (!def || typeof def !== 'object') {
    throw importFail(422, 'LC_E_IMPORT_FORMAT', '模板里的页面不是对象');
  }
  const title = String(def.title || '').trim() || templateId;
  const blocks = normalizeImportBlocks(def.blocks || [], ctx, '模板页面');
  const base = safePageSlug(def.slug || def.id, templateId);
  const slug = uniqueValue(base, ctx.slugs);
  const id = uniqueValue(base, ctx.pageIds);
  let htmlPath = String(def.path || '').trim().replace(/^\/+/, '');
  if (htmlPath && !PAGE_PATH_RE.test(htmlPath)) htmlPath = '';
  let finalPath = htmlPath || (id + '.html');
  if (ctx.paths.has(finalPath)) {
    const stem = finalPath.replace(/\.html$/i, '');
    let n = 2;
    while (ctx.paths.has(stem + '-' + n + '.html')) n += 1;
    finalPath = stem + '-' + n + '.html';
  }
  ctx.pageIds.add(id);
  ctx.slugs.add(slug);
  ctx.paths.add(finalPath);
  return {
    schemaVersion: 2,
    id,
    title,
    slug,
    path: finalPath,
    nav: def.nav !== false,
    layout: def.layout && typeof def.layout === 'object' ? def.layout : { mode: 'flow' },
    blocks
  };
}


/**
 * Builder 接口：
 * GET  /api/sites/:id/builder/site          站点、页面、主题、区块 schema
 * GET  /api/sites/:id/builder/page?pageId=  单个页面 JSON + rev
 * POST /api/sites/:id/builder/render        用渲染引擎生成画布文档（不落盘）
 *
 * 画布资源和页面内相对路径由 GET /preview/:siteId/:token/* 提供。
 */
export function registerBuilderRoutes(app, ctx) {
  app.get('/api/sites/:id/builder/site', async (request) => {
    const siteId = siteIdOf(request);
    const loaded = await loadSiteData(ctx.paths, siteId);
    const adapter = createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
    const pages = (loaded.site.pages || []).map((page) => ({
      id: page.id,
      title: page.title || page.id,
      slug: page.slug || '',
      path: page.path || '',
      nav: page.nav !== false
    }));
    const componentDefs = (loaded.site.components || []).map((component) => ({
      id: component.id,
      name: component.name || component.id,
      fields: componentFieldDefinitions(component)
    }));
    const components = componentDefs.map((component) => ({
      id: component.id,
      name: component.name,
      fields: component.fields.map((field) => field.id),
      template: String(component.template || ''),
      css: String(component.css || ''),
      js: String(component.js || '')
    }));
    const componentSchemas = componentDefs.map((component) => ({
      type: 'component',
      componentId: component.id,
      name: component.name,
      store: 'fields',
      props: component.fields.reduce((out, field) => {
        out[field.id] = builderPropFromField(field);
        return out;
      }, {})
    }));
    const builtinSchemas = typeof Render.componentsSchemas === 'function' ? Render.componentsSchemas() : [];
    const templateFiles = await loadTemplateFiles(adapter);
    const templates = templateFiles.map((entry) => templateInfo(entry)).filter(Boolean);
    return {
      ok: true,
      data: {
        siteId,
        site: loaded.meta,
        project: loaded.project,
        pages,
        templates,
        themes: (loaded.site.themes || []).map((theme) => ({ id: theme.id, name: theme.name || theme.id })),
        activeTheme: (loaded.project.theme && loaded.project.theme.activeId) || (loaded.site.themes[0] && loaded.site.themes[0].id) || '',
        blockSchemas: [
          ...baseBlockSchemas(),
          ...STRUCTURAL_SCHEMAS,
          ...builtinSchemas.map((schema) => ({
            ...schema,
            store: 'props',
            sample: typeof Render.componentSample === 'function' ? Render.componentSample(schema.type) : null
          }))
        ],
        componentSchemas,
        components,
        rev: await adapter.rev()
      }
    };
  });

  app.get('/api/sites/:id/builder/page', async (request) => {
    const pageId = request.query && request.query.pageId;
    const data = await readPageFile(ctx, siteIdOf(request), pageId);
    return { ok: true, data };
  });

  app.post('/api/sites/:id/builder/render', async (request, reply) => {
    const body = request.body || {};
    const siteId = siteIdOf(request);
    const page = body.page;
    if (!page || typeof page !== 'object' || !page.id) {
      return reply.code(400).send({ ok: false, error: { code: 'LC_E_VALIDATION', message: 'body.page 必须是带 id 的页面对象' } });
    }
    const uiEnd = body.uiEnd === 'mobile' ? 'mobile' : 'desktop';
    /* 画布一次只编辑一端：双端模式下取对应区块树，其余字段沿用页面本身。 */
    const renderPage = page.independentUi === true && Array.isArray(page.blocksMobile)
      ? Object.assign({}, page, {
        blocks: uiEnd === 'mobile' ? page.blocksMobile : page.blocks,
        independentUi: false,
        blocksMobile: undefined
      })
      : page;

    const loaded = await loadSiteData(ctx.paths, siteId);
    const pages = (loaded.site.pages || []).slice();
    const index = pages.findIndex((item) => item && item.id === renderPage.id);
    if (index >= 0) pages[index] = renderPage;
    else pages.push(renderPage);
    loaded.site.pages = pages;

    const renderer = registeredRenderer(loaded.site);
    const themeId = String(body.themeId || (loaded.project.theme && loaded.project.theme.activeId) || renderer.defaultThemeId || '');
    const mode = body.mode === 'dark' ? 'dark' : 'light';
    const result = renderer.renderToHtml(renderPage.id, { themeId, mode });
    const blockCount = Object.keys(result.result.blockMap || {}).length;
    /* 画布用同源真实地址加载这份文档：每次渲染换一个预览会话，iframe src 指向它。 */
    const previewId = newPreviewId();
    const documentHtml = previewDocument({
      siteId,
      sessionId: previewId,
      page: renderPage,
      themeId,
      mode,
      css: result.css,
      html: result.html,
      scriptsHtml: result.scriptsHtml,
      empty: !(Array.isArray(renderPage.blocks) && renderPage.blocks.length > 0),
      pageSize: result.result.pageSize
    });
    storePreviewSession(siteId, previewId, documentHtml);
    return {
      ok: true,
      data: {
        document: documentHtml,
        previewUrl: '/preview/' + encodeURIComponent(siteId) + '/' + previewId,
        themeId,
        mode,
        uiEnd,
        blockCount,
        report: (result.report && result.report.toJSON ? result.report.toJSON() : [])
      }
    };
  });

  app.post('/api/sites/:id/builder/import', async (request, reply) => {
    try {
      const siteId = siteIdOf(request);
      const payload = readImportPayload(request.body);
      const loaded = await loadSiteData(ctx.paths, siteId);
      const adapter = createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
      const templateFiles = await loadTemplateFiles(adapter);
      const importCtx = importContext(loaded, templateFiles);

      let rel;
      let content;
      let id;
      let name;
      let notices;
      if (payload.kind === 'page') {
        const result = normalizePageImport(payload.data, payload.filename, importCtx);
        id = result.page.id;
        name = result.page.title;
        notices = result.notices;
        rel = 'pages/' + id + '.json';
        content = JSON.stringify(result.page, null, 2);
      } else if (payload.kind === 'component') {
        const result = normalizeComponentImport(payload.data, payload.filename, importCtx);
        id = result.component.id;
        name = result.component.name;
        notices = result.notices;
        rel = 'components/' + id + '.json';
        content = JSON.stringify(result.component, null, 2);
      } else {
        const result = normalizeTemplateImport(payload.data, payload.filename, importCtx);
        id = result.template.id;
        name = result.template.name;
        notices = result.notices;
        rel = 'templates/' + id + '.json';
        content = JSON.stringify({
          format: 'lowcode-template',
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          template: result.template
        }, null, 2);
      }

      const written = await adapter.write(rel, content, { note: 'builder-import-' + payload.kind });
      return {
        ok: true,
        data: {
          kind: payload.kind,
          file: payload.filename,
          id,
          name,
          path: rel,
          notices,
          message: notices.length ? notices.join('；') : '已导入',
          rev: written.rev
        }
      };
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        ok: false,
        error: { code: error.importCode || 'LC_E_IMPORT_FAILED', message: error.message }
      });
    }
  });

  app.post('/api/sites/:id/builder/template/apply', async (request, reply) => {
    try {
      const siteId = siteIdOf(request);
      const templateId = String((request.body && request.body.templateId) || '').trim();
      if (!templateId) {
        throw importFail(400, 'LC_E_TEMPLATE_ID', '缺少 templateId');
      }
      const loaded = await loadSiteData(ctx.paths, siteId);
      const adapter = createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
      const templateFiles = await loadTemplateFiles(adapter);
      const entry = templateFiles.find((item) => {
        const info = templateInfo(item);
        return info && info.id === templateId;
      });
      if (!entry) {
        throw importFail(404, 'LC_E_TEMPLATE_NOT_FOUND', '模板不存在：' + templateId);
      }
      const importCtx = importContext(loaded, templateFiles);
      const template = entry.data.template;
      const defs = template.kind === 'site' ? template.pages : [template.page];
      if (!Array.isArray(defs) || !defs.length) {
        throw importFail(422, 'LC_E_IMPORT_FORMAT', '模板里没有可套用的页面');
      }
      const created = [];
      let rev = await adapter.rev();
      for (const def of defs) {
        const page = normalizeTemplatePage(def, importCtx, templateId);
        const written = await adapter.write('pages/' + page.id + '.json', JSON.stringify(page, null, 2), {
          note: 'builder-template-apply'
        });
        rev = written.rev;
        created.push({ id: page.id, title: page.title, path: page.path });
      }
      return { ok: true, data: { templateId, pages: created, rev } };
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        ok: false,
        error: { code: error.importCode || 'LC_E_TEMPLATE_FAILED', message: error.message }
      });
    }
  });

  function previewSessionOf(request) {
    let siteId;
    try {
      siteId = sanitizeSiteId(request.params.siteId);
    } catch (error) {
      return null;
    }
    return readPreviewSession(siteId, request.params.sessionId);
  }

  /* 预览 HTML 走平台同源真实地址：iframe 用 src 加载，不再用 srcdoc 的不透明源。 */
  app.get('/preview/:siteId/:sessionId', async (request, reply) => {
    const session = previewSessionOf(request);
    if (!session) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><title>预览已失效</title><p>画布预览已失效，请刷新页面重新渲染。</p>');
    }
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(session.document);
  });

  app.get('/preview/:siteId/:token/*', async (request, reply) => {
    let siteId;
    try {
      siteId = sanitizeSiteId(request.params.siteId);
    } catch (error) {
      return reply.code(403).type('text/plain; charset=utf-8').send('预览站点无效');
    }
    if (request.params.token !== ctx.token && !readPreviewSession(siteId, request.params.token)) {
      return reply.code(403).type('text/plain; charset=utf-8').send('预览令牌无效');
    }
    let rel;
    try {
      rel = normalizeRelPath(request.params['*'] || '');
    } catch (error) {
      return reply.code(400).type('text/plain; charset=utf-8').send(error.message);
    }
    if (!rel) return reply.code(404).type('text/plain; charset=utf-8').send('资源不存在');
    const file = path.join(ctx.paths.dataDir, 'sites', siteId, rel);
    const body = await fs.readFile(file).catch(() => null);
    if (!body) return reply.code(404).type('text/plain; charset=utf-8').send('资源不存在');
    const ext = path.extname(rel).toLowerCase();
    return reply
      .type(ASSET_MIME.get(ext) || 'application/octet-stream')
      .header('Cache-Control', 'no-store')
      .send(body);
  });

  /* 同源数据代理：页面里的 /api/* 被改写到 /preview-api/<siteId>/<sessionId>/api/*，
     平台再转发给站点后端预览进程。不添加任何 CORS 响应头，也不信任跨源 Origin。 */
  app.all('/preview-api/:siteId/:sessionId/*', async (request, reply) => {
    const session = previewSessionOf(request);
    if (!session) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_PREVIEW_SESSION', message: '画布预览已失效，请刷新页面重新渲染' } });
    }
    const siteId = sanitizeSiteId(request.params.siteId);
    const rel = String(request.params['*'] || '');
    if (!rel.startsWith('api/')) {
      return reply.code(404).send({ ok: false, error: { code: 'LC_E_PREVIEW_PATH', message: '只允许代理站点接口' } });
    }
    let preview;
    try {
      preview = await ensureSitePreview(ctx, siteId);
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: { code: 'LC_E_PREVIEW_BACKEND', message: '站点后端预览启动失败：' + error.message }
      });
    }
    const method = String(request.method || 'GET').toUpperCase();
    const headers = {};
    if (request.headers.authorization) headers.authorization = request.headers.authorization;
    if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
    if (request.headers.accept) headers.accept = request.headers.accept;
    let body;
    if (method !== 'GET' && method !== 'HEAD' && request.body != null) {
      body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    }
    let upstream;
    try {
      upstream = await fetch(preview.url + '/' + rel, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: { code: 'LC_E_PREVIEW_BACKEND', message: '站点后端预览不可用：' + error.message }
      });
    }
    const payload = Buffer.from(await upstream.arrayBuffer());
    reply.code(upstream.status).header('Cache-Control', 'no-store');
    const type = upstream.headers.get('content-type');
    if (type) reply.type(type);
    return reply.send(payload);
  });
}
