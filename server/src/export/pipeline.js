import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { resolveThemeForRenderer, getBuiltinTheme, listBuiltinThemes } from '../themes.js';
import { themeCssForIds } from '../../../src/theme/runtime.mjs';
import { readSite, defaultTheme } from '../sites.js';
import { registerBaseBlocks } from './base-blocks.js';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { SiteFileLock } from '../../../src/storage/locks.js';
import { zoneForLanguage, isUserZonePath } from '../code/zones.js';
import { normalizeSiteAddress } from './site-address.js';
import { readFlow, readCollections } from '../flow/store.js';
import { buildFlowProject, BuildError } from '../flow/build.js';

const require = createRequire(import.meta.url);
const Bundle = require('../../../shared/export-bundle.js');
const Assets = require('../../../shared/export-assets.js');
const Templates = require('../../../shared/export-templates.js');
const Minify = require('../../../shared/export-minify.js');
const MiddlewareCatalog = require('../../../shared/middleware-catalog.js');
const Render = require('../../../src/render/node.cjs');

const BUILD_RECORD_VERSION = 1;
/* Tauri 各平台 WebView 的页面来源：自定义协议 + Windows 的 http/https 变体。 */
const TAURI_CORS_ORIGINS = ['tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost'];
const TEXT_EXT = /\.(html?|css|js|json|txt|md|yaml|yml|toml|xml|svg|sh)$/i;

function fail(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function listJson(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const parsed = await readJson(path.join(dir, entry.name), null);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function walkFiles(dir, base, handler) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) await walkFiles(full, rel, handler);
    else if (entry.isFile()) await handler(full, rel);
  }
}

function pagePathOf(page) {
  const raw = String(page.path || '').replace(/^\/+/, '');
  if (raw) return raw;
  /* 中文等 Unicode 字母数字保留做文件名（浏览器会百分号编码）；emoji 与标点剔除，空值再退化。 */
  const slug = String(page.slug || page.id || 'page')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'page';
  return slug === 'home' ? 'index.html' : slug + '.html';
}

/* 把导航/正文里的链接归一成站内路径，用于判断它是否指向一个被排除的页面。 */
function pageRefKey(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.startsWith('#')) return '';
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) return '';
  if (/^(?:javascript|mailto|tel|data):/i.test(raw)) return '';
  const clean = raw
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '');
  return clean || 'index.html';
}

/* 一个页面可能被 href / path / slug / id 引用；这里列出所有可匹配的别名。 */
function pageAliases(page) {
  const aliases = new Set();
  const add = (value) => {
    const key = pageRefKey(value);
    if (!key) return;
    aliases.add(key);
    if (/\.html?$/i.test(key)) aliases.add(key.replace(/\.html?$/i, ''));
    else if (!/\/index$/.test(key)) aliases.add(key + '.html');
  };
  add(pagePathOf(page));
  add(page.path);
  add(page.slug);
  add(page.id);
  return aliases;
}

function makePageRefIndex(pages) {
  const byId = new Map();
  const hrefToId = new Map();
  for (const page of pages || []) {
    const id = String(page.id || '');
    if (!id) continue;
    byId.set(id, page);
    for (const alias of pageAliases(page)) {
      if (!hrefToId.has(alias)) hrefToId.set(alias, id);
    }
  }
  return { byId, hrefToId };
}

/* 收集页面与外壳里实际引用的页面 id：pageId 直接认，href 只认能映射到站内页面的。 */
function collectPageReferences(pages, shellBlocks, index) {
  const refs = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value.pageId === 'string' && index.byId.has(value.pageId)) refs.add(value.pageId);
    if (typeof value.href === 'string') {
      const id = index.hrefToId.get(pageRefKey(value.href));
      if (id) refs.add(id);
    }
    Object.keys(value).forEach((key) => walk(value[key]));
  };
  walk(pages);
  walk(shellBlocks);
  return refs;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

/* 体积按十进制换算（1 MB = 1000 KB），与报告和界面的显示口径一致。 */
function humanBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1e9) return (value / 1e9).toFixed(1) + ' GB';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + ' MB';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + ' KB';
  return value + ' B';
}

/* 统计站点自身的 HTML / CSS / JS 体积，用于构建报告里的体积账（排除第三方运行时）。 */
function siteCodeBytes(files, skipPaths) {
  const totals = { html: 0, css: 0, js: 0, total: 0 };
  const skip = new Set(skipPaths || []);
  for (const [file, body] of Object.entries(files || {})) {
    if (!file.startsWith('web/') || typeof body !== 'string' || skip.has(file)) continue;
    const kind = /\.html?$/i.test(file) ? 'html' : /\.css$/i.test(file) ? 'css' : /\.js$/i.test(file) ? 'js' : '';
    if (!kind) continue;
    const size = Bundle.byteSize(body);
    totals[kind] += size;
    totals.total += size;
  }
  return totals;
}

/* 构建报告里的人类可读体积账：zip 多大、解压后多大、其中图表库占多少。 */
function libraryLabel(pkg) {
  const name = String(pkg || '').split('@')[0];
  if (name === 'mermaid') return '图表库 mermaid';
  return name || '第三方运行时';
}

function buildSizing(input) {
  const { zipBytes, unpackedBytes, bundledAssets, codeBefore, codeAfter, minify } = input;
  const libraries = (bundledAssets || []).map((item) => {
    const bytes = Number(item.bytes) || 0;
    return {
      package: item.package,
      bytes,
      readable: humanBytes(bytes),
      share: unpackedBytes ? Math.round((bytes / unpackedBytes) * 100) : 0
    };
  });
  const mermaid = libraries.find((item) => String(item.package || '').split('@')[0] === 'mermaid') || null;
  const lines = ['zip ' + humanBytes(zipBytes) + '，解压后 ' + humanBytes(unpackedBytes)];
  const runtimeBytes = libraries.reduce((sum, item) => sum + item.bytes, 0);
  if (runtimeBytes) {
    const main = libraries.slice().sort((a, b) => b.bytes - a.bytes)[0];
    lines.push('其中 ' + humanBytes(main.bytes) + ' 是' + libraryLabel(main.package) +
      (main.share ? '（约占解压后的 ' + main.share + '%）' : ''));
  }
  lines.push('站点页面/样式/脚本 ' + humanBytes(codeAfter.total) + '（HTML ' + humanBytes(codeAfter.html) +
    '、CSS ' + humanBytes(codeAfter.css) + '、JS ' + humanBytes(codeAfter.js) + '）');
  if (minify && minify.enabled) {
    lines.push(minify.html
      ? '压缩：HTML/CSS/JS 共省 ' + humanBytes(Math.max(0, minify.saved))
      : '压缩：CSS/JS 省 ' + humanBytes(Math.max(0, minify.saved)) + '；HTML 未压缩（默认关闭，实测 zip 反而更大）');
  } else {
    lines.push('压缩：已关闭');
  }
  return { zipBytes, unpackedBytes, libraries, mermaid, code: { before: codeBefore, after: codeAfter }, lines };
}

function prefixFor(pathname) {
  const depth = Math.max(0, pathname.split('/').length - 1);
  return '../'.repeat(depth);
}

/* 站点公开基址：前端从这里取接口地址，不要在页面里写死域名。
   运行时脚本与页面内联运行时共用同一份注入，保证内联脚本先于数据脚本拿到基址。 */
function publicBaseConfig(address, overrideBaseUrl) {
  const override = String(overrideBaseUrl == null ? '' : overrideBaseUrl).trim().replace(/\/+$/, '');
  /* 桌面产物的接口地址由桌面配置决定（本地/内网后端），不能把 Web 站点域名带进去。 */
  if (override) {
    return '/* 桌面产物接口基址：前端从这里取接口地址，不要写死域名。 */\n' +
      'window.LC_PUBLIC_BASE_URL = ' + JSON.stringify(override) + ';\n\n';
  }
  if (!address) return '';
  /* 只配了路径前缀、没配域名：部署主机在构建期未知，用同源相对前缀最稳妥。 */
  if (!address.configured) {
    if (!address.basePath || address.basePath === '/') return '';
    return '/* 站点路径前缀：前端用同源相对路径取接口，避免写死 localhost。 */\n' +
      'window.LC_PUBLIC_BASE_URL = ' + JSON.stringify(address.basePath) + ';\n' +
      'window.LC_SITE_BASE_PATH = ' + JSON.stringify(address.basePath) + ';\n\n';
  }
  return '/* 站点公开基址：前端从这里取接口地址，不要在页面里写死域名。 */\n' +
    'window.LC_PUBLIC_BASE_URL = ' + JSON.stringify(address.publicBaseUrl) + ';\n' +
    'window.LC_SITE_ORIGIN = ' + JSON.stringify(address.origin) + ';\n' +
    'window.LC_SITE_BASE_PATH = ' + JSON.stringify(address.basePath) + ';\n\n';
}

function runtimeScript(address, defaultMode, overrideBaseUrl) {
  const config = publicBaseConfig(address, overrideBaseUrl);
  const fallbackMode = defaultMode === 'dark' ? 'dark' : 'light';
  return '/* 低代码产物运行时：同步主题与明暗偏好，不访问网络 */\n' +
    config +
    '(function () {\n' +
    '  "use strict";\n' +
    '  var fallbackMode = ' + JSON.stringify(fallbackMode) + ';\n' +
    '  function saved() {\n' +
    '    try { return JSON.parse(localStorage.getItem("lc-site-theme") || "null"); } catch (e) { return null; }\n' +
    '  }\n' +
    '  function apply() {\n' +
    '    var pref = saved() || {};\n' +
    '    var root = document.documentElement;\n' +
    '    var mode = pref.mode;\n' +
    '    if (mode !== "light" && mode !== "dark") mode = fallbackMode;\n' +
    '    root.setAttribute("data-lc-mode", mode);\n' +
    '    root.setAttribute("data-lc-mode-pref", pref.mode === "light" || pref.mode === "dark" ? pref.mode : "auto");\n' +
    '    root.style.colorScheme = mode;\n' +
    '    var page = document.querySelector(".lc-page");\n' +
    '    if (page) page.setAttribute("data-lc-mode", mode);\n' +
    '    if (typeof pref.theme === "string" && pref.theme) root.setAttribute("data-lc-theme", pref.theme);\n' +
    '  }\n' +
    '  apply();\n' +
    '})();\n';
}

/* 首屏防白闪：在样式表之前同步执行，只认 allowSwitch 里的主题 id。 */
function themeBootScript(ids, defaultId, defaultMode) {
  const fallbackMode = defaultMode === 'dark' ? 'dark' : 'light';
  return '<script>(function(){' +
    'var root=document.documentElement;' +
    'var allowed=' + JSON.stringify(ids || []) + ';' +
    'var saved=null;try{saved=JSON.parse(window.localStorage.getItem("lc-site-theme")||"null");}catch(e){saved=null;}' +
    'var theme=saved&&typeof saved.theme==="string"?saved.theme:null;' +
    'if(theme&&allowed.indexOf(theme)===-1)theme=null;' +
    'if(!theme)theme=' + JSON.stringify(defaultId || 'ink-green') + ';' +
    'var pref=saved&&saved.mode;' +
    'var mode=pref==="light"||pref==="dark"?pref:' + JSON.stringify(fallbackMode) + ';' +
    'root.setAttribute("data-lc-theme",theme);' +
    'root.setAttribute("data-lc-mode",mode);' +
    'root.setAttribute("data-lc-mode-pref",pref==="light"||pref==="dark"?pref:"auto");' +
    'root.style.colorScheme=mode;' +
  '})();</script>';
}

/* 图表库随包自托管，离线双击可渲染；不提供 CDN 回退，避免断网时页面依赖外网。 */
const EXPORT_TARGETS = new Set(['web-static', 'tauri-desktop']);
const DESKTOP_PLATFORMS = new Set(['win32', 'linux', 'android']);
const PLATFORM_TARGETS = {
  win32: ['msi', 'nsis'],
  linux: ['appimage', 'deb', 'rpm'],
  android: ['apk', 'aab']
};

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && Math.round(number) === number ? number : fallback;
}

/* 桌面模板脚本用 ESM 写，Node 侧直接动态 import；同一次进程内按 URL 缓存。 */
async function loadTauriHelpers(platformRoot) {
  const base = pathToFileURL(path.join(platformRoot, 'templates', 'tauri', 'scripts') + path.sep).href;
  try {
    const [render, validate] = await Promise.all([
      import(base + 'render-config.mjs'),
      import(base + 'validate-config.mjs')
    ]);
    return { render, validate };
  } catch (error) {
    throw fail('LC_E_TAURI_TEMPLATE', 'Tauri 模板脚本不可用：' + (error && error.message ? error.message : String(error)));
  }
}

/* 把模板默认值、站点保存值与本次向导输入合成一份可渲染的桌面配置。
   优先级：向导 > 站点 project.export.tauri > 模板默认。 */
