import path from 'node:path';
import fs from 'node:fs/promises';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { createBackup } from '../../../src/storage/backups.js';
import {
  DATA_LIMITS,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  fail,
  normalizeCollection,
  normalizeCollectionId,
  normalizeRowId,
  normalizeStoredRow,
  prepareRows,
  checkUniqueness,
  generateSampleRows,
  diffFieldSchema,
  changedFieldIds,
  scanDataUsage,
  flattenUsage,
  coerceFieldValue,
  defaultForField
} from '../data/model.js';
import { buildPreview, runImport, IMPORT_MODES, IMPORT_MODE_LABELS } from '../data/import.js';
import {
  SOURCE_METHODS,
  SOURCE_TARGETS,
  normalizeSource,
  sanitizeSource,
  collectSecretValues,
  secretKeysOf,
  stripSecretValues,
  performSourceTest
} from '../data/sources.js';

const COLLECTION_DIR = 'data/collections';
const SOURCES_FILE = 'data/sources.json';
const SOURCE_SECRET_FILE = path.join('.lowcode', 'data-secrets.json');

function adapterFor(ctx, siteId) {
  return createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
}

function collectionRel(id) {
  return COLLECTION_DIR + '/' + id + '.json';
}

/* 集合 ID 不可改：它写进页面绑定与导出快照，改名会断引用。 */

async function readCollection(adapter, id) {
  let textValue;
  try {
    textValue = await adapter.read(collectionRel(id));
  } catch {
    throw fail(404, 'LC_E_COLLECTION_NOT_FOUND', '集合不存在：' + id);
  }
  let parsed;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    throw fail(500, 'LC_E_COLLECTION_CORRUPT', '集合文件不是合法 JSON：' + id);
  }
  parsed.rows = Array.isArray(parsed.rows) ? parsed.rows.map(normalizeStoredRow) : [];
  parsed.fields = Array.isArray(parsed.fields) ? parsed.fields : [];
  parsed.indexes = Array.isArray(parsed.indexes) ? parsed.indexes : [];
  return parsed;
}

