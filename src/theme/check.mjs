#!/usr/bin/env node
/* 主题包自检。
 *
 *   node src/theme/check.mjs
 *   node src/theme/check.mjs --json
 *
 * 检查五件事：
 *   1. 字段完整性（schemaVersion / id / name / tone / modes）
 *   2. 必填主色有没有缺、值是不是合法十六进制
 *   3. 解析后的令牌表有没有缺项、有没有写错名字
 *   4. 对比度：正文 4.5:1；次要/占位/禁用文字单独复核；焦点环含遮罩场景按 3:1
 *   5. 图标集完整性、断点令牌与 lc-responsive.css 媒体查询是否一致
 *
 * 只用 Node 原生能力，不引依赖。退出码 0 = 全部通过，1 = 有硬错误。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  THEME_SCHEMA,
  THEME_SCHEMA_VERSION,
  BASE_STATIC,
  BASE_SHADOW,
  PRINT_TOKENS,
  CODE_COMMENT_PAIRS,
  CODE_LINE_PAIRS,
  CODE_PAIRS,
  COLOR_ALIASES,
  COLOR_TOKEN_NAMES,
  MERMAID_PAIRS,
  RADIUS_SCALE,
  REQUIRED_SEEDS,
  SEED_LABELS,
  TEXT_PAIRS,
  UI_PAIRS,
  WEAK_PAIRS,
  DISABLED_PAIRS,
  DECOR_MIN,
  DECOR_PAIRS,
  OVERLAY_PAIRS,
  BREAKPOINTS,
  BREAKPOINT_TOKENS,
  baseCss,
  parseColor,
  resolveMode,
  contrastRatio,
  compositeOver,
  migrateThemeData,
  validateThemeData,
  themeCssBlock,
  themeCssForIds,
  themeCssRule,
  themeStyleSheet
} from './tokens.mjs';
import { TEMPLATE_PRESETS } from './presets.mjs';
import {
  ICON_SET,
  ICON_GROUPS,
  REQUIRED_ICON_IDS,
  ICON_SIZE
} from './icons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const themeDir = join(here, 'themes');
const KNOWN_TOKENS = new Set([
  ...COLOR_TOKEN_NAMES,
  ...Object.keys(COLOR_ALIASES),
  ...Object.keys(BASE_STATIC),
  ...Object.keys(BASE_SHADOW.light),
  // 旧变量名允许出现在 overrides 里（兼容手工迁移的主题），但不推荐。
  '--bg', '--surface', '--ink', '--accent', '--radius', '--sans', '--serif', '--mono'
]);
const TONES = new Set(['paper', 'cool', 'warm', 'neutral', 'high-contrast', 'blueprint']);
const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const themes = loadThemes();
const results = themes.map((theme) => checkTheme(theme));

// 不同文件用了同一个 id，导入后只会剩下一套主题，必须当错误报出来。
const idCounts = new Map();
for (const item of results) {
  if (item.id === '—') continue;
  idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
}
for (const item of results) {
  if (idCounts.get(item.id) > 1) item.errors.push(`主题 id ${item.id} 与其他文件重复`);
}

const failed = results.filter((item) => item.errors.length > 0);
const iconReport = checkIcons();
const breakpointReport = checkBreakpoints();
const artifactReport = checkArtifacts();
const loadedThemes = themes
  .map((entry) => migrateThemeData(entry.data || {}).theme)
  .filter(Boolean);
const presetReport = checkPresets(new Set(results.map((item) => item.id)));
const schemaReport = checkSchemaCompat(loadedThemes);
const exportReport = checkExports(loadedThemes);
const tokenReport = checkTokens();
const fallbackReport = checkFallbacks();
const onDemandReport = checkOnDemand();
const ok = failed.length === 0
  && iconReport.errors.length === 0
  && breakpointReport.errors.length === 0
  && artifactReport.errors.length === 0
  && presetReport.errors.length === 0
  && schemaReport.errors.length === 0
  && exportReport.errors.length === 0
  && tokenReport.errors.length === 0
  && fallbackReport.errors.length === 0
  && onDemandReport.errors.length === 0;

if (asJson) {
  process.stdout.write(JSON.stringify({
    ok,
    themes: results.map((item) => ({
      file: item.file,
      id: item.id,
      name: item.name,
      ok: item.errors.length === 0,
      errors: item.errors,
      warnings: item.warnings,
      modes: item.modes
    })),
    icons: {
      count: iconReport.count,
      ok: iconReport.errors.length === 0,
      errors: iconReport.errors
    },
    breakpoints: {
      values: breakpointReport.values,
      ok: breakpointReport.errors.length === 0,
      errors: breakpointReport.errors
    },
    artifacts: {
      files: artifactReport.files,
      ok: artifactReport.errors.length === 0,
      errors: artifactReport.errors
    },
    presets: {
      count: presetReport.count,
      ok: presetReport.errors.length === 0,
      errors: presetReport.errors
    },
    schema: {
      version: THEME_SCHEMA_VERSION,
      ok: schemaReport.errors.length === 0,
      errors: schemaReport.errors
    },
    exports: {
      themes: exportReport.blocks,
      ok: exportReport.errors.length === 0,
      errors: exportReport.errors
    },
    tokens: {
      static: tokenReport.static,
      print: tokenReport.print,
      aliases: tokenReport.aliases,
      ok: tokenReport.errors.length === 0,
      errors: tokenReport.errors
    },
    fallbacks: {
      checked: fallbackReport.checked,
      ok: fallbackReport.errors.length === 0,
      errors: fallbackReport.errors
    },
    onDemand: {
      selected: onDemandReport.selected,
      cssBytes: onDemandReport.cssBytes,
      cssGzipBytes: onDemandReport.cssGzipBytes,
      manifest: onDemandReport.manifest,
      boot: onDemandReport.boot,
      ok: onDemandReport.errors.length === 0,
      errors: onDemandReport.errors
    }
  }, null, 2) + '\n');
} else {
  printHuman(results, iconReport, breakpointReport, artifactReport, presetReport, schemaReport, exportReport, tokenReport, fallbackReport, onDemandReport);
}

process.exit(ok ? 0 : 1);

/* ------------------------------------------------------------------ */

function loadThemes() {
  let files = [];
  try {
    files = readdirSync(themeDir).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    console.error(`读不到主题目录：${themeDir}`);
    console.error(error.message);
    process.exit(1);
  }
  return files.map((file) => {
    const full = join(themeDir, file);
    let data = null;
    let parseError = null;
    try {
      data = JSON.parse(readFileSync(full, 'utf8'));
    } catch (error) {
      parseError = error.message;
    }
    return { file, data, parseError };
  });
}

