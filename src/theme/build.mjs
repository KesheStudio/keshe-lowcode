#!/usr/bin/env node
/* 把令牌和主题包生成静态产物。
 *
 *   node src/theme/build.mjs
 *
 * 产出：
 *   assets/css/lc-tokens.css   基础令牌 + 旧变量别名
 *   assets/css/lc-themes.css   内置主题包的 CSS 变量块
 *   src/theme/lc-icons.html   内联 SVG sprite（粘到 <body> 开头即可用）
 *   src/theme/preview-shell.html 断点演示用的编辑器外壳（被预览页放进 iframe）
 *   src/theme/preview.html     双击即看的静态预览页（不依赖本地服务）
 *
 * 生成物不要手改；改令牌改 tokens.mjs，改主题改 themes/*.json，改图标改 icons.mjs。
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  BASE_STATIC,
  BREAKPOINTS,
  COLOR_TOKENS,
  baseCss,
  resolveTheme,
  themesCss
} from './tokens.mjs';

import {
  ICON_GROUPS,
  ICON_SET,
  ICON_STROKE,
  ICON_USAGE,
  iconMarkup,
  spriteMarkup
} from './icons.mjs';

import { renderEditorPage, renderSwitcherDemo } from './editor-page.mjs';
import { TEMPLATE_PRESETS } from './presets.mjs';
import { themeBootScript } from './theme-boot.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const themeDir = join(here, 'themes');
const cssDir = join(root, 'assets', 'css');

const TONE_LABELS = {
  paper: '纸感',
  cool: '冷调',
  warm: '暖调',
  neutral: '中性',
  'high-contrast': '高对比',
  blueprint: '工程蓝'
};

const themes = readdirSync(themeDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(themeDir, name), 'utf8')))
  .filter((theme) => theme && theme.id);

function main() {
  mkdirSync(cssDir, { recursive: true });
  writeFileSync(join(cssDir, 'lc-tokens.css'), baseCss(), 'utf8');
  writeFileSync(join(cssDir, 'lc-themes.css'), themesCss(themes), 'utf8');
  writeFileSync(join(cssDir, 'lc-theme-manifest.json'), themeManifest(), 'utf8');
  writeFileSync(join(here, 'lc-icons.html'), iconsSnippet(), 'utf8');
  writeFileSync(join(here, 'lc-theme-runtime.js'), runtimeSource(), 'utf8');
  writeFileSync(join(here, 'lc-theme-boot.js'), themeBootScript({
    storageKey: 'lc-site-theme',
    defaultTheme: 'ink-green',
    allowedThemes: themes.map((theme) => theme.id)
  }), 'utf8');
  writeFileSync(join(here, 'preview-shell.html'), renderShellPage(), 'utf8');
  writeFileSync(join(here, 'preview.html'), renderPreview(themes), 'utf8');
  writeFileSync(join(here, 'editor.html'), renderEditorPage(themes), 'utf8');
  writeFileSync(join(here, 'switcher-demo.html'), renderSwitcherDemo(themes), 'utf8');

  console.log('已生成：');
  console.log('  assets/css/lc-tokens.css');
  console.log('  assets/css/lc-themes.css');
  console.log('  assets/css/lc-theme-manifest.json');
  console.log('  src/theme/lc-icons.html');
  console.log('  src/theme/lc-theme-runtime.js');
  console.log('  src/theme/lc-theme-boot.js');
  console.log('  src/theme/preview-shell.html');
  console.log('  src/theme/preview.html');
  console.log('  src/theme/editor.html');
  console.log('  src/theme/switcher-demo.html');
  console.log(`基础令牌 ${Object.keys(BASE_STATIC).length} 个，颜色令牌 ${COLOR_TOKENS.length} 个，主题 ${themes.length} 套，图标 ${ICON_SET.length} 个，断点 ${BREAKPOINTS.map((item) => item.px).join('/')}px。`);
  const manifest = JSON.parse(readFileSync(join(cssDir, 'lc-theme-manifest.json'), 'utf8'));
  console.log(`体积：令牌 ${manifest.base.bytes} 字节（gzip ${manifest.base.gzipBytes}）；` +
    `合并主题 ${manifest.merged.bytes} 字节（gzip ${manifest.merged.gzipBytes}）；` +
    `单套 ${Math.min(...manifest.themes.map((item) => item.bytes))}–${Math.max(...manifest.themes.map((item) => item.bytes))} 字节。`);
}

/* 体积清单：导出管线按这份数据决定带几套主题，不需要自己再算一遍。
 * 口径统一：字节数 = UTF-8 原文，gzipBytes = zlib level 6（与常见静态服务器默认接近）。 */
