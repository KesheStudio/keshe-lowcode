import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEEDS, resolveTheme, THEME_SCHEMA_VERSION } from '../../src/theme/tokens.mjs';

/**
 * 主题接口层（CONTRACTS 第 7 节 / D-46）：
 * - 内置主题：src/theme/themes/<id>.json
 * - 站点主题：<data>/sites/<siteId>/themes/<id>.json
 * - 旧版扁平色板（light/dark 直接放色值）在这里归一化为 seeds + overrides + shared.tokens。
 * 渲染层只拿 resolveThemeForRenderer() 的输出（CSS 变量），不关心文件位置。
 */
const BUILTIN_DIR = fileURLToPath(new URL('../../src/theme/themes/', import.meta.url));

/* tone 是枚举元数据：旧站点文件里存过中文标签（如「温润」），读取时统一折回枚举键。 */
const TONE_KEYS = ['paper', 'cool', 'warm', 'neutral', 'high-contrast', 'blueprint'];
const TONE_ALIASES = { '温润': 'paper', '冷静': 'cool', '温暖': 'warm', '中性': 'neutral', '高对比': 'high-contrast', '蓝图': 'blueprint' };

function normalizeTone(value) {
  const tone = String(value || '');
  if (TONE_KEYS.includes(tone)) return tone;
  return TONE_ALIASES[tone] || 'neutral';
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 归一化主题：新结构原样补齐，旧结构转成 modes.light/dark.{seeds,overrides}。
 */
export function normalizeTheme(raw, fallbackId = 'ink-green') {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || fallbackId);
  const name = String(raw.name || id);
  const tone = normalizeTone(raw.tone || raw.note);
  const description = String(raw.description || '');
  const hasModes = raw.modes && typeof raw.modes === 'object';
  const base = { schemaVersion: THEME_SCHEMA_VERSION, id, name, tone, description };

  if (hasModes) {
    const modeShape = (mode) => {
      const source = raw.modes[mode] || {};
      return {
        seeds: { ...DEFAULT_SEEDS[mode], ...(source.seeds || {}) },
        overrides: { ...(source.overrides || {}) }
      };
    };
    return {
      ...base,
      modes: { light: modeShape('light'), dark: modeShape('dark') },
      shared: { tokens: { ...(raw.shared && raw.shared.tokens ? raw.shared.tokens : {}) } }
    };
  }

  // 旧结构：{ light: { accent, bg, ... }, dark: { ... } }
  const legacyMode = (mode) => ({
    seeds: { ...DEFAULT_SEEDS[mode], ...(raw[mode] || {}) },
    overrides: {}
  });
  return {
    ...base,
    modes: { light: legacyMode('light'), dark: legacyMode('dark') },
    shared: { tokens: {} }
  };
}

/** 渲染层入参：variables 为亮色变量表，light/dark 为两套完整变量表。 */
export function resolveThemeForRenderer(raw) {
  const normalized = normalizeTheme(raw);
  if (!normalized) return null;
  const resolved = resolveTheme(normalized);
  return {
    id: normalized.id,
    name: normalized.name,
    tone: normalized.tone,
    description: normalized.description,
    schemaVersion: normalized.schemaVersion,
    /* CSS 生成（themeCssRule）要重新按 seeds 派生，必须把原始令牌一并带给渲染层；
     * 只给 light/dark 解析结果会让导出与预览回落到默认种子色。 */
    shared: normalized.shared,
    modes: normalized.modes,
    variables: resolved.light,
    light: resolved.light,
    dark: resolved.dark,
    colorScheme: 'light'
  };
}

export async function listBuiltinThemes() {
  const entries = await fs.readdir(BUILTIN_DIR, { withFileTypes: true }).catch(() => []);
  const themes = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const parsed = await readJson(path.join(BUILTIN_DIR, entry.name));
    const normalized = normalizeTheme(parsed);
    if (normalized) {
      themes.push({
        id: normalized.id,
        name: normalized.name,
        tone: normalized.tone,
        description: normalized.description
      });
    }
  }
  return themes.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getBuiltinTheme(themeId) {
  const id = String(themeId || '').replace(/[^a-z0-9-]/gi, '');
  return normalizeTheme(await readJson(path.join(BUILTIN_DIR, `${id}.json`)), id || 'ink-green');
}

/**
 * 读取站点主题：优先站点自己的 themes/<id>.json，其次内置，最后默认内置。
 * @param {string} dataDir 平台数据根（相对或绝对）
 * @param {string} siteId
 * @param {string} [themeId] 不传则读 project.json 的 theme.activeId
 */
export async function loadSiteTheme(dataDir, siteId, themeId) {
  const siteRoot = path.join(dataDir, 'sites', String(siteId || ''));
  let activeId = themeId;
  if (!activeId) {
    const project = await readJson(path.join(siteRoot, 'project.json'));
    activeId = project && project.theme ? project.theme.activeId : '';
  }
  const wanted = String(activeId || 'ink-green').replace(/[^a-z0-9-]/gi, '');
  const fromSite = wanted ? await readJson(path.join(siteRoot, 'themes', `${wanted}.json`)) : null;
  if (fromSite) return { theme: normalizeTheme(fromSite, wanted), source: 'site' };
  const builtin = wanted ? await getBuiltinTheme(wanted) : null;
  if (builtin) return { theme: builtin, source: 'builtin' };
  return { theme: await getBuiltinTheme('ink-green'), source: 'fallback' };
}
