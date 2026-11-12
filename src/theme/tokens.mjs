/* 低代码平台 · 主题与设计令牌
 *
 * 命名规则（写死在这里，改名前先看 NOTES.md）：
 *   --lc-<类别>-<对象>[-<变体>]
 *
 *   类别        含义
 *   color       颜色；派生值由主色（seeds）算出来，不在别处写死
 *   font        字体栈
 *   text        字号
 *   leading     行高
 *   weight      字重
 *   space       间距
 *   radius      圆角
 *   border      边框宽度/样式/组合
 *   shadow      阴影
 *   motion      动效
 *   z           层级
 *   size        编辑器布局尺寸
 *   bp          响应式断点（只能作文档/JS 读取用，见下方 BREAKPOINTS 注释）
 *
 * 主题 JSON 只存「主色 seeds」和「可选覆盖 overrides」；其余变量由 runtime.mjs 派生。
 * 颜色算法与派生规则放在 runtime.mjs，是因为主题编辑器也要在浏览器里用同一套，
 * 不能出现「编辑器算一套、构建脚本算另一套」。
 * 颜色一律只走 CSS 变量，禁止在组件样式里写死色值。
 */

import {
  BASE_SHADOW,
  CODE_COMMENT_PAIRS,
  CODE_LINE_PAIRS,
  CODE_PAIRS,
  COLOR_ALIASES,
  DECOR_MIN,
  DECOR_PAIRS,
  COLOR_TOKENS,
  COLOR_TOKEN_LABELS,
  COLOR_TOKEN_NAMES,
  DEFAULT_SEEDS,
  DISABLED_PAIRS,
  MERMAID_PAIRS,
  OVERLAY_PAIRS,
  REQUIRED_SEEDS,
  SEED_LABELS,
  TEXT_PAIRS,
  THEME_ID_PATTERN,
  THEME_SCHEMA,
  THEME_SCHEMA_VERSION,
  TONES,
  TONE_LABELS,
  UI_PAIRS,
  WEAK_PAIRS,
  compositeOver,
  contrastRatio,
  ensureContrast,
  ensureContrastAll,
  mixColor,
  parseColor,
  pickOnColor,
  relativeLuminance,
  resolveMode,
  resolveTheme,
  themeVariables,
  themeCssBlock,
  themeCssForIds,
  themeCssRule,
  themeStyleSheet,
  migrateThemeData,
  safeCssValue,
  toHex,
  validateThemeData
} from './runtime.mjs';

export {
  BASE_SHADOW,
  CODE_COMMENT_PAIRS,
  CODE_LINE_PAIRS,
  CODE_PAIRS,
  COLOR_ALIASES,
  DECOR_MIN,
  DECOR_PAIRS,
  COLOR_TOKENS,
  COLOR_TOKEN_LABELS,
  COLOR_TOKEN_NAMES,
  DEFAULT_SEEDS,
  DISABLED_PAIRS,
  MERMAID_PAIRS,
  OVERLAY_PAIRS,
  REQUIRED_SEEDS,
  SEED_LABELS,
  TEXT_PAIRS,
  THEME_ID_PATTERN,
  THEME_SCHEMA,
  THEME_SCHEMA_VERSION,
  TONES,
  TONE_LABELS,
  UI_PAIRS,
  WEAK_PAIRS,
  compositeOver,
  contrastRatio,
  ensureContrast,
  ensureContrastAll,
  mixColor,
  parseColor,
  pickOnColor,
  relativeLuminance,
  resolveMode,
  resolveTheme,
  themeVariables,
  themeCssBlock,
  themeCssForIds,
  themeCssRule,
  themeStyleSheet,
  migrateThemeData,
  safeCssValue,
  toHex,
  validateThemeData
};

/* ---------------- 基础静态令牌（与明暗无关） ---------------- */

