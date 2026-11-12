import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeRelPath } from '../../../src/storage/path-safety.js';

const require = createRequire(import.meta.url);
const Render = require('../../../src/render/node.cjs');

export const COMPONENT_SCHEMA_VERSION = 1;

export const COMPONENT_LIMITS = {
  components: 300,
  fieldsPerComponent: 40,
  templateBytes: 256 * 1024,
  cssBytes: 128 * 1024,
  jsBytes: 128 * 1024,
  importBytes: 512 * 1024,
  nameLength: 64,
  tagCount: 8,
  tagLength: 24
};

export const COMPONENT_CATEGORIES = [
  { value: 'layout', label: '布局' },
  { value: 'content', label: '内容' },
  { value: 'media', label: '媒体' },
  { value: 'form', label: '表单' },
  { value: 'data', label: '数据' },
  { value: 'feedback', label: '反馈' },
  { value: 'other', label: '其他' }
];

export const COMPONENT_ICONS = [
  { value: 'box', label: '方盒' },
  { value: 'layout', label: '布局' },
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'table', label: '表格' },
  { value: 'form', label: '表单' },
  { value: 'chart', label: '图表' },
  { value: 'star', label: '星标' },
  { value: 'code', label: '代码' },
  { value: 'bolt', label: '闪电' }
];

export const COMPONENT_FIELD_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'color', label: '颜色' },
  { value: 'enum', label: '枚举' },
  { value: 'datasource', label: '数据源引用' },
  { value: 'image', label: '图片' }
];

const FIELD_TYPE_VALUES = new Set(COMPONENT_FIELD_TYPES.map((item) => item.value));
const CATEGORY_VALUES = new Set(COMPONENT_CATEGORIES.map((item) => item.value));
const ICON_VALUES = new Set(COMPONENT_ICONS.map((item) => item.value));

export function fail(status, code, message, detail) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  return error;
}

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

export function slugifyId(value, fallback = 'component') {
  const raw = String(value == null ? '' : value);
  let text = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  /* 与模板 ID 同样的问题：中文名清洗后只剩很短的 ASCII 尾巴，
     用可读的 fallback 打头，避免 ID 退化成纯 hash 观感（TPL-03）。 */
  if (text && CJK_RE.test(raw) && text.length <= 6) {
    text = String(fallback) + '-' + text;
  }
  return text || fallback;
}

export function normalizeComponentId(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(text)) {
    throw fail(400, 'LC_E_COMPONENT_ID', '组件 ID 只能用小写字母、数字、下划线、短横线，且不超过 48 位');
  }
  return text;
}

function normalizeFieldId(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(text)) {
    throw fail(422, 'LC_E_COMPONENT_FIELD_ID', '字段 ID「' + text + '」只能以字母或数字开头，可含下划线与短横线，不超过 48 位');
  }
  return text;
}

export function fieldLabel(type) {
  const item = COMPONENT_FIELD_TYPES.find((entry) => entry.value === type);
  return item ? item.label : String(type || '');
}

function asText(value) {
  return String(value == null ? '' : value);
}

