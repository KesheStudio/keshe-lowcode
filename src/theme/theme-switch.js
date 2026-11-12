/* 低代码平台 · 站点主题切换器
 *
 * 给导出站/文档页用：跟随系统 / 亮 / 暗，外加多套主题下拉。
 * 样式只复用现有的 .lc-select / .lc-tab 与 lc-tokens 变量，不新造配色。
 *
 * 用法：
 *   <div class="lc-theme-switch" data-lc-theme-switch
 *        data-storage-key="lc-site-theme" data-default-theme="ink-green">
 *     <span class="lc-theme-switch-label">外观</span>
 *     <button class="lc-tab" type="button" data-lc-theme-mode="system" aria-pressed="true">跟随系统</button>
 *     <button class="lc-tab" type="button" data-lc-theme-mode="light" aria-pressed="false">亮</button>
 *     <button class="lc-tab" type="button" data-lc-theme-mode="dark" aria-pressed="false">暗</button>
 *     <select class="lc-select" data-lc-theme-select aria-label="主题">
 *       <option value="ink-green">纸墨 · 松绿</option>
 *       ...
 *     </select>
 *   </div>
 *   <script src="assets/.../lc-theme-switch.js"></script>
 *
 * 组件只改 <html> 的 data-lc-theme / data-lc-mode，颜色仍由 CSS 变量决定。
 * 没选过时默认跟随系统；改了会存 localStorage，刷新后保持。
 * 监听系统深浅切换，只在「跟随系统」模式下跟随变化。
 */

(function () {
  'use strict';

  var MODES = ['system', 'light', 'dark'];
  var FALLBACK_THEME = 'ink-green';

  function read(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* 隐私模式下 localStorage 可能不可写，忽略即可，本次会话仍然生效。 */
    }
  }

  function systemMode() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (error) {
      return 'light';
    }
  }

  function resolveMode(mode) {
    return mode === 'system' || !MODES.includes(mode) ? systemMode() : mode;
  }

  function optionExists(select, theme) {
    if (!select) return true;
    return Array.prototype.some.call(select.options, function (option) {
      return option.value === theme;
    });
  }

  function applyTheme(theme, mode) {
    var root = document.documentElement;
    var resolved = resolveMode(mode);
    root.setAttribute('data-lc-theme', theme);
    root.setAttribute('data-lc-mode', resolved);
    /* 让原生控件（日期选择、滚动条）也跟着深浅，不用额外样式。 */
    root.style.colorScheme = resolved;
  }

  /* 防白闪：脚本在 <head> 里同步加载（或整段内联）时，先按存档把主题设好，
     首帧就用目标配色；等 DOMContentLoaded 再交给 init() 接管交互。
     容器上的 data-storage-key 在 DOM 就绪前读不到，所以优先读 <html> 上的
     data-lc-storage-key——导出站应把这个属性和切换器容器的键写成同一个值。 */
  function storageKeyOf(root) {
    return root.getAttribute('data-lc-storage-key') || 'lc-site-theme';
  }

  function earlyApply() {
    var root = document.documentElement;
    var saved = read(storageKeyOf(root)) || {};
    var theme = typeof saved.theme === 'string' && saved.theme
      ? saved.theme
      : (root.getAttribute('data-lc-theme') || FALLBACK_THEME);
    var mode = MODES.includes(saved.mode) ? saved.mode : 'system';
    applyTheme(theme, mode);
  }

  if (document.readyState === 'loading') earlyApply();

  function init(root) {
    if (!root || root.__lcSwitchReady) return root;
    root.__lcSwitchReady = true;

    var storageKey = root.getAttribute('data-storage-key')
      || document.documentElement.getAttribute('data-lc-storage-key')
      || 'lc-site-theme';
    var select = root.querySelector('[data-lc-theme-select]');
    var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-lc-theme-mode]'));
    var saved = read(storageKey) || {};

    var theme = saved.theme && optionExists(select, saved.theme)
      ? saved.theme
      : (select && select.value)
        || root.getAttribute('data-default-theme')
        || FALLBACK_THEME;
    var mode = MODES.includes(saved.mode) ? saved.mode : 'system';

    function sync() {
      applyTheme(theme, mode);
      root.setAttribute('data-lc-resolved-mode', resolveMode(mode));
      if (select) select.value = theme;
      buttons.forEach(function (button) {
        var active = button.getAttribute('data-lc-theme-mode') === mode;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('is-active', active);
      });
      root.dispatchEvent(new CustomEvent('lc-theme-change', {
        bubbles: true,
        detail: { theme: theme, mode: mode, resolved: resolveMode(mode) }
      }));
    }

    if (select) {
      select.addEventListener('change', function () {
        theme = select.value || FALLBACK_THEME;
        write(storageKey, { theme: theme, mode: mode });
        sync();
      });
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var next = button.getAttribute('data-lc-theme-mode');
        if (!MODES.includes(next)) return;
        mode = next;
        write(storageKey, { theme: theme, mode: mode });
        sync();
      });
    });

    try {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (mode === 'system') sync();
      };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    } catch (error) {
      /* 老浏览器没有 matchMedia 时保持当前结果。 */
    }

    sync();
    return root;
  }

  function initAll(scope) {
    return Array.prototype.map.call((scope || document).querySelectorAll('[data-lc-theme-switch]'), init);
  }

  window.LCThemeSwitch = {
    init: init,
    initAll: initAll,
    apply: applyTheme,
    resolveMode: resolveMode
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(); });
  } else {
    initAll();
  }
})();