function themeManifest() {
  const measure = (text) => ({
    bytes: Buffer.byteLength(text, 'utf8'),
    gzipBytes: gzipSync(Buffer.from(text, 'utf8'), { level: 6 }).length
  });
  const tokensCss = baseCss();
  const mergedCss = themesCss(themes);
  const themesList = themes.map((theme) => {
    const css = themesCss([theme]);
    return { id: theme.id, name: theme.name, ...measure(css) };
  });
  const cumulative = [];
  let previousBytes = 0;
  let previousGzip = 0;
  themes.forEach((theme, index) => {
    const now = measure(themesCss(themes.slice(0, index + 1)));
    cumulative.push({
      count: index + 1,
      lastThemeId: theme.id,
      bytes: now.bytes,
      gzipBytes: now.gzipBytes,
      addedBytes: now.bytes - previousBytes,
      addedGzipBytes: now.gzipBytes - previousGzip
    });
    previousBytes = now.bytes;
    previousGzip = now.gzipBytes;
  });
  const presets = TEMPLATE_PRESETS.map((preset) => {
    const selected = preset.themeIds.map((id) => themes.find((theme) => theme.id === id)).filter(Boolean);
    const css = themesCss(selected);
    const bundle = measure(tokensCss + '\n' + css);
    return {
      id: preset.id,
      themeIds: preset.themeIds.slice(),
      ...measure(css),
      bundleBytes: bundle.bytes,
      bundleGzipBytes: bundle.gzipBytes
    };
  });
  const manifest = {
    generatedBy: 'src/theme/build.mjs',
    gzip: 'zlib level 6',
    base: { file: 'assets/css/lc-tokens.css', ...measure(tokensCss) },
    merged: { file: 'assets/css/lc-themes.css', themes: themes.length, ...measure(mergedCss) },
    themes: themesList,
    cumulative,
    presets
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

/* 把 runtime.mjs 变成浏览器可用的经典脚本。
 * 不能直接 <script type="module">：file:// 下模块会被 CORS 拦掉，预览页要求双击可开。
 * 这里只做一件事：去掉行首的 export 关键字，再用一个 IIFE 把需要的名字挂到全局。
 */
function runtimeSource() {
  const source = readFileSync(join(here, 'runtime.mjs'), 'utf8');
  const body = source.replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, '');
  return `/* 由 src/theme/build.mjs 从 runtime.mjs 生成，不要手改。
 * 同一份颜色派生与导入校验逻辑，Node 侧和主题编辑器用的都是它。 */
(function () {
  'use strict';
${body}
  globalThis.LCThemeRuntime = {
    THEME_SCHEMA_VERSION, THEME_SCHEMA, TONES, TONE_LABELS, THEME_ID_PATTERN,
    BASE_SHADOW, REQUIRED_SEEDS, SEED_LABELS, DEFAULT_SEEDS,
    COLOR_TOKENS, COLOR_TOKEN_NAMES, COLOR_TOKEN_LABELS, COLOR_ALIASES,
    TEXT_PAIRS, UI_PAIRS, WEAK_PAIRS, DISABLED_PAIRS, DECOR_MIN, DECOR_PAIRS, OVERLAY_PAIRS,
    parseColor, toHex, mixColor, relativeLuminance, contrastRatio, compositeOver, pickOnColor,
    resolveMode, resolveTheme, themeVariables,
    migrateThemeData, safeCssValue, themeCssRule, themeCssBlock, themeCssForIds, themeStyleSheet,
    validateThemeData
  };
})();
`;
}

function iconsSnippet() {
  return `<!-- 低代码平台图标集 · 由 src/theme/icons.mjs 生成，不要手改。
     用法：整段粘到页面 <body> 开头，然后按 id 取用：
       ${ICON_USAGE}
     颜色走 currentColor，尺寸/描边由 assets/css/lc-icons.css 统一下发。 -->
${spriteMarkup()}
`;
}

function renderShell() {
  return `        <div class="lc-shell" id="lcShell">
          <header class="lc-topbar">
            <div class="lc-brand">
              <span class="lc-brand-mark lc-icon lc-icon-lg" aria-hidden="true">${iconMarkup('layers')}</span>
              <span class="lc-brand-text">科设低代码</span>
              <span class="lc-brand-sub">主题工作台</span>
            </div>
            <nav class="lc-nav" aria-label="主导航">
              <button class="lc-nav-item" type="button">站点</button>
              <button class="lc-nav-item is-active" type="button" aria-current="page">页面</button>
              <button class="lc-nav-item" type="button">组件库</button>
              <button class="lc-nav-item" type="button">主题</button>
              <button class="lc-nav-item" type="button">导出</button>
            </nav>
            <div class="lc-topbar-side">
              <button class="lc-icon-btn" type="button" aria-label="搜索">${iconMarkup('search')}</button>
              <span class="lc-badge lc-badge-success lc-hide-below-sm">本地草稿</span>
              <button class="lc-btn lc-btn-sm" type="button">${iconMarkup('eye')}<span class="lc-btn-label">预览</span></button>
              <button class="lc-btn lc-btn-primary lc-btn-sm" type="button">${iconMarkup('export')}<span class="lc-btn-label">导出站点</span></button>
            </div>
          </header>
          <main class="lc-main">
            <aside class="lc-sidebar" aria-label="页面与区块">
              <div class="lc-sidebar-head">
                <h2>页面</h2>
                <p>共 12 篇文章，按方向 / 系列 / 主题分组</p>
              </div>
              <div class="lc-sidebar-body">
                <div class="lc-tree-group-title"><span>前端</span><span>4</span></div>
                <ul class="lc-tree">
                  <li><button class="lc-tree-item" type="button">工程化<span class="lc-tree-meta">10 篇</span></button></li>
                  <li><button class="lc-tree-item is-active" type="button" aria-selected="true">主题与令牌<span class="lc-tree-meta">编辑中</span></button></li>
                  <li><button class="lc-tree-item" type="button">自研框架<span class="lc-tree-meta">3 篇</span></button></li>
                </ul>
                <div class="lc-tree-group-title"><span>后端</span><span>5</span></div>
                <ul class="lc-tree">
                  <li><button class="lc-tree-item" type="button">Rust 基础<span class="lc-tree-meta">11 篇</span></button></li>
                  <li><button class="lc-tree-item" type="button">PHP 基础<span class="lc-tree-meta">12 篇</span></button></li>
                </ul>
              </div>
              <p class="lc-sidebar-foot">数据保存在浏览器 IndexedDB，路径 <code>/articles/frontend/...</code></p>
            </aside>
            <section class="lc-workspace">
              <div class="lc-toolbar">
                <button class="lc-btn lc-btn-sm lc-show-below-sm" type="button" data-lc-toggle="sidebar" aria-expanded="false" aria-controls="lcShell">${iconMarkup('layers')}<span class="lc-btn-label">页面</span></button>
                <span class="lc-toolbar-title">主题与令牌 / 预览页</span>
                <span class="lc-toolbar-meta">1280 × 720</span>
                <div class="lc-toolbar-actions">
                  <button class="lc-icon-btn lc-hide-below-sm" type="button" aria-label="撤销">${iconMarkup('undo')}</button>
                  <button class="lc-icon-btn lc-hide-below-sm" type="button" aria-label="重做">${iconMarkup('redo')}</button>
                  <button class="lc-btn lc-btn-sm" type="button">${iconMarkup('add')}<span class="lc-btn-label">插入组件</span></button>
                  <button class="lc-btn lc-btn-sm lc-btn-primary" type="button">${iconMarkup('save')}<span class="lc-btn-label">保存</span></button>
                  <button class="lc-btn lc-btn-sm lc-show-below-md" type="button" data-lc-toggle="inspector" aria-expanded="false" aria-controls="lcShell">${iconMarkup('settings')}<span class="lc-btn-label">属性</span></button>
                </div>
              </div>
              <div class="lc-canvas-scroll">
                <div class="lc-canvas">
                  <p class="lc-canvas-hint">画布 · 拖入区块后在这里排布</p>
                  <div class="pv-block">标题区<span>h1 + 摘要</span></div>
                  <div class="pv-block">正文区块<span>段落 / 列表 / 表格</span></div>
                  <div class="pv-block">代码区块<span>命令 + 复制按钮</span></div>
                </div>
              </div>
            </section>
            <aside class="lc-inspector" aria-label="属性">
              <div class="lc-inspector-head">
                <h2>属性</h2>
                <p>当前选中：主题与令牌</p>
              </div>
              <div class="lc-inspector-body">
                <div class="lc-prop-group">
                  <h3>内容</h3>
                  <div class="lc-field">
                    <label class="lc-label" for="pvInsTitle">标题</label>
                    <input class="lc-input" id="pvInsTitle" type="text" value="主题与令牌">
                  </div>
                  <div class="lc-field pv-gap-top">
                    <label class="lc-label" for="pvInsDiff">难度</label>
                    <div class="lc-select-wrap">
                      <select class="lc-select" id="pvInsDiff"><option>进阶</option><option>基础</option><option>深入</option></select>
                    </div>
                  </div>
                </div>
                <div class="lc-prop-group">
                  <h3>主题</h3>
                  <div class="lc-prop-row"><span>明暗</span><b>跟随系统</b></div>
                  <div class="lc-prop-row"><span>主题包</span><b>ink-green</b></div>
                  <div class="lc-prop-row"><span>强调色</span><b>#3e6a56</b></div>
                </div>
                <div class="lc-panel">
                  <h3 class="lc-panel-title">说明</h3>
                  <p class="lc-hint">右侧栏始终有内容：没选中区块时显示页面属性和导出说明，不留空白。</p>
                </div>
              </div>
            </aside>
          </main>
          <footer class="lc-statusbar">
            <span><span class="lc-status-dot"></span>已连接本地数据</span>
            <span class="is-secondary">字号 14px / 行高 1.65</span>
            <span class="is-right">主题 ink-green · 亮色</span>
          </footer>
        </div>`;
}

function renderShellPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-lc-theme="ink-green" data-lc-mode="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>编辑器外壳 · 断点演示</title>
<script>
(function () {
  var params = new URLSearchParams(location.search);
  if (params.get('theme')) document.documentElement.setAttribute('data-lc-theme', params.get('theme'));
  if (params.get('mode')) document.documentElement.setAttribute('data-lc-mode', params.get('mode'));
})();
</script>
<link rel="stylesheet" href="../../assets/css/lc-tokens.css">
<link rel="stylesheet" href="../../assets/css/lc-themes.css">
<link rel="stylesheet" href="../../assets/css/lc-icons.css">
<link rel="stylesheet" href="../../assets/css/lc-controls.css">
<link rel="stylesheet" href="../../assets/css/lc-editor.css">
<link rel="stylesheet" href="../../assets/css/lc-responsive.css">
<link rel="stylesheet" href="../../assets/css/lc-a11y.css">
<link rel="stylesheet" href="../../assets/css/lc-print.css" media="print">
<style>
html, body { height: 100%; margin: 0; }
body { background: var(--lc-color-bg); }
.lc-shell { height: 100vh; }
</style>
</head>
<body>
${spriteMarkup()}
${renderShell()}
<script>
document.querySelectorAll('[data-lc-toggle]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var shell = btn.closest('.lc-shell');
    var key = 'data-lc-' + btn.getAttribute('data-lc-toggle');
    var next = shell.getAttribute(key) === 'open' ? 'closed' : 'open';
    shell.setAttribute(key, next);
    btn.setAttribute('aria-expanded', next === 'open' ? 'true' : 'false');
  });
});
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  var shell = document.querySelector('.lc-shell');
  if (!shell) return;
  ['sidebar', 'inspector'].forEach(function (name) {
    shell.setAttribute('data-lc-' + name, 'closed');
  });
  document.querySelectorAll('[data-lc-toggle]').forEach(function (btn) {
    btn.setAttribute('aria-expanded', 'false');
  });
});
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPreview(themeList) {
  const resolvedThemes = themeList.map((theme) => ({ raw: theme, resolved: resolveTheme(theme) }));
  const gallery = resolvedThemes.map(({ raw, resolved }) => {
    const light = raw.modes.light.seeds;
    const swatches = [light.bg, light.surface, light.accent, light.ink]
      .map((color) => `<span class="pv-thumb-strip" style="background:${esc(color)}"></span>`)
      .join('');
    return `
      <button class="pv-theme-card" type="button" data-set-theme="${esc(raw.id)}" aria-pressed="false">
        <span class="pv-theme-thumbs">${swatches}</span>
        <span class="pv-theme-name">${esc(raw.name)}</span>
        <span class="pv-theme-tone">${esc(TONE_LABELS[raw.tone] || raw.tone)} · ${esc(raw.id)}</span>
        <span class="pv-theme-desc">${esc(raw.description)}</span>
        <span class="pv-theme-stat">${Object.keys(resolved.light).length} 个令牌 / 亮暗两套</span>
      </button>`;
  }).join('');

  const themeById = new Map(themeList.map((theme) => [theme.id, theme]));
  const presetCards = TEMPLATE_PRESETS.map((preset) => {
    const theme = themeById.get(preset.defaultThemeId);
    const seeds = theme ? theme.modes.light.seeds : {};
    const strips = [seeds.bg, seeds.surface, seeds.accent, seeds.ink]
      .filter(Boolean)
      .map((color) => `<span class="pv-thumb-strip" style="background:${esc(color)}"></span>`)
      .join('');
    const names = preset.themeIds
      .map((id) => (themeById.get(id) || { name: id }).name)
      .join(' / ');
    return `
      <button class="pv-theme-card" type="button" data-set-theme="${esc(preset.defaultThemeId)}" aria-pressed="false">
        <span class="pv-theme-thumbs">${strips}</span>
        <span class="pv-theme-name">${esc(preset.name)}</span>
        <span class="pv-theme-tone">默认 ${esc(preset.defaultThemeId)}${theme ? ' · ' + esc(theme.name) : ''}</span>
        <span class="pv-theme-desc">${esc(preset.summary)}</span>
        <span class="pv-theme-stat">可选：${esc(names)}</span>
      </button>`;
  }).join('');

  const swatches = COLOR_TOKENS.map((token) => `
      <div class="pv-swatch">
        <span class="pv-swatch-color" style="background:var(${esc(token.name)})"></span>
        <span class="pv-swatch-label">${esc(token.label)}</span>
        <code>${esc(token.name)}</code>
      </div>`).join('');

  const themeChips = themeList.map((theme) => `
        <button class="lc-tab" type="button" data-set-theme="${esc(theme.id)}" aria-pressed="false">${esc(theme.name)}</button>`).join('');

  const iconGallery = ICON_GROUPS.map((group) => `
        <div class="pv-icon-group">
          <h3 class="pv-cell-title">${esc(group.label)}</h3>
          <div class="pv-icon-grid">
            ${group.ids.map((id) => {
              const icon = ICON_SET.find((item) => item.id === id);
              return `<div class="pv-icon-item">
              <span class="pv-icon-demo">${iconMarkup(id, 'lc-icon-lg')}</span>
              <code>${esc(id)}</code>
              <span class="pv-icon-name">${esc(icon ? icon.label : '')}</span>
            </div>`;
            }).join('')}
          </div>
        </div>`).join('');

  const breakpointRows = BREAKPOINTS.map((item) => `
            <tr>
              <td class="pv-num">≤ ${item.px}px</td>
              <td><code>--lc-bp-${esc(item.name)}</code></td>
              <td>${esc(item.label)}</td>
            </tr>`).join('');

  const breakpointPresets = [...BREAKPOINTS.map((item) => item.px), 1280].sort((a, b) => b - a)
    .map((px) => `<button class="lc-tab" type="button" data-bp="${px}" aria-pressed="false">${px}px</button>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-lc-theme="ink-green" data-lc-mode="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>主题与设计令牌预览 · 低代码平台</title>
<link rel="stylesheet" href="../../assets/css/lc-tokens.css">
<link rel="stylesheet" href="../../assets/css/lc-themes.css">
<link rel="stylesheet" href="../../assets/css/lc-icons.css">
<link rel="stylesheet" href="../../assets/css/lc-controls.css">
<link rel="stylesheet" href="../../assets/css/lc-editor.css">
<link rel="stylesheet" href="../../assets/css/lc-responsive.css">
<link rel="stylesheet" href="../../assets/css/lc-a11y.css">
<link rel="stylesheet" href="../../assets/css/lc-print.css" media="print">
<style>
${PREVIEW_CSS}
</style>
</head>
<body>
${spriteMarkup()}
<div class="pv-page">

  <a class="lc-skip-link" href="#themes">跳到内容</a>

  <header class="pv-head">
    <div class="pv-inner pv-head-inner">
      <div class="pv-title-row">
        <div>
          <h1 class="pv-title">主题与设计令牌预览</h1>
          <p class="pv-sub">一套令牌，${themeList.length} 套主题，亮暗两套值。切换下面任意主题和明暗，页面里所有控件、外壳、色板都会跟着变。</p>
        </div>
        <div class="pv-mode-box">
          <span class="pv-label">明暗</span>
          <div class="lc-tabs" role="group" aria-label="明暗模式">
            <button class="lc-tab" type="button" data-set-mode="light" aria-pressed="true">亮色</button>
            <button class="lc-tab" type="button" data-set-mode="dark" aria-pressed="false">暗色</button>
          </div>
        </div>
      </div>
      <div class="pv-theme-row">
        <span class="pv-label">主题包</span>
        <div class="lc-tabs pv-theme-tabs" role="group" aria-label="主题包">${themeChips}
        </div>
        <span class="pv-current" id="pvCurrent" aria-live="polite">当前：纸墨 · 松绿 / 亮色</span>
      </div>
    </div>
  </header>

  <main class="pv-inner pv-main">

    <section class="pv-section" id="themes">
      <div class="pv-section-head">
        <h2>开箱可用的主题包</h2>
        <p>四套模板各有默认主题：文档站纸感素净、作品集大胆、仪表盘冷静、认证中心干净。全部内置主题共 ${themeList.length} 套，覆盖纸感、冷调、暖调、中性、高对比和工程蓝，每套都有亮暗两种值。</p>
      </div>
      <h3 class="pv-cell-title">四套模板的默认主题</h3>
      <div class="pv-theme-gallery">${presetCards}
      </div>
      <h3 class="pv-cell-title">全部内置主题</h3>
      <div class="pv-theme-gallery">${gallery}
      </div>
    </section>

    <section class="pv-section" id="type">
      <div class="pv-section-head">
        <h2>排版示例</h2>
        <p>正文用系统无衬线栈，标题用衬线栈拉开层次。字号阶梯从 12px 到 30px，行高分紧、正常、松三档，长文章不会挤成一坨。</p>
      </div>
      <div class="pv-doc lc-canvas">
        <h1>低代码平台的主题是怎么长出来的</h1>
        <p class="pv-lead">这套东西不是把几个颜色变量换个名字就完事。它要保证同一套主题在亮色和暗色下都读得清，还得让编辑器、导出的静态站、预览页三处用的是同一份变量。</p>
        <h2>一、先定主色，其余靠派生</h2>
        <p>每个主题包只写 11 个主色：页面背景、面板背景、正文、次要文字、分隔线、强调色、代码底色，再加上成功、警告、危险、信息四个状态色。剩下的层级、浅底、描边、悬停位置都由这些颜色算出来。</p>
        <p>这么做的好处是，不会出现「亮色模式好看、暗色模式某个按钮白字白底」这种事故。派生规则在当前链接色和面板底色上直接算对比度，不够 4.5:1 就换颜色。<a href="#themes">先看看主题包</a>，再往下读。</p>
        <h3>为什么要拆成两套强调色</h3>
        <p>强调色在界面上有两个角色：一个是链接和图标，要放在背景上读；另一个是按钮底色，上面还要放文字。一个颜色不可能同时满足这两件事，尤其暗色模式。所以令牌里拆成 <code>accent</code> 和 <code>accent-fill</code>，各自带一个 <code>on-accent</code> 文字色。</p>
        <blockquote>
          <p>凡是「一个变量既当文字色又当背景色」的设计，早晚会在某个主题里出对比度问题。宁可多一个变量，也不要在组件里写死颜色。</p>
        </blockquote>
        <h2>二、代码和表格也得跟着换</h2>
        <p>下面是示例代码块和表格。它们没有单独配色，全部引用同一套令牌：</p>
<pre><code>/* 主题只通过 CSS 变量生效 */
:root[data-lc-theme="ink-ochre"] {
  --lc-color-bg: #f5efe3;
  --lc-color-accent: #8c4a26;
  --lc-color-accent-fill: #8c4a26;
}</code></pre>
        <h3>对比度检查结果</h3>
        <table>
          <thead><tr><th>组合</th><th>用途</th><th>要求</th></tr></thead>
          <tbody>
            <tr><td>正文 / 页面背景</td><td>文章正文</td><td class="pv-num">≥ 4.5:1</td></tr>
            <tr><td>次要文字 / 面板背景</td><td>说明、提示</td><td class="pv-num">≥ 4.5:1</td></tr>
            <tr><td>按钮文字 / 按钮底色</td><td>主要操作</td><td class="pv-num">≥ 4.5:1</td></tr>
            <tr><td>焦点环 / 页面背景</td><td>键盘焦点</td><td class="pv-num">≥ 3:1</td></tr>
          </tbody>
        </table>
        <p>列表也过一遍：</p>
        <ul>
          <li>主色只写 11 个，派生值统一算</li>
          <li>亮暗两套都过 WCAG AA 正文标准</li>
          <li>旧版变量保留别名，导出的静态站不用改样式</li>
        </ul>
      </div>
    </section>

    <section class="pv-section" id="controls">
      <div class="pv-section-head">
        <h2>基础控件</h2>
        <p>下面这些控件只依赖 <code>assets/css/lc-controls.css</code> 和令牌，没有外部字体、图标库或 CDN。把这一块单独拿出去，换个主题也照样能用。</p>
      </div>
      <div class="pv-controls-grid">

        <div class="pv-cell">
          <h3 class="pv-cell-title">按钮</h3>
          <div class="pv-row">
            <button class="lc-btn lc-btn-primary" type="button">保存并预览</button>
            <button class="lc-btn" type="button">取消</button>
            <button class="lc-btn lc-btn-ghost" type="button">更多</button>
          </div>
          <div class="pv-row">
            <button class="lc-btn lc-btn-danger" type="button">删除版本</button>
            <button class="lc-btn lc-btn-sm" type="button">小号</button>
            <button class="lc-btn" type="button" disabled>不可用</button>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">输入框</h3>
          <div class="lc-field">
            <label class="lc-label" for="pvTitle">文章标题 <small>必填</small></label>
            <input class="lc-input" id="pvTitle" type="text" placeholder="例如：主题与设计令牌">
            <p class="lc-hint">标题会出现在列表、搜索和页面头部。</p>
          </div>
          <div class="lc-field pv-gap-top">
            <label class="lc-label" for="pvSlug">路径别名</label>
            <input class="lc-input" id="pvSlug" type="text" value="theme-tokens" aria-describedby="pvSlugErr">
            <p class="lc-error" id="pvSlugErr">这个别名已经被占用了，换一个。</p>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">下拉与多行文本</h3>
          <div class="lc-field">
            <label class="lc-label" for="pvTheme">主题包</label>
            <div class="lc-select-wrap">
              <select class="lc-select" id="pvTheme">
                ${themeList.map((theme) => `<option>${esc(theme.name)}</option>`).join('\n                ')}
              </select>
            </div>
          </div>
          <div class="lc-field pv-gap-top">
            <label class="lc-label" for="pvDesc">摘要</label>
            <textarea class="lc-textarea" id="pvDesc" rows="3" placeholder="一两句话说清这篇讲什么"></textarea>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">搜索</h3>
          <div class="lc-field">
            <label class="lc-label" for="pvSearch">搜索文章</label>
            <div class="lc-search-wrap">
              <span class="lc-search-icon lc-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"></circle><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.6"></path></svg>
              </span>
              <input class="lc-input" id="pvSearch" type="search" placeholder="输入标题或标签">
            </div>
          </div>
          <div class="lc-field pv-gap-top">
            <label class="lc-label" for="pvSearch2">禁用状态</label>
            <input class="lc-input" id="pvSearch2" type="text" value="暂不可用" disabled>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">选择控件</h3>
          <label class="lc-check"><input type="checkbox" checked> <span>导出时保留文章目录</span></label>
          <label class="lc-check"><input type="checkbox"> <span>导入后自动生成搜索索引</span></label>
          <div class="pv-row pv-gap-top">
            <label class="lc-radio"><input type="radio" name="pvMode" checked> <span>流式布局</span></label>
            <label class="lc-radio"><input type="radio" name="pvMode"> <span>自由布局</span></label>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">开关</h3>
          <label class="lc-switch">
            <input type="checkbox" checked>
            <span class="lc-switch-track" aria-hidden="true"></span>
            <span>跟随系统明暗</span>
          </label>
          <div class="pv-row pv-gap-top">
            <label class="lc-switch">
              <input type="checkbox">
              <span class="lc-switch-track" aria-hidden="true"></span>
              <span>只读模式</span>
            </label>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">标签页</h3>
          <div class="lc-tabs" role="tablist" aria-label="编辑器面板">
            <button class="lc-tab" type="button" role="tab" aria-selected="true">区块</button>
            <button class="lc-tab" type="button" role="tab" aria-selected="false">样式</button>
            <button class="lc-tab" type="button" role="tab" aria-selected="false">数据</button>
          </div>
          <div class="pv-row pv-gap-top">
            <span class="lc-tag">入门</span>
            <span class="lc-tag is-accent">进阶</span>
            <span class="lc-tag">4300 字</span>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">徽标</h3>
          <div class="pv-row">
            <span class="lc-badge lc-badge-success">已发布</span>
            <span class="lc-badge lc-badge-warn">待校验</span>
            <span class="lc-badge lc-badge-danger">有冲突</span>
            <span class="lc-badge lc-badge-info">草稿</span>
          </div>
          <p class="lc-hint pv-gap-top">状态色只做小面积提示，正文仍然用墨色。</p>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">提示条</h3>
          <div class="lc-note lc-note-info"><p><strong>说明</strong>主题包只覆盖颜色和少量形状变量，其余由基础层兜底。</p></div>
          <div class="lc-note lc-note-warn pv-gap-top"><p><strong>注意</strong>深色主题里不要直接拿强调色当按钮底色。</p></div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">表格</h3>
          <div class="lc-table-wrap">
            <table class="lc-table">
              <thead><tr><th>令牌</th><th>角色</th><th class="is-num">数量</th></tr></thead>
              <tbody>
                <tr><td>颜色</td><td>主色 + 派生</td><td class="is-num">33</td></tr>
                <tr><td>字体</td><td>无衬线 / 衬线 / 等宽</td><td class="is-num">3</td></tr>
                <tr><td>间距</td><td>4px 到 48px</td><td class="is-num">8</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">进度</h3>
          <div class="lc-progress" role="progressbar" aria-valuenow="72" aria-valuemin="0" aria-valuemax="100">
            <span class="lc-progress-bar" style="width:72%"></span>
          </div>
          <p class="lc-hint pv-gap-top">导出 72%，正在打包文章和样式。</p>
          <div class="lc-progress is-warn pv-gap-top" role="progressbar" aria-valuenow="91" aria-valuemin="0" aria-valuemax="100">
            <span class="lc-progress-bar" style="width:91%"></span>
          </div>
          <p class="lc-hint pv-gap-top">存储用量 91%，接近浏览器配额。</p>
        </div>

        <div class="pv-cell">
          <h3 class="pv-cell-title">分页与面包屑</h3>
          <nav class="lc-breadcrumb" aria-label="面包屑">
            <a href="#themes">主题</a><span class="lc-crumb-sep">/</span><span>预览</span><span class="lc-crumb-sep">/</span><span>控件</span>
          </nav>
          <div class="lc-pagination pv-gap-top" aria-label="分页">
            <button class="lc-page-btn" type="button" aria-label="上一页">上一页</button>
            <button class="lc-page-btn" type="button" aria-current="page">1</button>
            <button class="lc-page-btn" type="button">2</button>
            <button class="lc-page-btn" type="button">3</button>
            <button class="lc-page-btn" type="button" aria-label="下一页">下一页</button>
          </div>
          <div class="pv-row pv-gap-top">
            <kbd class="lc-kbd">Ctrl</kbd><span class="lc-hint">+</span><kbd class="lc-kbd">S</kbd><span class="lc-hint">保存</span>
          </div>
        </div>

      </div>
    </section>

    <section class="pv-section" id="icons">
      <div class="pv-section-head">
        <h2>图标集</h2>
        <p>${ICON_SET.length} 个内联 SVG，同一套 24×24 网格、${ICON_STROKE} 描边、圆头端点。不引图标库、不引字体、不用 data URI；颜色走 <code>currentColor</code>，尺寸和描边用变量覆盖。</p>
      </div>
      <div class="lc-note lc-note-info">
        <p><strong>怎么用</strong>把 <code>src/theme/lc-icons.html</code> 整段粘到页面 <code>&lt;body&gt;</code> 开头，然后按 id 取用：</p>
      </div>
      <pre class="pv-cmd pv-gap-top"><code>${esc(ICON_USAGE)}
&lt;!-- 改尺寸：类名或变量都能改 --&gt;
&lt;svg class="lc-icon lc-icon-xl"&gt;&lt;use href="#lc-icon-save"&gt;&lt;/use&gt;&lt;/svg&gt;
&lt;svg class="lc-icon" style="--lc-icon-size:18px;--lc-icon-stroke:2"&gt;&lt;use href="#lc-icon-grip"&gt;&lt;/use&gt;&lt;/svg&gt;

&lt;!-- 改颜色：父级 color 就是描边色 --&gt;
&lt;span style="color:var(--lc-color-danger)"&gt;&lt;svg class="lc-icon"&gt;&lt;use href="#lc-icon-delete"&gt;&lt;/use&gt;&lt;/svg&gt;&lt;/span&gt;</code></pre>
      <div class="pv-cell pv-gap-top">
        <h3 class="pv-cell-title">尺寸与描边档位</h3>
        <div class="pv-icon-scales">
          <div class="pv-row"><span class="pv-icon-caption">14px</span>${iconMarkup('save', 'lc-icon-sm')}<span class="pv-icon-caption">16px 默认</span>${iconMarkup('save')}<span class="pv-icon-caption">20px</span>${iconMarkup('save', 'lc-icon-lg')}<span class="pv-icon-caption">24px</span>${iconMarkup('save', 'lc-icon-xl')}</div>
          <div class="pv-row pv-gap-top"><span class="pv-icon-caption">描边 1.5</span>${iconMarkup('search', 'lc-icon-lg lc-icon-thin')}<span class="pv-icon-caption">1.75 默认</span>${iconMarkup('search', 'lc-icon-lg')}<span class="pv-icon-caption">2.25</span>${iconMarkup('search', 'lc-icon-lg lc-icon-bold')}</div>
          <div class="pv-row pv-gap-top"><span class="pv-icon-caption">按钮里</span>
            <button class="lc-icon-btn" type="button" aria-label="保存">${iconMarkup('save')}</button>
            <button class="lc-icon-btn is-active" type="button" aria-label="已启用可见性" aria-pressed="true">${iconMarkup('eye')}</button>
            <button class="lc-icon-btn is-danger" type="button" aria-label="删除">${iconMarkup('delete')}</button>
            <button class="lc-icon-btn" type="button" aria-label="更多">${iconMarkup('more')}</button>
            <button class="lc-icon-btn" type="button" aria-label="不可用" disabled>${iconMarkup('lock')}</button>
          </div>
        </div>
      </div>
      <div class="pv-icon-groups pv-gap-top">${iconGallery}
      </div>
    </section>

    <section class="pv-section" id="editor">
      <div class="pv-section-head">
        <h2>编辑器外壳</h2>
        <p>顶栏、资源栏、工作区、属性栏、状态栏按真实比例摆一遍。外壳只负责布局和分隔，不掺杂业务逻辑；换主题时整块一起变。</p>
      </div>
      <div class="pv-shell-frame">
${renderShell()}
      </div>
    </section>

    <section class="pv-section" id="breakpoints">
      <div class="pv-section-head">
        <h2>响应式断点</h2>
        <p>断点定义收在 <code>src/theme/tokens.mjs</code> 的 <code>BREAKPOINTS</code> 里，同时输出 <code>--lc-bp-*</code> 令牌。CSS 变量不能写进 <code>@media</code> 条件，所以媒体查询用固定数值，校验脚本会核对两边一致。</p>
      </div>
      <div class="pv-bp-bar">
        <div class="lc-tabs" role="group" aria-label="断点预设">${breakpointPresets}</div>
        <label class="pv-bp-range">
          <span class="pv-label">宽度</span>
          <input id="pvBpRange" type="range" min="320" max="1280" step="20" value="1280" aria-label="预览宽度">
        </label>
        <span class="pv-current" id="pvBpLabel">1280px</span>
      </div>
      <div class="pv-bp-stage" id="pvBpStage">
        <iframe id="pvShellFrame" src="preview-shell.html?theme=ink-green&amp;mode=light" title="响应式编辑器外壳演示"></iframe>
      </div>
      <div class="lc-table-wrap pv-gap-top">
        <table class="lc-table">
          <thead><tr><th>视口</th><th>令牌</th><th>折叠规则</th></tr></thead>
          <tbody>${breakpointRows}
          </tbody>
        </table>
      </div>
      <div class="lc-note lc-note-info pv-gap-top">
        <p><strong>折叠靠属性，不靠 JS 改样式</strong>容器上写 <code>data-lc-sidebar="open|closed|hidden"</code>、<code>data-lc-inspector="open|closed|hidden"</code>，样式在 <code>lc-responsive.css</code> 里统一处理。演示里把宽度拖到 900px 以下，点工具栏的齿轮/图层按钮可以拉开检查器和侧栏。</p>
      </div>
    </section>

    <section class="pv-section" id="theme-editor">
      <div class="pv-section-head">
        <h2>主题编辑器与站点切换器</h2>
        <p>内置主题共 ${themeList.length} 套，不够用时用主题编辑器从空白或复制内置主题开始：改主色、看派生色、实时对比度标红、亮暗并排预览、导出/导入单个 JSON。编辑器本身跟随当前主题变，编辑暗色主题时不会留在亮色界面。</p>
      </div>
      <div class="pv-editor-bar">
        <a class="lc-btn lc-btn-primary" href="editor.html" target="_blank" rel="noopener">${iconMarkup('palette')}<span class="lc-btn-label">打开主题编辑器</span></a>
        <a class="lc-btn" href="switcher-demo.html" target="_blank" rel="noopener">${iconMarkup('external')}<span class="lc-btn-label">单独打开切换器演示</span></a>
        <span class="lc-hint">下面这块是真切换器：改外观或主题，整个 iframe 页面会跟着变。</span>
      </div>
      <div class="pv-bp-stage">
        <iframe id="pvSwitchFrame" src="switcher-demo.html" title="站点主题切换器演示"></iframe>
      </div>
      <div class="lc-note lc-note-info pv-gap-top">
        <p><strong>切换器怎么接</strong>把 <code>src/theme/theme-switch.js</code> 和 <code>assets/css/lc-theme-switch.css</code> 引入导出站，在需要的位置放 <code>data-lc-theme-switch</code> 容器，里面放 <code>data-lc-theme-mode</code> 三个按钮和 <code>data-lc-theme-select</code> 下拉即可。它只改 <code>&lt;html&gt;</code> 的 <code>data-lc-theme</code> / <code>data-lc-mode</code>，颜色仍全部走 CSS 变量；选择会存在 localStorage。</p>
      </div>
    </section>

    <section class="pv-section pv-print-section" id="print">
      <div class="pv-section-head">
        <h2>打印样式</h2>
        <p><code>assets/css/lc-print.css</code> 只在打印时加载。纸面强制浅色、去掉所有背景色块和阴影、隐藏导航/目录/工具栏，标题不落在页底，表格和代码块不跨页断开。</p>
      </div>
      <div class="pv-print-bar">
        <button class="lc-btn lc-btn-primary" type="button" id="pvPrintBtn">打开打印预览</button>
        <span class="lc-hint">会隐藏本页其他区块，只打印下面这份“纸面”文档。</span>
      </div>
      <div class="pv-paper">
        <div class="pv-paper-head">
          <span class="pv-paper-kicker">打印输出示意</span>
          <span class="pv-paper-meta">A4 · 18mm / 16mm 页边距</span>
        </div>
        <h1>主题与设计令牌 · 打印验收</h1>
        <p>这一段模拟纸面输出：不出现主题背景色，正文字号固定 11pt，行高 1.6。暗色主题下打印也不会出现白字白纸。</p>
        <h2>一、会隐藏的东西</h2>
        <p>顶栏、侧栏、检查器、工具栏、状态栏、分页、面包屑、目录、弹窗遮罩和轻提示全部 <code>display:none</code>，只剩文档正文。</p>
        <h2>二、会保留的东西</h2>
        <ul>
          <li>标题层级保持，但不会孤零零落在页底</li>
          <li>表格、代码块、引用、图片整块不跨页</li>
          <li>链接保留下划线，颜色统一成墨色</li>
        </ul>
        <blockquote><p>打印样式的目标是「读得清」，不是「还原屏幕」。</p></blockquote>
        <table>
          <thead><tr><th>项目</th><th>纸面规则</th></tr></thead>
          <tbody>
            <tr><td>背景</td><td>一律白纸，无底色块</td></tr>
            <tr><td>阴影</td><td>全部去掉</td></tr>
            <tr><td>正文</td><td>11pt / 行高 1.6</td></tr>
            <tr><td>分页</td><td>标题不留页底，表格不跨页</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="pv-section" id="overlays">
      <div class="pv-section-head">
        <h2>弹窗与轻提示</h2>
        <p>弹窗用固定的遮罩 + 面板块，轻提示从右下角出现。两者都只引用令牌，深浅主题下不会糊成一片。</p>
      </div>
      <div class="pv-overlay-grid">
        <div class="pv-stage">
          <div class="lc-dialog-backdrop">
            <div class="lc-dialog" role="dialog" aria-modal="true" aria-labelledby="pvDlgTitle">
              <div class="lc-dialog-head">
                <div>
                  <h2 id="pvDlgTitle">导出这个站点？</h2>
                  <p>导出包会包含全部文章、样式和主题，解压后可直接放进 nginx。</p>
                </div>
              </div>
              <div class="lc-dialog-body">
                <div class="lc-note lc-note-info"><p><strong>提醒</strong>导出前建议先生成一个构建记录，回滚时用得到。</p></div>
                <div class="lc-field pv-gap-top">
                  <label class="lc-label" for="pvDlgName">包名</label>
                  <input class="lc-input" id="pvDlgName" type="text" value="docs-site-20261108">
                </div>
              </div>
              <div class="lc-dialog-foot">
                <button class="lc-btn" type="button">取消</button>
                <button class="lc-btn lc-btn-primary" type="button">开始导出</button>
              </div>
            </div>
          </div>
        </div>
        <div class="pv-stage pv-stage-toast">
          <div class="lc-toast is-success" role="status">主题已保存。亮暗两套对比度都通过了。</div>
          <div class="lc-toast is-warn pv-gap-top" role="status">存储用量接近配额，建议先导出备份。</div>
          <div class="lc-toast is-error pv-gap-top" role="status">导入失败：第 3 个页面的区块类型不认识。</div>
        </div>
      </div>
    </section>

    <section class="pv-section" id="palette">
      <div class="pv-section-head">
        <h2>颜色令牌</h2>
        <p>下面 ${COLOR_TOKENS.length} 个颜色令牌全部由主题包的 11 个主色派生。切主题时色块会实时更新，名字不变，方便在组件里查。</p>
      </div>
      <div class="pv-swatches">${swatches}
      </div>
    </section>

    <section class="pv-section" id="verify">
      <div class="pv-section-head">
        <h2>怎么自己验证</h2>
        <p>预览页只能看外观，对比度靠脚本算。两条命令都在 <code>lowcode/</code> 根目录执行：</p>
      </div>
      <pre class="pv-cmd"><code>node src/theme/check.mjs          # 主题字段 / 令牌 / 对比度 / 弱化文字 / 遮罩焦点环 / 图标集 / 断点同步
node src/theme/build.mjs          # 重新生成令牌、主题、图标 sprite、运行时、编辑器和本页</code></pre>
      <div class="lc-note lc-note-info pv-gap-top">
        <p><strong>边界</strong>本页是静态文件，双击就能看，不需要起服务。它只演示外观，不代替真实编辑器的交互；键盘可达性与焦点顺序的复核记录写在 <code>src/theme/NOTES.md</code>。</p>
      </div>
    </section>

  </main>

  <footer class="pv-foot">
    <div class="pv-inner">
      <p>主题与设计系统 · 令牌定义在 <code>src/theme/tokens.mjs</code>，主题包在 <code>src/theme/themes/</code>，编辑器样式在 <code>assets/css/</code>。</p>
    </div>
  </footer>
</div>

<script>
(function () {
  var root = document.documentElement;
  var current = document.getElementById('pvCurrent');
  var shellFrame = document.getElementById('pvShellFrame');
  var bpRange = document.getElementById('pvBpRange');
  var bpLabel = document.getElementById('pvBpLabel');
  var bpStage = document.getElementById('pvBpStage');
  var themeNames = ${JSON.stringify(
    Object.fromEntries(themeList.map((theme) => [theme.id, theme.name]))
  )};

  function syncFrame() {
    if (!shellFrame) return;
    var theme = root.getAttribute('data-lc-theme') || 'ink-green';
    var mode = root.getAttribute('data-lc-mode') || 'light';
    shellFrame.setAttribute('src', 'preview-shell.html?theme=' + encodeURIComponent(theme) + '&mode=' + mode);
  }

  function applyTheme(id) {
    root.setAttribute('data-lc-theme', id);
    document.querySelectorAll('[data-set-theme]').forEach(function (node) {
      node.setAttribute('aria-pressed', node.getAttribute('data-set-theme') === id ? 'true' : 'false');
    });
    updateCurrent();
    syncFrame();
  }

  function applyMode(mode) {
    root.setAttribute('data-lc-mode', mode);
    document.querySelectorAll('[data-set-mode]').forEach(function (node) {
      node.setAttribute('aria-pressed', node.getAttribute('data-set-mode') === mode ? 'true' : 'false');
    });
    updateCurrent();
    syncFrame();
  }

  function updateCurrent() {
    var id = root.getAttribute('data-lc-theme');
    var mode = root.getAttribute('data-lc-mode') === 'dark' ? '暗色' : '亮色';
    if (current) current.textContent = '当前：' + (themeNames[id] || id) + ' / ' + mode;
  }

  document.querySelectorAll('[data-set-theme]').forEach(function (node) {
    node.addEventListener('click', function () {
      applyTheme(node.getAttribute('data-set-theme'));
    });
  });

  document.querySelectorAll('[data-set-mode]').forEach(function (node) {
    node.addEventListener('click', function () {
      applyMode(node.getAttribute('data-set-mode'));
    });
  });

  // 断点演示：拖宽度或点预设，直接改 iframe 宽度，让媒体查询真的按宽度触发。
  function setWidth(px) {
    if (!bpStage || !shellFrame) return;
    var width = Math.max(320, Math.min(1280, Number(px) || 1280));
    shellFrame.style.width = width + 'px';
    if (bpRange) bpRange.value = String(width);
    if (bpLabel) bpLabel.textContent = width + 'px';
    document.querySelectorAll('[data-bp]').forEach(function (node) {
      node.setAttribute('aria-pressed', Number(node.getAttribute('data-bp')) === width ? 'true' : 'false');
    });
  }
  if (bpRange) {
    bpRange.addEventListener('input', function () { setWidth(bpRange.value); });
  }
  document.querySelectorAll('[data-bp]').forEach(function (node) {
    node.addEventListener('click', function () { setWidth(node.getAttribute('data-bp')); });
  });
  setWidth(bpRange ? bpRange.value : 1280);

  // 外壳演示里的抽屉开关（预览用，不是编辑器业务逻辑）。
  document.querySelectorAll('[data-lc-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var shell = btn.closest('.lc-shell');
      if (!shell) return;
      var key = 'data-lc-' + btn.getAttribute('data-lc-toggle');
      var next = shell.getAttribute(key) === 'open' ? 'closed' : 'open';
      shell.setAttribute(key, next);
      btn.setAttribute('aria-expanded', next === 'open' ? 'true' : 'false');
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.lc-shell').forEach(function (shell) {
      shell.setAttribute('data-lc-sidebar', 'closed');
      shell.setAttribute('data-lc-inspector', 'closed');
    });
    document.querySelectorAll('[data-lc-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  });

  var printBtn = document.getElementById('pvPrintBtn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  applyTheme(root.getAttribute('data-lc-theme') || 'ink-green');
  applyMode(root.getAttribute('data-lc-mode') || 'light');
})();
</script>
</body>
</html>
`;
}

/* 预览页自身的排版，不进编辑器样式文件。 */
const PREVIEW_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--lc-color-bg);
  color: var(--lc-color-ink);
  font-family: var(--lc-font-sans);
  font-size: var(--lc-text-base);
  line-height: var(--lc-leading-base);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--lc-color-accent); }
