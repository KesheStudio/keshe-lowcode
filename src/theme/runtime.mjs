/* 低代码平台 · 主题运行时核心
 *
 * 这个文件同时被两处使用：
 *   - Node 侧：tokens.mjs / check.mjs / build.mjs 直接 import；
 *   - 浏览器侧：build.mjs 把本文件去掉 export 前缀，包成经典脚本
 *     src/theme/lc-theme-runtime.js，主题编辑器用它做派生和实时校验。
 *
 * 所以这里只能放纯数据与纯函数：不许 import 任何模块，不许碰 Node API，
 * 也不许碰 DOM。颜色只算值，写进 CSS 变量的事交给调用方。
 */

/* 当前主题包格式版本。v3 在 v2 的基础上只新增可选 meta，字段本身兼容 v1/v2。
   旧文件由 migrateThemeData() 自动补齐，导入不会因为版本号不同直接失败。 */
export const THEME_SCHEMA_VERSION = 3;

export const TONES = ['paper', 'cool', 'warm', 'neutral', 'high-contrast', 'blueprint'];

export const TONE_LABELS = {
  paper: '纸感',
  cool: '冷调',
  warm: '暖调',
  neutral: '中性',
  'high-contrast': '高对比',
  blueprint: '工程蓝'
};

export const THEME_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/* 焦点环用「底色内圈 + 强调色外圈」的双环：单圈在浅底/深底之间切换时容易糊进底色，
   加一圈和上层底同色的内圈能撕开边界；被 overflow 裁剪的容器改用内嵌环（见 lc-a11y.css）。 */
export const BASE_SHADOW = {
  light: {
    '--lc-shadow-xs': '0 1px 2px rgba(20, 24, 28, 0.05)',
    '--lc-shadow-sm': '0 2px 6px rgba(20, 24, 28, 0.07)',
    '--lc-shadow-md': '0 8px 24px rgba(20, 24, 28, 0.10)',
    '--lc-shadow-lg': '0 18px 44px rgba(20, 24, 28, 0.16)',
    '--lc-ring': '0 0 0 2px var(--lc-color-surface), 0 0 0 4px var(--lc-color-focus)'
  },
  dark: {
    '--lc-shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.22)',
    '--lc-shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.28)',
    '--lc-shadow-md': '0 10px 28px rgba(0, 0, 0, 0.34)',
    '--lc-shadow-lg': '0 22px 52px rgba(0, 0, 0, 0.42)',
    '--lc-ring': '0 0 0 2px var(--lc-color-surface), 0 0 0 4px var(--lc-color-focus)'
  }
};

/* ---------------- 主色（seeds） ---------------- */

/* 主题包里必须写全这 11 个键。accentFill / onAccent / accent2 可选：
   前两者不写会自动推断，accent2 不写就由 accent 与 info 混出来。 */
export const REQUIRED_SEEDS = [
  'bg', 'surface', 'ink', 'muted', 'line', 'accent', 'codeBg',
  'success', 'warn', 'danger', 'info'
];

export const SEED_LABELS = {
  bg: '页面背景',
  surface: '卡片/面板背景',
  ink: '正文文字',
  muted: '次要文字',
  line: '分隔线',
  accent: '主色（强调色）',
  accent2: '辅助强调色（可选）',
  codeBg: '代码底色',
  success: '成功色',
  warn: '警告色',
  danger: '危险色',
  info: '信息色',
  accentFill: '按钮填充色（可选）',
  onAccent: '按钮文字色（可选）'
};

/* 默认值 = ink-green（契约里 project.json 的 defaultThemeId 就是它）。 */
export const DEFAULT_SEEDS = {
  light: {
    bg: '#f4f0e6', surface: '#fffcf5', ink: '#20242a', muted: '#5f656b', line: '#ded6c5',
    accent: '#3e6a56', codeBg: '#efeade',
    success: '#2f5f4b', warn: '#8a5320', danger: '#a3342c', info: '#35577f'
  },
  dark: {
    bg: '#141a1f', surface: '#1a2229', ink: '#e6e2d8', muted: '#a0a8ae', line: '#2a343c',
    accent: '#8fb9a1', codeBg: '#151d23',
    success: '#8fc7a9', warn: '#d6a177', danger: '#e08a7d', info: '#93b3d6'
  }
};

/* ---------------- 主题包格式 ----------------
 * 单文件 JSON。v3 结构：
 *   { schemaVersion, id, name, tone, description, modes, shared?, meta? }
 *   modes.light / modes.dark 各自 { seeds, overrides? }
 * 版本兼容策略写在 compatibility 里，check.mjs 会拿合成旧文件逐条验证。
 */
export const THEME_SCHEMA = {
  version: THEME_SCHEMA_VERSION,
  file: 'src/theme/themes/<id>.json',
  required: ['schemaVersion', 'id', 'name', 'tone', 'description', 'modes'],
  optional: ['shared', 'meta'],
  modeRequired: ['seeds'],
  seedsRequired: REQUIRED_SEEDS,
  seedsOptional: ['accentFill', 'onAccent', 'accent2'],
  compatibility: [
    {
      from: 1,
      to: 3,
      rule: 'v1 允许把 light / dark 直接写在根节点；导入时折叠进 modes，缺失的 tone 补 neutral、description 补占位说明。'
    },
    {
      from: 2,
      to: 3,
      rule: 'v2 与 v3 字段一致，v3 只新增可选 meta；v2 文件原样可读，只把版本号升到 3。'
    },
    {
      from: 'future',
      to: 3,
      rule: '版本号高于当前时不拒绝文件，按已知字段尽力读取，并在导入报告里提示版本差。'
    }
  ]
};

/* ---------------- 颜色令牌清单 ---------------- */

