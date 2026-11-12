/* 防白闪引导脚本（纯函数，不依赖 DOM，Node 与浏览器构建都能用）。
 *
 * 问题：主题切换器要等 DOMContentLoaded 才读 localStorage，首屏会先用页面写死的
 * 默认主题画一遍，再跳到用户上次选的主题；暗色用户会看到一次亮色闪屏。
 *
 * 办法：把本函数生成的脚本内联到 <head>，放在所有样式表之前（同步执行），
 * 首帧之前就把 data-lc-theme / data-lc-mode 设好，后续样式直接按目标主题解析。
 *
 * 用法（导出管线）：
 *   import { themeBootScript } from './src/theme/theme-boot.mjs';
 *   const boot = themeBootScript({
 *     storageKey: 'lc-site-theme',
 *     defaultTheme: 'ink-green',
 *     allowedThemes: ['ink-green', 'ink-navy']
 *   });
 *   // 输出到页面 <head>：<script>${boot}</script>
 *
 * 约束：
 *   - 只读 localStorage，不写；存储键必须和切换器容器上的 data-storage-key 一致；
 *   - allowedThemes 传了就把存档里的旧主题挡在外面，避免存档指向导出包里没有的主题；
 *   - 不依赖 lc-theme-switch.js，可单独内联；切换器加载后会接管交互并保持同一结果。
 */

export function themeBootScript(options = {}) {
  const storageKey = String(options.storageKey || 'lc-site-theme');
  const defaultTheme = String(options.defaultTheme || 'ink-green');
  const allowed = Array.isArray(options.allowedThemes) && options.allowedThemes.length
    ? options.allowedThemes.map((id) => String(id))
    : null;
  const json = (value) => JSON.stringify(value);
  const body = `(function () {
  'use strict';
  var root = document.documentElement;
  var saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(${json(storageKey)}) || 'null'); } catch (error) { saved = null; }
  var allowed = ${allowed ? json(allowed) : 'null'};
  var theme = saved && typeof saved.theme === 'string' ? saved.theme : null;
  if (allowed && theme && allowed.indexOf(theme) === -1) theme = null;
  if (!theme) theme = root.getAttribute('data-lc-theme') || ${json(defaultTheme)};
  var mode = saved && saved.mode;
  if (mode !== 'light' && mode !== 'dark') {
    mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  root.setAttribute('data-lc-theme', theme);
  root.setAttribute('data-lc-mode', mode);
  root.style.colorScheme = mode;
})();`;
  return `/* 防白闪：必须在 <head> 里、样式表之前同步执行。由 src/theme/theme-boot.mjs 生成。 */\n${body}\n`;
}
