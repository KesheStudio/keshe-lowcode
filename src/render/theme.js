/* 渲染核心 · 主题
   只做一件事：把主题 JSON 转成 CSS 变量规则。
   颜色和尺寸都由主题给出，渲染层不写死任何色值。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory(root.LC.Render);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  R = R || {};

  function normalizeVars(input) {
    var out = {};
    Object.keys(input || {}).forEach(function (key) {
      var name = String(key);
      if (!name) return;
      out[name.indexOf('--') === 0 ? name : '--' + name] = input[key];
    });
    return out;
  }

  function mergeVars() {
    var out = {};
    for (var i = 0; i < arguments.length; i += 1) {
      var source = normalizeVars(arguments[i]);
      Object.keys(source).forEach(function (key) { out[key] = source[key]; });
    }
    return out;
  }

  function themeVars(theme, mode) {
    var t = theme || {};
    var base = mergeVars(t.variables || t.tokens || {});
    var light = mergeVars(base, t.light || {});
    var dark = mergeVars(base, t.light || {}, t.dark || {});
    return mode === 'dark' ? dark : light;
  }

  function rule(selector, vars, scheme) {
    var lines = Object.keys(vars).map(function (key) {
      return '  ' + key + ': ' + vars[key] + ';';
    });
    if (scheme) lines.push('  color-scheme: ' + scheme + ';');
    return selector + ' {\n' + lines.join('\n') + '\n}';
  }

  /* 主题只输出 CSS 变量规则。模式主路径是 data-lc-mode="light|dark"，
     data-theme="dark" 仅作旧属性兼容；auto 不在这里展开，由外壳层解析后传入。
     第一段 :root 兜底：文档缺少 data-lc-theme 时也有默认主题（亮色）的令牌，
     不会因为变量未定义而落到 transparent；暗色兜底用 :where 保持同等优先级，
     后面的具体主题规则仍可覆盖。 */
  function themeCss(themes) {
    var list = Array.isArray(themes) ? themes : [];
    var fallbackTheme = null;
    list.forEach(function (theme) {
      if (!fallbackTheme && theme && theme.id === 'ink-green') fallbackTheme = theme;
    });
    if (!fallbackTheme) fallbackTheme = list.filter(function (theme) { return theme && theme.id; })[0] || null;
    var fallback = [];
    if (fallbackTheme) {
      fallback.push(rule(':root', themeVars(fallbackTheme, 'light'), 'light'));
      if (fallbackTheme.dark) {
        fallback.push(rule(':root:where([data-lc-mode="dark"])', themeVars(fallbackTheme, 'dark'), 'dark'));
      }
    }
    var themed = list.map(function (theme) {
      if (!theme || !theme.id) return '';
      var selector = '[data-lc-theme="' + String(theme.id).replace(/"/g, '\\"') + '"]';
      var hasLight = !!theme.light;
      var hasDark = !!theme.dark;
      var baseMode = theme.colorScheme || (hasLight ? 'light' : (hasDark ? 'dark' : 'light'));
      var parts = [
        // 没有显式 mode 时的兜底，避免页面在未解析模式时丢变量
        rule(selector, themeVars(theme, baseMode), baseMode),
        rule(selector + '[data-lc-mode="light"]', themeVars(theme, 'light'), 'light')
      ];
      if (hasDark) {
        parts.push(rule(selector + '[data-lc-mode="dark"]', themeVars(theme, 'dark'), 'dark'));
        // 兼容旧属性；显式 light 不会被这条覆盖
        parts.push(rule(selector + '[data-theme="dark"]:not([data-lc-mode="light"])', themeVars(theme, 'dark'), 'dark'));
      }
      return parts.join('\n');
    });
    return fallback.concat(themed).filter(Boolean).join('\n\n');
  }

  function resolveTheme(themes, id) {
    var list = Array.isArray(themes) ? themes : [];
    var found = null;
    list.forEach(function (theme) {
      if (!found && theme && theme.id === id) found = theme;
    });
    return found || list[0] || null;
  }

  R.themeVars = themeVars;
  R.themeCss = themeCss;
  R.resolveTheme = resolveTheme;

  return R;
}));
