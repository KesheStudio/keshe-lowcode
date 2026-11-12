/* 后端积木 · 自定义后端组件
 *
 * 组件是“后端组件”而不是普通节点：它带自己的参数 schema 和多语言实现，
 * 可以被同一项目复用，也可以保存到全局组件库给其他项目用。
 *
 * 存储：
 *   项目内  data/sites/<siteId>/backend/node/_components/<id>.json
 *   全局    <dataDir>/backend-components/<id>.json
 * 代码存在组件定义的 code.<language> 里，构建时落到构建目录的
 *   src/custom/components/<id>.<language 扩展名>
 * 站点源码目录不写入生成代码，仍保持“生成区 / 用户区”两区边界。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { FLOW_LANGUAGES, componentFileFor } from './nodes.js';

export const COMPONENT_SCHEMA_VERSION = 1;

const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const PARAM_KINDS = new Set(['text', 'number', 'toggle', 'select', 'json', 'expression']);

const PARAM_DEFAULTS = {
  text: '',
  number: 0,
  toggle: false,
  select: '',
  json: '{}',
  expression: ''
};

const DEFAULT_NODE_CODE = `// [LC-CUSTOM] 后端组件实现 · 用户代码，生成过程只引用，不会改写。
// ctx: { request, reply, deps, vars }；args: 节点属性面板里传入的调用参数。
export async function run(ctx, args) {
  return { ok: true, args }
}
`;

export class ComponentError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ComponentError';
    this.issues = issues;
    this.statusCode = 422;
  }
}

export function projectComponentDir(siteDir) {
  return path.join(siteDir, 'backend', 'node', '_components');
}

export function globalComponentDir(paths) {
  return paths && paths.dataDir ? path.join(paths.dataDir, 'backend-components') : '';
}

function scopeDir(paths, siteDir, scope) {
  return scope === 'global'
    ? globalComponentDir(paths)
    : projectComponentDir(siteDir);
}

function paramOf(input, index, issues) {
  const key = String(input && input.key ? input.key : '').trim();
  if (!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(key)) {
    issues.push({ level: 'error', code: 'LC_C_PARAM_KEY', message: `参数 #${index + 1} 的 key 必须是字母开头的标识符` });
  }
  const kind = String((input && input.kind) || 'text');
  if (!PARAM_KINDS.has(kind)) {
    issues.push({ level: 'error', code: 'LC_C_PARAM_KIND', message: `参数「${key || index + 1}」的类型 ${kind} 不受支持` });
  }
  return {
    key,
    label: String((input && input.label) || key),
    kind,
    required: Boolean(input && input.required),
    default: input && input.default !== undefined ? input.default : PARAM_DEFAULTS[kind] ?? '',
    hint: input && input.hint ? String(input.hint).slice(0, 160) : ''
  };
}

/** 校验并规范化组件定义。 */
export function normalizeComponent(input, scope = 'project') {
  const issues = [];
  const raw = input && input.component && typeof input.component === 'object' ? input.component : input;
  if (!raw || typeof raw !== 'object') throw new ComponentError('组件定义不是对象');
  const id = String(raw.id || '').trim();
  if (!ID_PATTERN.test(id)) {
    issues.push({ level: 'error', code: 'LC_C_ID', message: '组件 id 必须是小写字母开头，只含小写字母、数字、连字符，长度 2-64' });
  }
  const name = String(raw.name || '').trim();
  if (!name) issues.push({ level: 'error', code: 'LC_C_NAME', message: '组件名称不能为空' });
  const languages = Array.isArray(raw.languages) && raw.languages.length
    ? [...new Set(raw.languages.filter((item) => FLOW_LANGUAGES.includes(item)))]
    : ['node'];
  if (!languages.length) {
    issues.push({ level: 'error', code: 'LC_C_LANG', message: `languages 必须是 ${FLOW_LANGUAGES.join(' / ')} 的非空子集` });
  }
  const declaredImplemented = Array.isArray(raw.implementedLanguages) && raw.implementedLanguages.length
    ? raw.implementedLanguages
    : ['node'];
  const implementedLanguages = declaredImplemented.filter((item) => languages.includes(item));
  const params = Array.isArray(raw.params) ? raw.params.map((item, index) => paramOf(item, index, issues)) : [];
  const keys = new Set();
  for (const param of params) {
    if (keys.has(param.key)) issues.push({ level: 'error', code: 'LC_C_PARAM_DUP', message: `参数 key 重复：${param.key}` });
    keys.add(param.key);
  }
  const codeInput = raw.code && typeof raw.code === 'object' ? raw.code : {};
  const code = {};
  for (const language of languages) {
    const text = typeof codeInput[language] === 'string' ? codeInput[language] : '';
    code[language] = text.trim() ? text : (language === 'node' ? DEFAULT_NODE_CODE : '');
  }
  if (issues.some((item) => item.level === 'error')) {
    throw new ComponentError('组件定义不合法', issues);
  }
  return {
    schemaVersion: COMPONENT_SCHEMA_VERSION,
    id,
    name: name.slice(0, 64),
    description: String(raw.description || '').slice(0, 240),
    scope,
    version: Math.max(1, Number.isInteger(raw.version) ? raw.version : 1),
    languages,
    implementedLanguages,
    params,
    code,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function readComponentFile(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readDir(dir, scope) {
  let entries = [];
  if (!dir) return [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const item = await readComponentFile(path.join(dir, entry.name));
    if (!item || !item.id) continue;
    out.push({ ...item, scope: scope === 'global' ? 'global' : 'project' });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

/** 列出项目内与全局组件。 */
export async function listComponents({ paths, siteDir }) {
  const [project, global] = await Promise.all([
    readDir(projectComponentDir(siteDir), 'project'),
    readDir(globalComponentDir(paths), 'global')
  ]);
  return { project, global };
}

/** 合并后的组件池：项目内优先，全局紧随其后；同 id 只保留项目内版本。 */
export async function allComponents({ paths, siteDir }) {
  const { project, global } = await listComponents({ paths, siteDir });
  const map = new Map();
  for (const item of project) map.set(item.id, item);
  for (const item of global) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

/** 保存组件；scope = project | global。 */
export async function saveComponent({ paths, siteDir, component, scope = 'project' }) {
  const normalized = normalizeComponent(component, scope === 'global' ? 'global' : 'project');
  const dir = scopeDir(paths, siteDir, normalized.scope);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, normalized.id + '.json');
  const existing = await readComponentFile(file);
  if (existing && Number(existing.version) >= normalized.version) {
    normalized.version = Number(existing.version) + 1;
  }
  normalized.createdAt = existing && existing.createdAt ? existing.createdAt : normalized.createdAt;
  await fs.writeFile(file, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

export async function deleteComponent({ paths, siteDir, id, scope = 'project' }) {
  if (!ID_PATTERN.test(String(id || ''))) throw new ComponentError('组件 id 不合法');
  const file = path.join(scopeDir(paths, siteDir, scope), id + '.json');
  const existed = await fs.stat(file).then(() => true).catch(() => false);
  if (existed) await fs.rm(file, { force: true });
  return { deleted: existed };
}

/** 组件实现代码；没有对应语言实现时返回空字符串（由 IR 报错，不静默补）。 */
export function componentCode(component, language) {
  const code = component && component.code && typeof component.code === 'object'
    ? component.code[language]
    : '';
  return typeof code === 'string' && code.trim() ? code : '';
}

/** 构建时把组件实现落到构建目录（生成区之外的 custom/ 用户区）。 */
export function componentFiles(components, target) {
  const files = [];
  for (const component of components) {
    const code = componentCode(component, target);
    if (!code) continue;
    files.push({
      path: componentFileFor(component.id, target),
      content: `// [LC-CUSTOM] 组件 ${component.id} v${component.version}（${component.scope}）\n${code.trim()}\n`
    });
  }
  return files;
}

/** 导出为可跨项目导入的 JSON。 */
export function exportComponent(component) {
  return JSON.stringify({
    kind: 'lc-backend-component',
    schemaVersion: COMPONENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    component: {
      id: component.id,
      name: component.name,
      description: component.description || '',
      version: component.version,
      languages: component.languages,
      implementedLanguages: component.implementedLanguages,
      params: component.params,
      code: component.code
    }
  }, null, 2) + '\n';
}