function checkTheme(entry) {
  const errors = [];
  const warnings = [];
  const modes = { light: [], dark: [] };

  if (entry.parseError) {
    errors.push(`JSON 解析失败：${entry.parseError}`);
    return { file: entry.file, id: '—', name: '—', errors, warnings, modes };
  }

  const migration = migrateThemeData(entry.data || {});
  if (!migration.ok) {
    errors.push(...migration.errors);
    return { file: entry.file, id: '—', name: '—', errors, warnings, modes };
  }
  const theme = migration.theme;
  for (const note of migration.notes) warnings.push(note);
  if (migration.version > THEME_SCHEMA_VERSION) {
    warnings.push(`文件版本 v${migration.version} 高于当前 v${THEME_SCHEMA_VERSION}`);
  }
  if (typeof theme.id !== 'string' || !ID_PATTERN.test(theme.id)) {
    errors.push(`id 必须是 2–32 位小写字母/数字/连字符，实际是 ${JSON.stringify(theme.id)}`);
  }
  if (theme.id && entry.file !== theme.id + '.json') {
    warnings.push(`文件名 ${entry.file} 与 id ${theme.id} 不一致，导入时容易找不到`);
  }
  if (typeof theme.name !== 'string' || !theme.name.trim()) errors.push('name 不能为空');
  if (typeof theme.description !== 'string' || !theme.description.trim()) errors.push('description 不能为空');
  if (!TONES.has(theme.tone)) {
    errors.push(`tone 必须是 ${[...TONES].join(' / ')} 之一，实际是 ${JSON.stringify(theme.tone)}`);
  }

  if (!theme.modes || typeof theme.modes !== 'object') {
    errors.push('缺少 modes 对象');
  }

  for (const mode of ['light', 'dark']) {
    const variant = theme.modes && theme.modes[mode];
    if (!variant || typeof variant !== 'object') {
      errors.push(`缺少 modes.${mode}`);
      continue;
    }

    const seeds = variant.seeds || {};
    if (!variant.seeds || typeof variant.seeds !== 'object') {
      errors.push(`modes.${mode}.seeds 必须是对象`);
    }

    for (const key of REQUIRED_SEEDS) {
      if (seeds[key] == null) {
        errors.push(`缺少主色 ${key}（${SEED_LABELS[key] || key}）`);
        continue;
      }
      const parsed = parseColor(seeds[key]);
      if (!parsed) {
        errors.push(`主色 ${key} 的值 ${JSON.stringify(seeds[key])} 不是合法颜色（主题包只收 #rgb / #rrggbb）`);
      } else if (parsed.a !== 1) {
        errors.push(`主色 ${key} 必须是实色，不能带透明度`);
      }
    }
    for (const key of ['accentFill', 'onAccent', 'accent2']) {
      if (seeds[key] == null) continue;
      const parsed = parseColor(seeds[key]);
      if (!parsed || parsed.a !== 1) {
        errors.push(`主色 ${key} 的值 ${JSON.stringify(seeds[key])} 不是合法实色`);
      }
    }

    const overrides = variant.overrides || {};
    if (variant.overrides && typeof variant.overrides !== 'object') {
      errors.push(`modes.${mode}.overrides 必须是对象`);
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (!KNOWN_TOKENS.has(key)) {
        warnings.push(`${mode}.overrides 里的 ${key} 不在令牌表里，可能是拼错了`);
      }
      if (/^--lc-color-/.test(key) && key !== '--lc-color-overlay' && !COLOR_ALIASES[key]) {
        const parsed = parseColor(value);
        if (!parsed || parsed.a !== 1) errors.push(`${mode}.overrides 的 ${key} 不是合法实色`);
      }
      if (typeof value !== 'string' || !value.trim()) errors.push(`${mode}.overrides 的 ${key} 值为空`);
    }

    const resolved = resolveMode(theme, mode);

    // 令牌完整性：颜色令牌一个都不能少。
    for (const name of COLOR_TOKEN_NAMES) {
      if (resolved[name] == null) errors.push(`${mode} 解析后缺少令牌 ${name}`);
    }
    for (const name of Object.keys(BASE_STATIC)) {
      if (resolved[name] == null && !(theme.shared && theme.shared.tokens && theme.shared.tokens[name])) {
        // 静态令牌由基础层兜底，不在这里重复报错。
      }
    }
    for (const [name, value] of Object.entries(resolved)) {
      if (/^--lc-color-/.test(name) && name !== '--lc-color-overlay' && !COLOR_ALIASES[name] && !parseColor(value)) {
        errors.push(`${mode} 的 ${name} 解析结果不是合法颜色：${JSON.stringify(value)}`);
      }
    }

    // 兼容别名必须落在正式令牌上，不能自己存一份色值（否则暗色会退回写死浅色）。
    for (const [alias, target] of Object.entries(COLOR_ALIASES)) {
      const value = resolved[alias];
      if (value == null) {
        errors.push(`${mode} 解析后缺少兼容别名 ${alias}，组件里的历史引用会回退到写死值`);
      } else if (value !== target) {
        errors.push(`${mode} 的别名 ${alias} 应指向 ${target}，实际是 ${JSON.stringify(value)}`);
      }
    }

    // 对比度：正文按 AA 4.5:1；焦点环、输入框描边按非文字 3:1
    const runPairs = (pairs, kind) => pairs.map(([fg, bg, min]) => {
      const ratio = contrastRatio(resolved[fg], resolved[bg]);
      return { fg, bg, min, kind, ratio, pass: ratio != null && ratio >= min };
    });
    const textChecks = runPairs(TEXT_PAIRS, 'text');
    const uiChecks = runPairs(UI_PAIRS, 'ui');
    const weakChecks = runPairs(WEAK_PAIRS, 'weak');
    const disabledChecks = runPairs(DISABLED_PAIRS, 'disabled');
    const decorChecks = runPairs(DECOR_PAIRS, 'decor');
    const codeChecks = runPairs(CODE_PAIRS, 'code');
    const codeCommentChecks = runPairs(CODE_COMMENT_PAIRS, 'code-comment');
    const codeLineChecks = runPairs(CODE_LINE_PAIRS, 'code-line');
    const mermaidChecks = runPairs(MERMAID_PAIRS, 'mermaid');

    // 遮罩是半透明的，先合成到底色上再算焦点环对比度。
    const overlayChecks = OVERLAY_PAIRS.map(([fg, overlay, base, min]) => {
      const composited = compositeOver(resolved[overlay], resolved[base]);
      const ratio = contrastRatio(resolved[fg], composited);
      return { fg, bg: `${overlay} → ${base}`, min, ratio, pass: ratio != null && ratio >= min };
    });

    const failures = [
      ...textChecks, ...uiChecks, ...weakChecks, ...disabledChecks, ...decorChecks, ...overlayChecks,
      ...codeChecks, ...codeCommentChecks, ...codeLineChecks, ...mermaidChecks
    ].filter((item) => !item.pass);
    for (const item of failures) {
      const bgValue = item.bg.includes('→') ? item.bg : resolved[item.bg];
      const kindText = item.kind === 'code-comment'
        ? '（代码注释，已标注为 3:1 放宽项）'
        : item.kind === 'code-line'
          ? '（代码分隔线，非文字）'
          : item.kind === 'decor'
            ? '（装饰色，不承载信息，按 3:1 下限）'
            : item.kind === 'mermaid'
              ? '（流程图）'
              : '';
      errors.push(
        `${mode} 对比度不足：${item.fg}（${resolved[item.fg]}）在 ${item.bg}（${bgValue}）上 ` +
        `${item.ratio == null ? '无法计算' : item.ratio.toFixed(2) + ':1'}，要求 ≥ ${item.min}:1${kindText}`
      );
    }

    const minOf = (items) => {
      const ratios = items.filter((item) => item.ratio != null).map((item) => item.ratio);
      return ratios.length ? Math.min(...ratios) : null;
    };

    /* decor 不只要「声明了」，还要和 muted-2 拉开距离：否则换了令牌，视觉上和
       压暗的次要文字一模一样，加了等于没加。这里用 1.0 的对比度差作为「明显」门槛，
       并保留差值，方便在报告里核对。 */
    const decorValue = resolved['--lc-color-decor'];
    const decorOnBg = decorValue ? contrastRatio(decorValue, resolved['--lc-color-bg']) : null;
    const mutedOnBg = contrastRatio(resolved['--lc-color-muted-2'], resolved['--lc-color-bg']);
    const decorGap = decorOnBg != null && mutedOnBg != null ? mutedOnBg - decorOnBg : null;
    if (!decorValue) {
      errors.push(`${mode} 缺少 --lc-color-decor，渲染层会回退到压暗后的 muted-2`);
    } else if (decorGap != null && decorGap < 1) {
      errors.push(
        `${mode} 装饰色与 muted-2 区分不足：decor ${decorOnBg.toFixed(2)}:1 / ` +
        `muted-2 ${mutedOnBg.toFixed(2)}:1，只差 ${decorGap.toFixed(2)}，要求至少 1.00`
      );
    }

    modes[mode] = {
      textChecks: textChecks.length,
      textFailures: textChecks.filter((item) => !item.pass).length,
      textMin: minOf(textChecks),
      uiChecks: uiChecks.length,
      uiFailures: uiChecks.filter((item) => !item.pass).length,
      uiMin: minOf(uiChecks),
      weakChecks: weakChecks.length,
      weakFailures: weakChecks.filter((item) => !item.pass).length,
      weakMin: minOf(weakChecks),
      disabledChecks: disabledChecks.length,
      disabledFailures: disabledChecks.filter((item) => !item.pass).length,
      disabledMin: minOf(disabledChecks),
      decorChecks: decorChecks.length,
      decorFailures: decorChecks.filter((item) => !item.pass).length,
      decorMin: minOf(decorChecks),
      decorOnBg,
      mutedOnBg,
      decorGap,
      overlayChecks: overlayChecks.length,
      overlayFailures: overlayChecks.filter((item) => !item.pass).length,
      overlayMin: minOf(overlayChecks),
      codeChecks: codeChecks.length,
      codeFailures: codeChecks.filter((item) => !item.pass).length,
      codeMin: minOf(codeChecks),
      codeCommentChecks: codeCommentChecks.length,
      codeCommentFailures: codeCommentChecks.filter((item) => !item.pass).length,
      codeCommentMin: minOf(codeCommentChecks),
      codeLineChecks: codeLineChecks.length,
      codeLineFailures: codeLineChecks.filter((item) => !item.pass).length,
      codeLineMin: minOf(codeLineChecks),
      mermaidChecks: mermaidChecks.length,
      mermaidFailures: mermaidChecks.filter((item) => !item.pass).length,
      mermaidMin: minOf(mermaidChecks),
      tokens: Object.keys(resolved).length,
      label: failures.length ? '不达标' : '通过'
    };
  }

  // 共享令牌只在主题层写一次，值不能是颜色（否则会盖掉亮暗两套）。
  if (theme.shared != null) {
    if (typeof theme.shared !== 'object' || !theme.shared.tokens || typeof theme.shared.tokens !== 'object') {
      errors.push('shared 必须是 { tokens: { ... } } 结构');
    } else {
      for (const [key, value] of Object.entries(theme.shared.tokens)) {
        if (!KNOWN_TOKENS.has(key)) warnings.push(`shared.tokens 里的 ${key} 不在令牌表里，可能是拼错了`);
        if (/^--lc-color-/.test(key)) {
          errors.push(`shared.tokens 不能覆盖颜色令牌 ${key}，颜色请写进 modes.light / modes.dark`);
        }
        if (typeof value !== 'string' || !value.trim()) errors.push(`shared.tokens 的 ${key} 值为空`);
      }
    }
  }

  return {
    file: entry.file,
    id: theme.id || '—',
    name: theme.name || '—',
    errors,
    warnings,
    modes
  };
}