code, kbd, pre { font-family: var(--lc-font-mono); }

.pv-page { min-height: 100vh; display: flex; flex-direction: column; }
.pv-inner { width: min(1240px, 100%); margin: 0 auto; padding: 0 var(--lc-space-6); }
.pv-head {
  position: sticky;
  top: 0;
  z-index: var(--lc-z-sticky);
  padding: var(--lc-space-4) 0 var(--lc-space-3);
  border-bottom: 1px solid var(--lc-color-line);
  background: var(--lc-color-bg);
}
.pv-head-inner { display: flex; flex-direction: column; gap: var(--lc-space-3); }
.pv-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--lc-space-4); flex-wrap: wrap; }
.pv-title { margin: 0; font-family: var(--lc-font-serif); font-size: var(--lc-text-2xl); font-weight: var(--lc-weight-semibold); line-height: var(--lc-leading-tight); }
.pv-sub { max-width: 68ch; margin: var(--lc-space-1) 0 0; color: var(--lc-color-muted); font-size: var(--lc-text-sm); line-height: var(--lc-leading-base); }
.pv-mode-box { display: flex; align-items: center; gap: var(--lc-space-2); flex: 0 0 auto; }
.pv-label { color: var(--lc-color-muted); font-size: var(--lc-text-xs); font-weight: var(--lc-weight-semibold); letter-spacing: 0.04em; white-space: nowrap; }
.pv-theme-row { display: flex; align-items: center; gap: var(--lc-space-3); flex-wrap: wrap; }
.pv-theme-tabs { flex-wrap: wrap; background: var(--lc-color-surface-2); }
.pv-current { margin-left: auto; color: var(--lc-color-muted); font-family: var(--lc-font-mono); font-size: var(--lc-text-xs); }