export const COLOR_TOKENS = [
  { name: '--lc-color-bg', label: '页面背景', base: 'bg' },
  { name: '--lc-color-bg-deep', label: '更深一层的背景', base: 'bg' },
  { name: '--lc-color-surface', label: '面板背景', base: 'surface' },
  { name: '--lc-color-surface-2', label: '次级面板背景', base: 'surface' },
  { name: '--lc-color-surface-3', label: '三级面板背景', base: 'surface' },
  { name: '--lc-color-ink', label: '正文文字', base: 'ink' },
  { name: '--lc-color-ink-2', label: '正文次级文字', base: 'ink' },
  { name: '--lc-color-muted', label: '次要文字', base: 'muted' },
  { name: '--lc-color-muted-2', label: '更深一档的次要文字', base: 'muted' },
  { name: '--lc-color-decor', label: '装饰色（行号、分隔符、斜杠；非信息，按 3:1 下限）', base: 'muted' },
  { name: '--lc-color-placeholder', label: '占位符文字（按正文标准 4.5:1）', base: 'muted' },
  { name: '--lc-color-disabled-bg', label: '禁用态底色', base: 'surface' },
  { name: '--lc-color-disabled-ink', label: '禁用态文字（内部要求 3:1）', base: 'ink' },
  { name: '--lc-color-line', label: '分隔线', base: 'line' },
  { name: '--lc-color-line-strong', label: '强调分隔线', base: 'line' },
  { name: '--lc-color-accent', label: '主色（文字/图标）', base: 'accent' },
  { name: '--lc-color-accent-fill', label: '主色填充（按钮底）', base: 'accent' },
  { name: '--lc-color-accent-fill-hover', label: '主按钮悬停底色', base: 'accent' },
  { name: '--lc-color-accent-fill-pressed', label: '主按钮按下底色', base: 'accent' },
  { name: '--lc-color-on-accent', label: '填充上的文字', base: 'accent' },
  { name: '--lc-color-accent-soft', label: '主色浅底', base: 'accent' },
  { name: '--lc-color-accent-line', label: '主色描边', base: 'accent' },
  { name: '--lc-color-accent-2', label: '辅助强调色', base: 'accent2' },
  { name: '--lc-color-accent-2-soft', label: '辅助强调色浅底', base: 'accent2' },
  { name: '--lc-color-accent-2-line', label: '辅助强调色描边', base: 'accent2' },
  { name: '--lc-color-code-bg', label: '代码底色', base: 'codeBg' },
  { name: '--lc-color-code-text', label: '代码正文', base: 'ink' },
  { name: '--lc-color-code-keyword', label: '代码关键字', base: 'accent2' },
  { name: '--lc-color-code-string', label: '代码字符串', base: 'success' },
  { name: '--lc-color-code-comment', label: '代码注释（放宽到 3:1）', base: 'muted' },
  { name: '--lc-color-code-number', label: '代码数字', base: 'warn' },
  { name: '--lc-color-code-function', label: '代码函数名', base: 'accent' },
  { name: '--lc-color-code-line', label: '代码块分隔线（非文字 3:1）', base: 'line' },
  { name: '--lc-color-focus', label: '焦点环', base: 'accent' },
  { name: '--lc-color-focus-overlay', label: '遮罩上的焦点环（黑白反色）', base: 'focus' },
  { name: '--lc-color-success', label: '成功', base: 'success' },
  { name: '--lc-color-success-soft', label: '成功浅底', base: 'success' },
  { name: '--lc-color-success-line', label: '成功描边', base: 'success' },
  { name: '--lc-color-warn', label: '警告', base: 'warn' },
  { name: '--lc-color-warn-soft', label: '警告浅底', base: 'warn' },
  { name: '--lc-color-warn-line', label: '警告描边', base: 'warn' },
  { name: '--lc-color-danger', label: '危险', base: 'danger' },
  { name: '--lc-color-danger-soft', label: '危险浅底', base: 'danger' },
  { name: '--lc-color-danger-line', label: '危险描边', base: 'danger' },
  { name: '--lc-color-info', label: '信息', base: 'info' },
  { name: '--lc-color-info-soft', label: '信息浅底', base: 'info' },
  { name: '--lc-color-info-line', label: '信息描边', base: 'info' },
  { name: '--lc-color-selection-bg', label: '文本选中底色', base: 'accent' },
  { name: '--lc-color-selection-ink', label: '文本选中文字', base: 'ink' },
  { name: '--lc-color-overlay', label: '遮罩层', base: 'ink' },
  { name: '--lc-mermaid-node-fill', label: '流程图节点底色', base: 'surface' },
  { name: '--lc-mermaid-node-stroke', label: '流程图节点描边', base: 'line' },
  { name: '--lc-mermaid-line', label: '流程图连线', base: 'line' },
  { name: '--lc-mermaid-label', label: '流程图文字', base: 'ink' },
  { name: '--lc-mermaid-note-fill', label: '流程图注释底色', base: 'warn' },
  { name: '--lc-mermaid-label-bg', label: '流程图文字底色', base: 'surface' }
];

export const COLOR_TOKEN_NAMES = COLOR_TOKENS.map((item) => item.name);

export const COLOR_TOKEN_LABELS = Object.fromEntries(
  COLOR_TOKENS.map((item) => [item.name, item.label])
);

/* 正式名之外的兼容别名。别名只写一次，值必须是指向正式令牌的 var()，
   不复制色值。这样 15 处历史引用（--lc-color-error）和 1 处遮罩引用
   （--lc-overlay-mask）都能落到主题派生结果上，而不是回退到写死的浅色。
   正式名：
     错误色     --lc-color-danger（与 success / warn / info 命名对齐）
     遮罩层     --lc-color-overlay
   别名不参与主题编辑器的调色面板，只负责让旧引用可用。 */
export const COLOR_ALIASES = {
  '--lc-color-error': 'var(--lc-color-danger)',
  '--lc-overlay-mask': 'var(--lc-color-overlay)',
  /* code.js 里已经在用 tag / attr / prop 三个语法角色，但它们不在正式清单里。
     按语义折到正式色，避免继续回退到写死的蓝 / 棕 / 绿。 */
  '--lc-color-code-tag': 'var(--lc-color-code-keyword)',
  '--lc-color-code-attr': 'var(--lc-color-code-number)',
  '--lc-color-code-prop': 'var(--lc-color-code-string)'
};

/* ---------------- 对比度组合 ----------------
 * threshold 默认 AA 正文 4.5；非文字图形（焦点环、输入框描边）按 WCAG 1.4.11 的 3:1。
 * 这里的组合既给 check.mjs 用，也给主题编辑器实时校验用，保证「编辑器说通过」和
 * 「脚本说通过」是同一套规则。
 */

