/* 主题编辑器页面与切换器演示页的 HTML 模板。
 *
 * 由 build.mjs 调用，输出两个静态文件：
 *   src/theme/editor.html         主题编辑器（经典脚本，双击可用）
 *   src/theme/switcher-demo.html  站点主题切换器演示页
 *
 * 页面里的按钮/图标全部来自现有图标集（内联 sprite），不引外部字体或图标 CDN。
 */

import { iconMarkup, spriteMarkup } from './icons.mjs';
import { TONE_LABELS, TONES } from './runtime.mjs';
import { themeBootScript } from './theme-boot.mjs';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toneOptions(selected) {
  return TONES.map((tone) => {
    const label = TONE_LABELS[tone] || tone;
    return `<option value="${tone}"${tone === selected ? ' selected' : ''}>${label}</option>`;
  }).join('\n          ');
}

function themeOptions(themes, selected) {
  return themes.map((theme) => {
    return `<option value="${escapeHtml(theme.id)}"${theme.id === selected ? ' selected' : ''}>${escapeHtml(theme.name || theme.id)}</option>`;
  }).join('\n          ');
}

function editorBar() {
  return `<header class="te-bar">
        <div class="te-brand">
          <span class="te-brand-mark lc-icon" aria-hidden="true">${iconMarkup('palette')}</span>
          <span>主题编辑器</span>
          <span class="lc-badge lc-badge-success" id="teSiteBadge" hidden></span>
        </div>
        <span class="te-save-state" id="teSaveState">内置主题 · 改动会另存为草稿</span>
        <div class="te-bar-actions">
          <button class="lc-btn lc-btn-sm" type="button" id="teNew">${iconMarkup('add')}<span class="lc-btn-label">新建</span></button>
          <button class="lc-btn lc-btn-sm" type="button" id="teDuplicate">${iconMarkup('copy')}<span class="lc-btn-label">复制</span></button>
          <button class="lc-btn lc-btn-primary lc-btn-sm" type="button" data-save>${iconMarkup('save')}<span class="lc-btn-label" data-save-label>保存草稿</span></button>
          <button class="lc-btn lc-btn-sm" type="button" id="teExport">${iconMarkup('download')}<span class="lc-btn-label">导出 JSON</span></button>
          <button class="lc-btn lc-btn-sm" type="button" id="teImportLabel">${iconMarkup('upload')}<span class="lc-btn-label">导入</span></button>
          <input type="file" id="teImportFile" accept=".json,application/json" hidden />
          <label class="te-chrome" for="teSiteMode" id="teSiteModeLabel" hidden>
            <span>站点默认外观</span>
            <select class="lc-select" id="teSiteMode">
              <option value="auto">跟随系统</option>
              <option value="light">亮色</option>
              <option value="dark">暗色</option>
            </select>
          </label>
          <label class="te-chrome" for="teChromeMode">
            <span>编辑器外观</span>
            <select class="lc-select" id="teChromeMode">
              <option value="auto" selected>跟随主题</option>
              <option value="light">强制亮色</option>
              <option value="dark">强制暗色</option>
            </select>
          </label>
          <a class="lc-btn lc-btn-ghost lc-btn-sm" href="../home.html" id="teBackHome">${iconMarkup('external')}<span class="lc-btn-label">返回工作台</span></a>
        </div>
      </header>`;
}

function editorAside() {
  return `<aside class="te-themes" aria-label="主题列表">
        <h2>主题</h2>
        <p class="te-themes-hint" id="teThemesHint">内置主题只读，改动会另存为草稿；自定义主题存在浏览器本地。</p>
        <div id="teThemeList"></div>
        <div class="te-drop" id="teDrop">
          把导出的主题 JSON 拖到这里
          <br />
          或点顶栏「导入」。不合格也会载入，并逐条列出问题。
        </div>
      </aside>`;
}

function editorForm(themes) {
  return `<section class="te-form" aria-label="色板编辑">
        <div class="te-form-head">
          <h2>色板</h2>
          <span class="te-form-meta" id="teFormMeta">亮色 · 内置主题副本</span>
        </div>

        <div class="lc-tabs" role="tablist" aria-label="编辑亮色或暗色" id="teModeTabs">
          <button class="lc-tab is-active" type="button" role="tab" aria-selected="true" data-mode="light" tabindex="0">亮色</button>
          <button class="lc-tab" type="button" role="tab" aria-selected="false" data-mode="dark" tabindex="-1">暗色</button>
        </div>

        <fieldset class="te-group">
          <legend>主题信息</legend>
          <div class="te-group-body">
            <div class="te-meta-grid">
              <div class="lc-field">
                <label class="lc-label" for="teId">id <small>小写字母/数字/连字符</small></label>
                <input class="lc-input" id="teId" spellcheck="false" autocomplete="off" />
              </div>
              <div class="lc-field">
                <label class="lc-label" for="teName">名称</label>
                <input class="lc-input" id="teName" autocomplete="off" />
              </div>
              <div class="lc-field">
                <label class="lc-label" for="teTone">调性</label>
                <select class="lc-select" id="teTone">
          ${toneOptions('paper')}
                </select>
              </div>
              <div class="lc-field te-span-2">
                <label class="lc-label" for="teDescription">描述</label>
                <input class="lc-input" id="teDescription" autocomplete="off" />
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset class="te-group">
          <legend>主色（种子）</legend>
          <div class="te-group-body" id="teSeeds"></div>
        </fieldset>

        <details class="te-group" open>
          <summary>派生色（自动计算，可逐项覆盖）<span class="te-form-meta" id="teDerivedCount" style="margin-left:8px"></span></summary>
          <div class="te-group-body">
            <div class="te-derived-list" id="teDerived"></div>
          </div>
        </details>

        <fieldset class="te-group">
          <legend>实时校验</legend>
          <div class="te-group-body">
            <div id="teChecks"></div>
            <div class="te-import-report" id="teImportReport" hidden></div>
          </div>
        </fieldset>
      </section>`;
}