.pv-main { flex: 1 0 auto; padding-top: var(--lc-space-7); padding-bottom: var(--lc-space-8); display: flex; flex-direction: column; gap: var(--lc-space-8); }
.pv-section { scroll-margin-top: 172px; }
.pv-section-head { margin-bottom: var(--lc-space-4); }
.pv-section-head h2 { margin: 0; font-family: var(--lc-font-serif); font-size: var(--lc-text-xl); font-weight: var(--lc-weight-semibold); line-height: var(--lc-leading-tight); }
.pv-section-head p { max-width: 78ch; margin: var(--lc-space-2) 0 0; color: var(--lc-color-muted); font-size: var(--lc-text-sm); line-height: var(--lc-leading-relaxed); }
.pv-section-head code, .pv-sub code, .pv-foot code { padding: 1px 4px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-xs); background: var(--lc-color-code-bg); font-size: 0.92em; }

.pv-theme-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--lc-space-3); }
.pv-theme-card {
  display: flex; flex-direction: column; gap: var(--lc-space-1);
  padding: var(--lc-space-3); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md);
  background: var(--lc-color-surface); color: var(--lc-color-ink); font-family: var(--lc-font-sans);
  text-align: left; cursor: pointer; transition: border-color var(--lc-motion-fast) var(--lc-ease-standard);
}
.pv-theme-card:hover { border-color: var(--lc-color-accent); }
.pv-theme-card:focus-visible { outline: none; box-shadow: var(--lc-ring); }
.pv-theme-card[aria-pressed="true"] { border-color: var(--lc-color-accent); box-shadow: inset 0 0 0 1px var(--lc-color-accent-line); }
.pv-theme-thumbs { display: flex; height: 26px; margin-bottom: var(--lc-space-2); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-sm); overflow: hidden; }
.pv-thumb-strip { flex: 1 1 25%; }
.pv-theme-name { font-size: var(--lc-text-md); font-weight: var(--lc-weight-semibold); }
.pv-theme-tone { color: var(--lc-color-accent); font-size: var(--lc-text-xs); font-family: var(--lc-font-mono); }
.pv-theme-desc { color: var(--lc-color-muted); font-size: var(--lc-text-xs); line-height: var(--lc-leading-base); }
.pv-theme-stat { margin-top: var(--lc-space-1); color: var(--lc-color-muted-2); font-size: 11px; font-family: var(--lc-font-mono); }