export const TEXT_PAIRS = [
  ['--lc-color-ink', '--lc-color-bg', 4.5],
  ['--lc-color-ink', '--lc-color-surface', 4.5],
  ['--lc-color-ink', '--lc-color-surface-2', 4.5],
  ['--lc-color-ink-2', '--lc-color-surface', 4.5],
  ['--lc-color-ink-2', '--lc-color-bg', 4.5],
  ['--lc-color-muted', '--lc-color-bg', 4.5],
  ['--lc-color-muted', '--lc-color-surface', 4.5],
  ['--lc-color-muted', '--lc-color-surface-2', 4.5],
  ['--lc-color-muted-2', '--lc-color-surface', 4.5],
  ['--lc-color-accent', '--lc-color-bg', 4.5],
  ['--lc-color-accent', '--lc-color-surface', 4.5],
  ['--lc-color-accent', '--lc-color-accent-soft', 4.5],
  ['--lc-color-accent-2', '--lc-color-bg', 4.5],
  ['--lc-color-accent-2', '--lc-color-surface', 4.5],
  ['--lc-color-accent-2', '--lc-color-accent-2-soft', 4.5],
  ['--lc-color-on-accent', '--lc-color-accent-fill', 4.5],
  ['--lc-color-on-accent', '--lc-color-accent-fill-hover', 4.5],
  ['--lc-color-on-accent', '--lc-color-accent-fill-pressed', 4.5],
  ['--lc-color-success', '--lc-color-bg', 4.5],
  ['--lc-color-success', '--lc-color-success-soft', 4.5],
  ['--lc-color-warn', '--lc-color-bg', 4.5],
  ['--lc-color-warn', '--lc-color-warn-soft', 4.5],
  ['--lc-color-danger', '--lc-color-bg', 4.5],
  ['--lc-color-danger', '--lc-color-surface', 4.5],
  ['--lc-color-danger', '--lc-color-danger-soft', 4.5],
  ['--lc-color-info', '--lc-color-bg', 4.5],
  ['--lc-color-info', '--lc-color-info-soft', 4.5],
  ['--lc-color-ink', '--lc-color-accent-soft', 4.5],
  ['--lc-color-ink', '--lc-color-surface-3', 4.5],
  ['--lc-color-ink', '--lc-color-bg-deep', 4.5],
  ['--lc-color-ink-2', '--lc-color-accent-soft', 4.5],
  ['--lc-color-ink-2', '--lc-color-success-soft', 4.5],
  ['--lc-color-ink-2', '--lc-color-warn-soft', 4.5],
  ['--lc-color-ink-2', '--lc-color-danger-soft', 4.5],
  ['--lc-color-ink-2', '--lc-color-info-soft', 4.5],
  ['--lc-color-ink-2', '--lc-color-surface-2', 4.5],
  ['--lc-color-ink-2', '--lc-color-bg-deep', 4.5]
];

export const UI_PAIRS = [
  ['--lc-color-focus', '--lc-color-bg', 3],
  ['--lc-color-focus', '--lc-color-surface', 3],
  ['--lc-color-focus', '--lc-color-accent-soft', 3],
  ['--lc-color-focus', '--lc-color-surface-2', 3],
  ['--lc-color-line-strong', '--lc-color-surface', 3],
  ['--lc-color-line-strong', '--lc-color-bg', 3],
  ['--lc-color-line-strong', '--lc-color-surface-2', 3]
];

/* 弱化文本。次要文字仍按正文 4.5:1；占位符是真实文字内容，也按 4.5:1。
   禁用态在 WCAG 里被豁免，但内部仍要求 3:1，避免「看得到但读不清」，单独放在 DISABLED_PAIRS。 */
export const WEAK_PAIRS = [
  ['--lc-color-muted', '--lc-color-surface-3', 4.5],
  ['--lc-color-muted', '--lc-color-bg-deep', 4.5],
  ['--lc-color-muted-2', '--lc-color-surface-2', 4.5],
  ['--lc-color-muted-2', '--lc-color-bg', 4.5],
  ['--lc-color-placeholder', '--lc-color-surface', 4.5],
  ['--lc-color-placeholder', '--lc-color-bg', 4.5],
  ['--lc-color-placeholder', '--lc-color-surface-2', 4.5]
];

export const DISABLED_PAIRS = [
  ['--lc-color-disabled-ink', '--lc-color-disabled-bg', 3],
  ['--lc-color-disabled-ink', '--lc-color-surface', 3],
  ['--lc-color-disabled-ink', '--lc-color-bg', 3]
];

/* 装饰色下限：3:1。
 *
 * 依据：装饰色不承载信息（行号、日期/滑块分隔符、面包屑斜杠、图表第 7 系列之后的色），
 * 不适用正文 4.5:1，也不属于 WCAG 1.4.11 必须达标的控件边界；但它是「可扫描结构」的一部分，
 * 低于 3:1 在暗色面上会直接消失，所以借 1.4.11 的非文本下限作为内部红线，只低不更低。
 * 与 muted-2 的分工见 NOTES.md：muted-2 承载信息、按 4.5:1 检查；decor 只做视觉分隔，
 * 按 3:1 检查，且必须比 muted-2 明显更淡（check.mjs 用 1.0 的对比度差作为「明显」的门槛）。
 */
export const DECOR_MIN = 3;
export const DECOR_PAIRS = [
  ['--lc-color-decor', '--lc-color-bg', DECOR_MIN],
  ['--lc-color-decor', '--lc-color-surface', DECOR_MIN],
  ['--lc-color-decor', '--lc-color-surface-2', DECOR_MIN],
  ['--lc-color-decor', '--lc-color-surface-3', DECOR_MIN],
  ['--lc-color-decor', '--lc-color-bg-deep', DECOR_MIN]
];

/* 代码语法色。
 *
 * 说明：六种前景色「任意两两 ≥ 4.5:1」在数学上不可满足——若底色是浅色，所有前景色亮度必须
 * ≤ 0.161 才能对底色达标，而这个区间内两两对比上限只有 4.22:1；深色底同理。所以回归检查
 * 采用可执行、可交付的口径：每个语法色对代码块底色 ≥ 4.5:1；注释是弱化文字，按 3:1 并单独标注；
 * 分隔线属于非文字，按 3:1。 */