function positionAt(text, index) {
  const source = asText(text);
  const limit = Math.max(0, Math.min(index, source.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < limit; i += 1) {
    if (source.charAt(i) === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/* 把注释和字符串替换成等长空白，避免误伤注释里的示例文字；保留换行，行号仍准确。 */
function maskJs(source) {
  const text = asText(source);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '/' && text.charAt(i + 1) === '/') {
      const end = text.indexOf('\n', i + 2);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < text.length) {
        const current = text.charAt(j);
        if (current === '\\') {
          j += 2;
          continue;
        }
        if (current === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += text.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const FORBIDDEN_JS_RULES = [
  {
    id: 'LC_E_JS_DOCUMENT_WRITE',
    pattern: /\bdocument\s*\.\s*(?:write|writeln)\s*\(/g,
    message: '禁止使用 document.write / document.writeln：它会覆盖当前文档。'
  },
  {
    id: 'LC_E_JS_INNER_HTML_CONCAT',
    pattern: /\b(?:inner|outer)HTML\s*\+?=/g,
    message: '禁止直接给 innerHTML / outerHTML 赋拼接结果：请用文本节点或模板中已转义的 {{字段}}。',
    check(match, _masked, text) {
      const after = text.slice(match.index + match[0].length);
      const trimmed = after.trimStart();
      if (/^["'`]/.test(trimmed)) {
        const quote = trimmed.charAt(0);
        const body = trimmed.slice(1);
        const close = body.indexOf(quote);
        const literal = close === -1 ? body : body.slice(0, close);
        if (literal.includes('${')) return true;
        if (close === -1) return true;
        const rest = body.slice(close + 1).trimStart();
        return /^\+/.test(rest);
      }
      return true;
    }
  }
];

/**
 * 保存前拦截危险 JS。
 * @returns {{rule:string, message:string, line:number, column:number, snippet:string}|null}
 */
export function checkDangerousJs(source) {
  const text = asText(source);
  if (!text.trim()) return null;
  const masked = maskJs(text);
  for (const rule of FORBIDDEN_JS_RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(masked))) {
      if (typeof rule.check === 'function' && !rule.check(match, masked, text)) continue;
      const pos = positionAt(text, match.index);
      const lineText = text.split('\n')[pos.line - 1] || '';
      return {
        rule: rule.id,
        message: rule.message,
        line: pos.line,
        column: pos.column,
        snippet: lineText.trim().slice(0, 160)
      };
    }
  }
  return null;
}

function normalizeTag(value) {
  const text = asText(value).trim();
  if (!text) return '';
  if (text.length > COMPONENT_LIMITS.tagLength) {
    throw fail(422, 'LC_E_COMPONENT_TAG', '标签「' + text.slice(0, 12) + '…」超过 ' + COMPONENT_LIMITS.tagLength + ' 个字符');
  }
  return text;
}

function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : asText(value).split(/[,，;；\s]+/);
  const out = [];
  for (const item of list) {
    const tag = normalizeTag(item);
    if (tag && out.indexOf(tag) === -1) out.push(tag);
  }
  if (out.length > COMPONENT_LIMITS.tagCount) {
    throw fail(422, 'LC_E_COMPONENT_TAG_LIMIT', '最多 ' + COMPONENT_LIMITS.tagCount + ' 个标签');
  }
  return out;
}

function normalizeEnumOptions(value) {
  const list = Array.isArray(value)
    ? value
    : asText(value).split(/[,，;；\n]+/);
  const out = [];
  for (const item of list) {
    const text = asText(item).trim();
    if (text && out.indexOf(text) === -1) out.push(text);
  }
  return out.slice(0, 40);
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normalizeDefaultValue(field) {
  const value = field.defaultValue;
  if (value === undefined || value === null || value === '') {
    if (field.type === 'boolean') return false;
    return '';
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const text = asText(value).trim().toLowerCase();
    if (text === 'true' || text === '1' || text === '是') return true;
    if (text === 'false' || text === '0' || text === '否') return false;
    throw fail(422, 'LC_E_COMPONENT_FIELD_DEFAULT', '字段「' + field.id + '」的默认值必须是 true / false');
  }
  if (field.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw fail(422, 'LC_E_COMPONENT_FIELD_DEFAULT', '字段「' + field.id + '」的默认值必须是数字');
    }
    return number;
  }
  if (field.type === 'color') {
    const text = asText(value).trim();
    if (!COLOR_RE.test(text)) {
      throw fail(422, 'LC_E_COMPONENT_FIELD_DEFAULT', '字段「' + field.id + '」的默认值必须是 #rgb / #rrggbb 颜色');
    }
    return text;
  }
  if (field.type === 'enum') {
    const text = asText(value).trim();
    if (field.options.length && field.options.indexOf(text) === -1) {
      throw fail(422, 'LC_E_COMPONENT_FIELD_DEFAULT', '字段「' + field.id + '」的默认值不在枚举选项里');
    }
    return text;
  }
  return asText(value);
}

/**
 * 归一化单个字段定义。
 * 旧格式（字符串）按「字段 ID」处理，保持与已有组件兼容。
 */
export function normalizeField(raw, index = 0) {
  if (raw == null) throw fail(422, 'LC_E_COMPONENT_FIELD', '第 ' + (index + 1) + ' 个字段是空值');
  const source = typeof raw === 'string' ? { id: raw } : raw;
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw fail(422, 'LC_E_COMPONENT_FIELD', '第 ' + (index + 1) + ' 个字段不是对象');
  }
  const id = normalizeFieldId(source.id || source.key || source.name);
  const type = FIELD_TYPE_VALUES.has(source.type) ? source.type : 'text';
  const field = {
    id,
    label: asText(source.label || source.title || id).trim().slice(0, 64) || id,
    type,
    required: Boolean(source.required),
    options: type === 'enum' ? normalizeEnumOptions(source.options) : [],
    defaultValue: ''
  };
  field.defaultValue = normalizeDefaultValue(Object.assign({ options: [] }, field, {
    options: field.options,
    defaultValue: source.defaultValue !== undefined ? source.defaultValue : source.default
  }));
  return field;
}

export function normalizeFields(value) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > COMPONENT_LIMITS.fieldsPerComponent) {
    throw fail(422, 'LC_E_COMPONENT_FIELD_LIMIT', '单组件最多 ' + COMPONENT_LIMITS.fieldsPerComponent + ' 个字段');
  }
  const out = [];
  const seen = new Set();
  list.forEach((raw, index) => {
    const field = normalizeField(raw, index);
    if (seen.has(field.id)) {
      throw fail(409, 'LC_E_COMPONENT_FIELD_DUPLICATE', '字段 ID 重复：' + field.id);
    }
    seen.add(field.id);
    out.push(field);
  });
  return out;
}

function assertSize(label, value, limit, code) {
  const bytes = Buffer.byteLength(asText(value));
  if (bytes > limit) {
    throw fail(413, code, label + '超过 ' + (limit / 1024) + ' KB（当前 ' + Math.ceil(bytes / 1024) + ' KB）');
  }
}

function validateSource(component) {
  const htmlError = Render.checkHtml(component.template);
  if (htmlError) {
    throw fail(422, 'LC_E_COMPONENT_HTML', 'HTML 模板语法错误（第 ' + htmlError.line + ' 行，第 ' + htmlError.column + ' 列）：' + htmlError.message, htmlError);
  }
  const cssError = Render.checkCss(component.css);
  if (cssError) {
    throw fail(422, 'LC_E_COMPONENT_CSS', 'CSS 语法错误（第 ' + cssError.line + ' 行，第 ' + cssError.column + ' 列）：' + cssError.message, cssError);
  }
  const danger = checkDangerousJs(component.js);
  if (danger) {
    throw fail(422, 'LC_E_COMPONENT_JS_FORBIDDEN', '组件 JS 被拦截：' + danger.message + '（第 ' + danger.line + ' 行）', danger);
  }
  const jsError = Render.checkJs(component.js);
  if (jsError) {
    throw fail(422, 'LC_E_COMPONENT_JS', 'JS 语法错误（第 ' + jsError.line + ' 行，第 ' + jsError.column + ' 列）：' + jsError.message, jsError);
  }
  const inlineErrors = Render.checkInlineScripts(component.template);
  if (inlineErrors.length) {
    const first = inlineErrors[0];
    throw fail(422, 'LC_E_COMPONENT_INLINE_SCRIPT', first.message, first);
  }
}

function defaultMeta(component, existing) {
  const now = new Date().toISOString();
  return {
    schemaVersion: COMPONENT_SCHEMA_VERSION,
    id: component.id,
    name: component.name,
    description: component.description,
    category: component.category,
    icon: component.icon,
    tags: component.tags,
    fields: component.fields,
    template: component.template,
    css: component.css,
    js: component.js,
    builtin: false,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now
  };
}

/**
 * 校验并归一化组件输入。
 * @param {object} raw 用户输入
 * @param {{id?:string, fallbackId?:string, existing?:object}} options
 */
export function normalizeComponent(raw, options = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = asText(source.name).trim();
  if (!name) throw fail(422, 'LC_E_COMPONENT_NAME', '组件名称不能为空');
  if (name.length > COMPONENT_LIMITS.nameLength) {
    throw fail(422, 'LC_E_COMPONENT_NAME', '组件名称不能超过 ' + COMPONENT_LIMITS.nameLength + ' 个字符');
  }
  const id = normalizeComponentId(options.id || source.id || slugifyId(name, options.fallbackId || 'component'));
  const category = CATEGORY_VALUES.has(source.category) ? source.category : 'other';
  const icon = ICON_VALUES.has(source.icon) ? source.icon : 'box';
  const tags = normalizeTags(source.tags);
  const fields = normalizeFields(source.fields);
  const template = asText(source.template);
  if (!template.trim()) throw fail(422, 'LC_E_COMPONENT_TEMPLATE', 'HTML 模板不能为空');
  assertSize('HTML 模板', template, COMPONENT_LIMITS.templateBytes, 'LC_E_COMPONENT_TEMPLATE_SIZE');
  const css = asText(source.css);
  assertSize('CSS', css, COMPONENT_LIMITS.cssBytes, 'LC_E_COMPONENT_CSS_SIZE');
  const js = asText(source.js);
  assertSize('JS', js, COMPONENT_LIMITS.jsBytes, 'LC_E_COMPONENT_JS_SIZE');
  const description = asText(source.description).trim().slice(0, 512);

  const component = { id, name, description, category, icon, tags, fields, template, css, js };
  validateSource(component);
  return defaultMeta(component, options.existing);
}

/** 读取磁盘上的组件时做宽松归一化，不因旧字段格式报错。 */
export function normalizeStoredComponent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let fields = [];
  try {
    fields = normalizeFields(source.fields);
  } catch {
    fields = [];
  }
  return {
    schemaVersion: COMPONENT_SCHEMA_VERSION,
    id: asText(source.id),
    name: asText(source.name || source.id),
    description: asText(source.description),
    category: CATEGORY_VALUES.has(source.category) ? source.category : 'other',
    icon: ICON_VALUES.has(source.icon) ? source.icon : 'box',
    tags: Array.isArray(source.tags) ? source.tags.map(asText).filter(Boolean) : [],
    fields,
    template: asText(source.template),
    css: asText(source.css),
    js: asText(source.js),
    builtin: false,
    createdAt: asText(source.createdAt),
    updatedAt: asText(source.updatedAt)
  };
}

const SAMPLE_TEXT = '示例文本';
const SAMPLE_COLOR = '#3e6a56';
const SAMPLE_IMAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#d8d2c4"/><path d="M25 75l30-32 24 24 20-16 36 40" stroke="#5f656b" stroke-width="4" fill="none"/></svg>'
);