.pv-doc { max-width: 100%; min-height: 0; padding: var(--lc-space-6) var(--lc-space-7); }
.pv-doc h1, .pv-doc h2, .pv-doc h3, .pv-doc h4 { font-family: var(--lc-font-serif); font-weight: var(--lc-weight-semibold); line-height: var(--lc-leading-tight); }
.pv-doc h1 { margin: 0 0 var(--lc-space-3); font-size: var(--lc-text-2xl); }
.pv-doc h2 { margin: var(--lc-space-6) 0 var(--lc-space-2); font-size: var(--lc-text-xl); }
.pv-doc h3 { margin: var(--lc-space-5) 0 var(--lc-space-2); font-size: var(--lc-text-lg); }
.pv-doc h4 { margin: var(--lc-space-4) 0 var(--lc-space-1); font-size: var(--lc-text-md); }
.pv-doc p { margin: 0 0 var(--lc-space-3); }
.pv-lead { color: var(--lc-color-ink-2); font-size: var(--lc-text-md); line-height: var(--lc-leading-relaxed); }
.pv-doc ul, .pv-doc ol { margin: 0 0 var(--lc-space-3); padding-left: var(--lc-space-5); }
.pv-doc li { margin-bottom: var(--lc-space-1); }
.pv-doc blockquote { margin: var(--lc-space-4) 0; padding: var(--lc-space-3) var(--lc-space-4); border-left: 3px solid var(--lc-color-accent-line); background: var(--lc-color-accent-soft); color: var(--lc-color-ink-2); border-radius: 0 var(--lc-radius-md) var(--lc-radius-md) 0; }
.pv-doc blockquote p:last-child { margin-bottom: 0; }
.pv-doc pre { margin: var(--lc-space-3) 0; padding: var(--lc-space-3) var(--lc-space-4); overflow-x: auto; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-code-bg); font-size: var(--lc-text-sm); line-height: var(--lc-leading-base); }
.pv-doc pre code { padding: 0; border: 0; background: none; }
.pv-doc > code, .pv-doc p code, .pv-doc li code { padding: 1px 5px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-xs); background: var(--lc-color-code-bg); color: var(--lc-color-ink-2); font-size: 0.92em; }
.pv-doc table { width: 100%; border-collapse: collapse; margin: var(--lc-space-3) 0; font-size: var(--lc-text-sm); }
.pv-doc th, .pv-doc td { padding: var(--lc-space-2) var(--lc-space-3); border-bottom: 1px solid var(--lc-color-line); text-align: left; }
.pv-doc th { color: var(--lc-color-ink-2); font-weight: var(--lc-weight-semibold); }
.pv-num { font-family: var(--lc-font-mono); font-variant-numeric: tabular-nums; }