export const CODE_PAIRS = [
  ['--lc-color-code-text', '--lc-color-code-bg', 4.5],
  ['--lc-color-code-keyword', '--lc-color-code-bg', 4.5],
  ['--lc-color-code-string', '--lc-color-code-bg', 4.5],
  ['--lc-color-code-number', '--lc-color-code-bg', 4.5],
  ['--lc-color-code-function', '--lc-color-code-bg', 4.5]
];

/* 注释单独放，标注为放宽项。 */
export const CODE_COMMENT_PAIRS = [
  ['--lc-color-code-comment', '--lc-color-code-bg', 3]
];

/* 代码块分隔线：非文字图形，按 WCAG 1.4.11 的 3:1。 */
export const CODE_LINE_PAIRS = [
  ['--lc-color-code-line', '--lc-color-code-bg', 3]
];

/* 流程图（mermaid）。暗色主题最怕「浅底浅字」，所以文字对三种可能的底色都复核：
   节点底、注释底、文字底。连线与节点描边属于非文字，按 3:1。 */
export const MERMAID_PAIRS = [
  ['--lc-mermaid-label', '--lc-mermaid-node-fill', 4.5],
  ['--lc-mermaid-label', '--lc-mermaid-note-fill', 4.5],
  ['--lc-mermaid-label', '--lc-mermaid-label-bg', 4.5],
  ['--lc-mermaid-node-stroke', '--lc-mermaid-node-fill', 3],
  ['--lc-mermaid-line', '--lc-color-bg', 3],
  ['--lc-mermaid-line', '--lc-color-surface', 3]
];

/* 遮罩上的焦点环：遮罩是半透明，必须先把遮罩叠到底色上再算对比度。 */
export const OVERLAY_PAIRS = [
  ['--lc-color-focus-overlay', '--lc-color-overlay', '--lc-color-surface', 3],
  ['--lc-color-focus-overlay', '--lc-color-overlay', '--lc-color-bg', 3]
];

/* ---------------- 颜色工具 ---------------- */

export function parseColor(value) {
  const text = String(value == null ? '' : value).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(text);
  if (m) {
    const s = m[1];
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(text);
  if (m) {
    const s = m[1];
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
  }
  m = /^#([0-9a-f]{8})$/i.exec(text);
  if (m) {
    const s = m[1];
    return {
      r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16),
      a: parseInt(s.slice(6, 8), 16) / 255
    };
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(text);
  if (m) {
    return {
      r: clamp255(Number(m[1])), g: clamp255(Number(m[2])), b: clamp255(Number(m[3])),
      a: m[4] == null ? 1 : Math.max(0, Math.min(1, Number(m[4])))
    };
  }
  return null;
}

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function toHex({ r, g, b }) {
  const p = (n) => ('0' + clamp255(n).toString(16)).slice(-2);
  return '#' + p(r) + p(g) + p(b);
}

/* t 是 b 的占比：t=0 得到 a，t=1 得到 b。sRGB 通道直接混合，和旧版算法一致。 */
export function mixColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t
  });
}