export function sampleValue(field) {
  if (field && field.defaultValue !== '' && field.defaultValue !== undefined && field.defaultValue !== null) {
    return field.defaultValue;
  }
  switch (field && field.type) {
    case 'number': return 12;
    case 'boolean': return true;
    case 'textarea': return '第一行示例文本\n第二行示例文本';
    case 'color': return SAMPLE_COLOR;
    case 'enum': return (field.options && field.options[0]) || '选项一';
    case 'datasource': return 'orders';
    case 'image': return SAMPLE_IMAGE;
    default: return SAMPLE_TEXT;
  }
}

export function sampleData(fields, overrides) {
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  const out = {};
  (fields || []).forEach((field) => {
    out[field.id] = Object.prototype.hasOwnProperty.call(source, field.id) ? source[field.id] : sampleValue(field);
  });
  return out;
}

function escapeHtml(value) {
  return asText(value).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

export function renderTemplate(template, data) {
  return asText(template).replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const value = data ? data[key] : '';
    return escapeHtml(value == null ? '' : value);
  });
}

export function scopeOf(componentId) {
  return '[data-lc-comp="' + asText(componentId).replace(/"/g, '\\"') + '"]';
}

export function buildScopeInfo(componentId) {
  const prefix = scopeOf(componentId);
  return {
    cssPrefix: prefix,
    instancePrefix: '[data-lc-instance="<区块 ID>"]',
    css: [
      '组件中的每个选择器都会自动加上 ' + prefix + ' 前缀；.card 实际变成 ' + prefix + ' .card。',
      ':root / html / body 会映射到组件根节点，不会影响整页。',
      '@import 会被丢弃（渲染层不访问网络）；@keyframes 名称不改，同名时后加载的覆盖先加载的。'
    ],
    js: [
      '每段 JS 都包在独立 IIFE 中执行，root 指向当前实例的 [data-lc-instance] 根节点。',
      '不要在 JS 里写 window.xxx = ... 这样的全局赋值；需要共享状态请用 root 上的自定义属性。',
      '禁止 document.write / document.writeln，也禁止直接给 innerHTML / outerHTML 赋拼接结果。'
    ]
  };
}

export function renderPreview(raw, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const componentId = asText(source.id || 'preview') || 'preview';
  let fields = [];
  const errors = [];
  try {
    fields = normalizeFields(source.fields);
  } catch (error) {
    errors.push({ field: 'fields', message: error.message });
    fields = Array.isArray(source.fields)
      ? source.fields.filter((item) => item && typeof item === 'object').map((item, index) => ({
          id: asText(item.id || item.key || ('field-' + (index + 1))),
          label: asText(item.label || item.id || ('字段 ' + (index + 1))),
          type: FIELD_TYPE_VALUES.has(item.type) ? item.type : 'text',
          required: Boolean(item.required),
          options: Array.isArray(item.options) ? item.options.map(asText) : [],
          defaultValue: item.defaultValue == null ? '' : item.defaultValue
        }))
      : [];
  }
  const template = asText(source.template);
  const htmlError = Render.checkHtml(template);
  if (htmlError) errors.push({ field: 'html', message: htmlError.message, line: htmlError.line, column: htmlError.column });
  const danger = checkDangerousJs(source.js);
  if (danger) errors.push({ field: 'js', message: danger.message, line: danger.line, column: danger.column, rule: danger.rule });
  const jsError = danger ? null : Render.checkJs(source.js);
  if (jsError) errors.push({ field: 'js', message: jsError.message, line: jsError.line, column: jsError.column });
  /* 模板里的内联 <script> 是预览空白的主要来源：语法错误不进 HTML 检查，
     必须单独扫描，否则只会在沙箱 iframe 控制台里静默失败。 */
  Render.checkInlineScripts(template).forEach((item) => errors.push(item));
  const cssWarnings = [];
  const scopedCss = Render.scopeCss(asText(source.css), scopeOf(componentId), (message) => {
    cssWarnings.push(message);
  });
  const data = sampleData(fields, options.sample);
  const html = renderTemplate(template, data);
  const js = danger ? '' : asText(source.js);
  return {
    html,
    css: scopedCss,
    js,
    fields,
    sample: data,
    errors,
    warnings: cssWarnings,
    blocked: danger ? { rule: danger.rule, message: danger.message, line: danger.line, column: danger.column } : null,
    scope: buildScopeInfo(componentId)
  };
}

function builtinCategory(type) {
  if (/chart|table|kpi|progress|sparkline|stats/.test(type)) return 'data';
  if (/form|textfield|otp|upload|date|slider|autocomplete|select|multiselect|radio|checkbox|switch|number|textarea|tags|cascader|rating/.test(type)) return 'form';
  if (/site-nav|site-footer|sidebar|breadcrumb|page-header|drawer|modal/.test(type)) return 'layout';
  if (/carousel|timeline|code/.test(type)) return 'media';
  return 'feedback';
}

function builtinIcon(type) {
  if (/chart|sparkline|kpi|progress/.test(type)) return 'chart';
  if (/table/.test(type)) return 'table';
  if (/form|textfield|otp|upload|date|slider|autocomplete|select|multiselect|radio|checkbox|switch|number|textarea|tags|cascader|rating/.test(type)) return 'form';
  if (/image|carousel/.test(type)) return 'image';
  if (/code/.test(type)) return 'code';
  if (/site-nav|site-footer|sidebar|breadcrumb|page-header|drawer|modal/.test(type)) return 'layout';
  if (/timeline/.test(type)) return 'text';
  return 'box';
}

function propToField(key, prop) {
  const source = prop && typeof prop === 'object' ? prop : {};
  let type = 'text';
  if (source.type === 'number') type = 'number';
  else if (source.type === 'boolean') type = 'boolean';
  else if (source.type === 'enum') type = 'enum';
  else if (source.type === 'array' || source.type === 'object') type = 'textarea';
  if (String(source.format || '') === 'color') type = 'color';
  const options = type === 'enum' && Array.isArray(source.options)
    ? source.options.map((item) => (typeof item === 'string' ? item : asText(item && item.value))).filter(Boolean)
    : [];
  return {
    id: slugifyId(key, 'field'),
    label: asText(source.label || key),
    type,
    required: false,
    options,
    defaultValue: source.default === undefined || source.default === null ? '' : source.default
  };
}

function builtinScaffold(name, fields) {
  const lines = fields.map((field) => '    <p class="lc-copy-row"><span class="lc-copy-label">' + escapeHtml(field.label) + '</span> {{' + field.id + '}}</p>');
  return [
    '<div class="lc-copy-comp">',
    '  <h3 class="lc-copy-title">' + escapeHtml(name) + '</h3>',
    '  <p class="lc-copy-hint">这是内置组件的自定义副本，请按需改写模板、样式与脚本。</p>',
    lines.length ? lines.join('\n') : '  <p>暂无字段</p>',
    '</div>'
  ].join('\n');
}

const BUILTIN_FALLBACK = [
  { type: 'ui-table', name: '数据表格' },
  { type: 'ui-form', name: '表单' },
  { type: 'ui-card', name: '卡片' },
  { type: 'ui-chart-line', name: '折线图' }
];

export function builtinComponents() {
  let schemas = [];
  try {
    schemas = typeof Render.componentsSchemas === 'function' ? Render.componentsSchemas() : [];
  } catch {
    schemas = [];
  }
  if (!Array.isArray(schemas) || !schemas.length) schemas = BUILTIN_FALLBACK;
  return schemas.filter((schema) => schema && schema.type).map((schema) => {
    const fields = Object.keys(schema.props || {}).map((key) => propToField(key, schema.props[key]));
    const id = 'builtin:' + schema.type;
    return {
      schemaVersion: COMPONENT_SCHEMA_VERSION,
      id,
      builtinId: schema.type,
      builtin: true,
      name: asText(schema.name || schema.type),
      description: '内置组件，只读；可复制为自定义组件后再改。',
      category: builtinCategory(schema.type),
      icon: builtinIcon(schema.type),
      tags: ['内置'],
      fields,
      sample: (typeof Render.getComponentDefaults === 'function' && Render.getComponentDefaults(schema.type))
        || Render.componentSample(schema.type)
        || {},
      template: builtinScaffold(asText(schema.name || schema.type), fields),
      css: [
        '.lc-copy-comp { padding: var(--lc-space-4); border: var(--lc-border); border-radius: var(--lc-radius-md); background: var(--lc-color-surface); }',
        '.lc-copy-title { margin: 0 0 var(--lc-space-2); font-family: var(--lc-font-serif); font-size: var(--lc-text-lg); }',
        '.lc-copy-hint { margin: 0 0 var(--lc-space-3); color: var(--lc-color-muted); font-size: var(--lc-text-xs); }',
        '.lc-copy-row { margin: 0 0 var(--lc-space-1); font-size: var(--lc-text-sm); }',
        '.lc-copy-label { display: inline-block; min-width: 96px; color: var(--lc-color-muted); }'
      ].join('\n'),
      js: '',
      createdAt: '',
      updatedAt: '',
      usageCount: 0,
      usagePages: []
    };
  });
}

export function findBuiltin(id) {
  const raw = asText(id).replace(/^builtin:/, '');
  return builtinComponents().find((item) => item.builtinId === raw) || null;
}

/* ---------------- 使用扫描 ---------------- */

function pageBlocks(page) {
  return Array.isArray(page && page.blocks) ? page.blocks : [];
}

function walkBlocks(blocks, visit) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue;
    visit(block);
    if (Array.isArray(block.blocks)) walkBlocks(block.blocks, visit);
  }
}