.pv-controls-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(286px, 1fr)); gap: var(--lc-space-3); align-items: start; }
.pv-cell { padding: var(--lc-space-4); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); }
.pv-cell-title { margin: 0 0 var(--lc-space-3); padding-bottom: var(--lc-space-2); border-bottom: 1px solid var(--lc-color-line); color: var(--lc-color-muted); font-size: var(--lc-text-xs); font-weight: var(--lc-weight-semibold); letter-spacing: 0.04em; }
.pv-row { display: flex; align-items: center; gap: var(--lc-space-2); flex-wrap: wrap; }
.pv-gap-top { margin-top: var(--lc-space-2); }

.pv-shell-frame { height: 620px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-lg); overflow: hidden; background: var(--lc-color-bg); box-shadow: var(--lc-shadow-sm); }
.pv-block { display: flex; align-items: center; justify-content: space-between; gap: var(--lc-space-3); margin-top: var(--lc-space-3); padding: var(--lc-space-4); border: 1px dashed var(--lc-color-line-strong); border-radius: var(--lc-radius-md); color: var(--lc-color-ink-2); font-size: var(--lc-text-sm); }
.pv-block span { color: var(--lc-color-muted); font-family: var(--lc-font-mono); font-size: 11px; }
.pv-block:first-of-type { margin-top: var(--lc-space-4); }

