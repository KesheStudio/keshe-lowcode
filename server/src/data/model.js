/* 数据源 · 集合模型（纯函数）
 *
 * 只做校验、归一化、示例数据与引用扫描，不读写文件、不连接外部服务。
 * 契约：CONTRACTS-v1 3.2 / DS_SCHEMA_VERSION=1。
 */
import crypto from 'node:crypto';

export const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'enum', 'reference', 'json'];

export const FIELD_TYPE_LABELS = {
  text: '文本',
  number: '数字',
  boolean: '布尔',
  date: '日期',
  enum: '枚举',
  reference: '引用',
  json: 'JSON'
};

/* 上限集中在这里，界面与接口都从同一份数字取，不允许各处各写一套。 */
export const DATA_LIMITS = {
  collections: 100,
  fieldsPerCollection: 64,
  indexesPerCollection: 32,
  rowsPerCollection: 50000,
  sampleRows: 100,
  importBytes: 5 * 1024 * 1024,
  importRows: 20000,
  requestTimeoutMs: 10000,
  requestTimeoutMinMs: 1000,
  requestTimeoutMaxMs: 30000,
  responseBytes: 1024 * 1024,
  responseBytesMin: 1024,
  responseBytesMax: 10 * 1024 * 1024,
  previewRows: 20,
  nameLength: 64,
  descriptionLength: 512,
  enumValues: 200
};

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROW_ID_RE = /^row-[A-Za-z0-9_-]{4,64}$/;

export function fail(statusCode, code, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  return error;
}

function sha1(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function slugId(name, prefix) {
  const base = String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (base && /[a-z]/.test(base)) return ID_RE.test(base) ? base : prefix + '-' + sha1(base).slice(0, 8);
  return prefix + '-' + sha1(String(name == null ? '' : name) || prefix).slice(0, 8);
}

function uniqueId(preferred, taken) {
  let candidate = preferred;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = preferred.slice(0, 60) + '-' + index;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
}

export function normalizeCollectionId(value) {
  const id = text(value, 64).toLowerCase();
  if (!ID_RE.test(id)) throw fail(400, 'LC_E_DATA_VALIDATION', '集合 ID 只能用小写字母、数字、下划线和短横线');
  return id;
}

export function normalizeRowId(value) {
  const id = text(value, 64);
  if (!ROW_ID_RE.test(id)) throw fail(400, 'LC_E_DATA_VALIDATION', '行 ID 非法');
  return id;
}

export function defaultForField(field) {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'enum': return field.enumValues && field.enumValues.length ? field.enumValues[0] : '';
    case 'json': return null;
    case 'reference': return '';
    default: return '';
  }
}

/* ---------- 字段 ---------- */

export function normalizeField(input, taken) {
  const src = input && typeof input === 'object' ? input : {};
  const name = text(src.name, DATA_LIMITS.nameLength);
  if (!name) throw fail(400, 'LC_E_DATA_VALIDATION', '字段名不能为空');
  const type = text(src.type, 20).toLowerCase();
  if (!FIELD_TYPES.includes(type)) {
    throw fail(400, 'LC_E_DATA_VALIDATION', '字段「' + name + '」的类型只支持 ' + FIELD_TYPES.join(' / '));
  }
  const preferred = text(src.id, 64).toLowerCase() || slugId(name, 'f');
  if (!ID_RE.test(preferred)) throw fail(400, 'LC_E_DATA_VALIDATION', '字段「' + name + '」的 ID 非法');
  const id = uniqueId(preferred, taken);

  const field = {
    id,
    name,
    type,
    required: src.required === true,
    unique: src.unique === true,
    description: text(src.description, DATA_LIMITS.descriptionLength)
  };

  if (type === 'enum') {
    const raw = Array.isArray(src.enumValues) ? src.enumValues : [];
    const values = [];
    for (const item of raw) {
      const value = text(item, 128);
      if (value && values.indexOf(value) === -1) values.push(value);
    }
    if (!values.length) throw fail(400, 'LC_E_DATA_VALIDATION', '枚举字段「' + name + '」至少需要一个可选值');
    if (values.length > DATA_LIMITS.enumValues) {
      throw fail(400, 'LC_E_DATA_VALIDATION', '枚举字段「' + name + '」最多 ' + DATA_LIMITS.enumValues + ' 个可选值');
    }
    field.enumValues = values;
    field.default = values.indexOf(text(src.default, 128)) >= 0 ? text(src.default, 128) : values[0];
  } else if (type === 'reference') {
    field.refCollection = text(src.refCollection, 64) || '';
    field.refField = text(src.refField, 64) || '';
  } else {
    field.default = src.default === undefined ? undefined : src.default;
  }

  return field;
}