/* 字体栈全仓只在这里定义一次，组件和主题一律 var(--lc-font-*) 引用，不再重写。
   三个栈都带中文回退，避免导出站落到浏览器默认字体。
   --lc-font-sans：西文系统栈 → 苹方 / 冬青黑体 → 微软雅黑 → Noto Sans CJK
   --lc-font-serif：宋体族（华文宋体 / 宋体 / Noto Serif CJK / 思源宋体）
   --lc-font-mono：SF Mono → Consolas → Liberation Mono → Menlo */
/* 打印专用固定令牌：始终按「浅色纸面」输出，不跟随当前主题。
   命名用 --lc-print-<对象>，与颜色令牌完全分开，避免打印时又回落到主题色。
   lc-print.css 只把主题颜色令牌映射到这一组，不再写死色值；
   check.mjs 同时核对存在性、取值和纸面对比度。 */
export const PRINT_TOKENS = {
  '--lc-print-bg': '#ffffff',
  '--lc-print-surface': '#ffffff',
  '--lc-print-ink': '#111111',
  '--lc-print-ink-2': '#222222',
  '--lc-print-muted': '#555555',
  '--lc-print-muted-2': '#444444',
  '--lc-print-decor': '#8a8a8a',
  '--lc-print-placeholder': '#555555',
  '--lc-print-disabled-ink': '#767676',
  '--lc-print-line': '#bbbbbb',
  '--lc-print-line-strong': '#888888',
  '--lc-print-accent': '#111111',
  '--lc-print-accent-fill': '#eeeeee',
  '--lc-print-on-accent': '#111111',
  '--lc-print-accent-soft': '#f5f5f5',
  '--lc-print-code-bg': '#ffffff',
  '--lc-print-focus': '#111111',
  '--lc-print-success': '#14532d',
  '--lc-print-success-soft': '#f0fdf4',
  '--lc-print-warn': '#7a4b00',
  '--lc-print-warn-soft': '#fff8e6',
  '--lc-print-danger': '#9b1c1c',
  '--lc-print-danger-soft': '#fef2f2',
  '--lc-print-info': '#1e4b7a',
  '--lc-print-info-soft': '#eff6ff'
};

export const BASE_STATIC = {
  '--lc-font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  '--lc-font-serif': '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif',
  '--lc-font-mono': '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',

  '--lc-text-xs': '0.75rem',
  '--lc-text-sm': '0.8125rem',
  '--lc-text-base': '0.875rem',
  '--lc-text-md': '0.9375rem',
  '--lc-text-lg': '1.0625rem',
  '--lc-text-xl': '1.25rem',
  '--lc-text-2xl': '1.5rem',
  '--lc-text-3xl': '1.875rem',

  '--lc-leading-tight': '1.3',
  '--lc-leading-base': '1.65',
  '--lc-leading-relaxed': '1.85',

  '--lc-weight-normal': '400',
  '--lc-weight-medium': '500',
  '--lc-weight-semibold': '600',
  '--lc-weight-bold': '700',

  /* 4px 基准间距，半档补 6 / 10 / 14px 三个高频值：
       6px  = --lc-space-1-5（1.5 档，密集 gap）
       10px = --lc-space-2-5（2.5 档，紧凑 padding）
       14px = --lc-space-3-5（3.5 档，卡片内边距） */
  '--lc-space-1': '4px',
  '--lc-space-1-5': '6px',
  '--lc-space-2': '8px',
  '--lc-space-2-5': '10px',
  '--lc-space-3': '12px',
  '--lc-space-3-5': '14px',
  '--lc-space-4': '16px',
  '--lc-space-5': '20px',
  '--lc-space-6': '24px',
  '--lc-space-7': '32px',
  '--lc-space-8': '48px',

  /* 圆角只有这一套，主题不允许再覆盖。5px / 6px 这类散值统一收进 sm / md：
       xs 2px   细节、标签内小元素（旧 2–3px）
       sm 5px   输入框、按钮、紧凑控件（旧 4–6px，也是组件里 var(--lc-radius-sm, 5px) 的约定值）
       md 8px   卡片、面板、下拉（旧 6–8px）
       lg 10px  大卡片、弹层（旧 10px）
       xl 14px  抽屉、大面积容器（旧 14px）
       full     胶囊/圆形（旧 50% / 999px） */
  '--lc-radius-xs': '2px',
  '--lc-radius-sm': '5px',
  '--lc-radius-md': '8px',
  '--lc-radius-lg': '10px',
  '--lc-radius-xl': '14px',
  '--lc-radius-full': '999px',

  '--lc-border-width': '1px',
  '--lc-border-style': 'solid',
  '--lc-border': '1px solid var(--lc-color-line)',
  '--lc-border-strong': '1px solid var(--lc-color-line-strong)',

  '--lc-motion-fast': '120ms',
  '--lc-motion-base': '180ms',
  '--lc-motion-slow': '320ms',
  '--lc-ease-standard': 'cubic-bezier(0.2, 0.6, 0.2, 1)',
  '--lc-ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
  '--lc-ease-in': 'cubic-bezier(0.4, 0, 1, 1)',

  '--lc-z-base': '0',
  '--lc-z-raised': '10',
  '--lc-z-sticky': '100',
  '--lc-z-dropdown': '200',
  '--lc-z-overlay': '300',
  '--lc-z-modal': '400',
  '--lc-z-toast': '500',

  '--lc-size-topbar': '56px',
  '--lc-size-statusbar': '28px',
  '--lc-size-sidebar': '264px',
  '--lc-size-inspector': '320px',
  '--lc-size-control': '32px',
  '--lc-size-row': '34px',

  ...PRINT_TOKENS
};