async function buildDesktopConfig(input) {
  const { platformRoot, project, siteName, desktop, backend } = input;
  const base = await readJson(path.join(platformRoot, 'templates', 'tauri', 'config', 'desktop.json'), null);
  if (!base) throw fail('LC_E_TAURI_TEMPLATE', '缺少桌面模板默认配置 templates/tauri/config/desktop.json');
  const saved = (project.export && project.export.tauri) || {};
  const pick = desktop && typeof desktop === 'object' ? desktop : {};

  const platform = DESKTOP_PLATFORMS.has(pick.platform)
    ? pick.platform
    : (DESKTOP_PLATFORMS.has(saved.platform) ? saved.platform : 'win32');

  const productName = String(pick.productName || saved.productName || siteName || base.productName || '').trim();
  const identifier = String(pick.identifier || saved.identifier || base.identifier || '').trim();
  const version = String(pick.version || saved.version || base.version || '0.1.0').trim();

  const windowInput = Object.assign({}, base.window || {}, saved.window || {}, pick.window || {});
  const protocol = String(pick.protocol || saved.protocol || base.protocol || 'https').trim();
  const requestedHttpsMode = String(
    (pick.https && pick.https.mode) || (saved.https && saved.https.mode) || (base.https && base.https.mode) || 'generated'
  ).trim();
  /* http 协议下证书不会生效：直接归一为 none，避免产物里留下“配置了证书但从未使用”的假配置。 */
  const httpsMode = protocol === 'http' && requestedHttpsMode !== 'none' ? 'none' : requestedHttpsMode;
  const httpsIgnored = protocol === 'http' && requestedHttpsMode !== 'none';
  const httpsHost = String((base.https && base.https.host) || 'localhost');
  const httpsPort = toInt(base.https && base.https.port, 1420);

  const updateInput = Object.assign({}, base.update || {}, saved.update || {}, pick.update || {});
  const updateActive = updateInput.enabled !== undefined ? Boolean(updateInput.enabled) : Boolean(updateInput.active);

  const backendPort = toInt(backend.port, 8080);
  const backendHostRaw = String(backend.host || '127.0.0.1');
  const backendHost = backendHostRaw === '0.0.0.0' ? '127.0.0.1' : backendHostRaw;

  const config = {
    schemaVersion: 1,
    productName,
    identifier,
    version,
    description: String(
      pick.description || saved.description || (project.site && project.site.description) || base.description || ''
    ).trim(),
    window: {
      title: productName,
      width: toInt(windowInput.width, 1024),
      height: toInt(windowInput.height, 720),
      minWidth: toInt(windowInput.minWidth, 800),
      minHeight: toInt(windowInput.minHeight, 600),
      resizable: windowInput.resizable !== false,
      fullscreen: windowInput.fullscreen === true,
      center: windowInput.center !== false
    },
    icon: { source: 'builtin', path: '' },
    protocol,
    delivery: { mode: 'static', webDir: '../web' },
    https: { mode: httpsMode, host: httpsHost, port: httpsPort },
    backend: {
      enabled: String(backend.language || 'none') !== 'none',
      baseUrl: 'http://' + backendHost + ':' + backendPort
    },
    runtime: Object.assign({}, base.runtime || {}),
    update: {
      active: updateActive,
      endpoint: String(updateInput.endpoint || ''),
      pubkey: String(updateInput.pubkey || ''),
      checkOnStartup: updateActive
    },
    bundle: {
      targets: (PLATFORM_TARGETS[platform] || ['msi']).slice(),
      createUpdaterArtifacts: false,
      windows: Object.assign(
        {},
        base.bundle && base.bundle.windows ? base.bundle.windows : {},
        // WiX 默认 1252 代码页装不下中文 productName，会触发 LGHT0311；
        // 中文站点默认 zh-CN，让 MSI 使用 936 代码页。
        { wixLanguage: String((project.site && project.site.language) || 'zh-CN').trim() }
      )
    },
    /* 静态接入下 devUrl 会被忽略；清空避免模板校验发出无意义的告警。 */
    dev: { url: '', beforeDevCommand: '', beforeBuildCommand: '' }
  };

  const helpers = await loadTauriHelpers(platformRoot);
  const validation = helpers.validate.validateConfig(config, {
    platform,
    root: path.join(platformRoot, 'templates', 'tauri'),
    skipFileChecks: true
  });
  return {
    config,
    platform,
    targets: config.bundle.targets,
    httpsIgnored,
    requestedHttpsMode,
    validation,
    helpers
  };
}

/* 生成 deploy/backend/config.yaml 与 config.generated.yaml。
   密码一律留空：导出包不含明文密码，部署时用 LC_DB_PASSWORD 注入。 */
function yamlValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return yamlScalar(value)
}

function yamlScalar(value) {
  const text = String(value == null ? '' : value);
  if (text === '') return '""';
  if (/^[A-Za-z0-9_.:\/~-]+$/.test(text) && !/^(?:true|false|null|~|[-+]?\d)/i.test(text)) return text;
  return JSON.stringify(text);
}

function isSecretKey(key) {
  return /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i.test(String(key));
}

/* 配置中心的五层覆盖：default < generated < site < env < cli。
   导出时把 generated / site 写进 YAML，env / cli 写进 .env.generated 与 cli-overrides.txt。 */
function centerEnvironment(center, backend) {
  const name = String(backend.environment || 'dev') === 'prod' ? 'prod' : 'dev';
  const envDoc = center && center.environments && center.environments[name] ? center.environments[name] : null;
  return { name, envDoc };
}

function customMiddlewareValues(backend) {
  const values = {};
  (Array.isArray(backend.customMiddleware) ? backend.customMiddleware : []).forEach((middleware) => {
    (Array.isArray(middleware.fields) ? middleware.fields : []).forEach((field) => {
      if (field.secret === true) return;
      values[MiddlewareCatalog.customKey(middleware.id, field.key)] = field.value;
    });
  });
  return values;
}

function centerDefinitions(center, backend) {
  const definitions = Array.isArray(center?.definitions) ? center.definitions.slice() : [];
  const seen = new Set(definitions.map((def) => String(def.key || '')));
  (Array.isArray(backend.customMiddleware) ? backend.customMiddleware : []).forEach((middleware) => {
    (Array.isArray(middleware.fields) ? middleware.fields : []).forEach((field) => {
      const key = MiddlewareCatalog.customKey(middleware.id, field.key);
      if (seen.has(key)) return;
      seen.add(key);
      definitions.push({
        key,
        type: ['string', 'number', 'bool', 'enum'].includes(field.type) ? field.type : 'string',
        default: field.secret === true ? undefined : field.value,
        enum: Array.isArray(field.enum) ? field.enum : undefined,
        secret: field.secret === true,
        description: `${middleware.name || middleware.id} · ${field.label || field.key}`
      });
    });
  });
  return definitions;
}

function nonSecretValues(definitions, values) {
  const secretKeys = new Set(definitions.filter((def) => def.secret === true).map((def) => String(def.key)));
  const out = {};
  Object.entries(values && typeof values === 'object' ? values : {}).forEach(([key, value]) => {
    if (secretKeys.has(key)) return;
    out[key] = value;
  });
  return out;
}