export function normalizeFields(input) {
  if (!Array.isArray(input) || !input.length) {
    throw fail(400, 'LC_E_DATA_VALIDATION', '集合至少需要一个字段');
  }
  if (input.length > DATA_LIMITS.fieldsPerCollection) {
    throw fail(400, 'LC_E_DATA_VALIDATION', '一个集合最多 ' + DATA_LIMITS.fieldsPerCollection + ' 个字段');
  }
  const taken = new Set();
  const explicitIds = new Set();
  for (const item of input) {
    const raw = item && typeof item === 'object' && item.id !== undefined ? text(item.id, 64).toLowerCase() : '';
    if (!raw) continue;
    if (explicitIds.has(raw)) throw fail(409, 'LC_E_DATA_FIELD_ID_CONFLICT', '字段 ID 重复：' + raw);
    explicitIds.add(raw);
  }
  return input.map((field) => normalizeField(field, taken));
}

export function normalizeIndexes(input, fields) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw fail(400, 'LC_E_DATA_VALIDATION', 'indexes 必须是数组');
  if (input.length > DATA_LIMITS.indexesPerCollection) {
    throw fail(400, 'LC_E_DATA_VALIDATION', '一个集合最多 ' + DATA_LIMITS.indexesPerCollection + ' 个索引');
  }
  const fieldIds = new Set(fields.map((field) => field.id));
  const taken = new Set(fields.filter((field) => field.unique).map((field) => field.id));
  return input.map((item, index) => {
    const src = item && typeof item === 'object' ? item : {};
    const ids = Array.isArray(src.fields) ? src.fields.map((id) => text(id, 64)).filter(Boolean) : [];
    if (!ids.length) throw fail(400, 'LC_E_DATA_VALIDATION', '第 ' + (index + 1) + ' 个索引至少需要一个字段');
    for (const id of ids) {
      if (!fieldIds.has(id)) throw fail(400, 'LC_E_DATA_VALIDATION', '索引引用了不存在的字段：' + id);
    }
    const preferred = text(src.id, 64).toLowerCase() || 'idx-' + ids.join('-').slice(0, 40);
    if (!ID_RE.test(preferred)) throw fail(400, 'LC_E_DATA_VALIDATION', '索引 ID 非法');
    return {
      id: uniqueId(preferred, taken),
      name: text(src.name, DATA_LIMITS.nameLength) || ids.join(' + '),
      fields: ids,
      unique: src.unique === true
    };
  });
}

/* ---------- 值 ---------- */

/* Date.parse 会把 2026-02-30 静默归一到 3 月 2 日，这里按日历回读校验日期部分。 */
function isCalendarDate(raw) {
  const textValue = String(raw);
  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(textValue);
  if (matched) {
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
      return false;
    }
  }
  return Number.isFinite(Date.parse(textValue));
}

function valueIsEmpty(field, value) {
  if (value == null) return true;
  if (field.type === 'text' || field.type === 'enum' || field.type === 'reference' || field.type === 'date') {
    return typeof value === 'string' && value.trim() === '';
  }
  return false;
}

export function coerceFieldValue(field, raw, options = {}) {
  const strict = options.strict !== false;
  const label = field.name || field.id;

  if (valueIsEmpty(field, raw)) {
    if (field.required) throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」必填');
    return defaultForField(field);
  }

  switch (field.type) {
    case 'text': {
      if (strict && typeof raw !== 'string') {
        throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」需要文本');
      }
      return String(raw);
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」需要数字，收到：' + String(raw));
      }
      return value;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (strict) throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」需要布尔值');
      const lowered = String(raw).trim().toLowerCase();
      if (['true', '1', 'yes', '是'].includes(lowered)) return true;
      if (['false', '0', 'no', '否', ''].includes(lowered)) return false;
      throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」无法识别为布尔值：' + String(raw));
    }
    case 'date': {
      if (typeof raw !== 'string') throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」需要日期字符串');
      if (!isCalendarDate(raw)) {
        throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」不是有效日期：' + raw);
      }
      return raw;
    }
    case 'enum': {
      const value = String(raw);
      if (!field.enumValues.includes(value)) {
        throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」只能是：' + field.enumValues.join(' / '));
      }
      return value;
    }
    case 'reference': {
      if (strict && typeof raw !== 'string' && typeof raw !== 'number') {
        throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」需要引用 ID');
      }
      return String(raw);
    }
    case 'json': {
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw);
        } catch {
          throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」不是合法 JSON');
        }
      }
      return raw;
    }
    default:
      throw fail(409, 'LC_E_DATA_INVALID_ROW', '字段「' + label + '」类型未知');
  }
}