async function listCollections(adapter) {
  const entries = await adapter.list(COLLECTION_DIR, { recursive: false }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue;
    const id = path.posix.basename(entry.path, '.json');
    try {
      const collection = await readCollection(adapter, id);
      out.push({
        id: collection.id,
        name: collection.name,
        description: collection.description || '',
        fieldCount: collection.fields.length,
        rowCount: collection.rows.length,
        indexCount: collection.indexes.length,
        fields: collection.fields,
        updatedAt: collection.updatedAt || ''
      });
    } catch {
      /* 损坏的集合不阻塞其它集合展示，由单条接口给出具体错误。 */
    }
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  return out;
}

async function assertUniqueName(adapter, name, selfId) {
  const list = await listCollections(adapter);
  const target = String(name).trim().toLowerCase();
  const clash = list.find((item) => item.id !== selfId && String(item.name).trim().toLowerCase() === target);
  if (clash) throw fail(409, 'LC_E_COLLECTION_NAME', '已存在同名集合：' + clash.name);
}

function assertSourceNameFree(sources, name, selfId) {
  const target = String(name).trim().toLowerCase();
  const clash = sources.find((item) => item.id !== selfId && String(item.name).trim().toLowerCase() === target);
  if (clash) throw fail(409, 'LC_E_SOURCE_NAME', '已存在同名接口：' + clash.name);
}

function respondError(reply, error) {
  const status = Number(error.statusCode) || 500;
  return reply.code(status).send({
    ok: false,
    error: {
      code: error.code || 'LC_E_DATA',
      message: error.message,
      detail: error.detail
    }
  });
}

function siteOf(reply, ctx, request) {
  try {
    const siteId = sanitizeSiteId(request.params.siteId);
    return { siteId, adapter: adapterFor(ctx, siteId) };
  } catch (error) {
    reply.code(400).send({ ok: false, error: { code: 'LC_E_SITE_ID', message: '站点 ID 非法' } });
    return null;
  }
}

/* 数据写入支持乐观锁：请求可带 expectedRev，版本不匹配时由存储层返回 409。 */
function expectedRevOf(request) {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const raw = body.expectedRev !== undefined && body.expectedRev !== null
    ? body.expectedRev
    : request.query && request.query.expectedRev;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const rev = Number(raw);
  if (!Number.isInteger(rev) || rev < 0) throw fail(400, 'LC_E_DATA_VALIDATION', 'expectedRev 必须是非负整数');
  return rev;
}

function pageSlice(rows, query) {
  const offset = Math.max(0, Number(query && query.offset) || 0);
  const limit = Math.min(500, Math.max(1, Number(query && query.limit) || 100));
  return { offset, limit, rows: rows.slice(offset, offset + limit) };
}

function isEmptyCell(value) {
  if (Array.isArray(value)) return value.length === 0;
  return value == null || String(value).trim() === '';
}

function compareCells(left, right, type) {
  if (isEmptyCell(left) && isEmptyCell(right)) return 0;
  /* 空值始终排在最后，不随升降序翻转。 */
  if (isEmptyCell(left)) return 1;
  if (isEmptyCell(right)) return -1;
  if (type === 'number' || type === 'boolean') {
    const a = Number(left);
    const b = Number(right);
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  if (type === 'date') {
    const a = Date.parse(String(left));
    const b = Date.parse(String(right));
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  const textA = typeof left === 'object' ? JSON.stringify(left) : String(left);
  const textB = typeof right === 'object' ? JSON.stringify(right) : String(right);
  return textA.localeCompare(textB, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function sortParamOf(query, collection) {
  const sort = String((query && query.sort) || '').trim();
  const rawOrder = String((query && query.order) || '').trim().toLowerCase();
  if (!sort) {
    if (rawOrder) throw fail(400, 'LC_E_DATA_VALIDATION', 'order 需要与 sort 一起使用');
    return null;
  }
  if (sort !== 'id' && !collection.fields.some((field) => field.id === sort)) {
    throw fail(400, 'LC_E_DATA_SORT_FIELD', '排序字段不存在：' + sort);
  }
  if (rawOrder && rawOrder !== 'asc' && rawOrder !== 'desc') {
    throw fail(400, 'LC_E_DATA_VALIDATION', 'order 只能是 asc 或 desc');
  }
  return { sort, order: rawOrder || 'asc' };
}

function sortRows(rows, collection, spec) {
  const type = spec.sort === 'id'
    ? 'text'
    : (collection.fields.find((field) => field.id === spec.sort) || {}).type || 'text';
  const direction = spec.order === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = spec.sort === 'id' ? a.row.id : a.row[spec.sort];
      const right = spec.sort === 'id' ? b.row.id : b.row[spec.sort];
      const compared = compareCells(left, right, type);
      if (compared === 0) return a.index - b.index;
      /* 空值排序位不翻转，保持“空值在最后”的稳定语义。 */
      if (isEmptyCell(left) || isEmptyCell(right)) return compared;
      return compared * direction;
    })
    .map((item) => item.row);
}

function searchRows(rows, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => Object.keys(row).some((key) => {
    if (key === 'id') return false;
    return String(row[key] == null ? '' : row[key]).toLowerCase().includes(needle);
  }));
}

/**
 * 数据源 · 集合管理 + 自定义接口：
 * GET    /api/sites/:siteId/data/collections
 * POST   /api/sites/:siteId/data/collections
 * GET    /api/sites/:siteId/data/collections/:collectionId
 * PUT    /api/sites/:siteId/data/collections/:collectionId
 * DELETE /api/sites/:siteId/data/collections/:collectionId
 * GET    /api/sites/:siteId/data/collections/:collectionId/rows
 * POST   /api/sites/:siteId/data/collections/:collectionId/rows
 * PUT    /api/sites/:siteId/data/collections/:collectionId/rows/:rowId
 * DELETE /api/sites/:siteId/data/collections/:collectionId/rows/:rowId
 * POST   /api/sites/:siteId/data/collections/:collectionId/sample
 * GET    /api/sites/:siteId/data/usage
 * GET    /api/sites/:siteId/data/meta
 * GET    /api/sites/:siteId/data/sources
 * POST   /api/sites/:siteId/data/sources
 * PUT    /api/sites/:siteId/data/sources/:sourceId
 * DELETE /api/sites/:siteId/data/sources/:sourceId
 * POST   /api/sites/:siteId/data/sources/test
 */
async function readSourcesDoc(adapter) {
  let textValue;
  try {
    textValue = await adapter.read(SOURCES_FILE);
  } catch {
    return { schemaVersion: 1, sources: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    throw fail(500, 'LC_E_SOURCE_CORRUPT', '数据源文件不是合法 JSON：' + SOURCES_FILE);
  }
  if (Array.isArray(parsed)) return { schemaVersion: 1, sources: parsed };
  return {
    schemaVersion: 1,
    sources: Array.isArray(parsed.sources) ? parsed.sources : []
  };
}

async function writeSourcesDoc(adapter, doc, opts) {
  await adapter.write(SOURCES_FILE, JSON.stringify(doc, null, 2) + '\n', opts || {});
}

/* 密钥只落在 .lowcode/data-secrets.json，权限 0o600；不随文件接口、导出包、日志外泄。 */
async function readSourceSecrets(siteDir) {
  const file = path.join(siteDir, SOURCE_SECRET_FILE);
  const textValue = await fs.readFile(file, 'utf8').catch(() => null);
  if (!textValue) return {};
  try {
    const parsed = JSON.parse(textValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSourceSecrets(siteDir, map) {
  const file = path.join(siteDir, SOURCE_SECRET_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(map, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/* 合并新录入的密钥，并清掉不再被任何来源引用的孤立键。 */
async function mergeSecrets(siteDir, incoming, doc) {
  const previous = await readSourceSecrets(siteDir);
  const next = Object.assign({}, previous);
  for (const [key, value] of Object.entries(incoming || {})) {
    if (String(value)) next[key] = String(value);
  }
  const keep = new Set();
  for (const source of doc.sources) {
    for (const key of secretKeysOf(source)) keep.add(key);
  }
  for (const key of Object.keys(next)) {
    if (!keep.has(key)) delete next[key];
  }
  await writeSourceSecrets(siteDir, next);
  return next;
}

async function listSources(adapter) {
  const doc = await readSourcesDoc(adapter);
  const secrets = await readSourceSecrets(adapter.siteDir);
  return doc.sources
    .map((source) => sanitizeSource(source, secrets))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
}

/* ---------------- 站点级上传目标 ----------------
   契约见 CONTRACTS-v1.md「上传」：默认值落在 project.json 的 upload 下。
   上传组件未单独填写时继承这里，组件属性填了则以组件为准。 */

const UPLOAD_METHODS = ['POST', 'PUT', 'PATCH'];

function uploadView(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const method = String(value.method || '').toUpperCase();
  const maxBytes = Number(value.maxBytes);
  return {
    enabled: value.enabled !== false,
    target: typeof value.target === 'string' ? value.target : '',
    method: UPLOAD_METHODS.includes(method) ? method : 'POST',
    fileField: typeof value.fileField === 'string' && value.fileField ? value.fileField : 'file',
    headers: value.headers && typeof value.headers === 'object' && !Array.isArray(value.headers) ? value.headers : {},
    fields: value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields) ? value.fields : {},
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0,
    accept: typeof value.accept === 'string' ? value.accept : ''
  };
}

function uploadJsonObject(value, label) {
  if (value === undefined || value === null || value === '') return {};
  const parsed = typeof value === 'string' ? (function () {
    try { return JSON.parse(value); } catch { throw fail(422, 'LC_E_UPLOAD_JSON', label + '不是合法 JSON'); }
  })() : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail(422, 'LC_E_UPLOAD_JSON', label + '必须是 JSON 对象');
  }
  return parsed;
}

function normalizeUpload(input) {
  const value = input && typeof input === 'object' ? input : {};
  const target = String(value.target == null ? '' : value.target).trim();
  if (target && !/^(https?:\/\/|\/)/i.test(target)) {
    throw fail(422, 'LC_E_UPLOAD_TARGET', '上传地址必须以 / 或 http(s):// 开头');
  }
  const method = String(value.method || 'POST').toUpperCase();
  if (!UPLOAD_METHODS.includes(method)) {
    throw fail(422, 'LC_E_UPLOAD_METHOD', '请求方法只支持 POST / PUT / PATCH');
  }
  const fileField = String(value.fileField || 'file').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(fileField)) {
    throw fail(422, 'LC_E_UPLOAD_FIELD', '文件字段名只能包含字母、数字、下划线和短横线，且不能以数字开头');
  }
  const maxBytes = Number(value.maxBytes == null ? 0 : value.maxBytes);
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw fail(422, 'LC_E_UPLOAD_MAX', '单文件大小上限必须是不小于 0 的整数（字节）');
  }
  return {
    enabled: value.enabled === undefined ? true : value.enabled !== false,
    target,
    method,
    fileField,
    headers: uploadJsonObject(value.headers, '请求头'),
    fields: uploadJsonObject(value.fields, '附加表单字段'),
    maxBytes: Math.floor(maxBytes),
    accept: String(value.accept == null ? '' : value.accept).trim()
  };
}

async function readProjectFile(adapter) {
  let text;
  try {
    text = await adapter.read('project.json');
  } catch {
    throw fail(404, 'LC_E_PROJECT_MISSING', '站点缺少 project.json');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw fail(500, 'LC_E_PROJECT_CORRUPT', 'project.json 不是合法 JSON');
  }
}

/**
 * 数据源 · 自定义接口与连接测试：
 * GET    /api/sites/:siteId/data/sources
 * POST   /api/sites/:siteId/data/sources
 * PUT    /api/sites/:siteId/data/sources/:sourceId
 * DELETE /api/sites/:siteId/data/sources/:sourceId
 * POST   /api/sites/:siteId/data/sources/test
 */
export function registerDataRoutes(app, ctx) {
  app.get('/api/sites/:siteId/data/meta', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      return {
        ok: true,
        data: {
          fieldTypes: FIELD_TYPES.map((value) => ({ value, label: FIELD_TYPE_LABELS[value] })),
          importModes: IMPORT_MODES.map((value) => ({ value, label: IMPORT_MODE_LABELS[value] })),
          limits: DATA_LIMITS,
          collections: await listCollections(target.adapter)
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/data/usage', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const collection = request.query && request.query.collection;
      const field = request.query && request.query.field;
      const items = await scanDataUsage(target.adapter, { collection, field });
      return { ok: true, data: { items, flat: flattenUsage(items) } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/data/collections', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      return { ok: true, data: await listCollections(target.adapter) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/data/collections', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const existing = await listCollections(target.adapter);
      if (existing.length >= DATA_LIMITS.collections) {
        throw fail(422, 'LC_E_DATA_LIMIT', '最多 ' + DATA_LIMITS.collections + ' 个集合');
      }
      const collection = normalizeCollection(request.body || {});
      normalizeCollectionId(collection.id);
      if (existing.some((item) => item.id === collection.id)) {
        throw fail(409, 'LC_E_COLLECTION_EXISTS', '集合 ID 已存在：' + collection.id);
      }
      await assertUniqueName(target.adapter, collection.name, collection.id);
      const prepared = prepareRows(collection, collection.rows, { strict: false });
      collection.rows = prepared;
      await target.adapter.write(collectionRel(collection.id), JSON.stringify(collection, null, 2) + '\n');
      return reply.code(201).send({ ok: true, data: collection });
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/data/collections/:collectionId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const collection = await readCollection(target.adapter, id);
      const usage = await scanDataUsage(target.adapter, { collection: id });
      const rev = await target.adapter.rev();
      /* 行数据单独分页读取，详情接口只回结构，避免一次返回几万行。 */
      const meta = Object.assign({}, collection);
      delete meta.rows;
      return { ok: true, data: { collection: meta, rowCount: collection.rows.length, usage: flattenUsage(usage), rev } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.put('/api/sites/:siteId/data/collections/:collectionId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const previous = await readCollection(target.adapter, id);
      /* 集合 ID 不可改：它写进页面绑定与导出快照，改名会断引用，接口强制沿用路径里的 ID。 */
      const next = normalizeCollection(Object.assign({}, request.body || {}, { id }), { existing: previous });

      if (next.name.toLowerCase() !== String(previous.name).toLowerCase()) {
        await assertUniqueName(target.adapter, next.name, id);
      }

      const diff = diffFieldSchema(previous.fields, next.fields);
      const breakingIds = changedFieldIds(diff);
      let usage = [];
      if (breakingIds.length) {
        const scan = await scanDataUsage(target.adapter, { collection: id });
        usage = flattenUsage(scan.filter((item) => breakingIds.includes(item.field) || item.field === ''));
      }
      if (diff.breaking && usage.length && request.body && request.body.confirmBreaking !== true) {
        return reply.code(409).send({
          ok: false,
          error: {
            code: 'LC_E_DATA_SCHEMA_IN_USE',
            message: '字段类型变化会影响已绑定这些字段的页面/组件，确认后才能保存',
            detail: { diff, usage }
          }
        });
      }

      /* 类型变化后重算行值：无法转换的落到字段默认值，并把处理条数回显给用户。 */
      let rows = Array.isArray(request.body && request.body.rows) ? request.body.rows : previous.rows;
      let adjusted = 0;
      if (diff.breaking) {
        const rebuilt = [];
        for (const raw of rows) {
          const id = normalizeStoredRow(raw).id;
          const candidate = Object.assign({}, raw, { id });
          try {
            const row = prepareRows(next, [candidate], { strict: false })[0];
            checkUniqueness(next, row, row.id, rebuilt);
            rebuilt.push(row);
          } catch {
            adjusted += 1;
            const reset = { id };
            for (const field of next.fields) {
              try {
                reset[field.id] = coerceFieldValue(field, Object.prototype.hasOwnProperty.call(candidate, field.id) ? candidate[field.id] : undefined, { strict: false });
              } catch {
                reset[field.id] = defaultForField(field);
              }
            }
            rebuilt.push(reset);
          }
        }
        rows = rebuilt;
      } else {
        rows = prepareRows(next, rows, { strict: true });
      }

      if (rows.length > DATA_LIMITS.rowsPerCollection) {
        throw fail(422, 'LC_E_DATA_LIMIT', '一个集合最多 ' + DATA_LIMITS.rowsPerCollection + ' 行');
      }

      next.rows = rows;
      next.updatedAt = new Date().toISOString();
      await target.adapter.write(collectionRel(id), JSON.stringify(next, null, 2) + '\n', { expectedRev: expectedRevOf(request) });
      const meta = Object.assign({}, next);
      delete meta.rows;
      return {
        ok: true,
        data: {
          collection: meta,
          rowCount: rows.length,
          diff,
          usage,
          adjustedRows: adjusted,
          warnings: diff.breaking
            ? [{
                code: 'LC_W_DATA_SCHEMA_CHANGED',
                message: '字段结构已变化：' + [
                  diff.retyped.length ? diff.retyped.length + ' 个改类型' : '',
                  diff.removed.length ? diff.removed.length + ' 个删除' : '',
                  diff.retargeted.length ? diff.retargeted.length + ' 个改引用目标' : ''
                ].filter(Boolean).join('，') +
                  (usage.length ? '；影响 ' + usage.length + ' 处页面/组件引用' : '') +
                  (adjusted ? '；' + adjusted + ' 行数据已按新类型重置' : '')
              }]
            : []
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.delete('/api/sites/:siteId/data/collections/:collectionId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      await readCollection(target.adapter, id);
      const usage = flattenUsage(await scanDataUsage(target.adapter, { collection: id }));
      if (usage.length && !(request.query && request.query.confirm === '1')) {
        return reply.code(409).send({
          ok: false,
          error: {
            code: 'LC_E_DATA_SCHEMA_IN_USE',
            message: '集合被页面/组件引用，确认后才能删除',
            detail: { usage }
          }
        });
      }
      const backup = await createBackup(target.adapter.siteDir, {
        siteId: target.siteId,
        reason: 'collection-delete',
        paths: [collectionRel(id)]
      });
      await target.adapter.delete(collectionRel(id), { expectedRev: expectedRevOf(request) });
      return { ok: true, data: { id, usage: usage.length, backup: path.basename(backup.dir) } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/data/collections/:collectionId/rows', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const collection = await readCollection(target.adapter, id);
      const filtered = searchRows(collection.rows, request.query && request.query.q);
      const sortSpec = sortParamOf(request.query, collection);
      const ordered = sortSpec ? sortRows(filtered, collection, sortSpec) : filtered;
      const slice = pageSlice(ordered, request.query);
      return {
        ok: true,
        data: {
          id: collection.id,
          fields: collection.fields,
          total: ordered.length,
          offset: slice.offset,
          limit: slice.limit,
          sort: sortSpec ? sortSpec.sort : '',
          order: sortSpec ? sortSpec.order : '',
          rows: slice.rows,
          rev: await target.adapter.rev()
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/data/collections/:collectionId/rows', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const collection = await readCollection(target.adapter, id);
      const body = request.body || {};
      const input = body.row !== undefined ? [body.row] : Array.isArray(body.rows) ? body.rows : [];
      if (!input.length) throw fail(400, 'LC_E_DATA_VALIDATION', '缺少要新增的行');
      for (const item of input) {
        const rawId = item && item.id;
        if (rawId !== undefined && collection.rows.some((row) => row.id === String(rawId))) {
          throw fail(409, 'LC_E_DATA_ROW_ID_CONFLICT', '行 ID 已存在：' + rawId);
        }
      }
      if (collection.rows.length + input.length > DATA_LIMITS.rowsPerCollection) {
        throw fail(422, 'LC_E_DATA_LIMIT', '一个集合最多 ' + DATA_LIMITS.rowsPerCollection + ' 行');
      }
      const rows = prepareRows(collection, input, { strict: true });
      for (const row of rows) checkUniqueness(collection, row, row.id, collection.rows);
      collection.rows.push(...rows);
      collection.updatedAt = new Date().toISOString();
      await target.adapter.write(collectionRel(id), JSON.stringify(collection, null, 2) + '\n', { expectedRev: expectedRevOf(request) });
      return reply.code(201).send({ ok: true, data: { added: rows.length, rows, total: collection.rows.length } });
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.put('/api/sites/:siteId/data/collections/:collectionId/rows/:rowId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const rowId = normalizeRowId(request.params.rowId);
      const collection = await readCollection(target.adapter, id);
      const index = collection.rows.findIndex((row) => row.id === rowId);
      if (index === -1) throw fail(404, 'LC_E_ROW_NOT_FOUND', '行不存在：' + rowId);
      const body = request.body || {};
      const rowInput = Object.assign({}, body.row || {}, { id: rowId });
      const row = prepareRows(collection, [rowInput], { strict: true })[0];
      const others = collection.rows.filter((item) => item.id !== rowId);
      checkUniqueness(collection, row, rowId, others);
      collection.rows[index] = row;
      collection.updatedAt = new Date().toISOString();
      await target.adapter.write(collectionRel(id), JSON.stringify(collection, null, 2) + '\n', { expectedRev: expectedRevOf(request) });
      return { ok: true, data: { row, total: collection.rows.length } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.delete('/api/sites/:siteId/data/collections/:collectionId/rows/:rowId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const rowId = normalizeRowId(request.params.rowId);
      const collection = await readCollection(target.adapter, id);
      const before = collection.rows.length;
      collection.rows = collection.rows.filter((row) => row.id !== rowId);
      if (collection.rows.length === before) throw fail(404, 'LC_E_ROW_NOT_FOUND', '行不存在：' + rowId);
      collection.updatedAt = new Date().toISOString();
      await target.adapter.write(collectionRel(id), JSON.stringify(collection, null, 2) + '\n', { expectedRev: expectedRevOf(request) });
      return { ok: true, data: { id: rowId, total: collection.rows.length } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/data/collections/:collectionId/sample', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = normalizeCollectionId(request.params.collectionId);
      const collection = await readCollection(target.adapter, id);
      const body = request.body || {};
      const count = Math.min(DATA_LIMITS.sampleRows, Math.max(1, Number(body.count) || 10));
      if (collection.rows.length + count > DATA_LIMITS.rowsPerCollection) {
        throw fail(422, 'LC_E_DATA_LIMIT', '一个集合最多 ' + DATA_LIMITS.rowsPerCollection + ' 行');
      }
      const sample = generateSampleRows(collection, count);
      const existing = collection.rows.slice();
      const accepted = [];
      for (const row of sample) {
        try {
          checkUniqueness(collection, row, row.id, existing.concat(accepted));
          accepted.push(row);
        } catch {
          /* 示例数据撞唯一约束时跳过该条，不让整批失败。 */
        }
      }
      collection.rows.push(...accepted);
      collection.updatedAt = new Date().toISOString();
      await target.adapter.write(collectionRel(id), JSON.stringify(collection, null, 2) + '\n', { expectedRev: expectedRevOf(request) });
      return { ok: true, data: { added: accepted.length, skipped: count - accepted.length, total: collection.rows.length, rows: accepted } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  /* 导入预览：只解析，不写入。 */
  app.post('/api/sites/:siteId/data/import/preview', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      if (typeof body.content !== 'string') {
        throw fail(400, 'LC_E_IMPORT_FORMAT', '缺少导入内容（content 必须是字符串）');
      }
      const id = normalizeCollectionId(body.collectionId);
      const collection = await readCollection(target.adapter, id);
      return { ok: true, data: buildPreview(collection, body.content, body.format) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  /* 执行导入：解析 → 映射 → 冲突策略 → 写入。 */
  app.post('/api/sites/:siteId/data/import', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      if (typeof body.content !== 'string') {
        throw fail(400, 'LC_E_IMPORT_FORMAT', '缺少导入内容（content 必须是字符串）');
      }
      const id = normalizeCollectionId(body.collectionId);
      const collection = await readCollection(target.adapter, id);
      const result = runImport(collection, body.content, {
        format: body.format,
        mapping: body.mapping,
        mode: body.mode
      });
      collection.rows = result.rows;
      collection.updatedAt = new Date().toISOString();
      await target.adapter.write(collectionRel(id), JSON.stringify(collection, null, 2) + '\n', { expectedRev: expectedRevOf(request) });
      return {
        ok: true,
        data: {
          mode: result.mode,
          format: result.format,
          sizeBytes: result.sizeBytes,
          totalRows: result.totalRows,
          added: result.added,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          issueCount: result.issueCount,
          issues: result.issues,
          mapping: result.mapping,
          rowCount: collection.rows.length
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  /* ---------------- 自定义接口 ---------------- */

  app.get('/api/sites/:siteId/data/sources', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      return {
        ok: true,
        data: {
          sources: await listSources(target.adapter),
          rev: await target.adapter.rev(),
          methods: SOURCE_METHODS,
          targets: SOURCE_TARGETS,
          limits: {
            requestTimeoutMs: DATA_LIMITS.requestTimeoutMs,
            requestTimeoutMinMs: DATA_LIMITS.requestTimeoutMinMs,
            requestTimeoutMaxMs: DATA_LIMITS.requestTimeoutMaxMs,
            responseBytes: DATA_LIMITS.responseBytes,
            responseBytesMin: DATA_LIMITS.responseBytesMin,
            responseBytesMax: DATA_LIMITS.responseBytesMax
          }
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/data/sources', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      const raw = body.source && typeof body.source === 'object' ? body.source : body;
      const doc = await readSourcesDoc(target.adapter);
      const source = normalizeSource(raw);
      if (doc.sources.some((item) => item.id === source.id)) {
        throw fail(409, 'LC_E_SOURCE_EXISTS', '接口 ID 已存在：' + source.id);
      }
      assertSourceNameFree(doc.sources, source.name, source.id);

      doc.sources.push(stripSecretValues(source));
      await writeSourcesDoc(target.adapter, doc, { expectedRev: expectedRevOf(request) });
      const secrets = await mergeSecrets(target.adapter.siteDir, collectSecretValues(raw), doc);
      return reply.code(201).send({ ok: true, data: sanitizeSource(doc.sources[doc.sources.length - 1], secrets) });
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.put('/api/sites/:siteId/data/sources/:sourceId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const sourceId = String(request.params.sourceId || '').trim().toLowerCase();
      const doc = await readSourcesDoc(target.adapter);
      const index = doc.sources.findIndex((item) => item.id === sourceId);
      if (index === -1) throw fail(404, 'LC_E_SOURCE_NOT_FOUND', '接口不存在：' + sourceId);
      const body = request.body || {};
      const raw = body.source && typeof body.source === 'object' ? body.source : body;
      const source = normalizeSource(Object.assign({}, raw, { id: sourceId }), { existing: doc.sources[index] });
      assertSourceNameFree(doc.sources, source.name, sourceId);

      doc.sources[index] = stripSecretValues(source);
      await writeSourcesDoc(target.adapter, doc, { expectedRev: expectedRevOf(request) });
      const secrets = await mergeSecrets(target.adapter.siteDir, collectSecretValues(raw), doc);
      return { ok: true, data: sanitizeSource(doc.sources[index], secrets) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.delete('/api/sites/:siteId/data/sources/:sourceId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const sourceId = String(request.params.sourceId || '').trim().toLowerCase();
      const doc = await readSourcesDoc(target.adapter);
      const index = doc.sources.findIndex((item) => item.id === sourceId);
      if (index === -1) throw fail(404, 'LC_E_SOURCE_NOT_FOUND', '接口不存在：' + sourceId);
      doc.sources.splice(index, 1);
      await writeSourcesDoc(target.adapter, doc, { expectedRev: expectedRevOf(request) });
      /* 同步清理不再被引用的密钥。 */
      await mergeSecrets(target.adapter.siteDir, {}, doc);
      return { ok: true, data: { id: sourceId } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  /* 连接测试：返回状态码、耗时、失败分类与字段结构；失败也是一种结果，不用 5xx 掩盖。 */
  app.post('/api/sites/:siteId/data/sources/test', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      const raw = body.source && typeof body.source === 'object' ? body.source : null;
      const doc = await readSourcesDoc(target.adapter);
      let stored = null;
      if (body.sourceId) {
        stored = doc.sources.find((item) => item.id === String(body.sourceId).trim().toLowerCase()) || null;
        if (!stored) throw fail(404, 'LC_E_SOURCE_NOT_FOUND', '接口不存在：' + body.sourceId);
      }
      const candidate = raw || stored;
      if (!candidate) throw fail(400, 'LC_E_SOURCE_VALIDATION', '缺少要测试的接口配置');

      const input = Object.assign({}, stored || {}, candidate);
      if (!String(input.name == null ? '' : input.name).trim()) input.name = '未命名接口';

      const source = normalizeSource(input, {
        existing: stored,
        relaxed: true,
        allowSecretValues: true
      });

      const typedSecrets = collectSecretValues(candidate);
      const storedSecrets = stored ? await readSourceSecrets(target.adapter.siteDir) : {};
      const secrets = Object.assign({}, storedSecrets, typedSecrets);

      let collection = null;
      if (source.mapping.target === 'collection' && source.mapping.collectionId) {
        collection = await readCollection(target.adapter, normalizeCollectionId(source.mapping.collectionId))
          .catch(() => null);
      }

      const result = await performSourceTest(source, secrets, { collection });
      return { ok: true, data: result };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  /* 站点级上传目标：上传地址、请求头、文件字段名、大小与类型限制。
     写在 project.json 的 upload 下，导出后上传组件按同一份配置工作。 */
  app.get('/api/sites/:siteId/data/upload', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const project = await readProjectFile(target.adapter);
      return { ok: true, data: uploadView(project.upload) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.put('/api/sites/:siteId/data/upload', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const project = await readProjectFile(target.adapter);
      const upload = normalizeUpload(request.body || {});
      project.upload = upload;
      await target.adapter.write('project.json', JSON.stringify(project, null, 2) + '\n');
      return { ok: true, data: upload };
    } catch (error) {
      return respondError(reply, error);
    }
  });
}