/* 圆角刻度（唯一事实来源）。check.mjs 会核对 BASE_STATIC 里的值与这里一致，
   并确保主题 JSON 不再覆盖圆角。 */
export const RADIUS_SCALE = [
  { token: '--lc-radius-xs', px: 2, from: '2–3px' },
  { token: '--lc-radius-sm', px: 5, from: '4–6px' },
  { token: '--lc-radius-md', px: 8, from: '6–8px' },
  { token: '--lc-radius-lg', px: 10, from: '10px' },
  { token: '--lc-radius-xl', px: 14, from: '14px' },
  { token: '--lc-radius-full', px: 999, from: '50% / 999px' }
];

/* 响应式断点。
 *
 * CSS 自定义属性不能用在 @media 的查询条件里（规范限制，不是实现问题），所以：
 *   - 这里是断点的唯一事实来源，构建时把 px 数值写进 lc-responsive.css 的媒体查询；
 *   - 同时输出 --lc-bp-* 变量，供 JS 用 getComputedStyle 读取，或作为文档；
 *   - 改断点只改这里，并同步 lc-responsive.css（改完跑一次 check.mjs，会核对两边一致）。
 *
 * 命名：--lc-bp-<尺寸名>，尺寸名按从小到大 sm / md / lg 排列，值是视口宽度。
 */
export const BREAKPOINTS = [
  { name: 'sm', px: 640, label: '窄屏：侧栏与检查器改为覆盖层抽屉，工具栏只留图标' },
  { name: 'md', px: 900, label: '平板：检查器改为右侧覆盖层，工具栏收起次要信息' },
  { name: 'lg', px: 1180, label: '小桌面：侧栏与检查器收窄，工作区优先' }
];

export const BREAKPOINT_TOKENS = {
  '--lc-bp-sm': '640px',
  '--lc-bp-md': '900px',
  '--lc-bp-lg': '1180px'
};

/* 旧版导出站/工作台用的无前缀变量。只做别名，不新增颜色。
   注意 --accent 在旧样式里既当文字色又当按钮底色，新版把这两个角色拆成
   --lc-color-accent（文字）和 --lc-color-accent-fill（填充）。 */