function stableText(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeRow(fields, raw, options = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!src) throw fail(409, 'LC_E_DATA_INVALID_ROW', '行必须是对象');
  const strict = options.strict !== false;
  const known = new Set(fields.map((field) => field.id));
  if (strict) {
    for (const key of Object.keys(src)) {
      if (key === 'id' || key === '_id') continue;
      if (!known.has(key)) throw fail(409, 'LC_E_DATA_INVALID_ROW', '未知字段：' + key);
    }
  }
  const row = {};
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(src, field.id);
    row[field.id] = coerceFieldValue(field, present ? src[field.id] : undefined, { strict });
  }
  return row;
}

/* 唯一约束：unique 字段 + 显式索引（含索引 unique）。返回第一个冲突。 */
export function checkUniqueness(collection, row, rowId, rows) {
  const checks = [];
  for (const field of collection.fields) {
    if (field.unique) checks.push({ label: '字段「' + field.name + '」', fields: [field.id] });
  }
  for (const index of collection.indexes || []) {
    if (index.unique) checks.push({ label: '索引「' + index.name + '」', fields: index.fields });
  }
  const list = Array.isArray(rows) ? rows : [];
  for (const check of checks) {
    const probe = check.fields.map((id) => stableText(row[id]));
    for (const other of list) {
      if (other.id === rowId) continue;
      const target = check.fields.map((id) => stableText(other[id]));
      if (probe.every((value, i) => value === target[i])) {
        throw fail(409, 'LC_E_DATA_ROW_CONFLICT', check.label + '必须唯一，已存在相同值的行');
      }
    }
  }
}

/* ---------- 集合 ---------- */

export function normalizeCollection(input, options = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const existing = options.existing || null;

  const name = text(src.name, DATA_LIMITS.nameLength);
  if (!name) throw fail(400, 'LC_E_DATA_VALIDATION', '集合名称不能为空');

  const preferredId = text(src.id, 64).toLowerCase() || (existing ? existing.id : slugId(name, 'col'));
  if (!ID_RE.test(preferredId)) throw fail(400, 'LC_E_DATA_VALIDATION', '集合 ID 非法');

  const fields = normalizeFields(src.fields !== undefined ? src.fields : (existing ? existing.fields : undefined));
  const indexes = normalizeIndexes(src.indexes !== undefined ? src.indexes : (existing ? existing.indexes : []), fields);

  const now = new Date().toISOString();
  const collection = {
    schemaVersion: 1,
    id: preferredId,
    name,
    description: text(src.description, DATA_LIMITS.descriptionLength),
    fields,
    indexes,
    rows: Array.isArray(src.rows) ? src.rows.slice(0, DATA_LIMITS.rowsPerCollection) : [],
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now
  };
  return collection;
}

export function normalizeStoredRow(row) {
  const src = row && typeof row === 'object' ? row : {};
  const id = ROW_ID_RE.test(String(src.id || '')) ? String(src.id) : 'row-' + crypto.randomUUID();
  const out = { id };
  for (const [key, value] of Object.entries(src)) {
    if (key !== 'id') out[key] = value;
  }
  return out;
}

/* 把外部行（含 id）逐条校验并归一化；strict=false 时做宽松转换。 */
export function prepareRows(collection, input, options = {}) {
  const strict = options.strict !== false;
  const rows = [];
  const usedIds = new Set();
  for (const item of Array.isArray(input) ? input : []) {
    const id = ROW_ID_RE.test(String((item && item.id) || '')) ? String(item.id) : 'row-' + crypto.randomUUID();
    if (usedIds.has(id)) throw fail(409, 'LC_E_DATA_ROW_ID_CONFLICT', '同一次提交里的行 ID 重复：' + id);
    usedIds.add(id);
    const row = normalizeRow(collection.fields, item, { strict });
    const withId = Object.assign({ id }, row);
    checkUniqueness(collection, withId, id, rows);
    rows.push(withId);
  }
  return rows;
}

