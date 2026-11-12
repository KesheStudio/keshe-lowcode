/* 防白闪：必须在 <head> 里、样式表之前同步执行。由 src/theme/theme-boot.mjs 生成。 */
(function () {
  'use strict';
  var root = document.documentElement;
  var saved = null;
  try { saved = JSON.parse(window.localStorage.getItem("lc-site-theme") || 'null'); } catch (error) { saved = null; }
  var allowed = ["auth-clean","blueprint-amber","dashboard-calm","docs-quiet","ink-graphite","ink-green","ink-navy","ink-ochre","night-contrast","portfolio-bold"];
  var theme = saved && typeof saved.theme === 'string' ? saved.theme : null;
  if (allowed && theme && allowed.indexOf(theme) === -1) theme = null;
  if (!theme) theme = root.getAttribute('data-lc-theme') || "ink-green";
  var mode = saved && saved.mode;
  if (mode !== 'light' && mode !== 'dark') {
    mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  root.setAttribute('data-lc-theme', theme);
  root.setAttribute('data-lc-mode', mode);
  root.style.colorScheme = mode;
})();