export const LEGACY_ALIASES = {
  '--bg': 'var(--lc-color-bg)',
  '--bg-deep': 'var(--lc-color-bg-deep)',
  '--surface': 'var(--lc-color-surface)',
  '--surface-2': 'var(--lc-color-surface-2)',
  '--surface-3': 'var(--lc-color-surface-3)',
  '--ink': 'var(--lc-color-ink)',
  '--ink-2': 'var(--lc-color-ink-2)',
  '--muted': 'var(--lc-color-muted)',
  '--muted-2': 'var(--lc-color-muted-2)',
  '--line': 'var(--lc-color-line)',
  '--line-strong': 'var(--lc-color-line-strong)',
  '--accent': 'var(--lc-color-accent)',
  '--accent-ink': 'var(--lc-color-accent)',
  '--accent-soft': 'var(--lc-color-accent-soft)',
  '--accent-line': 'var(--lc-color-accent-line)',
  '--code-bg': 'var(--lc-color-code-bg)',
  '--warn': 'var(--lc-color-warn)',
  '--warn-ink': 'var(--lc-color-warn)',
  '--warn-soft': 'var(--lc-color-warn-soft)',
  '--warn-line': 'var(--lc-color-warn-line)',
  '--danger': 'var(--lc-color-danger)',
  '--danger-soft': 'var(--lc-color-danger-soft)',
  '--sans': 'var(--lc-font-sans)',
  '--serif': 'var(--lc-font-serif)',
  '--mono': 'var(--lc-font-mono)',
  '--radius': 'var(--lc-radius-lg)',
  '--radius-sm': 'var(--lc-radius-md)'
};

/* ---------------- 输出 CSS ---------------- */

function declarations(map, indent = '  ') {
  return Object.keys(map).map((key) => `${indent}${key}: ${map[key]};`).join('\n');
}

export function baseCss() {
  const light = resolveMode({ modes: { light: {}, dark: {} } }, 'light');
  const dark = resolveMode({ modes: { light: {}, dark: {} } }, 'dark');
  const aliases = declarations(LEGACY_ALIASES);
  return [
    '/* 由 src/theme/build.mjs 生成，不要手改。改令牌请改 src/theme/runtime.mjs 或 tokens.mjs。 */',
    '',
    ':root {',
    declarations(BASE_STATIC),
    '',
    '  /* 断点值只供 JS 读取和文档；@media 条件里用的是同样数值的固定写法。 */',
    declarations(BREAKPOINT_TOKENS),
    '',
    aliases,
    '}',
    '',
    '/* 亮色是默认值；运行时在 <html> 上设 data-lc-mode="dark" 切暗色。 */',
    ':root, [data-lc-mode="light"] {',
    declarations(light),
    '}',
    '',
    '[data-lc-mode="dark"], [data-theme="dark"] {',
    declarations(dark),
    '}',
    ''
  ].join('\n');
}

/* 内置主题的 CSS 变量块。
 * 构建管线直接调用 runtime.mjs 的 themeCssRule()，和导出接口是同一套实现，
 * 避免「构建出来的 CSS」和「导出的 CSS」逐渐跑偏。 */
export function themesCss(themes) {
  const parts = ['/* 由 src/theme/build.mjs 生成，不要手改。主题源文件在 src/theme/themes/。 */', ''];
  for (const theme of themes) {
    for (const mode of ['light', 'dark']) {
      parts.push(themeCssRule(
        theme,
        mode,
        `[data-lc-theme="${theme.id}"][data-lc-mode="${mode}"]`,
        { onlyThemeTokens: true, comment: `${theme.name || theme.id} · ${mode}` }
      ));
      parts.push('');
    }
  }
  return parts.join('\n');
}

function colorNameMatch(key) {
  return /^--lc-color-/.test(key);
}

/* 供构建脚本读取的元信息，避免两个脚本各写一份常量。 */
export const TOKEN_COUNTS = {
  static: Object.keys(BASE_STATIC).length,
  color: COLOR_TOKENS.length,
  breakpoints: BREAKPOINTS.length
};