/* 字段变更影响面：新增安全；改类型 / 删除 / 改引用目标会破坏既有页面绑定。 */
export function diffFieldSchema(prevFields, nextFields) {
  const before = new Map((prevFields || []).map((field) => [field.id, field]));
  const after = new Map((nextFields || []).map((field) => [field.id, field]));
  const added = [];
  const removed = [];
  const retyped = [];
  const retargeted = [];
  for (const field of after.values()) {
    const old = before.get(field.id);
    if (!old) {
      added.push({ id: field.id, name: field.name, type: field.type });
      continue;
    }
    if (old.type !== field.type) {
      retyped.push({ id: field.id, name: field.name, from: old.type, to: field.type });
    }
    if (field.type === 'reference' && old.type === 'reference' &&
        (old.refCollection !== field.refCollection || old.refField !== field.refField)) {
      retargeted.push({
        id: field.id,
        name: field.name,
        from: (old.refCollection || '') + (old.refField ? '.' + old.refField : ''),
        to: (field.refCollection || '') + (field.refField ? '.' + field.refField : '')
      });
    }
  }
  for (const field of before.values()) {
    if (!after.has(field.id)) removed.push({ id: field.id, name: field.name, type: field.type });
  }
  const breaking = removed.length + retyped.length + retargeted.length > 0;
  return { added, removed, retyped, retargeted, breaking };
}

export function changedFieldIds(diff) {
  return Array.from(new Set([
    ...diff.removed.map((item) => item.id),
    ...diff.retyped.map((item) => item.id),
    ...diff.retargeted.map((item) => item.id)
  ]));
}

/* ---------- 示例数据 ---------- */

function sampleValue(field, index, collection) {
  switch (field.type) {
    case 'number': return index + 1;
    case 'boolean': return index % 2 === 0;
    case 'date': {
      const base = Date.UTC(2025, 0, 1);
      return new Date(base + index * 86400000).toISOString().slice(0, 10);
    }
    case 'enum': return field.enumValues[index % field.enumValues.length];
    case 'reference': return (field.refCollection || 'ref') + '-1';
    case 'json': return { note: '示例 ' + (index + 1) };
    default: {
      const suffix = field.unique ? ' ' + (index + 1) : '';
      return (field.name || '示例') + ' ' + (index + 1) + suffix;
    }
  }
}

export function generateSampleRows(collection, count) {
  const total = Math.max(1, Math.min(DATA_LIMITS.sampleRows, Number(count) || 10));
  const rows = [];
  for (let index = 0; index < total; index += 1) {
    const row = { id: 'row-' + crypto.randomUUID() };
    for (const field of collection.fields) row[field.id] = sampleValue(field, index, collection);
    checkUniqueness(collection, row, row.id, rows);
    rows.push(row);
  }
  return rows;
}

/* ---------- 引用扫描 ---------- */

const REF_TOKEN_RE = /^([a-z0-9][a-z0-9_-]{0,63})\.([a-z0-9][a-z0-9_-]{0,63})$/;

function recordRef(map, ref) {
  const key = ref.collection + '\u0000' + (ref.field || '');
  if (map.has(key)) {
    const existing = map.get(key);
    if (!existing.files.includes(ref.file)) existing.files.push(ref.file);
    return;
  }
  map.set(key, { collection: ref.collection, field: ref.field || '', files: [ref.file], paths: [ref.path] });
}

function walkRefs(node, pathText, file, map) {
  if (typeof node === 'string') {
    const value = node.trim();
    const matched = REF_TOKEN_RE.exec(value);
    if (matched) {
      recordRef(map, { collection: matched[1], field: matched[2], file, path: pathText });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkRefs(item, pathText + '[' + index + ']', file, map));
    return;
  }
  if (!node || typeof node !== 'object') return;

  const cid = node.collectionId || node.collection || node.datasource || node.source;
  const fid = node.fieldId || node.field;
  if (typeof cid === 'string' && cid.trim()) {
    recordRef(map, {
      collection: cid.trim().replace(/^.*[./]/, ''),
      field: typeof fid === 'string' ? fid.trim() : '',
      file,
      path: pathText
    });
  }
  for (const [key, value] of Object.entries(node)) {
    walkRefs(value, pathText + '/' + key, file, map);
  }
}

export async function scanDataUsage(adapter, options = {}) {
  const map = new Map();
  const kinds = options.kinds || ['pages', 'components'];
  for (const kind of kinds) {
    const entries = await adapter.list(kind, { recursive: false }).catch(() => []);
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue;
      let parsed;
      try {
        parsed = JSON.parse(await adapter.read(entry.path));
      } catch {
        continue;
      }
      walkRefs(parsed, entry.path, entry.path, map);
    }
  }

  let items = Array.from(map.values());
  if (options.collection) {
    items = items.filter((item) => item.collection === options.collection);
  }
  if (options.field) {
    items = items.filter((item) => item.field === options.field);
  }
  return items;
}

export function flattenUsage(items) {
  const out = [];
  for (const item of items) {
    for (const file of item.files) {
      out.push({ collection: item.collection, field: item.field, file });
    }
  }
  return out;
}