export async function scanAllComponentUsage(adapter) {
  const entries = await adapter.list('pages', { recursive: false }).catch(() => []);
  const byComponent = new Map();
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue;
    let page;
    try {
      page = JSON.parse(await adapter.read(entry.path));
    } catch {
      continue;
    }
    const counts = new Map();
    walkBlocks(pageBlocks(page), (block) => {
      if (String(block.type || '') !== 'component') return;
      const id = asText(block.componentId);
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    const pageInfo = {
      pageId: asText(page.id || path.posix.basename(entry.path, '.json')),
      pageTitle: asText(page.title || page.id),
      pagePath: asText(page.path || '')
    };
    for (const [id, count] of counts) {
      if (!byComponent.has(id)) byComponent.set(id, []);
      byComponent.get(id).push(Object.assign({ count }, pageInfo));
    }
  }
  for (const items of byComponent.values()) {
    items.sort((a, b) => String(a.pageTitle).localeCompare(String(b.pageTitle), 'zh-CN'));
  }
  return byComponent;
}

export async function scanComponentUsage(adapter, componentId) {
  const id = asText(componentId);
  const map = await scanAllComponentUsage(adapter);
  return map.get(id) || [];
}

export function usageTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (Number(item.count) || 0), 0);
}

/* ---------------- 字段差异 ---------------- */

const BREAKING_TYPES = new Set(['removed', 'type']);

export function diffFields(previous, next) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(next) ? next : [];
  const afterMap = new Map(after.map((field) => [field.id, field]));
  const beforeMap = new Map(before.map((field) => [field.id, field]));
  const items = [];
  for (const field of before) {
    const target = afterMap.get(field.id);
    if (!target) {
      items.push({ id: field.id, label: field.label, kind: 'removed', message: '字段「' + field.label + '」已被删除' });
      continue;
    }
    if (target.type !== field.type) {
      items.push({
        id: field.id,
        label: field.label,
        kind: 'type',
        from: field.type,
        to: target.type,
        message: '字段「' + field.label + '」类型从 ' + fieldLabel(field.type) + ' 改为 ' + fieldLabel(target.type)
      });
    }
  }
  for (const field of after) {
    if (!beforeMap.has(field.id)) {
      items.push({ id: field.id, label: field.label, kind: 'added', message: '新增字段「' + field.label + '」' });
    }
  }
  return { items, breaking: items.filter((item) => BREAKING_TYPES.has(item.kind)) };
}

export function assertSafePath(relPath) {
  return normalizeRelPath(relPath);
}