function checkIcons() {
  const errors = [];
  const seen = new Set();
  const idPattern = /^[a-z][a-z0-9-]*$/;

  for (const icon of ICON_SET) {
    if (!idPattern.test(icon.id)) errors.push(`图标 id ${JSON.stringify(icon.id)} 不符合小写连字符规则`);
    if (seen.has(icon.id)) errors.push(`图标 id ${icon.id} 重复`);
    seen.add(icon.id);
    if (!icon.label || !String(icon.label).trim()) errors.push(`图标 ${icon.id} 缺少中文名`);
    if (!Array.isArray(icon.shapes) || icon.shapes.length === 0) {
      errors.push(`图标 ${icon.id} 没有任何图形`);
      continue;
    }
    for (const shape of icon.shapes) {
      if (!Array.isArray(shape) || !['p', 'c', 'r'].includes(shape[0])) {
        errors.push(`图标 ${icon.id} 有无法识别的图形 ${JSON.stringify(shape)}`);
      }
    }
  }

  for (const id of REQUIRED_ICON_IDS) {
    if (!seen.has(id)) errors.push(`缺少任务要求的图标：${id}`);
  }

  // 分组漏图标不会报错，但预览页会漏展示，所以当提醒处理。
  const grouped = new Set(ICON_GROUPS.flatMap((group) => group.ids));
  for (const id of seen) {
    if (!grouped.has(id)) errors.push(`图标 ${id} 没有归入任何分组，预览页不会展示`);
  }
  for (const group of ICON_GROUPS) {
    for (const id of group.ids) {
      if (!seen.has(id)) errors.push(`分组「${group.label}」引用了不存在的图标 ${id}`);
    }
  }

  if (ICON_SIZE !== 24) errors.push(`图标网格应为 24×24，当前是 ${ICON_SIZE}`);

  return { count: ICON_SET.length, errors };
}

function checkBreakpoints() {
  const errors = [];
  const values = BREAKPOINTS.map((item) => item.px);

  for (const item of BREAKPOINTS) {
    const key = `--lc-bp-${item.name}`;
    if (!BREAKPOINT_TOKENS[key]) {
      errors.push(`断点 ${item.name} 没有对应的令牌 ${key}`);
    } else if (BREAKPOINT_TOKENS[key] !== `${item.px}px`) {
      errors.push(`令牌 ${key} 应为 ${item.px}px，实际是 ${BREAKPOINT_TOKENS[key]}`);
    }
  }
  for (const key of Object.keys(BREAKPOINT_TOKENS)) {
    if (!BREAKPOINTS.some((item) => `--lc-bp-${item.name}` === key)) {
      errors.push(`令牌 ${key} 没有对应的断点定义`);
    }
  }

  let css = '';
  try {
    css = readFileSync(join(here, '..', '..', 'assets', 'css', 'lc-responsive.css'), 'utf8');
  } catch {
    errors.push('读不到 assets/css/lc-responsive.css，无法核对断点数值');
    return { values, errors };
  }

  const cssValues = [...css.matchAll(/max-width:\s*(\d+)px/g)].map((match) => Number(match[1]));
  const unique = [...new Set(cssValues)].sort((a, b) => a - b);
  if (cssValues.length !== unique.length || unique.length !== values.length) {
    errors.push(`lc-responsive.css 的媒体查询断点数量应和令牌一致：期望 ${values.join('/')}，实际 ${cssValues.join('/')}`);
  }
  for (const px of values) {
    if (!cssValues.includes(px)) errors.push(`lc-responsive.css 缺少 ${px}px 断点，令牌和样式不同步`);
  }

  return { values: unique, errors };
}