.pv-overlay-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: var(--lc-space-3); }
.pv-stage { position: relative; min-height: 420px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-lg); overflow: hidden; background: var(--lc-color-bg-deep); }
.pv-stage .lc-dialog-backdrop { position: absolute; }
.pv-stage-toast { display: flex; flex-direction: column; justify-content: flex-end; gap: var(--lc-space-2); padding: var(--lc-space-4); }
.pv-stage-toast .lc-toast { position: static; max-width: none; }

.pv-swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--lc-space-2); }
.pv-swatch { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 0 var(--lc-space-2); align-items: center; padding: var(--lc-space-2); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); }
.pv-swatch-color { grid-row: span 2; width: 34px; height: 34px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-sm); }
.pv-swatch-label { color: var(--lc-color-ink-2); font-size: var(--lc-text-xs); }
.pv-swatch code { color: var(--lc-color-muted); font-size: 11px; overflow-wrap: anywhere; }

.pv-cmd { margin: 0; padding: var(--lc-space-3) var(--lc-space-4); overflow-x: auto; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-code-bg); color: var(--lc-color-ink-2); font-size: var(--lc-text-sm); line-height: var(--lc-leading-relaxed); }

.pv-foot { flex: 0 0 auto; border-top: 1px solid var(--lc-color-line); background: var(--lc-color-surface); }
.pv-foot p { margin: 0; padding: var(--lc-space-4) 0; color: var(--lc-color-muted); font-size: var(--lc-text-xs); line-height: var(--lc-leading-base); }