export function relativeLuminance(value) {
  const c = parseColor(value);
  if (!c) return null;
  const channel = (n) => {
    const v = n / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  if (a == null || b == null) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/* 把半透明前景叠到不透明背景上，用于算遮罩、半透明状态色的实际对比度。
   contrastRatio 只看 RGB，不做合成，所以遮罩场景必须先过一遍这个函数。 */
export function compositeOver(fg, bg) {
  const cf = parseColor(fg);
  const cb = parseColor(bg);
  if (!cf || !cb) return fg;
  const alpha = cf.a;
  return toHex({
    r: cf.r * alpha + cb.r * (1 - alpha),
    g: cf.g * alpha + cb.g * (1 - alpha),
    b: cf.b * alpha + cb.b * (1 - alpha)
  });
}

/* 填充色上的文字：白纸色和近黑色里挑对比度高的那个；两个都不达标也取高的。 */
export function pickOnColor(fill) {
  const candidates = ['#fbfaf5', '#14181c'];
  let best = candidates[0];
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, fill) || 0;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/* 把颜色朝底色相反的方向（浅底往黑、深底往白）逐档混合，返回第一档满足目标对比度的值。
   这样派生出来的语法色保留主题色相，只在必要范围内加深/提亮，不会整套变成纯黑或纯白。 */
export function ensureContrast(color, bg, min) {
  const direct = contrastRatio(color, bg);
  if (direct != null && direct >= min) return color;
  const toward = (relativeLuminance(bg) || 0) < 0.5 ? '#ffffff' : '#000000';
  for (let step = 1; step <= 32; step += 1) {
    const candidate = mixColor(color, toward, step / 32);
    const ratio = contrastRatio(candidate, bg);
    if (ratio != null && ratio >= min) return candidate;
  }
  return toward;
}

/* 同一文字色要同时满足多个底色（节点底、注释底、文字底）时用这个，避免顾此失彼。 */
export function ensureContrastAll(color, backgrounds, min) {
  const passes = (value) => backgrounds.every((bg) => {
    const ratio = contrastRatio(value, bg);
    return ratio != null && ratio >= min;
  });
  if (passes(color)) return color;
  for (const toward of ['#000000', '#ffffff']) {
    for (let step = 1; step <= 32; step += 1) {
      const candidate = mixColor(color, toward, step / 32);
      if (passes(candidate)) return candidate;
    }
  }
  return color;
}

/* ---------------- 主题解析 ---------------- */

const SOFT_MIX = { light: 0.9, dark: 0.86 };
/* 强调分隔线要满足非文字对比度 3:1（输入框描边、选中态边界），所以往正文色压得比
   普通分隔线重。太浅的线在纸感主题里好看，但表单边界会看不清。 */
const LINE_STRONG_MIX = { light: 0.46, dark: 0.48 };
/* muted-2 的压暗比例，decor 从这里再往底色退，保证装饰永远比次要文字淡。 */
const MUTED2_MIX = 0.22;
const DECOR_FADE = 0.45;

export function resolveMode(theme, mode) {
  const variant = (theme && theme.modes && theme.modes[mode]) || {};
  const seeds = { ...DEFAULT_SEEDS[mode], ...(variant.seeds || {}) };
  const dark = mode === 'dark';
  const softMix = SOFT_MIX[mode];
  const accentFill = seeds.accentFill || seeds.accent;
  const onAccent = seeds.onAccent || pickOnColor(accentFill);
  /* 辅助强调色：没有显式主色时，由主色与信息色混出来，保证和主题调性一致，
     而不是硬编码一个蓝紫色。 */
  const accent2 = seeds.accent2 || mixColor(seeds.accent, seeds.info, 0.45);
  const lineStrong = mixColor(seeds.line, seeds.ink, LINE_STRONG_MIX[mode]);
  const warnSoft = mixColor(seeds.warn, seeds.bg, softMix);
  const bgDeep = dark ? mixColor(seeds.bg, '#000000', 0.22) : mixColor(seeds.bg, seeds.ink, 0.07);
  const surface2 = mixColor(seeds.surface, seeds.bg, 0.55);
  const surface3 = mixColor(seeds.surface, seeds.bg, 0.3);
  const muted2 = mixColor(seeds.muted, seeds.ink, MUTED2_MIX);
  /* 装饰色：从 muted-2 再向底色退 45%，然后保证在所有常见底色上 ≥3:1。
     先退再兜底，是为了让它稳定地比 muted-2 淡；兜底只在个别主题上抬回下限。 */
  const decor = ensureContrastAll(
    mixColor(muted2, seeds.bg, DECOR_FADE),
    [seeds.bg, seeds.surface, surface2, surface3, bgDeep],
    DECOR_MIN
  );

  /* 代码语法色：从主题既有色相出发，只在达不到对比度时向黑/白方向收窄。
     注释按 3:1（弱化文字），分隔线按 3:1（非文字）。 */
  const codeBg = seeds.codeBg;
  const codeText = ensureContrast(seeds.ink, codeBg, 4.5);
  const codeKeyword = ensureContrast(accent2, codeBg, 4.5);
  const codeString = ensureContrast(seeds.success, codeBg, 4.5);
  const codeComment = ensureContrast(seeds.muted, codeBg, 3);
  const codeNumber = ensureContrast(seeds.warn, codeBg, 4.5);
  const codeFunction = ensureContrast(seeds.accent, codeBg, 4.5);
  const codeLine = ensureContrast(lineStrong, codeBg, 3);

  /* mermaid：节点底、注释底都从主题底色派生；文字色要同时对三种底色达标，
     避免暗色主题出现「浅底浅字」。 */
  const mermaidNodeFill = mixColor(seeds.surface, seeds.bg, dark ? 0.2 : 0.25);
  const mermaidNoteFill = warnSoft;
  const mermaidLabelBg = seeds.surface;
  const mermaidLabel = ensureContrastAll(
    seeds.ink,
    [mermaidNodeFill, mermaidNoteFill, mermaidLabelBg],
    4.5
  );
  const mermaidNodeStroke = ensureContrast(lineStrong, mermaidNodeFill, 3);
  const mermaidLine = ensureContrastAll(lineStrong, [seeds.bg, seeds.surface], 3);

  const tokens = {
    '--lc-color-bg': seeds.bg,
    '--lc-color-bg-deep': bgDeep,
    '--lc-color-surface': seeds.surface,
    '--lc-color-surface-2': surface2,
    '--lc-color-surface-3': surface3,
    '--lc-color-ink': seeds.ink,
    '--lc-color-ink-2': mixColor(seeds.ink, seeds.bg, 0.16),
    '--lc-color-muted': seeds.muted,
    '--lc-color-muted-2': muted2,
    '--lc-color-decor': decor,
    '--lc-color-placeholder': muted2,
    '--lc-color-disabled-bg': mixColor(seeds.surface, seeds.bg, dark ? 0.45 : 0.7),
    '--lc-color-disabled-ink': mixColor(seeds.ink, seeds.bg, dark ? 0.55 : 0.42),
    '--lc-color-line': seeds.line,
    '--lc-color-line-strong': lineStrong,
    '--lc-color-accent': seeds.accent,
    '--lc-color-accent-fill': accentFill,
    /* 悬停变亮/变暗：亮色主题往黑混（按下去更实），暗色主题往白混（按下去更亮）。
       用变量而不是 filter: brightness()，这样对比度能被脚本按实际值算出来。 */
    '--lc-color-accent-fill-hover': mixColor(accentFill, dark ? '#ffffff' : '#000000', 0.1),
    '--lc-color-accent-fill-pressed': mixColor(accentFill, dark ? '#ffffff' : '#000000', 0.18),
    '--lc-color-on-accent': onAccent,
    '--lc-color-accent-soft': mixColor(seeds.accent, seeds.bg, softMix),
    '--lc-color-accent-line': mixColor(seeds.accent, seeds.line, 0.5),
    '--lc-color-accent-2': accent2,
    '--lc-color-accent-2-soft': mixColor(accent2, seeds.bg, softMix),
    '--lc-color-accent-2-line': mixColor(accent2, seeds.line, 0.5),
    '--lc-color-code-bg': codeBg,
    '--lc-color-code-text': codeText,
    '--lc-color-code-keyword': codeKeyword,
    '--lc-color-code-string': codeString,
    '--lc-color-code-comment': codeComment,
    '--lc-color-code-number': codeNumber,
    '--lc-color-code-function': codeFunction,
    '--lc-color-code-line': codeLine,
    '--lc-color-focus': seeds.accent,
    /* 遮罩上的焦点环：亮色主题用纯黑、暗色主题用纯白，保证在任何遮罩浓度上都能撕开边界。 */
    '--lc-color-focus-overlay': dark ? '#ffffff' : '#000000',
    '--lc-color-success': seeds.success,
    '--lc-color-success-soft': mixColor(seeds.success, seeds.bg, softMix),
    '--lc-color-success-line': mixColor(seeds.success, seeds.line, 0.5),
    '--lc-color-warn': seeds.warn,
    '--lc-color-warn-soft': warnSoft,
    '--lc-color-warn-line': mixColor(seeds.warn, seeds.line, 0.5),
    '--lc-color-danger': seeds.danger,
    '--lc-color-danger-soft': mixColor(seeds.danger, seeds.bg, softMix),
    '--lc-color-danger-line': mixColor(seeds.danger, seeds.line, 0.5),
    '--lc-color-info': seeds.info,
    '--lc-color-info-soft': mixColor(seeds.info, seeds.bg, softMix),
    '--lc-color-info-line': mixColor(seeds.info, seeds.line, 0.5),
    '--lc-color-selection-bg': mixColor(seeds.accent, seeds.bg, softMix),
    '--lc-color-selection-ink': seeds.ink,
    '--lc-color-overlay': dark ? 'rgba(2, 4, 6, 0.68)' : 'rgba(20, 24, 28, 0.44)',
    '--lc-mermaid-node-fill': mermaidNodeFill,
    '--lc-mermaid-node-stroke': mermaidNodeStroke,
    '--lc-mermaid-line': mermaidLine,
    '--lc-mermaid-label': mermaidLabel,
    '--lc-mermaid-note-fill': mermaidNoteFill,
    '--lc-mermaid-label-bg': mermaidLabelBg,
    /* 兼容别名也进解析结果，这样基础层、每套主题块、运行时挂载三处都会输出。 */
    ...COLOR_ALIASES
  };

  const shared = (theme && theme.shared && theme.shared.tokens) || {};
  const overrides = (variant.overrides || {});

  return { ...tokens, ...shared, ...overrides, ...BASE_SHADOW[mode] };
}

export function resolveTheme(theme) {
  return {
    id: theme.id,
    name: theme.name,
    light: resolveMode(theme, 'light'),
    dark: resolveMode(theme, 'dark')
  };
}

/* 运行时把一套主题挂到 documentElement 上的写法（供编辑器调用）：
   const vars = resolveTheme(theme); Object.entries(vars[mode]).forEach(...)
   本文件不碰 DOM，只给数据。 */
export function themeVariables(theme, mode) {
  return resolveTheme(theme)[mode];
}

/* ---------------- 导出为 CSS（纯函数，不依赖浏览器） ----------------
 * 导出管线（Node / CI / 静态站生成器）直接调用这三个函数就能拿到可直接内联的 CSS：
 *
 *   themeCssRule(theme, mode, selector)   单个选择器 + 一套变量
 *   themeCssBlock(theme)                  默认 :root（亮色）+ [data-lc-theme][data-lc-mode="dark"]
 *   themeStyleSheet(themes)               批量拼接（每套主题一组，选择器各自带 id）
 *
 * 值会先过 safeCssValue：导入的 JSON 里如果混进 `;`、`{`、`}` 或换行，整条声明会被丢弃，
 * 避免覆盖值把样式表结构撑破。返回的都是字符串，不读写文件、不碰 DOM。
 */

const CSS_UNSAFE = /[;{}\r\n]/;

export function safeCssValue(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || CSS_UNSAFE.test(text)) return null;
  return text;
}

function cssDeclarations(map, indent) {
  return Object.keys(map).map((key) => {
    const safe = safeCssValue(map[key]);
    return safe == null ? null : `${indent}${key}: ${safe};`;
  }).filter(Boolean).join('\n');
}

/* themesCss() 只输出主题自己的覆盖；导出接口默认输出全部解析结果（颜色 + 阴影 +
   共享/覆盖），这样一份文件就能自带完整的一套主题。 */
function themeOwnTokens(theme, mode, resolved) {
  const shared = (theme && theme.shared && theme.shared.tokens) || {};
  const overrides = (theme && theme.modes && theme.modes[mode] && theme.modes[mode].overrides) || {};
  const map = {};
  for (const key of Object.keys(resolved)) {
    if (/^--lc-color-/.test(key) || /^--lc-mermaid-/.test(key) || COLOR_ALIASES[key] != null || shared[key] != null || overrides[key] != null) {
      map[key] = resolved[key];
    }
  }
  return map;
}

export function themeCssRule(theme, mode, selector, options = {}) {
  if (!selector) throw new TypeError('themeCssRule 需要 selector');
  const resolved = resolveMode(theme, mode);
  const map = options.onlyThemeTokens ? themeOwnTokens(theme, mode, resolved) : resolved;
  const body = cssDeclarations(map, options.indent || '  ');
  const comment = options.comment ? `/* ${options.comment} */\n` : '';
  return `${comment}${selector} {\n${body}\n}`;
}

export function themeCssBlock(theme, options = {}) {
  if (!theme || typeof theme !== 'object' || !theme.id) {
    throw new TypeError('themeCssBlock 需要带 id 的主题对象');
  }
  const lightSelector = options.lightSelector || ':root';
  const darkSelector = options.darkSelector ||
    `[data-lc-theme="${theme.id}"][data-lc-mode="dark"]`;
  return [
    `/* ${theme.name || theme.id} · ${theme.id}（schema v${theme.schemaVersion || THEME_SCHEMA_VERSION}） */`,
    themeCssRule(theme, 'light', lightSelector, options),
    '',
    themeCssRule(theme, 'dark', darkSelector, options),
    ''
  ].join('\n');
}

export function themeStyleSheet(themes, options = {}) {
  if (!Array.isArray(themes)) throw new TypeError('themeStyleSheet 需要主题数组');
  return themes.map((theme) => themeCssBlock(theme, options)).join('\n');
}

/* 按主题 id 列表生成 CSS：导出站只带「默认主题 + 允许切换的那几套」。
 *
 * 与 themeStyleSheet 的区别：
 *   - 亮色选择器都带主题 id，只有默认主题额外挂 :root，避免后写的 :root 覆盖前面的；
 *   - 默认只输出主题自己的令牌（颜色、别名、覆盖），基础静态令牌由 lc-tokens.css 出一份，
 *     不再给每套主题重复字体 / 间距 / 阴影（每套约省 507 字节）；
 *   - 未知 id 直接抛错，不静默少带一套或静默回落。
 *
 * options：
 *   defaultThemeId  默认主题 id（默认取 ids[0]），必须出现在 ids 里
 *   includeRoot     默认 true；false 时不输出 :root 兜底（页面自己保证 html 带属性）
 *   onlyThemeTokens 默认 true；false 时每套输出完整解析结果
 *   modes           默认 ['light', 'dark']
 *   comment         表头注释；传空字符串可去掉
 */
export function themeCssForIds(themes, ids, options = {}) {
  if (!Array.isArray(themes)) throw new TypeError('themeCssForIds 需要主题数组');
  if (!Array.isArray(ids) || ids.length === 0) throw new TypeError('themeCssForIds 需要非空的主题 id 列表');
  const normalized = [];
  for (const id of ids) {
    const text = String(id == null ? '' : id).trim();
    if (!text) throw new TypeError('themeCssForIds 的 id 不能为空');
    if (!normalized.includes(text)) normalized.push(text);
  }
  const byId = new Map(themes.filter((theme) => theme && theme.id).map((theme) => [theme.id, theme]));
  const missing = normalized.filter((id) => !byId.has(id));
  if (missing.length) throw new TypeError(`themeCssForIds 找不到主题：${missing.join('、')}`);
  const defaultThemeId = String(options.defaultThemeId || normalized[0]);
  if (!normalized.includes(defaultThemeId)) {
    throw new TypeError(`默认主题 ${defaultThemeId} 不在 id 列表里`);
  }
  const modes = Array.isArray(options.modes) && options.modes.length ? options.modes : ['light', 'dark'];
  const onlyThemeTokens = options.onlyThemeTokens !== false;
  const includeRoot = options.includeRoot !== false;
  const header = options.comment === undefined
    ? `/* 导出主题包 · ${normalized.length} 套（默认 ${defaultThemeId}）· 由 src/theme/runtime.mjs 生成，不要手改 */`
    : options.comment;
  const esc = (id) => String(id).replace(/"/g, '\\"');
  const parts = [];
  if (header) parts.push(header);
  for (const id of [defaultThemeId, ...normalized.filter((item) => item !== defaultThemeId)]) {
    const theme = byId.get(id);
    const isDefault = id === defaultThemeId;
    for (const mode of modes) {
      const selector = isDefault
        ? mode === 'light'
          ? (includeRoot ? `:root, [data-lc-theme="${esc(id)}"][data-lc-mode="light"]` : `[data-lc-theme="${esc(id)}"][data-lc-mode="light"]`)
          : `[data-lc-theme="${esc(id)}"][data-lc-mode="dark"]${includeRoot ? ', :root[data-lc-mode="dark"]' : ''}`
        : `[data-lc-theme="${esc(id)}"][data-lc-mode="${mode}"]`;
      parts.push(themeCssRule(theme, mode, selector, {
        onlyThemeTokens,
        comment: `${theme.name || id} · ${id} · ${mode}`
      }));
      parts.push('');
    }
  }
  return parts.join('\n') + '\n';
}

/* ---------------- 版本迁移 ----------------
 * 导入时先迁移再校验：旧版本文件不因为 schemaVersion 不同直接失败。
 * 返回 { ok, theme, version, notes, errors }，theme 是补全后的 v3 结构。
 */
function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

export function migrateThemeData(raw) {
  const errors = [];
  const notes = [];
  const fail = () => ({ ok: false, theme: null, version: null, notes, errors });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('根节点必须是一个 JSON 对象');
    return fail();
  }

  const theme = clonePlain(raw);
  if (!theme) {
    errors.push('主题数据不是可序列化的 JSON');
    return fail();
  }

  let version = theme.schemaVersion;
  if (version == null) {
    version = 1;
    notes.push('缺少 schemaVersion，按 v1 兼容读取');
  } else if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) {
    errors.push(`schemaVersion 必须是正整数，实际是 ${JSON.stringify(theme.schemaVersion)}`);
    return fail();
  }

  if (version > THEME_SCHEMA_VERSION) {
    notes.push(`文件版本 v${version} 高于当前 v${THEME_SCHEMA_VERSION}，已按已知字段尽力读取`);
  }

  if (version < THEME_SCHEMA_VERSION) {
    /* v1 历史写法：light / dark 直接挂在根节点，或包在 colors 下。 */
    if (!theme.modes) {
      const legacy = theme.light || theme.dark ? theme : (theme.colors || {});
      if (legacy.light || legacy.dark) {
        theme.modes = {
          light: legacy.light || { seeds: {} },
          dark: legacy.dark || { seeds: {} }
        };
        notes.push('已把根节点的 light / dark 迁移到 modes');
      }
    }
    if (typeof theme.tone !== 'string' || !TONES.includes(theme.tone)) {
      theme.tone = 'neutral';
      notes.push('tone 缺失或不在枚举内，已按 neutral 处理');
    }
    if (typeof theme.description !== 'string' || !theme.description.trim()) {
      theme.description = theme.name ? `${theme.name}（导入时未提供描述）` : '导入的主题';
      notes.push('description 缺失，已补占位说明');
    }
    if (theme.modes && typeof theme.modes === 'object') {
      for (const mode of ['light', 'dark']) {
        if (theme.modes[mode] && typeof theme.modes[mode] === 'object' && !theme.modes[mode].overrides) {
          theme.modes[mode].overrides = {};
        }
      }
    }
    delete theme.light;
    delete theme.dark;
    delete theme.colors;
    notes.push(`已从 v${version} 升级到 v${THEME_SCHEMA_VERSION}`);
  }

  theme.schemaVersion = THEME_SCHEMA_VERSION;
  return { ok: true, theme, version, notes, errors };
}