function checkArtifacts() {
  const errors = [];
  const rootDir = join(here, '..', '..');
  const entries = [
    { file: join(here, 'lc-theme-runtime.js'), needles: ['LCThemeRuntime', 'validateThemeData', 'resolveMode', 'migrateThemeData', 'themeCssBlock'] },
    { file: join(here, 'editor.html'), needles: ['lc-theme-editor.css', 'editor-app.js', 'lc-theme-runtime.js', 'LC_BUILTIN_THEMES'] },
    { file: join(here, 'switcher-demo.html'), needles: ['lc-theme-switch.css', 'theme-switch.js', 'data-lc-theme-switch'] },
    { file: join(here, 'editor-app.js'), needles: ['data-save', 'validateThemeData', 'LC_BUILTIN_THEMES', '复制为基础', 'migrateThemeData'] },
    { file: join(here, 'theme-switch.js'), needles: ['LCThemeSwitch', 'prefers-color-scheme'] },
    { file: join(rootDir, 'assets', 'css', 'lc-theme-editor.css'), needles: ['.te-app', '.te-pane-body', '.te-checks'] },
    { file: join(rootDir, 'assets', 'css', 'lc-theme-switch.css'), needles: ['.lc-theme-switch'] }
  ];

  for (const entry of entries) {
    let text = '';
    try {
      text = readFileSync(entry.file, 'utf8');
    } catch {
      errors.push(`读不到 ${entry.file}，先跑一次 node src/theme/build.mjs`);
      continue;
    }
    for (const needle of entry.needles) {
      if (!text.includes(needle)) errors.push(`${entry.file} 里缺少 ${needle}，编辑器/切换器可能没接上`);
    }
  }

  return { files: entries.length, errors };
}

/* 四套模板必须有各自的默认主题，且默认主题真实存在。 */
function checkPresets(themeIds) {
  const errors = [];
  const seen = new Set();
  const defaults = new Set();

  if (TEMPLATE_PRESETS.length !== 4) {
    errors.push(`模板预设应为 4 套，实际 ${TEMPLATE_PRESETS.length} 套`);
  }

  for (const preset of TEMPLATE_PRESETS) {
    if (seen.has(preset.id)) errors.push(`模板 id ${preset.id} 重复`);
    seen.add(preset.id);

    if (!themeIds.has(preset.defaultThemeId)) {
      errors.push(`模板「${preset.name}」的默认主题 ${preset.defaultThemeId} 不存在`);
    }
    if (defaults.has(preset.defaultThemeId)) {
      errors.push(`多套模板共用了默认主题 ${preset.defaultThemeId}，气质区分不开`);
    }
    defaults.add(preset.defaultThemeId);

    for (const id of preset.themeIds) {
      if (!themeIds.has(id)) errors.push(`模板「${preset.name}」的可选主题 ${id} 不存在`);
    }
  }

  if (themeIds.size < 10) {
    errors.push(`内置主题应至少 10 套，实际 ${themeIds.size} 套`);
  }

  return { count: TEMPLATE_PRESETS.length, errors };
}