/* ---------------- 图标集 ---------------- */

.pv-icon-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--lc-space-3); }
.pv-icon-group { padding: var(--lc-space-3) var(--lc-space-4); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); }
.pv-icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: var(--lc-space-2); }
.pv-icon-item { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--lc-space-2) 2px; border: 1px solid transparent; border-radius: var(--lc-radius-sm); }
.pv-icon-item:hover { border-color: var(--lc-color-line); background: var(--lc-color-surface-2); }
.pv-icon-demo { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; color: var(--lc-color-ink-2); }
.pv-icon-item code { color: var(--lc-color-accent); font-size: 10px; text-align: center; overflow-wrap: anywhere; }
.pv-icon-name { color: var(--lc-color-muted); font-size: 11px; }
.pv-icon-caption { color: var(--lc-color-muted); font-family: var(--lc-font-mono); font-size: 11px; }
.pv-icon-scales .lc-icon { color: var(--lc-color-ink-2); }

/* ---------------- 断点演示 ---------------- */

.pv-bp-bar { display: flex; align-items: center; gap: var(--lc-space-3); flex-wrap: wrap; margin-bottom: var(--lc-space-3); }
.pv-bp-range { display: flex; align-items: center; gap: var(--lc-space-2); }
.pv-bp-stage { overflow-x: auto; padding: var(--lc-space-3); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-lg); background: var(--lc-color-bg-deep); }
#pvShellFrame { display: block; width: 1280px; max-width: none; height: 620px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-bg); }

/* ---------------- 主题编辑器与切换器演示 ---------------- */

.pv-editor-bar { display: flex; align-items: center; gap: var(--lc-space-3); flex-wrap: wrap; margin-bottom: var(--lc-space-3); }
#pvSwitchFrame { display: block; width: 100%; height: 560px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-bg); }

/* ---------------- 打印示意 ---------------- */

.pv-print-bar { display: flex; align-items: center; gap: var(--lc-space-3); flex-wrap: wrap; margin-bottom: var(--lc-space-3); }
/* 这份“纸”故意用字面色而不是主题令牌：它模拟的是纸张输出，不是屏幕界面。 */
.pv-paper { max-width: 760px; margin: 0 auto; padding: 48px 52px; border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: #ffffff; color: #111111; box-shadow: var(--lc-shadow-sm); font-size: 11pt; line-height: 1.6; }
.pv-paper h1 { margin: 0 0 12pt; font-family: var(--lc-font-serif); font-size: 18pt; line-height: 1.3; }
.pv-paper h2 { margin: 18pt 0 8pt; font-family: var(--lc-font-serif); font-size: 15pt; line-height: 1.3; }
.pv-paper p, .pv-paper ul, .pv-paper table { margin: 0 0 10pt; }
.pv-paper ul { padding-left: 20pt; }
.pv-paper blockquote { margin: 12pt 0; padding: 6pt 0 6pt 12pt; border-left: 3px solid #999999; color: #333333; }
.pv-paper table { width: 100%; border-collapse: collapse; }
.pv-paper th, .pv-paper td { padding: 5pt 8pt; border-bottom: 1px solid #bbbbbb; text-align: left; }
.pv-paper code { padding: 0 3px; border: 1px solid #999999; font-family: var(--lc-font-mono); }
.pv-paper-head { display: flex; justify-content: space-between; gap: var(--lc-space-3); margin-bottom: 18pt; padding-bottom: 8pt; border-bottom: 1px solid #bbbbbb; color: #555555; font-size: 8.5pt; letter-spacing: 0.04em; }

/* 打印本页时只留纸面文档，顺便验证「导航不打断版面」。 */
@media print {
  .pv-head,
  .pv-foot,
  .pv-print-bar,
  .pv-section:not(.pv-print-section) { display: none !important; }
  .pv-page { display: block; min-height: 0; }
  .pv-main { display: block; padding: 0; }
  .pv-paper { max-width: none; margin: 0; padding: 0; border: 0; box-shadow: none; }
}

@media (max-width: 860px) {
  .pv-inner { padding: 0 var(--lc-space-4); }
  .pv-overlay-grid { grid-template-columns: 1fr; }
  .pv-shell-frame { height: 560px; }
  .pv-doc { padding: var(--lc-space-4); }
  .pv-current { margin-left: 0; }
  .pv-icon-groups { grid-template-columns: 1fr; }
  .pv-paper { padding: var(--lc-space-5); }
}

@media (prefers-reduced-motion: reduce) {
  .pv-theme-card { transition-duration: 0ms; }
}
`;

main();