function renderBackendConfig(backend, address, layer = 'generated', extraOrigins = []) {
  const database = backend.database || {};
  const cache = backend.cache || {};
  const cors = backend.cors || {};
  const language = String(backend.language || 'none');
  const driver = String(database.driver || 'sqlite');
  const dbName = String(database.name || 'app');
  const dbUrl = String(database.url || (driver === 'sqlite' ? 'sqlite://data/' + dbName + '.db' : ''));
  const cacheEnabled = cache.enabled !== false;
  const cacheFallback = String(cache.fallback || 'memory') === 'none' ? 'none' : 'memory';
  const cacheDriver = String(cache.driver || 'memory');
  const cacheHost = String(cache.host || '127.0.0.1');
  const cachePort = toInt(cache.port, 16379);
  const cacheDb = toInt(cache.db, 0);
  const cacheUrl = String(cache.url || ('redis://' + cacheHost + ':' + cachePort + '/' + cacheDb));
  /* 允许来源：显式配置优先；* 视为未配置，避免继续产出通配来源。
     未配置时用站点域名（含协议与端口），未填域名则只放行本机预览地址。 */
  const explicitOrigins = (Array.isArray(cors.origins) ? cors.origins : [])
    .map((item) => String(item || '').trim().replace(/\/+$/, ''))
    .filter((item) => item && item !== '*');
  const origins = explicitOrigins.length
    ? explicitOrigins.slice()
    : ((address && address.corsOrigins) || ['http://localhost', 'http://127.0.0.1']).slice();
  /* 桌面 WebView 的页面来源不是 http(s) 站点；后端必须额外放行 Tauri 协议来源，
     否则桌面里的 fetch 会因 CORS 被浏览器内核拦掉。 */
  for (const item of extraOrigins || []) {
    const value = String(item || '').trim().replace(/\/+$/, '');
    if (value && !origins.includes(value)) origins.push(value);
  }
  const originText = origins.length ? '[' + origins.map(yamlScalar).join(', ') + ']' : '[]';
  const dbGroup = driver === 'mysql' ? 'mysql' : driver === 'postgres' ? 'postgres' : 'sqlite'
  const builtinLines = ['  builtin:']
  if (dbGroup === 'sqlite') {
    const file = String(database.file || dbUrl.replace(/^sqlite:\/\//, '') || ('data/' + dbName + '.db'))
    builtinLines.push('    sqlite:', '      enabled: true', '      config:', '        file: ' + yamlScalar(file))
  } else {
    builtinLines.push(
      '    ' + dbGroup + ':',
      '      enabled: true',
      '      config:',
      '        host: ' + yamlScalar(database.host || '127.0.0.1'),
      '        port: ' + toInt(database.port, dbGroup === 'mysql' ? 3306 : 5432),
      '        database: ' + yamlScalar(dbName),
      '        user: ' + yamlScalar(database.user || ''),
      '        password: ""',
      ...(dbGroup === 'postgres' ? ['        sslMode: ' + yamlScalar(database.sslMode || 'disable')] : []),
      '        maxOpenConns: ' + toInt(database.maxOpenConns, 10),
      '        connectTimeoutSeconds: ' + toInt(database.connectTimeoutSeconds, 5)
    )
  }
  // 只渲染启用组：关闭组的配置键不会出现在产物里。
  if (cacheEnabled && cacheDriver === 'redis') {
    builtinLines.push(
      '    redis:',
      '      enabled: true',
      '      config:',
      '        url: ' + yamlScalar(cacheUrl),
      '        ttlSeconds: ' + toInt(cache.ttlSeconds, 30),
      '        keyPrefix: ' + yamlScalar(cache.keyPrefix || 'lc:'),
      '        password: ""'
    )
  }
  const extraGroups = backend.middlewareGroups && typeof backend.middlewareGroups === 'object'
    ? backend.middlewareGroups
    : {}
  for (const name of ['objectStorage', 'messageQueue', 'search', 'reverseProxy']) {
    const group = extraGroups[name]
    if (!group || group.enabled !== true) continue
    const config = group.config && typeof group.config === 'object' ? group.config : {}
    builtinLines.push('    ' + name + ':', '      enabled: true', '      config:')
    const entries = Object.entries(config)
    for (const [key, value] of entries) {
      // 密钥类字段一律留空，由 LC_CFG_* 环境变量注入，避免随产物泄露。
      builtinLines.push('        ' + key + ': ' + (isSecretKey(key) ? '""' : yamlValue(value)))
    }
    if (entries.length === 0) builtinLines.push('        {}')
  }

  const centerLines = []
  const center = backend.configCenter && typeof backend.configCenter === 'object' ? backend.configCenter : null
  const centerEnv = centerEnvironment(center, backend)
  const definitions = centerDefinitions(center, backend)
  const generatedValues = nonSecretValues(
    definitions,
    Object.assign(
      {},
      centerEnv.envDoc && centerEnv.envDoc.values ? centerEnv.envDoc.values : (center?.values || {}),
      customMiddlewareValues(backend)
    )
  )
  const siteValues = nonSecretValues(definitions, centerEnv.envDoc?.site || {})
  const exportedValues = layer === 'user'
    ? Object.assign({}, generatedValues, siteValues)
    : generatedValues
  if (definitions.length) {
    centerLines.push('configCenter:', '  definitions:')
    for (const def of definitions) {
      centerLines.push('    - key: ' + yamlScalar(def.key), '      type: ' + yamlScalar(def.type || 'string'))
      if (def.default !== undefined) centerLines.push('      default: ' + yamlValue(def.default))
      centerLines.push('      secret: ' + (def.secret === true ? 'true' : 'false'))
      if (Array.isArray(def.enum) && def.enum.length) {
        centerLines.push('      enum: [' + def.enum.map(yamlScalar).join(', ') + ']')
      }
      if (def.description) centerLines.push('      description: ' + yamlScalar(def.description))
    }
    const valueKeys = Object.keys(exportedValues)
    if (valueKeys.length) {
      centerLines.push('  values:')
      for (const key of valueKeys) centerLines.push('    ' + key + ': ' + yamlValue(exportedValues[key]))
    }
    centerLines.push('')
  }

  return [
    '# 由低代码工作台在导出时生成。',
    '# 密码不写在这里：内置组用 LC_CFG_* 环境变量，自定义密钥用 LC_CFG_<KEY>。',
    '# 只支持映射、列表、行内列表、引号字符串、布尔、整数、null 与 # 注释。',
    '',
    'schemaVersion: 1',
    'language: ' + yamlScalar(language),
    'maturity: ' + yamlScalar(backend.maturity || (language === 'none' ? 'n/a' : 'full')),
    'strict: true',
    'override: false',
    '',
    'host: ' + yamlScalar(backend.host || '127.0.0.1'),
    'port: ' + toInt(backend.port, 8080),
    'logLevel: info',
    '',
    'cors:',
    '  enabled: ' + (cors.enabled !== false ? 'true' : 'false'),
    '  origins: ' + originText,
    '  methods: [GET, POST, PUT, DELETE, OPTIONS]',
    '  headers: [content-type, authorization, x-request-id]',
    '  credentials: ' + (cors.credentials === true ? 'true' : 'false'),
    '  maxAge: 600',
    '',
    'database:',
    '  driver: ' + yamlScalar(driver),
    '  url: ' + yamlScalar(dbUrl),
    '  host: ' + yamlScalar(database.host || '127.0.0.1'),
    '  port: ' + toInt(database.port, 0),
    '  name: ' + yamlScalar(dbName),
    '  user: ' + yamlScalar(database.user || ''),
    '  password: ""',
    '  sslMode: ' + yamlScalar(database.sslMode || 'disable'),
    '  maxOpenConns: ' + toInt(database.maxOpenConns, 10),
    '  connectTimeoutSeconds: ' + toInt(database.connectTimeoutSeconds, 5),
    '',
    'cache:',
    '  enabled: ' + (cacheEnabled ? 'true' : 'false'),
    '  fallback: ' + cacheFallback,
    '  driver: ' + yamlScalar(cacheDriver),
    '  url: ' + yamlScalar(cacheDriver === 'redis' ? cacheUrl : ''),
    '  ttlSeconds: ' + toInt(cache.ttlSeconds, 30),
    '  keyPrefix: ' + yamlScalar(cache.keyPrefix || 'lc:'),
    '',
    'middleware:',
    '  requestId: true',
    '  logging: true',
    '  bodyLimit:',
    '    enabled: true',
    '    maxBytes: 1048576',
    '  timeout:',
    '    enabled: true',
    '    seconds: 30',
    '  concurrency:',
    '    enabled: false',
    '    maxInFlight: 64',
    '  compression:',
    '    enabled: true',
    '    gzip: true',
    '    brotli: true',
    '    minBytes: 1024',
    '  rateLimit:',
    '    enabled: false',
    '    rps: 20',
    '  staticCache:',
    '    enabled: true',
    '    maxAgeSeconds: 3600',
    '    immutableMaxAgeSeconds: 31536000',
    '  health:',
    '    enabled: true',
    '    readinessRequiresDatabase: true',
    '    readinessRequiresCache: false',
    '  securityHeaders:',
    '    enabled: true',
    '    hsts:',
    '      enabled: false',
    '      maxAgeSeconds: 31536000',
    '      includeSubdomains: true',
    '      preload: false',
    '    contentTypeOptions: nosniff',
    '    frameOptions: SAMEORIGIN',
    '    referrerPolicy: strict-origin-when-cross-origin',
    '    permissionsPolicy: "geolocation=(), microphone=(), camera=()"',
    '    crossOriginOpenerPolicy: same-origin',
    ...builtinLines,
    '',
    ...centerLines,
    'static:',
    '  enabled: false',
    '  root: "../web"',
    ''
  ].join('\n');
}

/* 部署侧环境变量：非密钥的环境变量层直接给值，密钥只给键名，避免明文进产物。 */
function renderBackendEnv(backend, secrets) {
  const lines = [
    '# 由低代码工作台生成：部署前请按需修改。',
    '# 密钥项默认留空，平台不把明文口令写进导出产物；部署时在进程环境里注入。',
    '# 非密钥项来自配置中心「环境变量」层，会覆盖 config.yaml 里的同键值。',
    ''
  ]
  const seen = new Set()
  const selection = backend.middlewareSelection && typeof backend.middlewareSelection === 'object'
    ? backend.middlewareSelection
    : {}
  const dbSelected = typeof selection.database === 'string'
    ? selection.database
    : (String(backend.database?.driver || 'sqlite') === 'postgres'
        ? 'postgres'
        : String(backend.database?.driver || 'sqlite') === 'mysql' ? 'mysql' : 'sqlite')
  const enabledGroups = new Set()
  MiddlewareCatalog.BUILTIN_GROUPS.forEach((group) => {
    let enabled = false
    if (group.kind === 'database') enabled = group.id === dbSelected
    else if (group.id === 'redis') enabled = Boolean(backend.cache?.enabled && backend.cache?.driver === 'redis')
    else enabled = backend.middlewareGroups?.[group.id]?.enabled === true
    if (enabled) enabledGroups.add(group.group)
  })
  MiddlewareCatalog.BUILTIN_GROUPS.forEach((group) => {
    if (!enabledGroups.has(group.group)) return
    group.fields.forEach((field) => {
      if (!field.secret) return
      const name = field.env || MiddlewareCatalog.envNameForBuiltin(group.group, field.key)
      if (seen.has(name)) return
      seen.add(name)
      const value = secrets?.builtin?.[group.group]?.[field.key]
      lines.push((value ? '# 已保存密钥，部署时注入：' : '# 需要注入：') + name)
      lines.push(name + '=')
    })
  })
  const center = backend.configCenter && typeof backend.configCenter === 'object' ? backend.configCenter : null
  const definitions = centerDefinitions(center, backend)
  const { envDoc } = centerEnvironment(center, backend)
  definitions.forEach((definition) => {
    const name = MiddlewareCatalog.envNameForKey(definition.key)
    if (seen.has(name)) return
    if (definition.secret === true) {
      seen.add(name)
      lines.push('# 密钥配置项，部署时注入：' + name)
      lines.push(name + '=')
      return
    }
    const value = envDoc?.env?.[definition.key]
    if (value === undefined || value === '') return
    seen.add(name)
    lines.push(name + '=' + String(value))
  })
  return lines.join('\n') + '\n'
}

/* 启动参数层：导出成可复制的 --cfg 列表，不自动执行。 */
function renderCliOverrides(backend) {
  const center = backend.configCenter && typeof backend.configCenter === 'object' ? backend.configCenter : null
  const definitions = centerDefinitions(center, backend)
  const { envDoc } = centerEnvironment(center, backend)
  const lines = [
    '# 配置中心「启动参数」层：需要覆盖时把对应行拼到启动命令后面。',
    '# 例：node src/main.js --cfg APP_MODE=strict',
    ''
  ]
  let count = 0
  definitions.forEach((definition) => {
    const value = envDoc?.cli?.[definition.key]
    if (value === undefined || value === '') return
    count += 1
    if (definition.secret === true) {
      lines.push('# 密钥项请直接写在部署脚本的环境变量里，避免进入 shell 历史：')
      lines.push('# --cfg ' + definition.key + '=<secret>')
      return
    }
    lines.push('--cfg ' + definition.key + '=' + String(value))
  })
  if (count === 0) lines.push('# 当前没有启动参数覆盖。')
  return lines.join('\n') + '\n'
}

/* Web 产物不再承诺 file:// 双击可用。双击打开时至少给一个明确说明，
   而不是让用户面对白屏或半残页面。只依赖内联样式与脚本，不引用产物里的任何资源。 */
function httpRequiredNotice() {
  return [
    '<div id="lc-http-required" style="display:none;margin:0;padding:12px 16px;background:#fff4d6;border-bottom:1px solid #e0c27a;color:#4a3410;font:14px/1.6 system-ui,-apple-system,sans-serif;">',
    '<strong>这个包需要通过 http 访问</strong>',
    '<span style="display:block;margin-top:4px;">当前是双击打开（file://），fetch、模块脚本与部分浏览器 API 会被限制。请把 web/ 部署到 nginx，或在本机执行 <code>npx serve web</code> / <code>python -m http.server</code> 后打开。想要双击直接用，请改用 Tauri 桌面导出。</span>',
    '</div>',
    '<script>(function(){ if (location.protocol !== "file:") return; var box = document.getElementById("lc-http-required"); if (box) box.style.display = "block"; })();</script>'
  ].join('\n');
}

/* 只导出选定页面时，如果选中范围里没有站点入口 index.html，
   产物的入口检查会失败。这里补一个最小的跳转页，保证包能直接打开。 */
function buildEntryShim(input) {
  const target = String(input.target || '');
  const title = String(input.title || '入口');
  const lang = String(input.lang || 'zh-CN');
  return [
    '<!doctype html>',
    '<html lang="' + escapeHtml(lang) + '" data-lc-mode="light">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(title) + '</title>',
    '<meta http-equiv="refresh" content="0; url=' + escapeHtml(target) + '">',
    '<link rel="canonical" href="' + escapeHtml(target) + '">',
    '</head>',
    '<body>',
    httpRequiredNotice(),
    '<p>正在前往 <a href="' + escapeHtml(target) + '">' + escapeHtml(title) + '</a>…</p>',
    '</body>',
    '</html>'
  ].join('\n');
}

function buildPageDocument(input) {
  const { page, result, title, lang, prefix, mermaid, runtime, themeId, themeBoot, desktopBridge } = input;
  const description = String(page.summary || page.description || '');
  const pageSize = (result.result && result.result.pageSize) || {};
  /* 页面限高时把滚动交给页面根容器，文档本身不留滚动条；限宽时去掉 body 默认外边距。 */
  /* 页面文档自身也显式铺主题背景，避免 CSS 未加载或变量缺失时露出 UA 黑底。 */
  const shellCss = '<style>html, body { background: var(--lc-color-bg, #f4f0e6); color: var(--lc-color-ink, #1d2320); }</style>';
  const pageSizeCss = pageSize.maxHeight
    ? '<style>html, body { margin: 0; height: 100%; } body { overflow: hidden; }</style>'
    : (pageSize.maxWidth ? '<style>html, body { margin: 0; }</style>' : '');
  const head = [
    '<!doctype html>',
    '<html lang="' + escapeHtml(lang || 'zh-CN') + '" data-lc-theme="' + escapeHtml(themeId || 'ink-green') + '" data-lc-mode="light">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(title) + '</title>',
    description ? '<meta name="description" content="' + escapeHtml(description) + '">' : '',
    themeBoot ? themeBoot : '',
    /* Tauri 桌面：页面在运行时从 window.__LC_DESKTOP__ 读应用名/版本/后端地址，
       桥接文件必须比其他脚本先加载。 */
    desktopBridge ? '<script src="' + prefix + 'desktop-config.js"></script>' : '',
    shellCss,
    pageSizeCss,
    '<link rel="stylesheet" href="' + prefix + 'assets/css/site.css">',
    '</head>',
    '<body>'
  ].filter(Boolean).join('\n');
  const tail = [
    runtime ? '<script>' + String(runtime).replace(/<\/script/gi, '<\\/script') + '</script>' : '',
    result.scriptsHtml || '',
    mermaid ? '<script src="' + prefix + 'assets/js/mermaid.min.js"></script>\n' + mermaid : '',
    '<script src="' + prefix + 'assets/js/site.js" defer></script>',
    '</body>',
    '</html>'
  ].filter(Boolean).join('\n');
  return head + '\n' + httpRequiredNotice() + '\n' + result.html + '\n' + tail;
}

export async function loadSiteData(paths, siteId) {
  const loaded = await readSite(paths, siteId);
  if (!loaded.project) {
    throw fail('LC_E_PROJECT_MISSING', '站点缺少 project.json，无法导出');
  }
  const siteDir = loaded.siteDir;
  const pages = await listJson(path.join(siteDir, 'pages'));
  const components = await listJson(path.join(siteDir, 'components'));
  const articles = await listJson(path.join(siteDir, 'articles'));
  const themeFiles = await listJson(path.join(siteDir, 'themes'));

  const activeId = loaded.project.theme && loaded.project.theme.activeId;
  const themes = [];
  for (const raw of themeFiles) {
    const resolved = resolveThemeForRenderer(raw);
    if (resolved) themes.push(resolved);
  }
  /* 导出要支持访客切换主题：把 10 套内置主题读进渲染数据，再由 allowSwitch 决定带哪几套。 */
  const builtinIds = [];
  for (const info of await listBuiltinThemes()) {
    if (!themes.some((item) => item.id === info.id)) {
      const resolved = resolveThemeForRenderer(await getBuiltinTheme(info.id));
      if (resolved) themes.push(resolved);
    }
    builtinIds.push(info.id);
  }
  const active = String(activeId || (themes[0] && themes[0].id) || 'ink-green');
  if (!themes.some((item) => item.id === active)) {
    const builtin = await getBuiltinTheme(active);
    const resolved = resolveThemeForRenderer(builtin);
    if (resolved) themes.push(resolved);
  }
  if (!themes.length) themes.push(resolveThemeForRenderer(defaultTheme('ink-green')));

  const savedTheme = loaded.project.theme || {};
  const savedAllow = Array.isArray(savedTheme.allowSwitch) ? savedTheme.allowSwitch.map((id) => String(id)) : [];
  const allowSwitch = [];
  for (const id of savedAllow.concat(builtinIds, [active])) {
    if (themes.some((item) => item.id === id) && allowSwitch.indexOf(id) === -1) allowSwitch.push(id);
  }
  const mode = savedTheme.mode === 'light' || savedTheme.mode === 'dark' ? savedTheme.mode : 'auto';

  const project = {
    ...loaded.project,
    theme: { defaultThemeId: active, mode, allowSwitch }
  };
  /* 外壳区块（导航/页脚/侧栏）由项目引用，渲染层按 blockId 解析。 */
  const shellBlocks = Array.isArray(loaded.project.shellBlocks) ? loaded.project.shellBlocks : [];
  const site = { project, pages, components, articles, themes, shellBlocks };
  return { meta: loaded.site, project: loaded.project, siteDir, site };
}

/* 站点自己的后端用户区代码：只读 backend/<language>/ 下的白名单文件，
   导出时覆盖模板里的同名用户区文件；生成区与构建产物不在白名单内。 */
async function readBackendUserCode(siteDir, language) {
  const { key, zone } = zoneForLanguage(language);
  if (!zone) return {};
  const root = path.join(siteDir, 'backend', key);
  const out = {};
  await walkFiles(root, '', async (full, rel) => {
    if (!isUserZonePath(zone, rel)) return;
    const ext = path.posix.extname(rel).toLowerCase();
    if (!zone.extensions.includes(ext)) return;
    const body = await fs.readFile(full, 'utf8').catch(() => null);
    if (body != null) out[rel] = body;
  });
  return out;
}

async function readAssetSources(siteDir) {
  const sources = {};
  await walkFiles(path.join(siteDir, 'assets'), 'assets', async (full, rel) => {
    sources[rel] = await fs.readFile(full);
  });
  return sources;
}

async function readConditionalSources(platformRoot) {
  const sources = {};
  for (const item of Assets.CONDITIONAL_ASSETS) {
    const file = path.join(platformRoot, item.source);
    const body = await fs.readFile(file).catch(() => null);
    if (body) sources[item.source] = body;
  }
  return sources;
}

/* 数据源快照：把 data/sources.json、collections、mocks 原样打进产物，导出后不实时请求。
 * 快照清单写清 capturedAt 与各集合条数，便于产物侧核对数据是否过期。
 * 只读取 data/ 下的四类文件；.lowcode 下的密钥文件不在快照范围内。
 * includeData=false 时集合只带定义，行数据不写进产物。 */
async function readDataSourceSnapshot(siteDir, capturedAt, includeData = true) {
  const files = {};
  const counts = { sources: 0, collections: 0, mocks: 0 };
  const collections = [];
  const sourcesText = await fs.readFile(path.join(siteDir, 'data', 'sources.json'), 'utf8').catch(() => null);
  if (sourcesText) {
    files['web/data/sources.json'] = sourcesText;
    try {
      const parsed = JSON.parse(sourcesText);
      counts.sources = Array.isArray(parsed.sources) ? parsed.sources.length : Array.isArray(parsed) ? parsed.length : 0;
    } catch { counts.sources = 0; }
  }
  for (const kind of ['collections', 'mocks']) {
    const dir = path.join(siteDir, 'data', kind);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const text = await fs.readFile(path.join(dir, entry.name), 'utf8').catch(() => null);
      if (text == null) continue;
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      let body = text;
      // 不带数据时把 rows 从集合定义里摘掉，避免产物里仍留存业务数据。
      if (kind === 'collections' && !includeData && parsed && 'rows' in parsed) {
        const clone = { ...parsed };
        delete clone.rows;
        delete clone.total;
        body = JSON.stringify(clone, null, 2) + '\n';
        parsed = clone;
      }
      files['web/data/' + kind + '/' + entry.name] = body;
      counts[kind] += 1;
      if (kind !== 'collections') continue;
      collections.push({
        id: (parsed && parsed.id) || path.basename(entry.name, '.json'),
        name: (parsed && parsed.name) || path.basename(entry.name, '.json'),
        rows: includeData && Array.isArray(parsed && parsed.rows) ? parsed.rows.length : 0,
        fields: Array.isArray(parsed && parsed.fields) ? parsed.fields.length : 0
      });
    }
  }
  collections.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  files['web/data/snapshot.json'] = JSON.stringify({
    schemaVersion: 1,
    capturedAt,
    counts,
    collections,
    note: '导出快照：静态产物不实时请求数据源；capturedAt 为构建开始时间'
  }, null, 2) + '\n';
  return { files, counts, collections };
}

/* 迁移语句按分号切分，SQL 字符串里不能留裸分号；用 JSON 的 \u003b 转义可保持 JSON 语义。
 * MySQL 默认把反斜杠当转义符，需整体转义成 \\，否则种子里的 JSON 会被改写。 */
function sqlText(value, driver) {
  let text = String(value == null ? '' : value).replace(/;/g, '\\u003b');
  if (driver === 'mysql') text = text.replace(/\\/g, '\\\\');
  return "'" + text.replace(/'/g, "''") + "'";
}

/* 把站点集合的当前行生成一份随迁移执行的种子快照。
 * 迁移版本只会应用一次：新库首次启动自动导入，已有数据的库不会重复导入。 */
function renderSeedMigration(items, capturedAt, driver) {
  const rows = [];
  for (const item of items) {
    const raw = Array.isArray(item.json && item.json.rows) ? item.json.rows : [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const id = String(row.id || 'seed-' + item.id + '-' + (rows.length + 1));
      const data = { ...row };
      delete data.id;
      delete data.createdAt;
      delete data.updatedAt;
      const createdAt = String(row.createdAt || row.created_at || capturedAt);
      const updatedAt = String(row.updatedAt || row.updated_at || createdAt);
      rows.push({ collection: item.id, id, data, createdAt, updatedAt });
    }
  }
  const header = '-- [LC-GENERATED] 平台生成区：导出时写入的集合种子快照，请勿手改。\n' +
    '-- 新环境首次启动时随迁移自动导入；同一数据库只会执行一次。\n' +
    '-- capturedAt: ' + capturedAt + '，集合 ' + items.length + ' 个，数据 ' + rows.length + ' 行。\n\n';
  const body = rows.map((row) =>
    'INSERT INTO collection_rows (collection_id, id, data, created_at, updated_at) VALUES (' +
    [sqlText(row.collection, driver), sqlText(row.id, driver),
      sqlText(JSON.stringify(row.data), driver), sqlText(row.createdAt, driver), sqlText(row.updatedAt, driver)]
      .join(', ') + ');'
  ).join('\n') + (rows.length ? '\n' : '');
  const down = '-- [LC-GENERATED] 种子数据回滚：只删除导出时写入的行。\n' +
    rows.map((row) => 'DELETE FROM collection_rows WHERE collection_id = ' + sqlText(row.collection, driver) +
      ' AND id = ' + sqlText(row.id, driver) + ';').join('\n') + (rows.length ? '\n' : '');
  return { rows: rows.length, sql: header + body, down };
}

/* 预览占用文件时不要把 EBUSY 原文和绝对路径抛给用户。 */
function friendlyFlowBuildError(error) {
  const raw = String((error && error.message) || error || '');
  if (/EBUSY|EPERM|EACCES|resource busy|locked/i.test(raw)) {
    return '站点有后端预览实例正在运行，构建目录里的文件被占用。请先在「后端积木」里停止预览，或稍后重试';
  }
  return raw;
}

/* 导出产物自带积木后端：编译流程并把生成区文件（flows 路由、runtime、清单）打进 server/。
 * 产物解开后后端直接可启动，前端不必再靠平台“编译”目录手工搬运。 */
async function collectBackendFlowFiles({ paths, siteId, siteDir, language }) {
  const flow = await readFlow(siteDir, siteId, 'node').catch((error) => {
    throw fail('LC_E_FLOW_READ', '读取后端流程失败：' + (error && error.message ? error.message : String(error)));
  });
  if (!flow.exists) return { files: {}, compiled: false };
  let build;
  try {
    build = await buildFlowProject({ paths, siteId, siteDir, flowDoc: flow.doc, target: language });
  } catch (error) {
    if (error instanceof BuildError) {
      const failure = fail('LC_E_FLOW_BUILD', '后端积木编译失败：' + friendlyFlowBuildError(error));
      failure.issues = error.issues || [];
      throw failure;
    }
    throw fail('LC_E_FLOW_BUILD', '后端积木编译失败：' + friendlyFlowBuildError(error));
  }
  const out = {};
  for (const file of build.files) out['server/' + file.path] = file.content;
  const manifest = await fs.readFile(path.join(build.serverDir, 'GENERATED-MANIFEST.json'), 'utf8').catch(() => null);
  if (manifest != null) out['server/GENERATED-MANIFEST.json'] = manifest;
  return { files: out, compiled: true, filesCount: build.files.length };
}

/* 只带集合定义：后端启用但没勾选数据源快照时，后端仍需要集合字段定义才能启动数据 API。 */
async function readCollectionDefinitions(siteDir, includeData) {
  const files = {};
  const collections = [];
  const dir = path.join(siteDir, 'data', 'collections');
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const text = await fs.readFile(path.join(dir, entry.name), 'utf8').catch(() => null);
    if (text == null) continue;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    let body = text;
    if (!includeData && parsed && 'rows' in parsed) {
      const clone = { ...parsed };
      delete clone.rows;
      delete clone.total;
      body = JSON.stringify(clone, null, 2) + '\n';
      parsed = clone;
    }
    files['web/data/collections/' + entry.name] = body;
    collections.push({
      id: (parsed && parsed.id) || path.basename(entry.name, '.json'),
      name: (parsed && parsed.name) || path.basename(entry.name, '.json'),
      rows: includeData && Array.isArray(parsed && parsed.rows) ? parsed.rows.length : 0,
      fields: Array.isArray(parsed && parsed.fields) ? parsed.fields.length : 0
    });
  }
  collections.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { files, collections };
}

/* 工具链只由“本包实际选了什么”推导：目标 + 后端语言，一处得出，README/模板过滤共用。
   桌面目标必然需要 Node（构建脚本）与 Rust（Tauri 本体）；后端语言按选中项追加。 */
const TOOLCHAIN_VERSIONS = { nodeBackend: '22.5', nodeBuild: '18', rust: '1.80', go: '1.23' };
const BACKEND_LABEL = { node: 'Node.js', rust: 'Rust', go: 'Go' };

function toolchainUsage(target, backend) {
  const desktop = target === 'tauri-desktop';
  const language = String((backend && backend.language) || 'none');
  const node = desktop || language === 'node';
  const rust = desktop || language === 'rust';
  const go = language === 'go';
  const requirements = [];
  if (node) {
    requirements.push({
      id: 'node',
      name: 'Node.js + npm',
      version: language === 'node' ? TOOLCHAIN_VERSIONS.nodeBackend : TOOLCHAIN_VERSIONS.nodeBuild,
      purpose: [language === 'node' ? '后端' : '', desktop ? '桌面构建' : ''].filter(Boolean).join(' / ')
    });
  }
  if (rust) {
    requirements.push({
      id: 'rust',
      name: 'Rust 工具链（cargo/rustc）',
      version: TOOLCHAIN_VERSIONS.rust,
      purpose: [desktop ? 'Tauri 桌面构建' : '', language === 'rust' ? '后端' : ''].filter(Boolean).join(' / ')
    });
  }
  if (go) {
    requirements.push({
      id: 'go',
      name: 'Go',
      version: TOOLCHAIN_VERSIONS.go,
      purpose: language === 'go' ? (desktop ? '后端 / sidecar' : '后端') : 'sidecar'
    });
  }
  const describe = [
    desktop ? 'Tauri 桌面工程' : '',
    language !== 'none' ? (BACKEND_LABEL[language] || language) + ' 后端' : ''
  ].filter(Boolean).join(' + ');
  return { target, desktop, language, node, rust, go, requirements, describe };
}

function requirementList(usage) {
  return (usage.requirements || []).map((item) => item.name + ' ≥ ' + item.version + '（' + item.purpose + '）');
}

/* 去掉未选中语言的说明块，并清理模板自带的验证记录；同一份选择推导，不各自硬编码。
   独占整行的标记按行处理，避免删掉条件行后留下空行把 Markdown 表格拆断。 */
function localizeDoc(text, usage) {
  const lines = String(text == null ? '' : text).split('\n');
  const out = [];
  const stack = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const open = trimmed.match(/^<!-- lc:lang:([a-z]+) -->$/);
    if (open) {
      stack.push({ keep: open[1] === usage.language });
      continue;
    }
    if (/^<!-- \/lc:lang:[a-z]+ -->$/.test(trimmed)) {
      stack.pop();
      continue;
    }
    if (trimmed === '<!-- lc:export-hide -->') {
      stack.push({ keep: false });
      continue;
    }
    if (trimmed === '<!-- /lc:export-hide -->') {
      stack.pop();
      continue;
    }
    if (stack.every((item) => item.keep)) out.push(line);
  }
  let result = out.join('\n');
  /* 行内标记（例如同一行里的多语言片段）单独处理。 */
  result = result.replace(/<!-- lc:lang:([a-z]+) -->([\s\S]*?)<!-- \/lc:lang:\1 -->/g,
    (match, language, body) => (language === usage.language ? body : ''));
  result = result.replace(/<!-- lc:export-hide -->[\s\S]*?<!-- \/lc:export-hide -->/g, '');
  return result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
}