function editorPreview() {
  return `<section class="te-preview" aria-label="实时预览">
        <div class="te-preview-head">
          <h2>实时预览</h2>
          <span class="te-preview-meta" id="tePreviewMeta"></span>
        </div>
        <div class="te-panes">
          <div class="te-pane">
            <div class="te-pane-head"><span>亮色 light</span><span>同步编辑</span></div>
            <div class="te-pane-body" id="tePaneLight"></div>
          </div>
          <div class="te-pane">
            <div class="te-pane-head"><span>暗色 dark</span><span>同步编辑</span></div>
            <div class="te-pane-body" id="tePaneDark"></div>
          </div>
        </div>
      </section>`;
}

function baseHead(title, extraCss = '') {
  return `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="../../assets/css/lc-tokens.css" />
  <link rel="stylesheet" href="../../assets/css/lc-themes.css" />
  <link rel="stylesheet" href="../../assets/css/lc-icons.css" />
  <link rel="stylesheet" href="../../assets/css/lc-controls.css" />
  <link rel="stylesheet" href="../../assets/css/lc-editor.css" />
  <link rel="stylesheet" href="../../assets/css/lc-responsive.css" />
  <link rel="stylesheet" href="../../assets/css/lc-a11y.css" />
  <link rel="stylesheet" href="../../assets/css/lc-print.css" media="print" />${extraCss}`;
}

export function renderEditorPage(themes) {
  const themeJson = JSON.stringify(themes).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN" data-lc-theme="ink-green" data-lc-mode="light">
<head>
  <meta name="lc-token" content="__LC_TOKEN__" />
  ${baseHead('主题编辑器 · 低代码平台', `
  <link rel="stylesheet" href="../../assets/css/lc-theme-editor.css" />`)}
  <style>
    html, body { margin: 0; height: 100%; background: var(--lc-color-bg); }
  </style>
</head>
<body>
${spriteMarkup()}
<div class="te-app">
  ${editorBar()}
  <main class="te-main">
    ${editorAside()}
    ${editorForm(themes)}
    ${editorPreview()}
  </main>
</div>
<div class="te-toast" id="teToast" role="status" aria-live="polite"></div>
<script>window.LC_BUILTIN_THEMES = ${themeJson};</script>
<script src="lc-theme-runtime.js"></script>
<script src="editor-app.js"></script>
</body>
</html>
`;
}

export function renderSwitcherDemo(themes) {
  const defaultTheme = themes.some((theme) => theme.id === 'ink-green') ? 'ink-green' : (themes[0] && themes[0].id) || 'ink-green';
  const boot = themeBootScript({
    storageKey: 'lc-switcher-demo',
    defaultTheme,
    allowedThemes: themes.map((theme) => theme.id)
  });
  return `<!DOCTYPE html>
<html lang="zh-CN" data-lc-theme="${escapeHtml(defaultTheme)}" data-lc-mode="light" data-lc-storage-key="lc-switcher-demo">
<head>
  <meta charset="utf-8" />
  <script>
${boot}</script>
  ${baseHead('主题切换器演示 · 低代码平台', `
  <link rel="stylesheet" href="../../assets/css/lc-theme-switch.css" />`)}
  <style>
    html, body { margin: 0; min-height: 100%; background: var(--lc-color-bg); color: var(--lc-color-ink); }
    body { font-family: var(--lc-font-sans); font-size: var(--lc-text-base); line-height: var(--lc-leading-base); }
    .demo-top {
      position: sticky; top: 0; z-index: var(--lc-z-sticky);
      display: flex; align-items: center; gap: var(--lc-space-3); flex-wrap: wrap;
      padding: var(--lc-space-2) var(--lc-space-5);
      border-bottom: 1px solid var(--lc-color-line);
      background: var(--lc-color-surface);
    }
    .demo-brand { margin-right: auto; font-family: var(--lc-font-serif); font-size: var(--lc-text-lg); font-weight: var(--lc-weight-semibold); }
    .demo-brand small { display: block; color: var(--lc-color-muted); font-family: var(--lc-font-mono); font-size: 10px; font-weight: var(--lc-weight-normal); }
    .demo-doc { max-width: 860px; margin: 0 auto; padding: var(--lc-space-7) var(--lc-space-5) var(--lc-space-8); }
    .demo-doc h1 { margin: 0 0 var(--lc-space-3); font-family: var(--lc-font-serif); font-size: var(--lc-text-3xl); line-height: var(--lc-leading-tight); }
    .demo-doc h2 { margin: var(--lc-space-6) 0 var(--lc-space-2); font-family: var(--lc-font-serif); font-size: var(--lc-text-xl); }
    .demo-doc p { margin: 0 0 var(--lc-space-3); color: var(--lc-color-ink-2); }
    .demo-lead { color: var(--lc-color-muted); font-size: var(--lc-text-sm); }
    .demo-actions { display: flex; gap: var(--lc-space-2); flex-wrap: wrap; margin: var(--lc-space-4) 0; }
    .demo-card { padding: var(--lc-space-4); border: 1px solid var(--lc-color-line); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); }
    .demo-card + .demo-card { margin-top: var(--lc-space-3); }
    .demo-table { width: 100%; border-collapse: collapse; font-size: var(--lc-text-sm); }
    .demo-table th, .demo-table td { padding: var(--lc-space-2); border-bottom: 1px solid var(--lc-color-line); text-align: left; }
    .demo-table th { color: var(--lc-color-muted); font-weight: var(--lc-weight-semibold); }
    .demo-bars { display: flex; align-items: flex-end; gap: var(--lc-space-2); height: 120px; margin-top: var(--lc-space-3); }
    .demo-bars span { flex: 1 1 0; border-radius: var(--lc-radius-xs) var(--lc-radius-xs) 0 0; background: var(--lc-color-accent); }
    .demo-bars span:nth-child(2) { background: var(--lc-color-accent-2); }
    .demo-bars span:nth-child(4) { background: var(--lc-color-warn); }
    .demo-bars span:nth-child(5) { background: var(--lc-color-success); }
    .demo-foot { color: var(--lc-color-muted); font-size: var(--lc-text-xs); }
  </style>