/* ---------------- 导入校验 ----------------
 * 编辑器的「导入」和 check.mjs 用同一套规则：
 *   - 字段完整性、主色是否存在且是合法实色；
 *   - 解析后的对比度够不够。
 * 返回具体问题列表，调用方可以选择「带问题加载」而不是拒绝文件。
 */

const MODE_LABELS = { light: '亮色', dark: '暗色' };

function pairReport(resolved, pairs, kind) {
  return pairs.map(([fg, bg, min]) => {
    const ratio = contrastRatio(resolved[fg], resolved[bg]);
    return {
      kind,
      fg,
      bg,
      min,
      ratio,
      pass: ratio != null && ratio >= min,
      deficit: ratio == null ? null : Math.max(0, min - ratio),
      fgLabel: COLOR_TOKEN_LABELS[fg] || fg,
      bgLabel: COLOR_TOKEN_LABELS[bg] || bg
    };
  });
}

function overlayReport(resolved) {
  return OVERLAY_PAIRS.map(([fg, overlay, base, min]) => {
    const composited = compositeOver(resolved[overlay], resolved[base]);
    const ratio = contrastRatio(resolved[fg], composited);
    return {
      kind: 'overlay',
      fg,
      bg: `${overlay} → ${base}`,
      min,
      ratio,
      pass: ratio != null && ratio >= min,
      deficit: ratio == null ? null : Math.max(0, min - ratio),
      fgLabel: COLOR_TOKEN_LABELS[fg] || fg,
      bgLabel: `${COLOR_TOKEN_LABELS[base] || base}上的遮罩`
    };
  });
}