/* 产物里只保留实际用到的示例：没选 Go 时去掉 examples/ 下的 Go sidecar 示例。 */
function applyToolchainToFiles(files, usage) {
  if (!usage.go) {
    for (const key of Object.keys(files)) {
      if (/^(?:desktop\/)?(?:examples|demo|demos|samples)(?:\/|$)/i.test(key)) delete files[key];
    }
  }
  for (const key of ['deploy/README.md', 'desktop/README.md', 'desktop/docs/sidecar.md', 'desktop/docs/build-app.md']) {
    const value = files[key];
    /* 模板文件从磁盘读入是 Buffer，统一转成文本后再按选择裁剪，否则标记会原样留在产物里。 */
    if (value == null) continue;
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : (typeof value === 'string' ? value : null);
    if (text == null) continue;
    files[key] = localizeDoc(text, usage);
  }
  if (typeof files['desktop/README.md'] === 'string' && usage.desktop) {
    const line = '前置：' + requirementList(usage).join('、') +
      '、平台依赖（Windows 需 WebView2 运行时；Linux 需 WebKitGTK）。' +
      '依赖全部走本地 npm / cargo 并锁定版本，**不引用任何 CDN**。';
    files['desktop/README.md'] = files['desktop/README.md'].replace(
      /<!-- lc:env-requirements -->[\s\S]*?<!-- \/lc:env-requirements -->/,
      line
    );
  }
}