/* 用合成旧文件验证向后兼容：v1 平铺结构、v2 原结构、未来版本、危险覆盖值。 */
function checkSchemaCompat(loaded) {
  const errors = [];
  const base = loaded.find((theme) => theme.id === 'ink-green') || loaded[0];

  if (!base) return { version: THEME_SCHEMA_VERSION, errors: ['没有可用于兼容性测试的主题'] };

  if (!THEME_SCHEMA || THEME_SCHEMA.version !== THEME_SCHEMA_VERSION) {
    errors.push('THEME_SCHEMA.version 与 THEME_SCHEMA_VERSION 不一致');
  }
  if (!THEME_SCHEMA.compatibility || THEME_SCHEMA.compatibility.length < 3) {
    errors.push('THEME_SCHEMA.compatibility 至少应覆盖 v1 / v2 / 未来版本三条');
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const v2 = { ...clone(base), id: 'legacy-v2', name: '旧版 v2', schemaVersion: 2 };
  const r2 = validateThemeData(v2);
  if (!r2.ok) errors.push(`v2 文件迁移后仍不通过：${r2.errors.join('；')}`);
  if (!r2.migrated || r2.version !== 2) errors.push('v2 文件没有被识别为旧版本并迁移');

  const v1 = {
    schemaVersion: 1,
    id: 'legacy-v1',
    name: '旧版 v1',
    light: clone(base.modes.light),
    dark: clone(base.modes.dark)
  };
  const r1 = validateThemeData(v1);
  if (!r1.ok) errors.push(`v1 平铺结构迁移后仍不通过：${r1.errors.join('；')}`);
  if (!r1.migrated) errors.push('v1 文件没有被识别为旧版本并迁移');
  const migratedV1 = migrateThemeData(v1).theme;
  if (!migratedV1 || migratedV1.tone !== 'neutral') errors.push('v1 缺 tone 时没有补 neutral');
  if (!migratedV1 || !migratedV1.description) errors.push('v1 缺 description 时没有补占位说明');

  const v4 = { ...clone(base), id: 'future-v4', name: '未来 v4', schemaVersion: 4 };
  const r4 = validateThemeData(v4);
  if (!r4.ok) errors.push(`高版本文件没有被尽力读取：${r4.errors.join('；')}`);
  if (!r4.warnings.some((text) => text.includes('高于当前'))) {
    errors.push('高版本文件没有给出「版本高于当前」的提醒');
  }

  return { version: THEME_SCHEMA_VERSION, errors };
}

/* 导出接口必须能在 Node 里直接产出可用 CSS，并且挡住危险覆盖值。 */
function checkExports(loaded) {
  const errors = [];
  if (!loaded.length) return { blocks: 0, errors: ['没有主题可供导出测试'] };

  const base = loaded.find((theme) => theme.id === 'ink-green') || loaded[0];
  const block = themeCssBlock(base);
  const darkSelector = `[data-lc-theme="${base.id}"][data-lc-mode="dark"]`;

  if (!/:root\s*\{/.test(block)) errors.push('themeCssBlock 没有输出 :root 选择器');
  if (!block.includes(darkSelector)) errors.push('themeCssBlock 没有输出暗色选择器');
  if (!block.includes('--lc-color-bg:')) errors.push('themeCssBlock 没有输出 --lc-color-bg');
  if (!block.includes('--lc-color-accent-fill-hover:')) errors.push('导出缺少派生色 accent-fill-hover');

  const sheet = themeStyleSheet(loaded);
  const rootCount = (sheet.match(/:root\s*\{/g) || []).length;
  if (rootCount !== loaded.length) {
    errors.push(`themeStyleSheet 应输出 ${loaded.length} 个 :root 块，实际 ${rootCount} 个`);
  }

  const evil = JSON.parse(JSON.stringify(base));
  evil.id = 'evil-inject';
  evil.name = '危险值测试';
  evil.modes.light.overrides = { '--lc-color-bg': '#fff;} body{display:none' };
  const evilCss = themeCssBlock(evil);
  if (/display\s*:\s*none/.test(evilCss)) errors.push('导出没有拦截含 ; { } 的覆盖值');

  const own = themeCssRule(base, 'light', '.scope', { onlyThemeTokens: true });
  if (!own.includes('--lc-color-bg:')) errors.push('onlyThemeTokens 模式没有输出颜色令牌');
  if (own.includes('--lc-shadow')) errors.push('onlyThemeTokens 模式不应输出阴影令牌');

  return { blocks: loaded.length, errors };
}

/* 静态令牌与别名自检（令牌层三件事的回归防线）：
 *   1. 间距半档 6 / 10 / 14px 存在且值正确；
 *   2. 字号 xs / sm 覆盖 12px / 13px；
 *   3. 兼容别名真实出现在生成的基础 CSS 里，不再是「组件引用、令牌没声明」的幽灵变量；
 *   4. 错误色（--lc-color-danger）在暗色背景与面板上 ≥ 4.5:1；
 *   5. 圆角刻度与 RADIUS_SCALE 一致，且主题没有偷偷改圆角；
 *   6. 代码语法色与 mermaid 令牌都已声明并进入产物。 */
function checkTokens() {
  const errors = [];
  const expectedStatic = {
    '--lc-space-1-5': '6px',
    '--lc-space-2-5': '10px',
    '--lc-space-3-5': '14px',
    '--lc-text-xs': '0.75rem',
    '--lc-text-sm': '0.8125rem'
  };

  for (const [name, value] of Object.entries(expectedStatic)) {
    if (BASE_STATIC[name] == null) errors.push(`缺少静态令牌 ${name}（应是 ${value}）`);
    else if (BASE_STATIC[name] !== value) errors.push(`静态令牌 ${name} 应为 ${value}，实际是 ${BASE_STATIC[name]}`);
  }
  // 16px 根字号下 0.75rem = 12px、0.8125rem = 13px；写成 rem 是为了跟随用户字号设置。
  if (BASE_STATIC['--lc-text-xs'] === '0.75rem' || BASE_STATIC['--lc-text-xs'] === '12px') {
    // 通过
  } else {
    errors.push('--lc-text-xs 必须覆盖 12px（0.75rem）');
  }
  if (BASE_STATIC['--lc-text-sm'] === '0.8125rem' || BASE_STATIC['--lc-text-sm'] === '13px') {
    // 通过
  } else {
    errors.push('--lc-text-sm 必须覆盖 13px（0.8125rem）');
  }

  const css = baseCss();
  for (const [alias, target] of Object.entries(COLOR_ALIASES)) {
    const declared = new RegExp(`${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(css);
    if (!declared) errors.push(`基础 CSS 没有声明兼容别名 ${alias}，组件里的引用会回退到写死值`);
    const formal = /^var\((--lc-[a-z0-9-]+)\)$/.exec(target);
    if (!formal) {
      errors.push(`别名 ${alias} 的值必须是 var(--lc-…)，实际是 ${JSON.stringify(target)}`);
    } else if (formal[1] !== '--lc-color-overlay' && !COLOR_TOKEN_NAMES.includes(formal[1])) {
      errors.push(`别名 ${alias} 指向的 ${formal[1]} 不是已声明的颜色令牌`);
    } else if (COLOR_ALIASES[formal[1]]) {
      errors.push(`别名 ${alias} 指向另一个别名 ${formal[1]}，只允许「正式名 + 一个别名」一层`);
    }
  }

  // 错误色暗色复核：所有主题都要过 4.5:1，不再依赖组件里的写死回退。
  for (const entry of themes) {
    if (entry.parseError || !entry.data) continue;
    const migrated = migrateThemeData(entry.data);
    if (!migrated.ok || !migrated.theme) continue;
    const dark = resolveMode(migrated.theme, 'dark');
    for (const bg of ['--lc-color-bg', '--lc-color-surface']) {
      const ratio = contrastRatio(dark['--lc-color-danger'], dark[bg]);
      if (ratio == null) {
        errors.push(`${entry.data.id || entry.file} 暗色无法计算错误色与 ${bg} 的对比度`);
      } else if (ratio < 4.5) {
        errors.push(
          `${entry.data.id || entry.file} 暗色错误色 ${dark['--lc-color-danger']} 在 ${bg}（${dark[bg]}）上 ` +
          `${ratio.toFixed(2)}:1，要求 ≥ 4.5:1`
        );
      }
    }
  }

  // 圆角：唯一刻度，值必须和 RADIUS_SCALE 一致且严格递增。
  const radiusSequence = RADIUS_SCALE.filter((item) => item.px !== 999).map((item) => item.px);
  for (const item of RADIUS_SCALE) {
    if (BASE_STATIC[item.token] == null) errors.push(`缺少圆角令牌 ${item.token}（应是 ${item.px}px）`);
    else if (BASE_STATIC[item.token] !== `${item.px}px`) {
      errors.push(`圆角令牌 ${item.token} 应为 ${item.px}px，实际是 ${BASE_STATIC[item.token]}`);
    }
  }
  for (let i = 1; i < radiusSequence.length; i += 1) {
    if (radiusSequence[i] <= radiusSequence[i - 1]) errors.push('圆角刻度必须从 xs 到 xl 严格递增');
  }
  for (const entry of themes) {
    if (!entry.data) continue;
    const shared = (entry.data.shared && entry.data.shared.tokens) || {};
    const radiusKeys = Object.keys(shared).filter((key) => key.startsWith('--lc-radius-'));
    for (const key of radiusKeys) {
      errors.push(`${entry.data.id || entry.file} 在 shared.tokens 里覆盖了 ${key}，圆角必须全站统一`);
    }
    for (const mode of ['light', 'dark']) {
      const overrides = (entry.data.modes && entry.data.modes[mode] && entry.data.modes[mode].overrides) || {};
      for (const key of Object.keys(overrides)) {
        if (key.startsWith('--lc-radius-')) {
          errors.push(`${entry.data.id || entry.file} 在 ${mode}.overrides 里覆盖了 ${key}，圆角必须全站统一`);
        }
      }
    }
  }

  // 代码语法色 / mermaid 令牌：必须在颜色令牌表里，且基础 CSS 里真的声明了。
  const newColorTokens = [
    '--lc-color-code-text', '--lc-color-code-keyword', '--lc-color-code-string',
    '--lc-color-code-comment', '--lc-color-code-number', '--lc-color-code-function',
    '--lc-color-code-bg', '--lc-color-code-line',
    '--lc-mermaid-node-fill', '--lc-mermaid-node-stroke', '--lc-mermaid-line',
    '--lc-mermaid-label', '--lc-mermaid-note-fill', '--lc-mermaid-label-bg',
    '--lc-color-decor'
  ];
  for (const name of newColorTokens) {
    if (!COLOR_TOKEN_NAMES.includes(name)) errors.push(`颜色令牌表缺少 ${name}`);
    const declared = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(css);
    if (!declared) errors.push(`基础 CSS 没有声明 ${name}，组件引用会变成幽灵变量`);
  }
  let lcThemesCss = '';
  try {
    lcThemesCss = readFileSync(join(here, '..', '..', 'assets', 'css', 'lc-themes.css'), 'utf8');
  } catch (error) {
    errors.push(`读不到 assets/css/lc-themes.css：${error.message}`);
  }
  if (lcThemesCss) {
    for (const name of newColorTokens) {
      if (!lcThemesCss.includes(`${name}:`)) errors.push(`lc-themes.css 里没有主题输出 ${name}，主题块会缺令牌`);
    }
  }

  // 打印令牌：固定浅色纸面，不跟随主题。只核对存在性、取值、引用和纸面对比度，
  // 避免打印样式里又写死色值或漏映射导致暗色主题把浅字带上纸。
  const printPairs = [
    ['--lc-print-ink', '--lc-print-bg', 4.5],
    ['--lc-print-ink-2', '--lc-print-bg', 4.5],
    ['--lc-print-muted', '--lc-print-bg', 4.5],
    ['--lc-print-muted-2', '--lc-print-bg', 4.5],
    ['--lc-print-placeholder', '--lc-print-bg', 4.5],
    ['--lc-print-disabled-ink', '--lc-print-bg', 4.5],
    ['--lc-print-on-accent', '--lc-print-accent-fill', 4.5],
    ['--lc-print-success', '--lc-print-success-soft', 4.5],
    ['--lc-print-warn', '--lc-print-warn-soft', 4.5],
    ['--lc-print-danger', '--lc-print-danger-soft', 4.5],
    ['--lc-print-info', '--lc-print-info-soft', 4.5],
    ['--lc-print-line-strong', '--lc-print-bg', 3],
    ['--lc-print-focus', '--lc-print-bg', 3],
    ['--lc-print-decor', '--lc-print-bg', DECOR_MIN]
  ];
  const printNameRegex = (name) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  for (const name of Object.keys(PRINT_TOKENS)) {
    if (PRINT_TOKENS[name] == null) errors.push(`缺少打印令牌 ${name}`);
    if (!printNameRegex(name).test(css)) errors.push(`基础 CSS 没有声明打印令牌 ${name}，打印时会回落成主题色`);
  }
  for (const [fg, bg, min] of printPairs) {
    const ratio = contrastRatio(PRINT_TOKENS[fg], PRINT_TOKENS[bg]);
    if (ratio == null) errors.push(`打印令牌 ${fg} 与 ${bg} 无法计算对比度`);
    else if (ratio < min) {
      errors.push(`打印令牌 ${fg}（${PRINT_TOKENS[fg]}）在 ${bg}（${PRINT_TOKENS[bg]}）上 ${ratio.toFixed(2)}:1，要求 ≥ ${min}:1`);
    }
  }
  let printCss = '';
  try {
    printCss = readFileSync(join(here, '..', '..', 'assets', 'css', 'lc-print.css'), 'utf8');
  } catch (error) {
    errors.push(`读不到 assets/css/lc-print.css：${error.message}`);
  }
  if (printCss) {
    for (const name of Object.keys(PRINT_TOKENS)) {
      if (!printCss.includes(`var(${name})`)) {
        errors.push(`lc-print.css 没有引用打印令牌 ${name}，打印时仍可能用到主题色`);
      }
    }
    if (/#[0-9a-fA-F]{3,8}\b/.test(printCss)) {
      errors.push('lc-print.css 里仍有写死色值，打印颜色应只来自 --lc-print-* 令牌');
    }
  }

  return {
    static: Object.keys(BASE_STATIC).length,
    print: Object.keys(PRINT_TOKENS).length,
    aliases: Object.keys(COLOR_ALIASES),
    radii: RADIUS_SCALE.map((item) => `${item.token.replace('--lc-radius-', '')}=${item.px}px`).join(' / '),
    errors
  };
}

/* 别名兜底层级检查：
 *   只允许「正式令牌 + 一个别名」两层。若写成
 *     var(--lc-color-bg, var(--bg, #f4f0e6))
 *   就是三层兜底，暗色/打印下会悄悄用回写死值，必须报错。
 *   扫描范围是主题层拥有的样式文件（assets/css/*.css、assets/app.css、
 *   src/theme 下的演示页）；渲染层组件不在本层范围。 */
function checkFallbacks() {
  const errors = [];
  const checked = [];
  const root = join(here, '..', '..');
  const files = [];
  try {
    for (const name of readdirSync(join(root, 'assets', 'css'))) {
      if (name.endsWith('.css')) files.push(join(root, 'assets', 'css', name));
    }
  } catch (error) {
    errors.push(`读不到 assets/css：${error.message}`);
  }
  files.push(join(root, 'assets', 'app.css'));
  for (const name of ['editor.html', 'switcher-demo.html']) {
    files.push(join(here, name));
  }

  for (const file of files) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      continue;
    }
    checked.push(relative(root, file));
    for (const call of collectVarCalls(text)) {
      const args = splitTopLevelArgs(call.inner);
      if (args.length < 2 || !args[0].startsWith('--')) continue;
      if (!args[1].includes('var(')) continue;
      const innerHasFallback = collectVarCalls(args[1])
        .some((item) => splitTopLevelArgs(item.inner).length >= 2);
      if (!innerHasFallback) continue;
      const line = text.slice(0, call.start).split('\n').length;
      const snippet = text.slice(call.start, call.end).replace(/\s+/g, ' ');
      errors.push(
        `${relative(root, file)}:${line} 三层兜底 ${snippet}；` +
        '只允许「正式名 + 一个别名」，别名后不要再叠字面量'
      );
    }
  }
  return { checked, errors };
}

/* 取出所有 var(...) 调用，带原文位置；括号按层级匹配，跳过字符串里的括号。 */
function collectVarCalls(text) {
  const calls = [];
  let index = text.indexOf('var(');
  while (index !== -1) {
    let depth = 1;
    let quote = '';
    let cursor = index + 4;
    for (; cursor < text.length; cursor += 1) {
      const ch = text[cursor];
      if (quote) {
        if (ch === '\\') cursor += 1;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === '\'') {
        quote = ch;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth === 0) calls.push({ start: index, end: cursor + 1, inner: text.slice(index + 4, cursor) });
    index = text.indexOf('var(', index + 4);
  }
  return calls;
}

/* 按顶层逗号切 var() 的参数，忽略嵌套括号里的逗号。 */
function splitTopLevelArgs(text) {
  const args = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

/* 按需主题与首屏防白闪检查：
 *   1. themeCssForIds 只输出请求的 id，未知 id / 空列表 / 默认主题不在列表都要抛错；
 *   2. 默认主题必须挂 :root 兜底，且默认只输出主题自己的令牌（不重复字体/间距/阴影）；
 *   3. lc-theme-manifest.json 的体积数字必须和实际生成物一致；
 *   4. 切换器演示页的引导脚本必须内联在 <head>、排在样式表之前。 */
function checkOnDemand() {
  const errors = [];
  const root = join(here, '..', '..');
  const ids = loadedThemes.map((theme) => theme.id);
  const selected = ids.slice(0, Math.min(2, ids.length));
  let cssBytes = 0;
  let cssGzipBytes = 0;
  let manifestOk = false;
  let bootOk = false;

  if (!loadedThemes.length) {
    errors.push('没有可用主题，无法生成按需 CSS');
    return { errors, selected, cssBytes, cssGzipBytes, manifest: manifestOk, boot: bootOk };
  }

  const css = themeCssForIds(loadedThemes, selected, { defaultThemeId: selected[0] });
  cssBytes = Buffer.byteLength(css, 'utf8');
  cssGzipBytes = gzipSync(Buffer.from(css, 'utf8'), { level: 6 }).length;

  for (const id of ids) {
    const present = css.includes(`[data-lc-theme="${id}"]`);
    if (selected.includes(id) && !present) errors.push(`themeCssForIds 漏掉了已选主题 ${id}`);
    if (!selected.includes(id) && present) errors.push(`themeCssForIds 带上了未选主题 ${id}，导出包会变大`);
  }
  if (!css.includes(':root, [data-lc-theme=')) {
    errors.push('themeCssForIds 没有给默认主题挂 :root 兜底，页面未带属性时会掉回基础色');
  }
  if (!css.includes(`[data-lc-theme="${selected[0]}"][data-lc-mode="light"]`)) {
    errors.push('themeCssForIds 的亮色选择器没有带主题 id，换主题时会被 :root 覆盖');
  }
  if (css.includes('--lc-font-sans') || css.includes('--lc-shadow-')) {
    errors.push('themeCssForIds 默认重复输出了基础静态令牌，应只带主题自己的颜色令牌');
  }

  const wrongCases = [
    { name: '空 id 列表', run: () => themeCssForIds(loadedThemes, []) },
    { name: '未知主题 id', run: () => themeCssForIds(loadedThemes, ['__does-not-exist__']) },
    { name: '默认主题不在列表', run: () => themeCssForIds(loadedThemes, [selected[0]], { defaultThemeId: '__does-not-exist__' }) }
  ];
  for (const item of wrongCases) {
    try {
      item.run();
      errors.push(`themeCssForIds 对「${item.name}」没有报错，导出时会静默少带主题`);
    } catch (error) {
      /* 应该抛错，符合预期。 */
    }
  }

  // 体积清单必须和实际文件对得上，否则导出管线会按错的数据做取舍。
  try {
    const manifestPath = join(root, 'assets', 'css', 'lc-theme-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const themesCss = readFileSync(join(root, 'assets', 'css', 'lc-themes.css'), 'utf8');
    const themesBytes = Buffer.byteLength(themesCss, 'utf8');
    const themesGzip = gzipSync(Buffer.from(themesCss), { level: 6 }).length;
    manifestOk = true;
    if (manifest.merged.bytes !== themesBytes) {
      errors.push(`manifest 的合并体积 ${manifest.merged.bytes} 与实际 lc-themes.css ${themesBytes} 不一致`);
    }
    if (manifest.merged.gzipBytes !== themesGzip) {
      errors.push(`manifest 的合并 gzip ${manifest.merged.gzipBytes} 与实际 ${themesGzip} 不一致`);
    }
    if (!Array.isArray(manifest.themes) || manifest.themes.length !== ids.length) {
      errors.push('manifest 的主题套数与 themes/ 目录不一致');
    } else {
      for (const id of ids) {
        if (!manifest.themes.some((item) => item.id === id)) errors.push(`manifest 缺少主题 ${id} 的体积数据`);
      }
    }
    if (manifest.cumulative && manifest.cumulative.length === ids.length) {
      const last = manifest.cumulative[manifest.cumulative.length - 1];
      if (last.bytes !== themesBytes) errors.push('manifest 累计表最后一行的字节数与合并产物不一致');
    } else {
      errors.push('manifest 的累计体积表不完整，无法判断「多带一套加多少」');
    }
  } catch (error) {
    errors.push(`读不到或解析不了 assets/css/lc-theme-manifest.json：${error.message}`);
  }

  // 首屏闪白：引导脚本必须在样式表之前执行，否则用户会先看到默认主题再跳变。
  try {
    const demo = readFileSync(join(here, 'switcher-demo.html'), 'utf8');
    const headEnd = demo.indexOf('</head>');
    const bootAt = demo.indexOf('localStorage.getItem');
    const firstLinkAt = demo.indexOf('<link rel="stylesheet"');
    bootOk = bootAt !== -1 && firstLinkAt !== -1 && bootAt < firstLinkAt && headEnd !== -1 && bootAt < headEnd;
    if (!bootOk) {
      errors.push('switcher-demo.html 的防白闪引导脚本没有内联在 <head> 的样式表之前');
    }
    const bootFile = readFileSync(join(here, 'lc-theme-boot.js'), 'utf8');
    if (!bootFile.includes('localStorage.getItem') || !bootFile.includes('data-lc-theme')) {
      errors.push('lc-theme-boot.js 没有正确生成引导逻辑');
      bootOk = false;
    }
    const runtimeFile = readFileSync(join(here, 'lc-theme-runtime.js'), 'utf8');
    if (!runtimeFile.includes('themeCssForIds')) {
      errors.push('lc-theme-runtime.js 没有同步导出 themeCssForIds，浏览器侧导出管线用不到按需接口');
    }
  } catch (error) {
    errors.push(`读不到切换器演示页或引导脚本：${error.message}`);
    bootOk = false;
  }

  return { errors, selected, cssBytes, cssGzipBytes, manifest: manifestOk, boot: bootOk };
}

function printHuman(items, icons, breakpoints, artifacts, presets, schema, exportsReport, tokens, fallbacks, onDemand) {
  console.log('');
  console.log(`主题自检 · ${items.length} 个主题包（${themeDir}）`);
  console.log('检查项：字段完整性 / 主色齐全 / 令牌完整 / 对比度（正文 4.5:1，弱化文字 4.5:1 或 3:1，焦点环 3:1，装饰色 3:1 且与 muted-2 明显区分）/ 静态令牌与别名 / 打印令牌 / 别名兜底层级 / 按需加载与防白闪 / 图标集 / 断点同步 / 模板预设 / schema 兼容 / CSS 导出');
  console.log('');

  for (const item of items) {
    const mark = item.errors.length ? '不通过' : (item.warnings.length ? '通过（有提醒）' : '通过');
    console.log(`■ ${item.name} [${item.id}]  ${mark}`);
    for (const mode of ['light', 'dark']) {
      const info = item.modes[mode];
      if (!info) continue;
      const modeName = mode === 'light' ? '亮色' : '暗色';
      const textPart = info.textFailures
        ? `正文 ${info.textChecks} 组里 ${info.textFailures} 组不达标`
        : `正文 ${info.textChecks} 组全部达标（最低 ${info.textMin.toFixed(2)}:1）`;
      const uiPart = info.uiFailures
        ? `；描边/焦点环 ${info.uiChecks} 组里 ${info.uiFailures} 组不达标`
        : `；描边/焦点环 ${info.uiChecks} 组最低 ${info.uiMin.toFixed(2)}:1`;
      const weakPart = info.weakFailures
        ? `；次要/占位文字 ${info.weakChecks} 组里 ${info.weakFailures} 组不达标`
        : `；次要/占位文字 ${info.weakChecks} 组最低 ${info.weakMin.toFixed(2)}:1`;
      const decorPart = info.decorFailures
        ? `；装饰色 ${info.decorChecks} 组里 ${info.decorFailures} 组不达标`
        : `；装饰色最低 ${info.decorMin.toFixed(2)}:1（下限 ${DECOR_MIN}:1，比 muted-2 淡 ` +
          `${info.decorGap != null ? info.decorGap.toFixed(2) : '—'}）`;
      const disabledPart = info.disabledFailures
        ? `；禁用态 ${info.disabledChecks} 组里 ${info.disabledFailures} 组不达标`
        : `；禁用态 ${info.disabledChecks} 组最低 ${info.disabledMin.toFixed(2)}:1`;
      const overlayPart = info.overlayFailures
        ? `；遮罩焦点环 ${info.overlayChecks} 组里 ${info.overlayFailures} 组不达标`
        : `；遮罩焦点环 ${info.overlayChecks} 组最低 ${info.overlayMin.toFixed(2)}:1`;
      const codePart = info.codeFailures || info.codeCommentFailures || info.codeLineFailures
        ? `；代码色 ${info.codeChecks + info.codeCommentChecks + info.codeLineChecks} 组里 ` +
          `${info.codeFailures + info.codeCommentFailures + info.codeLineFailures} 组不达标`
        : `；代码色 ${info.codeChecks} 组最低 ${info.codeMin.toFixed(2)}:1，` +
          `注释 ${info.codeCommentMin.toFixed(2)}:1（3:1 放宽），分隔线 ${info.codeLineMin.toFixed(2)}:1`;
      const mermaidPart = info.mermaidFailures
        ? `；流程图 ${info.mermaidChecks} 组里 ${info.mermaidFailures} 组不达标`
        : `；流程图 ${info.mermaidChecks} 组最低 ${info.mermaidMin.toFixed(2)}:1`;
      console.log(
        `  ${modeName}：令牌 ${info.tokens} 个，${textPart}${uiPart}${weakPart}${decorPart}${disabledPart}${overlayPart}${codePart}${mermaidPart}`
      );
    }
    for (const message of item.errors) console.log(`  ✗ ${message}`);
    for (const message of item.warnings) console.log(`  ! ${message}`);
    console.log('');
  }

  if (icons.errors.length) {
    console.log(`■ 图标集  ${icons.count} 个  不通过`);
    for (const message of icons.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(`■ 图标集  ${icons.count} 个  通过（24×24 网格、id 唯一、必需动作齐全、分组完整）`);
  }
  if (breakpoints.errors.length) {
    console.log(`■ 断点  不通过`);
    for (const message of breakpoints.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(`■ 断点  ${breakpoints.values.join(' / ')}px  通过（与 lc-responsive.css 一致）`);
  }
  if (artifacts.errors.length) {
    console.log(`■ 主题编辑器与切换器  不通过`);
    for (const message of artifacts.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(`■ 主题编辑器与切换器  ${artifacts.files} 个产物  通过（运行时 / 编辑器 / 切换器文件齐全且已接线）`);
  }
  if (presets.errors.length) {
    console.log(`■ 模板预设  不通过`);
    for (const message of presets.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(`■ 模板预设  ${presets.count} 套模板  通过（默认主题各不重复且都存在）`);
  }
  if (schema.errors.length) {
    console.log(`■ 主题包格式 v${schema.version}  不通过`);
    for (const message of schema.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(`■ 主题包格式 v${schema.version}  通过（v1 / v2 旧文件可迁移，未来版本不拒绝）`);
  }
  if (exportsReport.errors.length) {
    console.log(`■ CSS 导出接口  不通过`);
    for (const message of exportsReport.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(`■ CSS 导出接口  ${exportsReport.blocks} 套  通过（:root + 暗色选择器，危险值已过滤）`);
  }
  if (tokens.errors.length) {
    console.log(`■ 静态令牌与别名  不通过`);
    for (const message of tokens.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(
      `■ 静态令牌与别名  ${tokens.static} 个静态令牌  通过` +
      `（间距 6/10/14px、字号 xs/sm 覆盖 12/13px、圆角 ${tokens.radii}、` +
      `别名 ${tokens.aliases.join(' / ')} 已声明、错误色暗色 ≥ 4.5:1）`
    );
  }
  if (fallbacks.errors.length) {
    console.log(`■ 别名兜底层级  不通过`);
    for (const message of fallbacks.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(
      `■ 别名兜底层级  ${fallbacks.checked.length} 个样式文件  通过` +
      `（只允许「正式名 + 一个别名」；未发现 var(--正式, var(--别名, 字面量)) 三层兜底）`
    );
  }
  if (onDemand.errors.length) {
    console.log(`■ 按需加载与防白闪  不通过`);
    for (const message of onDemand.errors) console.log(`  ✗ ${message}`);
  } else {
    console.log(
      `■ 按需加载与防白闪  通过` +
      `（themeCssForIds 只带选中的 ${onDemand.selected.length} 套：${onDemand.selected.join(' + ')}，` +
      `${onDemand.cssBytes} 字节 / gzip ${onDemand.cssGzipBytes}；` +
      `体积清单与实际产物一致；引导脚本已内联在样式表之前）`
    );
  }
  console.log('');

  const failedCount = items.filter((item) => item.errors.length > 0).length;
  const allOk = failedCount === 0
    && icons.errors.length === 0
    && breakpoints.errors.length === 0
    && artifacts.errors.length === 0
    && presets.errors.length === 0
    && schema.errors.length === 0
    && exportsReport.errors.length === 0
    && tokens.errors.length === 0
    && fallbacks.errors.length === 0
    && onDemand.errors.length === 0;
  if (!allOk) {
    console.log(`结论：这里有硬错误（主题 ${failedCount} 套不达标、图标问题 ${icons.errors.length} 处、断点问题 ${breakpoints.errors.length} 处、编辑器产物问题 ${artifacts.errors.length} 处、模板问题 ${presets.errors.length} 处、格式兼容问题 ${schema.errors.length} 处、导出问题 ${exportsReport.errors.length} 处、令牌问题 ${tokens.errors.length} 处、别名兜底问题 ${fallbacks.errors.length} 处、按需加载与防白闪问题 ${onDemand.errors.length} 处）。按上面的提示修完再跑一次。`);
    console.log('提示：浅底主题把强调色/状态色调深一点，深底主题把它们调亮一点，通常就能过 4.5:1。');
  } else {
    console.log(`结论：${items.length} 套主题全部可用，亮暗 ${items.length * 2} 组配色满足 WCAG AA 正文与弱化文字标准；`);
    console.log(`      4 套模板各有默认主题，v1 / v2 旧文件可迁移，CSS 导出接口在 Node 里直接可用；`);
    console.log(`      图标集 ${icons.count} 个、断点 ${breakpoints.values.join('/')}px 与样式同步；`);
    console.log(`      静态令牌 ${tokens.static} 个（其中打印令牌 ${tokens.print} 个，浅色纸面固定不跟主题），兼容别名 ${tokens.aliases.join(' / ')} 已声明并跟随主题；`);
    console.log(`      ${fallbacks.checked.length} 个主题层样式文件通过「正式名 + 一个别名」检查，三层兜底 0 处；`);
    console.log(`      --lc-color-decor 在 ${items.length} 套亮暗各派生一份，按 ${DECOR_MIN}:1 下限检查，且比 muted-2 至少淡 1.00；`);
    console.log(`      themeCssForIds 按 id 列表裁剪主题（当前自检 ${onDemand.selected.length} 套 ${onDemand.cssBytes} 字节 / gzip ${onDemand.cssGzipBytes}），体积清单与实际产物一致，首屏引导脚本在样式表之前；`);
    console.log(`      代码语法色 8 个、mermaid 6 个逐套亮暗复核，注释按 3:1 放宽；主题编辑器与切换器产物齐全，可以交付。`);
  }
  console.log('');
}