</head>
<body>
${spriteMarkup()}
<header class="demo-top">
  <div class="demo-brand">科设笔记<small>theme switcher demo</small></div>
  <div class="lc-theme-switch" data-lc-theme-switch data-storage-key="lc-switcher-demo" data-default-theme="${escapeHtml(defaultTheme)}">
    <span class="lc-theme-switch-label">外观</span>
    <button class="lc-tab is-active" type="button" data-lc-theme-mode="system" aria-pressed="true">跟随系统</button>
    <button class="lc-tab" type="button" data-lc-theme-mode="light" aria-pressed="false">亮</button>
    <button class="lc-tab" type="button" data-lc-theme-mode="dark" aria-pressed="false">暗</button>
    <select class="lc-select" data-lc-theme-select aria-label="主题">
          ${themeOptions(themes, defaultTheme)}
    </select>
  </div>
</header>
<main class="demo-doc">
  <h1>把主题切换交给读者</h1>
  <p class="demo-lead">这一页不写死任何颜色：按钮、表格、图表全部引用 CSS 变量。右上角切换器只改 html 上的 data-lc-theme 与 data-lc-mode。</p>

  <div class="demo-actions">
    <button class="lc-btn lc-btn-primary" type="button">${iconMarkup('save')}<span class="lc-btn-label">保存</span></button>
    <button class="lc-btn" type="button">${iconMarkup('eye')}<span class="lc-btn-label">预览</span></button>
    <button class="lc-btn lc-btn-ghost" type="button">${iconMarkup('more')}<span class="lc-btn-label">更多</span></button>
    <span class="lc-badge lc-badge-success">已同步</span>
  </div>

  <div class="demo-card">
    <p>正文、次要文字、占位符和禁用态都在这一屏里。切换主题后，注意看输入框描边和按钮悬停色。</p>
    <div class="lc-field" style="max-width:320px">
      <label class="lc-label" for="demoName">订阅邮箱</label>
      <input class="lc-input" id="demoName" placeholder="you@example.com" />
    </div>
    <div class="lc-check" style="margin-top:12px"><input id="demoCheck" type="checkbox" checked /> <span><label for="demoCheck">接收每周摘要</label></span></div>
  </div>

  <h2>表格与图表</h2>
  <div class="demo-card">
    <table class="demo-table">
      <thead><tr><th>页面</th><th>状态</th><th>更新时间</th></tr></thead>
      <tbody>
        <tr><td>主题与令牌</td><td>已发布</td><td>今天</td></tr>
        <tr><td>组件库</td><td>草稿</td><td>昨天</td></tr>
        <tr><td>导出设置</td><td>待审</td><td>3 天前</td></tr>
      </tbody>
    </table>
    <div class="demo-bars" role="img" aria-label="示例柱状图">
      <span style="height:52%"></span><span style="height:74%"></span><span style="height:100%"></span><span style="height:40%"></span><span style="height:63%"></span>
    </div>
  </div>

  <p class="demo-foot">切换结果会存在 localStorage（key: lc-switcher-demo）。刷新后保持；选「跟随系统」时监听系统深浅变化。</p>
</main>
<script src="theme-switch.js"></script>
</body>
</html>
`;
}