function planFor(project, target, backendOverride) {
  const backend = backendOverride || (project.export && project.export.backend) || { language: 'none' };
  const web = (project.export && project.export.web) || {};
  return Templates.planTemplates({
    target,
    backend,
    nginxEnabled: Boolean(web.nginx && web.nginx.enabled)
  });
}

async function readTemplateSources(platformRoot, plan) {
  const sources = {};
  for (const rule of plan.rules) {
    const root = path.join(platformRoot, rule.root);
    await walkFiles(root, '', async (full, rel) => {
      if (!Templates.includedIn(rule.kind, rel)) return;
      const key = rule.root + '/' + rel;
      sources[key] = await fs.readFile(full);
    });
  }
  for (const candidate of plan.configCandidates || []) {
    if (sources[candidate] != null) continue;
    const file = path.join(platformRoot, candidate);
    const body = await fs.readFile(file).catch(() => null);
    if (body) sources[candidate] = body;
  }
  return sources;
}

async function writeBuild(siteDir, buildId, record, zipBuffer, logText) {
  const dir = path.join(siteDir, 'builds', buildId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'build.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(dir, 'log.txt'), logText, 'utf8');
  if (zipBuffer) await fs.writeFile(path.join(dir, 'artifact.zip'), zipBuffer);
  return dir;
}

/* 构建保留策略：按导出目标保留最近 N 份；最新成功的一份和本次构建永不清理。
 * 清理不是硬删：旧构建整体移入 builds/.trash/，随时可以移回恢复。 */
const BUILD_TRASH_DIR = '.trash';
const BUILD_CLEANUP_LOG = '.cleanup-log.json';
const BUILD_CLEANUP_LOG_LIMIT = 200;

async function pruneBuilds(siteDir, { target, keep, currentBuildId }) {
  const buildsDir = path.join(siteDir, 'builds');
  const entries = (await fs.readdir(buildsDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  const records = [];
  for (const entry of entries) {
    const record = await readJson(path.join(buildsDir, entry.name, 'build.json'), null);
    if (!record || String(record.target || '') !== String(target || '')) continue;
    records.push({ buildId: entry.name, record });
  }
  if (!records.length) return null;

  records.sort((a, b) => {
    const byTime = String(b.record.startedAt || '').localeCompare(String(a.record.startedAt || ''));
    return byTime || b.buildId.localeCompare(a.buildId);
  });
  const keepIds = new Set(records.slice(0, Math.max(1, Number(keep) || 10)).map((item) => item.buildId));
  if (currentBuildId) keepIds.add(String(currentBuildId));
  /* 最近一次成功构建必须保留：失败构建再多，也不能只剩一堆不可用的记录。 */
  const latestSuccess = records.find((item) => item.record.status === 'success');
  if (latestSuccess) keepIds.add(latestSuccess.buildId);

  const candidates = records.filter((item) => !keepIds.has(item.buildId));
  if (!candidates.length) {
    return {
      target,
      keep: Math.max(1, Number(keep) || 10),
      protectedBuildIds: Array.from(keepIds),
      archived: [],
      trashDir: 'builds/' + BUILD_TRASH_DIR,
      log: 'builds/' + BUILD_CLEANUP_LOG
    };
  }

  const trashDir = path.join(buildsDir, BUILD_TRASH_DIR);
  await fs.mkdir(trashDir, { recursive: true });
  const logFile = path.join(buildsDir, BUILD_CLEANUP_LOG);
  const log = await readJson(logFile, { schemaVersion: 1, entries: [] });
  if (!Array.isArray(log.entries)) log.entries = [];
  const entry = {
    at: new Date().toISOString(),
    target,
    keep: Math.max(1, Number(keep) || 10),
    protectedBuildIds: Array.from(keepIds),
    candidates: candidates.map((item) => item.buildId),
    archived: [],
    status: 'pending',
    restore: '把 builds/.trash/<buildId> 移回 builds/<buildId> 即可恢复，build.json 与 artifact.zip 都保留。'
  };
  /* 先落记录再移动，异常中断时也能知道哪些构建被动过。 */
  log.entries.unshift(entry);
  log.entries = log.entries.slice(0, BUILD_CLEANUP_LOG_LIMIT);
  await fs.writeFile(logFile, JSON.stringify(log, null, 2) + '\n', 'utf8');

  for (const item of candidates) {
    const from = path.join(buildsDir, item.buildId);
    let toName = item.buildId;
    let to = path.join(trashDir, toName);
    if (await fs.stat(to).then(() => true).catch(() => false)) {
      toName = item.buildId + '-' + Date.now();
      to = path.join(trashDir, toName);
    }
    try {
      await fs.rename(from, to);
      entry.archived.push({ buildId: item.buildId, trashPath: 'builds/' + BUILD_TRASH_DIR + '/' + toName });
    } catch (error) {
      entry.archived.push({ buildId: item.buildId, error: error.message });
    }
  }
  entry.status = entry.archived.some((item) => item.error) ? 'partial' : 'done';
  await fs.writeFile(logFile, JSON.stringify(log, null, 2) + '\n', 'utf8');
  return {
    target: entry.target,
    keep: entry.keep,
    protectedBuildIds: entry.protectedBuildIds,
    archived: entry.archived,
    trashDir: 'builds/' + BUILD_TRASH_DIR,
    log: 'builds/' + BUILD_CLEANUP_LOG
  };
}

/* 清理失败不影响本次导出；把结果写回当前构建记录，构建详情里能看到归档了哪些旧构建。 */
async function applyBuildRetention(siteDir, buildId, record, target, keep, notes) {
  try {
    const cleanup = await pruneBuilds(siteDir, { target, keep, currentBuildId: buildId });
    if (!cleanup) return null;
    record.cleanup = cleanup;
    await fs.writeFile(
      path.join(siteDir, 'builds', buildId, 'build.json'),
      JSON.stringify(record, null, 2) + '\n',
      'utf8'
    );
    if (cleanup.archived.length) {
      notes.push({
        code: 'LC_I_BUILD_RETENTION',
        message: '按目标保留最近 ' + cleanup.keep + ' 份构建，' + cleanup.archived.length +
          ' 份旧构建已移入 ' + cleanup.trashDir + '（可恢复）'
      });
    }
    return cleanup;
  } catch (error) {
    notes.push({
      code: 'LC_W_BUILD_CLEANUP',
      message: '旧构建清理失败，本次产物不受影响：' + error.message
    });
    return null;
  }
}

function firstErrorLine(stderr) {
  var text = String(stderr || '');
  var match = text.match(/(?:^|\n)([^\n]*(?:SyntaxError|Error)[^\n]*)/);
  if (match) return match[1].trim();
  return text.split('\n').map((line) => line.trim()).filter(Boolean)[0] || '语法解析失败';
}

function hasRustToolchain() {
  const result = spawnSync('cargo', ['--version'], { encoding: 'utf8', timeout: 10000 });
  return result.status === 0;
}

function checkNodeFiles(files) {
  const failures = [];
  let checked = 0;
  for (const [file, body] of Object.entries(files)) {
    if (!/^server\/.*\.(?:js|mjs|cjs)$/.test(file)) continue;
    if (typeof body !== 'string' || !body.trim()) continue;
    const esm = file.endsWith('.mjs') || /(^|\n)\s*(?:import|export)\s/.test(body);
    const result = spawnSync(process.execPath, ['--check', '--input-type=' + (esm ? 'module' : 'commonjs')], {
      input: body,
      encoding: 'utf8',
      timeout: 15000
    });
    checked += 1;
    if (result.status !== 0) failures.push({ file, message: firstErrorLine(result.stderr) });
  }
  return { checked, failures };
}

async function checkRustFiles(files, backend) {
  if ((backend.language || 'none') !== 'rust') {
    return { status: 'skip', message: '当前后端不是 Rust，跳过 cargo check' };
  }
  if (!hasRustToolchain()) {
    return { status: 'skip', message: '未安装 cargo，跳过 Rust 编译检查' };
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-cargo-'));
  try {
    for (const [file, body] of Object.entries(files)) {
      if (!file.startsWith('server/') || body == null) continue;
      /* 模板源文件以 Buffer 进入构建；这里只关心文本，二进制原样落盘即可。 */
      const content = typeof body === 'string' || Buffer.isBuffer(body) ? body : null;
      if (!content) continue;
      const target = path.join(temp, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    const result = spawnSync('cargo', ['check', '--offline', '--quiet'], {
      cwd: path.join(temp, 'server'),
      encoding: 'utf8',
      timeout: 180000
    });
    if (result.status === 0) {
      return { status: 'pass', message: 'cargo check 通过' };
    }
    const stderr = String(result.stderr || '');
    if (/no matching package|failed to load source|offline|registry index|failed to download/i.test(stderr)) {
      return { status: 'skip', message: '依赖未缓存，跳过离线 cargo check' };
    }
    const failures = stderr.split('\n')
      .filter((line) => /^error(\[|:)/.test(line.trim()) || /^src\/.*\.rs:\d+/.test(line.trim()))
      .slice(0, 8)
      .map((line) => ({ file: 'server/', message: line.replace(temp + '/', '').trim() }));
    return { status: 'fail', failures, message: 'cargo check 未通过' };
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 组件脚本检查：JS 字段 + 模板里的内联 <script>。
 * 组件保存时已校验一次，这里覆盖导入的旧文件与手工改过的站点数据；
 * 失败会写进构建日志、manifest 警告，并由 component-scripts 检查项阻断导出。
 */
export function checkComponentScripts(components) {
  const failures = [];
  for (const component of components || []) {
    const id = String((component && component.id) || '(未命名组件)');
    const jsError = Render.checkJs((component && component.js) || '');
    if (jsError) {
      failures.push({
        componentId: id,
        field: 'js',
        message: '组件 JS 语法错误（第 ' + jsError.line + ' 行，第 ' + jsError.column + ' 列）：' + jsError.message,
        line: jsError.line,
        column: jsError.column
      });
    }
    Render.checkInlineScripts((component && component.template) || '').forEach((item) => {
      failures.push({
        componentId: id,
        field: 'template',
        message: item.message + '（第 ' + item.line + ' 行，第 ' + item.column + ' 列）',
        line: item.line,
        column: item.column
      });
    });
  }
  return failures;
}

/* 收集页面与外壳里实际引用的组件 id；未引用的组件只记录警告，不阻断导出。 */
export function collectComponentRefs(pages, extra) {
  const ids = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value.type === 'component' && value.componentId) ids.add(String(value.componentId));
    Object.keys(value).forEach((key) => walk(value[key]));
  };
  walk(pages || []);
  walk(extra || []);
  return ids;
}

/**
 * 导出前用户代码语法/编译检查：Node 逐文件解析，Rust 在临时副本上 cargo check。
 * 失败会进入 manifest 的 user-code-syntax 检查项并阻断产物生成。
 */
export async function checkUserCodeSyntax(files, backend) {
  const node = checkNodeFiles(files);
  const rust = await checkRustFiles(files, backend || { language: 'none' });
  const failures = [];
  node.failures.forEach((item) => failures.push(item));
  if (rust.failures) failures.push(...rust.failures);
  if (failures.length) {
    return { status: 'fail', failures, node: { checked: node.checked }, rust: { status: rust.status } };
  }
  const notes = [];
  if (node.checked) notes.push('Node 语法解析通过（' + node.checked + ' 个文件）');
  if (rust.status === 'pass') notes.push('cargo check 通过');
  if (rust.status === 'skip') notes.push(rust.message);
  if (!notes.length) return { status: 'skip', message: '没有可检查的用户代码' };
  return { status: 'pass', node: { checked: node.checked }, rust: { status: rust.status }, message: notes.join('；') };
}

async function uniqueBuildId(siteDir, base) {
  let id = base;
  let index = 1;
  while (true) {
    const exists = await fs.stat(path.join(siteDir, 'builds', id)).then(() => true).catch(() => false);
    if (!exists) return id;
    index += 1;
    id = base + '-' + index;
  }
}

function buildLog(record) {
  const lines = [
    '# 低代码构建日志（脱敏，不含密钥）',
    'buildId=' + record.buildId,
    'target=' + record.target,
    'status=' + record.status,
    'startedAt=' + record.startedAt,
    'endedAt=' + record.endedAt,
    'artifactBytes=' + (record.artifact ? record.artifact.bytes : 0)
  ];
  for (const line of (record.sizing && record.sizing.lines) || []) {
    lines.push('size=' + line);
  }
  lines.push('minify=' + (record.minify && record.minify.enabled ? 'on' : 'off'));
  lines.push('minifyHtml=' + (record.minify && record.minify.html ? 'on' : 'off'));
  lines.push('minifySaved=' + (record.minify ? record.minify.saved : 0));
  for (const check of record.manifest.checks || []) {
    lines.push('check[' + check.id + ']=' + check.status + ' ' + check.message);
  }
  for (const warning of record.manifest.warnings || []) {
    lines.push('warn[' + warning.code + ']=' + warning.message);
  }
  return lines.join('\n') + '\n';
}

/* 把站点域名与其路径前缀写进部署侧产物：
   - nginx.conf 的 server_name 与子路径重写；
   - 部署脚本的域名默认值（证书 CN/SAN 跟着用同一个值）；
   - server/.env.example 与前端 site.js 的公开基址。
   站点自定义 nginx 由用户自己维护，这里只提示，不改写。 */
function applySiteAddressToFiles(files, address, notes) {
  const host = address.configured ? address.host : 'localhost';
  const asText = (body) => {
    if (typeof body === 'string') return body;
    if (Buffer.isBuffer(body)) return body.toString('utf8');
    return null;
  };
  const rewrite = address.basePath === '/'
    ? ''
    : [
        '        # 站点挂载在子路径 ' + address.basePath + '/：先去掉前缀，再按根路径匹配。',
        '        location = ' + address.basePath + ' { return 301 ' + address.basePath + '/; }',
        '        rewrite ^' + address.basePath + '(/.*)$ $1 break;'
      ].join('\n');

  const nginx = asText(files['deploy/nginx/nginx.conf']);
  if (nginx != null) {
    files['deploy/nginx/nginx.conf'] = nginx
      .replace(/server_name\s+example\.com localhost 127\.0\.0\.1;/g, () => 'server_name  ' + address.serverNames + ';')
      .replace(/[ \t]*\{\{BASE_PATH_REWRITE\}\}[ \t]*\n?/g, () => (rewrite ? rewrite + '\n' : ''));
  }

  for (const [file, body] of Object.entries(files)) {
    if (!file.startsWith('deploy/scripts/')) continue;
    const current = asText(body);
    if (current == null) continue;
    let text = current;
    if (address.configured) {
      text = text
        .replace(/LC_DEPLOY_DOMAIN:-localhost/g, () => 'LC_DEPLOY_DOMAIN:-' + host)
        .replace(/if \(-not \$Domain\) \{ \$Domain = 'localhost' \}/g, () => "if (-not $Domain) { $Domain = '" + host + "' }")
        .replace(/^\s*DOMAIN=localhost$/gm, () => 'DOMAIN=' + host)
        .replace(/\[string\]\$Domain = "localhost"/g, () => '[string]$Domain = "' + host + '"');
    }
    text = text.replace(/[ \t]*\{\{BASE_PATH_REWRITE\}\}[ \t]*\n?/g, () => (rewrite ? rewrite + '\n' : ''));
    files[file] = text;
  }

  const envFile = asText(files['server/.env.example']);
  if (envFile != null && !envFile.includes('LC_PUBLIC_BASE_URL=')) {
    files['server/.env.example'] = envFile.replace(/\s*$/, '\n') +
      '\n# 站点公开基址（域名 + 路径前缀）：前端从这里取接口地址，不要写死域名。\n' +
      'LC_PUBLIC_BASE_URL=' + address.publicBaseUrl + '\n' +
      'LC_SITE_ORIGIN=' + address.origin + '\n' +
      'LC_SITE_BASE_PATH=' + address.basePath + '\n';
  }

  if (!address.configured) {
    notes.push({
      code: 'LC_W_SITE_DOMAIN_UNSET',
      message: '域名未配置，仅本机可用：nginx server_name 回退 localhost / 127.0.0.1，CORS 只放行本机预览地址，公开基址为 ' + address.publicBaseUrl + '。'
    });
  } else if (address.normalized) {
    notes.push({
      code: 'LC_W_SITE_DOMAIN_NORMALIZED',
      message: '域名已归一化为 ' + address.origin + (address.basePath === '/' ? '' : '，路径前缀 ' + address.basePath)
    });
  }
}

/**
 * 服务端导出：读取站点 → 渲染页面 → 资源/模板装配 → 压缩 → assemble → 写 zip 与构建记录。
 * 与浏览器导出共用 shared/export-*.js 的同一套逻辑。
 */
export async function exportSite(options) {
  const opts = options || {};
  const platformRoot = opts.platformRoot;
  const paths = opts.paths;
  const siteId = String(opts.siteId || '');
  const target = String(opts.target || 'web-static');
  if (!EXPORT_TARGETS.has(target)) throw fail('LC_E_EXPORT_TARGET', '不支持的导出目标：' + target);
  const desktopInput = (opts.desktop && typeof opts.desktop === 'object') ? opts.desktop : {};
  const version = String(opts.version || '');
  const platform = opts.platform || { name: '低代码工作台', version: '0.1.0' };
  const scopeInput = (opts.scope && typeof opts.scope === 'object') ? opts.scope : null;
  const scopeMode = scopeInput && scopeInput.mode === 'selected' ? 'selected' : 'all';
  const selectedPageIds = new Set(((scopeInput && scopeInput.pageIds) || []).map((id) => String(id)));
  let minifyCssJs = opts.minify !== false;
  let minifyHtmlEnabled = opts.minifyHtml === true;
  if (opts.minify && typeof opts.minify === 'object') {
    minifyCssJs = opts.minify.cssJs !== false;
    minifyHtmlEnabled = opts.minify.html === true;
  }
  const snapshotEnabled = opts.snapshotSources !== false;
  /* 集合数据默认随包导出：新环境解开即可用，不用先造数据才能验证接口。 */
  const includeData = opts.includeData !== false;
  const backendOverride = (opts.backend && typeof opts.backend === 'object') ? opts.backend : null;
  const dryRun = opts.dryRun === true;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const step = (stage, percent, message) => {
    if (!onProgress) return;
    try { onProgress({ stage, percent, message }); } catch { /* 进度回调不影响导出 */ }
  };

  if (!platformRoot || !paths) throw fail('LC_E_EXPORT_CONTEXT', '缺少平台根或数据路径，无法导出');
  Bundle.layoutFor(target);

  const loaded = await loadSiteData(paths, siteId);
  const siteDir = loaded.siteDir;
  if (!Render.ready) {
    throw fail('LC_E_RENDER_NOT_READY', '渲染层缺少模块：' + (Render.missing || []).join(', '));
  }

  const lock = new SiteFileLock(path.join(siteDir, '.lowcode', 'locks', 'builds', 'site.lock'), {
    siteId: loaded.meta.siteId || siteId,
    staleMs: paths.lockStaleMs || 60000
  });
  let locked = false;
  if (!dryRun) {
    await lock.acquire();
    locked = true;
  }
  try {
  step('read', 6, '读取站点文件');
  const startedAt = new Date().toISOString();
  const baseArtifactId = Bundle.makeArtifactId({ id: loaded.meta.siteId || siteId }, startedAt);
  const buildId = await uniqueBuildId(siteDir, baseArtifactId);
  const artifactId = buildId;
  const registry = Render.createRegistry();
  Render.registerBuiltinComponents(registry);
  registerBaseBlocks(registry);
  const renderer = Render.createRenderer(loaded.site, { preview: false, registry });
  const themeId = renderer.defaultThemeId;
  const pageErrors = [];
  const notes = [];
  /* 旧站点或导入的组件可能绕过保存校验；导出前统一再查一次，结果写进日志与清单。 */
  const componentScriptFailures = checkComponentScripts(loaded.site.components);
  for (const item of componentScriptFailures) {
    notes.push({
      code: 'LC_W_COMPONENT_SCRIPT',
      componentId: item.componentId,
      message: '组件「' + item.componentId + '」' + item.message
    });
  }
  let files = {};
  /* 站点公开地址：域名缺失时回退 localhost；非法值在导出前直接报错，不生成坏配置。 */
  const web = Object.assign(
    {},
    (loaded.project.export && loaded.project.export.web) || {},
    (opts.web && typeof opts.web === 'object') ? opts.web : {}
  );
  const address = normalizeSiteAddress({ domain: web.domain, basePath: web.basePath });

  /* 后端选项与桌面配置先算出来：页面渲染要用桌面后端的接口基址，
     不能等页面写完再决定（否则会把 Web 站点域名带进桌面产物）。 */
  const projectBackend = (loaded.project.export && loaded.project.export.backend) || { language: 'none' };
  const backend = Object.assign({}, projectBackend, backendOverride || {}, {
    database: Object.assign({}, projectBackend.database || {}, (backendOverride && backendOverride.database) || {}),
    cache: Object.assign({}, projectBackend.cache || {}, (backendOverride && backendOverride.cache) || {}),
    cors: Object.assign({}, projectBackend.cors || {}, (backendOverride && backendOverride.cors) || {})
  });
  const toolchain = toolchainUsage(target, backend);

  /* Tauri 桌面：合并向导/站点/模板默认值，渲染工程配置并校验。 */
  let desktopInfo = null;
  if (target === 'tauri-desktop') {
    desktopInfo = await buildDesktopConfig({
      platformRoot,
      project: loaded.project,
      siteName: String(loaded.project.site?.name || loaded.meta.name || ''),
      desktop: desktopInput,
      backend
    });
    const config = desktopInfo.config;
    const rendered = desktopInfo.helpers.render;
    files['desktop/config/desktop.json'] = stableJson(config);
    files['desktop/src-tauri/tauri.conf.json'] = stableJson(rendered.buildTauriConf(config, { platform: desktopInfo.platform }));
    files['desktop/src-tauri/desktop.runtime.json'] = stableJson(rendered.buildRuntimeConfig(config));
    files['web/desktop-config.js'] = rendered.buildFrontendBridge(config);
    for (const warning of desktopInfo.validation.warnings) {
      notes.push({
        code: 'LC_W_TAURI_' + String(warning.code || 'CONFIG').replace(/^W_/, ''),
        message: (warning.field ? warning.field + '：' : '') + warning.message
      });
    }
    if (desktopInfo.httpsIgnored) {
      notes.push({
        code: 'LC_W_TAURI_HTTPS_IGNORED',
        message: '桌面协议是 http，HTTPS 模式（' + desktopInfo.requestedHttpsMode +
          '）不会生效，已重置为 none；需要证书时请把协议改成 https 再导出。'
      });
    }
    if (config.https.mode === 'generated') {
      notes.push({
        code: 'LC_W_TAURI_TEST_CERT',
        message: 'HTTPS 使用生成的自签测试证书：仅限本地测试。安装后系统与 WebView 会警告，不能用于真实用户；正式发布请导入可信证书。'
      });
    } else if (config.https.mode === 'imported') {
      notes.push({
        code: 'LC_W_TAURI_CERT_IMPORTED',
        message: 'HTTPS 使用导入证书：证书与私钥只在构建机准备，私钥不会进入导出包。'
      });
    }
  }

  /* 桌面页面：接口基址取桌面配置的后端地址；没有后端就不注入任何绝对域名。 */
  const desktopBaseUrl = desktopInfo && desktopInfo.config.backend && desktopInfo.config.backend.enabled
    ? String(desktopInfo.config.backend.baseUrl || '')
    : '';
  const pageAddress = target === 'tauri-desktop' ? null : address;
  const pageBaseOverride = target === 'tauri-desktop' ? desktopBaseUrl : '';

  const baseCss = renderer.baseCss();
  const themeCss = renderer.themeCss();
  const allowSwitch = (loaded.site.project.theme && Array.isArray(loaded.site.project.theme.allowSwitch) && loaded.site.project.theme.allowSwitch.length)
    ? loaded.site.project.theme.allowSwitch
    : [themeId];
  const siteMode = loaded.site.project.theme && loaded.site.project.theme.mode;
  const defaultMode = siteMode === 'dark' ? 'dark' : siteMode === 'light' ? 'light' : 'auto';
  const exportThemeCss = themeCssForIds(loaded.site.themes, allowSwitch, { defaultThemeId: themeId });
  const themeBoot = themeBootScript(allowSwitch, themeId, defaultMode);
  const cssExtras = [];
  const allPages = renderer.listPages();
  if (!allPages.length) throw fail('LC_E_EXPORT_EMPTY', '站点没有页面，无法导出');
  let pageList = allPages;
  let entryShim = null;
  if (scopeMode === 'selected') {
    pageList = allPages.filter((page) => selectedPageIds.has(String(page.id)));
    if (!pageList.length) throw fail('LC_E_EXPORT_SCOPE_EMPTY', '选定的页面不存在，无法导出');
    /* 导航、页脚、侧栏和正文里的站内链接都要保持可点：被引用但没选中的页面自动补进导出范围，
       直到没有新的引用为止。这样只导出部分页面时也不会产生死链。 */
    const pageIndex = makePageRefIndex(allPages);
    const wanted = new Set(pageList.map((page) => String(page.id)));
    const expanded = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      const currentPages = allPages.filter((page) => wanted.has(String(page.id)));
      for (const id of collectPageReferences(currentPages, loaded.site.shellBlocks, pageIndex)) {
        if (wanted.has(id)) continue;
        wanted.add(id);
        expanded.add(id);
        changed = true;
      }
    }
    pageList = allPages.filter((page) => wanted.has(String(page.id)));
    if (expanded.size) {
      notes.push({
        code: 'LC_W_SCOPE_EXPANDED',
        pages: Array.from(expanded),
        message: '为避免导航/正文链接指向未导出的页面，已自动把 ' + expanded.size + ' 个被引用的页面加入导出范围'
      });
    }
    if (pageList.length < allPages.length) {
      notes.push({
        code: 'LC_W_SCOPE_PARTIAL',
        message: '只导出 ' + pageList.length + '/' + allPages.length + ' 个页面；其余页面没有被已导出页面的导航或正文引用'
      });
    }
    if (!pageList.some((page) => pagePathOf(page) === 'index.html')) {
      const first = pageList[0];
      entryShim = {
        target: pagePathOf(first),
        title: String(first.title || first.id || '入口')
      };
      notes.push({
        code: 'LC_W_SCOPE_ENTRY_SHIM',
        message: '选定页面不含站点入口，已生成 web/index.html 跳转到 ' + entryShim.target
      });
    }
  }

  step('render', 10, '渲染页面 0/' + pageList.length);
  for (let index = 0; index < pageList.length; index += 1) {
    const page = pageList[index];
    const pagePath = pagePathOf(page);
    const prefix = prefixFor(pagePath);
    const result = renderer.renderToHtml(page.id, { themeId, mode: defaultMode });
    /* 每个页面按自身用到的组件内联一份运行时：http 部署下主题切换、文章目录 / 检索、
       表单联动与图表增强都要靠它生效。 */
    let runtimeCode = publicBaseConfig(pageAddress, pageBaseOverride);
    try {
      runtimeCode += Render.buildRuntime({ html: result.html, site: renderer.site, page }, {
        theme: themeId,
        mode: defaultMode
      }).code;
    } catch (error) {
      notes.push({
        code: 'LC_W_RUNTIME_OMITTED',
        message: '页面 ' + pagePath + ' 的交互运行时未写入：' + (error && error.message ? error.message : String(error))
      });
    }
    const html = buildPageDocument({
      page,
      result,
      runtime: runtimeCode,
      title: String(page.title || loaded.project.site?.name || ''),
      lang: loaded.project.site?.language || 'zh-CN',
      prefix,
      mermaid: '',
      themeId,
      themeBoot,
      desktopBridge: target === 'tauri-desktop'
    });
    files['web/' + pagePath] = html;

    const head = baseCss + '\n' + themeCss;
    if (result.css && result.css.indexOf(head) === 0) {
      const extra = result.css.slice(head.length).trim();
      if (extra && cssExtras.indexOf(extra) === -1) cssExtras.push(extra);
    }
    for (const error of (result.report && result.report.items) || []) {
      if (error.severity === 'error') {
        pageErrors.push({ pageId: page.id, pagePath: 'web/' + pagePath, code: error.code, message: error.message });
      }
    }
    step('render', 10 + Math.round(((index + 1) / pageList.length) * 40), '渲染页面 ' + (index + 1) + '/' + pageList.length);
  }

  if (entryShim) {
    files['web/index.html'] = buildEntryShim({
      target: entryShim.target,
      title: entryShim.title,
      lang: loaded.project.site?.language || 'zh-CN'
    });
  }

  /* 产物自带设计系统基础令牌（间距/字号/字体栈）；缺了它们，页内 var(--lc-space-*) 全部失效，
     主题切换面板和正文排版都会错位。 */
  let tokensCss = '';
  if (platformRoot) {
    try {
      tokensCss = await fs.readFile(path.join(platformRoot, 'assets', 'css', 'lc-tokens.css'), 'utf8');
    } catch {
      tokensCss = '';
    }
  }
  files['web/assets/css/site.css'] = tokensCss + '\n' + baseCss + '\n' + exportThemeCss +
    (cssExtras.length ? '\n' + cssExtras.join('\n') : '') + '\n';
  files['web/assets/js/site.js'] = runtimeScript(pageAddress, defaultMode, pageBaseOverride);

  const conditional = Assets.selectConditionalAssets(Assets.CONDITIONAL_ASSETS, files);
  const mermaidUsed = conditional.some((item) => item.package === 'mermaid');
  for (const page of pageList) {
    const pagePath = pagePathOf(page);
    const key = 'web/' + pagePath;
    if (!mermaidUsed || !/data-lc-mermaid|class="mermaid"/.test(files[key])) continue;
    const prefix = prefixFor(pagePath);
    const bootstrap = require('../../../shared/mermaid.js').bootstrap();
    const library = '<script src="' + prefix + 'assets/js/mermaid.min.js"></script>';
    files[key] = files[key].replace(
      '<script src="' + prefix + 'assets/js/site.js" defer></script>',
      library + '\n' + bootstrap + '\n' +
      '<script src="' + prefix + 'assets/js/site.js" defer></script>'
    );
  }

  const assetSources = await readAssetSources(siteDir);
  const conditionalSources = await readConditionalSources(platformRoot);
  const mermaidEntry = Assets.CONDITIONAL_ASSETS.find((item) => item.package === 'mermaid');
  const mermaidVendorBytes = mermaidEntry && conditionalSources[mermaidEntry.source]
    ? conditionalSources[mermaidEntry.source].length
    : 0;
  const mermaidInfo = {
    used: mermaidUsed,
    bundled: mermaidUsed,
    external: false,
    vendorBytes: mermaidVendorBytes,
    savedBytes: 0,
    savedReadable: humanBytes(0)
  };
  const plan = planFor(loaded.project, target, backend);
  if (!plan.rules.some((rule) => rule.kind === 'backend-' + plan.language) && plan.language !== 'none') {
    notes.push({ code: 'LC_W_TEMPLATE_MISSING', message: '后端语言 ' + plan.language + ' 没有可用模板' });
  }
  step('templates', 60, '装配部署模板');
  const templateSources = await readTemplateSources(platformRoot, plan);
  const templateResult = Templates.applyTemplates({ plan, sources: templateSources, files });
  files = templateResult.files;
  notes.push(...templateResult.warnings);
  applyToolchainToFiles(files, toolchain);

  /* 部署侧跟着站点域名走：nginx server_name、部署脚本默认域名、公开基址。 */
  applySiteAddressToFiles(files, address, notes);

  /* 后端配置：generated 层写平台生成值，user 层再叠加站点覆盖；密钥不进 YAML。 */
  if (backend.language !== 'none' && files[plan.configTargets.generated] != null) {
    let middlewareSecrets = null;
    try {
      middlewareSecrets = JSON.parse(await fs.readFile(path.join(siteDir, '.lowcode', 'middleware-secrets.json'), 'utf8'));
    } catch {
      /* 没有密钥文件时按空处理 */
    }
    const backendOrigins = target === 'tauri-desktop' ? TAURI_CORS_ORIGINS : [];
    files[plan.configTargets.generated] = renderBackendConfig(backend, address, 'generated', backendOrigins);
    files[plan.configTargets.user] = renderBackendConfig(backend, address, 'user', backendOrigins);
    files['deploy/backend/.env.generated'] = renderBackendEnv(backend, middlewareSecrets);
    files['deploy/backend/cli-overrides.txt'] = renderCliOverrides(backend);
  }

  /* 站点自定义 nginx：启用代理时优先使用站点里手写/编辑过的配置。 */
  let nginxCustomized = false;
  if (web.nginx && web.nginx.enabled) {
    const custom = await fs.readFile(path.join(siteDir, 'config', 'nginx.conf'), 'utf8').catch(() => null);
    if (custom && custom.trim()) {
      files['deploy/nginx/nginx.conf'] = custom;
      nginxCustomized = true;
      notes.push({
        code: 'LC_W_NGINX_CUSTOM_DOMAIN',
        message: '已使用站点自定义 nginx 配置，平台未改写其中的 server_name；请确认与站点域名 ' + (address.configured ? address.host : 'localhost') + ' 及证书 SAN 一致。'
      });
    }
  }

  /* 积木后端：编译流程并把生成区（flows 路由、runtime、manifest）覆盖进产物。
     只覆盖生成区文件，不影响模板用户区；编译失败直接终止导出，避免产出跑不起来的包。 */
  let flowReport = { compiled: false, files: 0 };
  if (plan.language !== 'none') {
    step('backend-flow', 64, '编译积木后端');
    const compiled = await collectBackendFlowFiles({
      paths,
      siteId: loaded.meta.siteId || siteId,
      siteDir,
      language: plan.language
    });
    files = Object.assign(files, compiled.files);
    for (const key of Object.keys(compiled.files)) {
      if (templateResult.ownership.platform.indexOf(key) === -1) templateResult.ownership.platform.push(key);
    }
    flowReport = { compiled: compiled.compiled, files: compiled.filesCount || 0 };
    if (!compiled.compiled) {
      notes.push({ code: 'LC_W_FLOW_EMPTY', message: '站点没有保存过后端流程，产物只带模板自带的接口' });
    }
  }

  const assetResult = Assets.planAssets({
    files,
    siteDir: 'web',
    assetSources,
    conditionalSources,
    conditionalTable: Assets.CONDITIONAL_ASSETS
  });
  files = assetResult.files;
  notes.push(...assetResult.warnings);
  pageErrors.forEach((item) => notes.push({ code: 'LC_W_RENDER', message: item.pageId + ': ' + item.code + ' ' + item.message }));

  const snapshotReport = { enabled: snapshotEnabled, capturedAt: null, counts: { sources: 0, collections: 0, mocks: 0 }, collections: [] };
  if (snapshotEnabled) {
    step('snapshot', 70, '快照数据源');
    const snapshot = await readDataSourceSnapshot(siteDir, startedAt, includeData);
    files = Object.assign(files, snapshot.files);
    snapshotReport.capturedAt = startedAt;
    snapshotReport.counts = snapshot.counts;
    snapshotReport.collections = snapshot.collections;
  } else if (plan.language !== 'none') {
    /* 后端启用时集合定义是启动依赖，快照关掉也要带定义；行数据仍按 includeData 取舍。 */
    const definitions = await readCollectionDefinitions(siteDir, includeData);
    files = Object.assign(files, definitions.files);
    snapshotReport.counts.collections = definitions.collections.length;
    snapshotReport.collections = definitions.collections;
  }

  /* 集合种子：带上数据时生成一份迁移快照，新库首次启动随迁移自动导入；
     迁移版本只应用一次，已有数据的库不会被覆盖。 */
  let seedReport = { included: false, collections: 0, rows: 0, migration: null };
  if (plan.language !== 'none' && includeData) {
    const items = await readCollections(siteDir);
    const seed = renderSeedMigration(items, startedAt, String((backend.database || {}).driver || 'sqlite'));
    if (seed.rows > 0) {
      files['server/migrations/generated/0099_lc_seed_data.sql'] = seed.sql;
      files['server/migrations/down/0099_lc_seed_data.sql'] = seed.down;
      for (const key of ['server/migrations/generated/0099_lc_seed_data.sql', 'server/migrations/down/0099_lc_seed_data.sql']) {
        if (templateResult.ownership.platform.indexOf(key) === -1) templateResult.ownership.platform.push(key);
      }
      seedReport = {
        included: true,
        collections: items.filter((item) => Array.isArray(item.json && item.json.rows) && item.json.rows.length).length,
        rows: seed.rows,
        migration: '0099_lc_seed_data'
      };
      notes.push({
        code: 'LC_W_SEED_DATA',
        message: '已带上集合种子数据：' + seedReport.collections + ' 个集合 / ' + seed.rows +
          ' 行，新环境首次启动随迁移自动导入（导出时未选则不携带）'
      });
    }
  }

  const bundledPaths = assetResult.bundledAssets.map((item) => item.path);
  const codeBefore = siteCodeBytes(files, bundledPaths);

  step('minify', 78, '压缩 CSS/JS');
  const minifyResult = Minify.applyMinify({
    files,
    siteDir: 'web',
    enabled: minifyCssJs,
    html: minifyHtmlEnabled,
    artifactId,
    createdAt: startedAt,
    version,
    title: String(loaded.project.site?.name || loaded.meta.name || 'lowcode 产物'),
    skipPaths: bundledPaths
  });
  notes.push(...minifyResult.warnings);
  const codeAfter = siteCodeBytes(minifyResult.files, bundledPaths);

  /* Tauri 工程默认 delivery.webDir = "../web"，相对 src-tauri/ 解析就是 desktop/web。
     导出包把站点产物放在包根 web/，桌面工程因此找不到前端；这里同步一份到 desktop/web/，
     保证 `build-app.mjs --project desktop` 能在包内直接构建。 */
  if (target === 'tauri-desktop') {
    for (const key of Object.keys(minifyResult.files)) {
      if (!key.startsWith('web/')) continue;
      minifyResult.files['desktop/' + key] = minifyResult.files[key];
    }
  }

  /* 站点后端用户区：在最终文件集合上覆盖模板同名用户区文件（不碰生成区）。
     放在压缩之后，用户代码不参与前端压缩；显式记进 ownership.user。 */
  if (plan.language !== 'none') {
    const backendUserCode = await readBackendUserCode(siteDir, plan.language);
    const rels = Object.keys(backendUserCode).sort();
    for (const rel of rels) {
      const target = 'server/' + rel;
      files[target] = backendUserCode[rel];
      minifyResult.files[target] = backendUserCode[rel];
      if (templateResult.ownership.user.indexOf(target) === -1) templateResult.ownership.user.push(target);
    }
    if (rels.length) {
      notes.push({
        code: 'LC_W_BACKEND_USER_CODE',
        message: '已用站点用户区代码覆盖 ' + rels.length + ' 个后端文件：' + rels.join('、')
      });
    }
  }

  const deploy = {
    site: {
      domain: address.configured ? address.host : 'localhost',
      configured: address.configured,
      origin: address.origin,
      basePath: address.basePath,
      publicBaseUrl: address.publicBaseUrl
    },
    nginx: {
      enabled: Boolean(web.nginx && web.nginx.enabled),
      path: 'deploy/nginx/nginx.conf',
      customized: nginxCustomized
    },
    tls: {
      enabled: Boolean(web.nginx && web.nginx.enabled),
      /* 未启用时不要把 source 写成 generated-or-imported，否则清单看着像有证书。 */
      source: web.nginx && web.nginx.enabled ? 'generated-or-imported' : 'none',
      status: web.nginx && web.nginx.enabled ? 'configured' : 'disabled',
      domain: address.configured ? address.host : 'localhost'
    },
    backend: {
      configPath: String(backend.configFile || 'deploy/backend/config.yaml'),
      generatedPath: 'deploy/backend/config.generated.yaml'
    }
  };
  const signing = (loaded.project.export && loaded.project.export.signing) || {};
  step('checks', 82, '检查入口、外链与用户代码');
  const syntax = await checkUserCodeSyntax(files, backend);

  step('bundle', 88, '生成产物清单');
  const assembled = await Bundle.assemble({
    target,
    artifactId,
    createdAt: startedAt,
    platform,
    project: {
      id: loaded.meta.siteId || siteId,
      name: loaded.project.site?.name || loaded.meta.name || siteId,
      config: {
        ...loaded.project,
        export: { ...(loaded.project.export || {}), backend }
      }
    },
    runtime: target === 'tauri-desktop' ? 'tauri-desktop' : 'static',
    backend,
    toolchain,
    template: loaded.project.template,
    files: minifyResult.files,
    editorLibraries: [],
    bundledAssets: assetResult.bundledAssets,
    deploy,
    signing,
    allowExternal: [],
    warnings: notes,
    templateRequired: templateResult.required,
    ownership: templateResult.ownership,
    syntax
  });

  /* 组件脚本错误不能静默通过：被页面引用的组件阻断导出，未引用的只写清单警告。 */
  const referencedIds = collectComponentRefs(pageList, loaded.project.shellBlocks);
  const blockingComponentFailures = componentScriptFailures.filter((item) => referencedIds.has(item.componentId));
  if (blockingComponentFailures.length) {
    const componentCheck = {
      id: 'component-scripts',
      status: 'fail',
      failures: blockingComponentFailures,
      message: '组件脚本语法错误：' + blockingComponentFailures
        .map((item) => item.componentId + '（' + item.message + '）')
        .slice(0, 3)
        .join('；') + (blockingComponentFailures.length > 3 ? '（共 ' + blockingComponentFailures.length + ' 处）' : '')
    };
    assembled.checks.push(componentCheck);
    assembled.failures.push(componentCheck);
    assembled.ok = false;
  } else {
    assembled.checks.push({
      id: 'component-scripts',
      status: 'pass',
      message: componentScriptFailures.length
        ? '页面引用的组件脚本均可用；另有 ' + componentScriptFailures.length + ' 个未引用组件有语法错误（见警告）'
        : '组件脚本检查通过：' + (loaded.site.components || []).length + ' 个组件'
    });
  }

  /* 桌面配置校验失败必须阻断产物：不能让用户拿到一个打不开的工程。 */
  if (desktopInfo) {
    const desktopErrors = desktopInfo.validation.errors || [];
    assembled.checks.push({
      id: 'desktop-config',
      status: desktopErrors.length ? 'fail' : 'pass',
      message: desktopErrors.length
        ? '桌面配置有 ' + desktopErrors.length + ' 个错误：' + desktopErrors.map((item) => (item.field ? item.field + '：' : '') + item.message).slice(0, 3).join('；')
        : '桌面配置通过：标识符、版本、窗口与更新设置可渲染'
    });
    if (desktopErrors.length) {
      for (const item of desktopErrors) {
        assembled.failures.push({
          file: 'desktop/config/desktop.json',
          code: item.code,
          field: item.field,
          message: (item.field ? item.field + '：' : '') + item.message
        });
      }
      assembled.ok = false;
    }
  }

  const manifestText = Bundle.serializeManifest(assembled.manifest);
  assembled.files['artifact-manifest.json'] = manifestText;

  const endedAt = new Date().toISOString();
  const totalBytes = assembled.size.total + Bundle.byteSize(manifestText);
  const sizingInput = {
    unpackedBytes: totalBytes,
    bundledAssets: assetResult.bundledAssets,
    codeBefore,
    codeAfter,
    minify: minifyResult.report
  };

  let zipBuffer = null;
  if (assembled.ok) {
    const zip = new JSZip();
    for (const [filePath, body] of Object.entries(assembled.files)) {
      zip.file(filePath, body);
    }
    step('zip', 94, '生成压缩包');
    zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
  const sizing = buildSizing({ zipBytes: zipBuffer ? zipBuffer.length : 0, ...sizingInput });
  const estimate = makeEstimate({
    target,
    scopeMode,
    pageList,
    entryShim,
    files: assembled.files,
    sizing,
    snapshotReport,
    mermaidInfo,
    desktopInfo,
    minifyCssJs,
    minifyHtmlEnabled,
    pageErrors,
    checks: assembled.checks,
    failures: assembled.failures,
    warnings: assembled.warnings,
    canExport: assembled.ok
  });

  if (dryRun) {
    return {
      ok: assembled.ok,
      dryRun: true,
      estimate,
      checks: assembled.checks,
      warnings: assembled.warnings,
      failures: assembled.failures,
      pageErrors,
      totalBytes
    };
  }

  let artifact = null;
  let status = assembled.ok ? 'success' : 'failed';
  const adapter = createSiteAdapter(paths.dataDir, loaded.meta.siteId || siteId, { lockStaleMs: paths.lockStaleMs });
  const rev = assembled.ok ? await adapter.rev() : -1;

  if (assembled.ok) {
    artifact = {
      path: 'artifact.zip',
      bytes: zipBuffer.length,
      sha256: crypto.createHash('sha256').update(zipBuffer).digest('hex')
    };
    const record = buildRecord({ buildId, status, target, startedAt, endedAt, rev, version, artifact, manifest: assembled.manifest, minify: minifyResult.report, sizing });
    record.scope = estimate.scope;
    record.snapshot = snapshotReport;
    record.backendFlow = flowReport;
    record.seed = seedReport;
    await writeBuild(siteDir, buildId, record, zipBuffer, buildLog(record));
    const cleanup = await applyBuildRetention(siteDir, buildId, record, target, paths.buildKeepPerTarget, notes);
    step('done', 100, '构建完成');
    return { ok: true, buildId, artifactId, status, record, estimate, manifest: assembled.manifest, artifactPath: path.join(siteDir, 'builds', buildId, 'artifact.zip'), checks: assembled.checks, warnings: assembled.warnings, cleanup };
  }

  status = 'failed';
  const record = buildRecord({
    buildId,
    status,
    target,
    startedAt,
    endedAt,
    rev: -1,
    version,
    artifact: null,
    manifest: assembled.manifest,
    minify: minifyResult.report,
    sizing
  });
  record.scope = estimate.scope;
  record.snapshot = snapshotReport;
  record.backendFlow = flowReport;
  record.seed = seedReport;
  await writeBuild(siteDir, buildId, record, null, buildLog(record));
  const cleanup = await applyBuildRetention(siteDir, buildId, record, target, paths.buildKeepPerTarget, notes);
  return { ok: false, buildId, artifactId, status, record, estimate, manifest: assembled.manifest, failures: assembled.failures, pageErrors, checks: assembled.checks, warnings: assembled.warnings, totalBytes, cleanup };
  } finally {
    if (locked) await lock.release();
  }
}

function makeEstimate(input) {
  const {
    target, scopeMode, pageList, entryShim, files, sizing, snapshotReport, mermaidInfo, desktopInfo,
    minifyCssJs, minifyHtmlEnabled, pageErrors, checks, failures, warnings, canExport
  } = input;
  const runtimeBytes = sizing.libraries.reduce((sum, item) => sum + item.bytes, 0);
  const code = sizing.code.after;
  const otherBytes = Math.max(0, sizing.unpackedBytes - code.total - runtimeBytes);
  const pageEntries = pageList.map((page) => {
    const filePath = 'web/' + pagePathOf(page);
    return { id: page.id, title: page.title || page.id, path: filePath, bytes: Bundle.byteSize(files[filePath] || '') };
  });
  const largest = Object.entries(files)
    .map(([filePath, body]) => ({ path: filePath, bytes: Bundle.byteSize(body || '') }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
  return {
    target,
    scope: { mode: scopeMode, pageIds: pageList.map((page) => page.id) },
    entryShim: entryShim || null,
    minify: { cssJs: minifyCssJs, html: minifyHtmlEnabled },
    snapshot: snapshotReport,
    pages: pageEntries,
    sizing,
    mermaid: Object.assign(
      { package: 'mermaid', bytes: 0, readable: '0 B', share: 0 },
      sizing.mermaid || {},
      mermaidInfo || {}
    ),
    desktop: desktopInfo ? {
      productName: desktopInfo.config.productName,
      identifier: desktopInfo.config.identifier,
      version: desktopInfo.config.version,
      platform: desktopInfo.platform,
      targets: desktopInfo.targets,
      protocol: desktopInfo.config.protocol,
      httpsMode: desktopInfo.config.https.mode,
      httpsIgnored: Boolean(desktopInfo.httpsIgnored),
      updateActive: desktopInfo.config.update.active,
      errors: desktopInfo.validation.errors || [],
      warnings: desktopInfo.validation.warnings || []
    } : null,
    breakdown: {
      html: code.html,
      css: code.css,
      js: code.js,
      runtime: runtimeBytes,
      other: otherBytes,
      unpacked: sizing.unpackedBytes,
      zip: sizing.zipBytes
    },
    largest,
    checks,
    failures,
    warnings,
    pageErrors,
    canExport
  };
}

function buildRecord(input) {
  const { buildId, status, target, startedAt, endedAt, rev, version, artifact, manifest, minify, sizing } = input;
  return {
    buildRecordVersion: BUILD_RECORD_VERSION,
    buildId,
    status,
    target,
    runtime: manifest.runtime,
    version,
    sourceRev: rev,
    startedAt,
    endedAt,
    artifact,
    sizing,
    manifest: {
      formatVersion: manifest.formatVersion,
      artifactId: manifest.artifactId,
      createdAt: manifest.createdAt,
      fileCount: manifest.files.length,
      size: manifest.size,
      checks: manifest.checks,
      warnings: manifest.warnings,
      ownership: manifest.ownership,
      bundledAssets: manifest.bundledAssets,
      deploy: manifest.deploy
    },
    minify: {
      enabled: minify.enabled,
      html: minify.html,
      applied: minify.applied,
      before: minify.before,
      after: minify.after,
      saved: minify.saved,
      byKind: minify.byKind,
      skipped: minify.skipped
    }
  };
}

export async function listBuilds(paths, siteId) {
  const siteDir = path.join(paths.dataDir, 'sites', String(siteId || ''));
  const dir = path.join(siteDir, 'builds');
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const builds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJson(path.join(dir, entry.name, 'build.json'), null);
    if (record) {
      const zip = await fs.stat(path.join(dir, entry.name, 'artifact.zip')).catch(() => null);
      const warnings = record.manifest && Array.isArray(record.manifest.warnings) ? record.manifest.warnings : [];
      builds.push({
        buildId: record.buildId,
        status: record.status,
        target: record.target,
        startedAt: record.startedAt,
        endedAt: record.endedAt || '',
        artifactBytes: record.artifact && Number(record.artifact.bytes)
          ? Number(record.artifact.bytes)
          : (zip ? zip.size : 0),
        version: record.version,
        scope: record.scope || null,
        pageCount: record.scope && Array.isArray(record.scope.pageIds) ? record.scope.pageIds.length : 0,
        warningCount: warnings.length,
        fileCount: record.manifest && Number(record.manifest.fileCount) ? Number(record.manifest.fileCount) : 0
      });
    }
  }
  return builds.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

export async function readBuildRecord(paths, siteId, buildId) {
  if (!/^[a-z0-9._-]+$/i.test(String(buildId || ''))) throw fail('LC_E_BUILD_INVALID', '构建 ID 非法');
  return readJson(path.join(paths.dataDir, 'sites', String(siteId || ''), 'builds', buildId, 'build.json'), null);
}

export async function readBuildArtifact(paths, siteId, buildId) {
  if (!/^[a-z0-9._-]+$/i.test(String(buildId || ''))) throw fail('LC_E_BUILD_INVALID', '构建 ID 非法');
  const file = path.join(paths.dataDir, 'sites', String(siteId || ''), 'builds', buildId, 'artifact.zip');
  const body = await fs.readFile(file).catch(() => null);
  return body ? { body, name: buildId + '.zip' } : null;
}