function seedsComplete(seeds) {
  if (!seeds || typeof seeds !== 'object') return false;
  for (const key of REQUIRED_SEEDS) {
    const parsed = parseColor(seeds[key]);
    if (!parsed || parsed.a !== 1) return false;
  }
  return true;
}

export function validateThemeData(raw) {
  const errors = [];
  const warnings = [];
  const contrast = { light: [], dark: [] };

  /* 先迁移再校验：v1/v2 文件不会被版本号直接判死。 */
  const migration = migrateThemeData(raw);
  errors.push(...migration.errors);
  warnings.push(...migration.notes);
  if (!migration.theme) {
    return {
      ok: false, id: null, name: null, errors, warnings, contrast,
      version: migration.version, migrated: false
    };
  }
  const theme = migration.theme;
  const migrated = migration.version !== THEME_SCHEMA_VERSION;

  if (typeof theme.id !== 'string' || !THEME_ID_PATTERN.test(theme.id)) {
    errors.push(`id 必须是 2–32 位小写字母/数字/连字符，实际是 ${JSON.stringify(theme.id)}`);
  }
  if (typeof theme.name !== 'string' || !theme.name.trim()) errors.push('name 不能为空');
  if (typeof theme.description !== 'string' || !theme.description.trim()) errors.push('description 不能为空');
  if (!TONES.includes(theme.tone)) {
    errors.push(`tone 必须是 ${TONES.join(' / ')} 之一，实际是 ${JSON.stringify(theme.tone)}`);
  }

  if (!theme.modes || typeof theme.modes !== 'object' || Array.isArray(theme.modes)) {
    errors.push('缺少 modes 对象');
  }

  for (const mode of ['light', 'dark']) {
    const variant = theme.modes && theme.modes[mode];
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      errors.push(`缺少 modes.${mode}`);
      continue;
    }
    if (!variant.seeds || typeof variant.seeds !== 'object' || Array.isArray(variant.seeds)) {
      errors.push(`modes.${mode}.seeds 必须是对象`);
      continue;
    }

    const seeds = variant.seeds;
    for (const key of REQUIRED_SEEDS) {
      if (seeds[key] == null) {
        errors.push(`${MODE_LABELS[mode]}缺少主色 ${key}（${SEED_LABELS[key] || key}）`);
        continue;
      }
      const parsed = parseColor(seeds[key]);
      if (!parsed) errors.push(`${MODE_LABELS[mode]}主色 ${key} 的值 ${JSON.stringify(seeds[key])} 不是合法颜色`);
      else if (parsed.a !== 1) errors.push(`${MODE_LABELS[mode]}主色 ${key} 必须是实色，不能带透明度`);
    }
    for (const key of ['accentFill', 'onAccent', 'accent2']) {
      if (seeds[key] == null) continue;
      const parsed = parseColor(seeds[key]);
      if (!parsed || parsed.a !== 1) {
        errors.push(`${MODE_LABELS[mode]}可选色 ${key} 的值 ${JSON.stringify(seeds[key])} 不是合法实色`);
      }
    }

    if (variant.overrides != null && typeof variant.overrides !== 'object') {
      errors.push(`modes.${mode}.overrides 必须是对象`);
    }
    for (const [key, value] of Object.entries(variant.overrides || {})) {
      if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${MODE_LABELS[mode]}覆盖项 ${key} 值为空`);
      } else if (!/^--lc-[a-z0-9-]+$/.test(key)) {
        warnings.push(`${MODE_LABELS[mode]}覆盖项 ${key} 不像一个 --lc- 变量名，可能是拼错了`);
      }
    }

    if (!seedsComplete(seeds)) continue;

    const resolved = resolveMode(theme, mode);
    const items = [
      ...pairReport(resolved, TEXT_PAIRS, 'text'),
      ...pairReport(resolved, WEAK_PAIRS, 'weak'),
      ...pairReport(resolved, UI_PAIRS, 'ui'),
      ...pairReport(resolved, DISABLED_PAIRS, 'disabled'),
      ...pairReport(resolved, DECOR_PAIRS, 'decor'),
      ...pairReport(resolved, CODE_PAIRS, 'code'),
      ...pairReport(resolved, CODE_COMMENT_PAIRS, 'code-comment'),
      ...pairReport(resolved, CODE_LINE_PAIRS, 'code-line'),
      ...pairReport(resolved, MERMAID_PAIRS, 'mermaid'),
      ...overlayReport(resolved)
    ];
    contrast[mode] = items;

    for (const item of items) {
      if (item.pass) continue;
      const ratioText = item.ratio == null ? '无法计算' : `${item.ratio.toFixed(2)}:1`;
      const deficitText = item.deficit == null ? '' : `，差 ${item.deficit.toFixed(2)}`;
      errors.push(
        `${MODE_LABELS[mode]}对比度不足：${item.fgLabel}（${item.fg}）在 ${item.bgLabel}（${item.bg}）上 ` +
        `${ratioText}，要求 ≥ ${item.min}:1${deficitText}`
      );
    }
  }

  return {
    ok: errors.length === 0,
    id: typeof theme.id === 'string' ? theme.id : null,
    name: typeof theme.name === 'string' ? theme.name : null,
    errors,
    warnings,
    contrast,
    version: migration.version,
    migrated
  };
}
