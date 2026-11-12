import path from 'node:path';
import { createSiteAdapter } from '../../../src/storage/index.js';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { createBackup } from '../../../src/storage/backups.js';
import {
  COMPONENT_CATEGORIES,
  COMPONENT_FIELD_TYPES,
  COMPONENT_ICONS,
  COMPONENT_LIMITS,
  buildScopeInfo,
  builtinComponents,
  checkDangerousJs,
  diffFields,
  fail,
  findBuiltin,
  normalizeComponent,
  normalizeComponentId,
  normalizeStoredComponent,
  renderPreview,
  sampleData,
  scanAllComponentUsage,
  scanComponentUsage,
  slugifyId,
  usageTotal
} from '../components/model.js';

const COMPONENT_DIR = 'components';
const TRASH_DIR = 'trash/components';

function adapterFor(ctx, siteId) {
  return createSiteAdapter(ctx.paths.dataDir, siteId, { lockStaleMs: ctx.paths.lockStaleMs });
}

function componentRel(id) {
  return COMPONENT_DIR + '/' + id + '.json';
}

function trashRel(trashId) {
  return TRASH_DIR + '/' + trashId + '.json';
}

function respondError(reply, error) {
  const status = Number(error.statusCode) || 500;
  return reply.code(status).send({
    ok: false,
    error: {
      code: error.code || 'LC_E_COMPONENT',
      message: error.message,
      detail: error.detail
    }
  });
}

function siteOf(reply, ctx, request) {
  try {
    const siteId = sanitizeSiteId(request.params.siteId);
    return { siteId, adapter: adapterFor(ctx, siteId) };
  } catch {
    reply.code(400).send({ ok: false, error: { code: 'LC_E_SITE_ID', message: '站点 ID 非法' } });
    return null;
  }
}

function isBuiltinId(id) {
  return /^builtin:/.test(String(id || ''));
}

function trashIdFor(id) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return stamp + '-' + id;
}

async function readComponent(adapter, id) {
  normalizeComponentId(id);
  let textValue;
  try {
    textValue = await adapter.read(componentRel(id));
  } catch {
    throw fail(404, 'LC_E_COMPONENT_NOT_FOUND', '组件不存在：' + id);
  }
  let parsed;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    throw fail(500, 'LC_E_COMPONENT_CORRUPT', '组件文件不是合法 JSON：' + id);
  }
  const component = normalizeStoredComponent(parsed);
  if (!component.id) component.id = id;
  if (!component.name) component.name = id;
  return component;
}

async function listCustom(adapter) {
  const entries = await adapter.list(COMPONENT_DIR, { recursive: false }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue;
    const id = path.posix.basename(entry.path, '.json');
    try {
      out.push(await readComponent(adapter, id));
    } catch {
      /* 损坏组件不阻塞列表，详情接口给出具体错误。 */
    }
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  return out;
}

function attachUsage(list, usageMap) {
  return list.map((component) => {
    const usagePages = usageMap.get(component.id) || [];
    return Object.assign({}, component, {
      usagePages,
      usageCount: usageTotal(usagePages),
      readOnly: false
    });
  });
}

async function assertNameFree(adapter, name, selfId) {
  const target = String(name || '').trim().toLowerCase();
  const list = await listCustom(adapter);
  const clash = list.find((item) => item.id !== selfId && String(item.name).trim().toLowerCase() === target);
  if (clash) throw fail(409, 'LC_E_COMPONENT_NAME', '已存在同名组件：' + clash.name);
}

async function uniqueCopyName(adapter, base, selfWords) {
  const list = await listCustom(adapter);
  const taken = new Set(list.map((item) => String(item.name).trim().toLowerCase()));
  const suffix = selfWords || '（副本）';
  let name = base + suffix;
  let index = 2;
  while (taken.has(name.toLowerCase())) {
    name = base + suffix.replace(/）$/, ' ' + index + '）');
    index += 1;
  }
  return name;
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(base + '-' + index)) index += 1;
  return base + '-' + index;
}

async function compiledTags(adapter) {
  const list = await listCustom(adapter);
  const tags = [];
  for (const component of list) {
    for (const tag of component.tags || []) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
}

async function listTrash(adapter) {
  const entries = await adapter.list(TRASH_DIR, { recursive: false }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await adapter.read(entry.path));
      out.push({
        trashId: parsed.trashId || path.posix.basename(entry.path, '.json'),
        deletedAt: parsed.deletedAt || '',
        originalId: parsed.originalId || '',
        name: (parsed.component && parsed.component.name) || parsed.originalId || '未命名组件',
        category: (parsed.component && parsed.component.category) || 'other',
        tags: (parsed.component && parsed.component.tags) || []
      });
    } catch {
      /* 回收站里的损坏文件不影响其它记录。 */
    }
  }
  out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return out;
}

/**
 * 组件库接口：
 * GET    /api/sites/:siteId/components
 * POST   /api/sites/:siteId/components
 * GET    /api/sites/:siteId/components/meta
 * GET    /api/sites/:siteId/components/usage?componentId=
 * GET    /api/sites/:siteId/components/trash
 * POST   /api/sites/:siteId/components/trash/:trashId/restore
 * POST   /api/sites/:siteId/components/import
 * POST   /api/sites/:siteId/components/preview
 * GET    /api/sites/:siteId/components/:componentId
 * PUT    /api/sites/:siteId/components/:componentId
 * DELETE /api/sites/:siteId/components/:componentId
 * POST   /api/sites/:siteId/components/:componentId/duplicate
 * GET    /api/sites/:siteId/components/:componentId/export
 */
export function registerComponentRoutes(app, ctx) {
  app.get('/api/sites/:siteId/components/meta', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      return {
        ok: true,
        data: {
          categories: COMPONENT_CATEGORIES,
          icons: COMPONENT_ICONS,
          fieldTypes: COMPONENT_FIELD_TYPES,
          limits: COMPONENT_LIMITS,
          tags: await compiledTags(target.adapter),
          trashCount: (await listTrash(target.adapter)).length,
          builtinCount: builtinComponents().length,
          scopeExample: buildScopeInfo('my-card'),
          forbiddenJs: [
            { rule: 'LC_E_JS_DOCUMENT_WRITE', message: '禁止 document.write / document.writeln' },
            { rule: 'LC_E_JS_INNER_HTML_CONCAT', message: '禁止给 innerHTML / outerHTML 赋拼接结果' }
          ]
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/components', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const usageMap = await scanAllComponentUsage(target.adapter);
      const custom = attachUsage(await listCustom(target.adapter), usageMap);
      const includeBuiltins = !(request.query && request.query.builtins === '0');
      const builtins = includeBuiltins
        ? builtinComponents().map((component) => Object.assign({}, component, { usageCount: 0, usagePages: [], readOnly: true }))
        : [];
      return {
        ok: true,
        data: {
          items: custom.concat(builtins),
          counts: { custom: custom.length, builtin: builtins.length },
          tags: await compiledTags(target.adapter)
        }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/components/usage', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const componentId = String((request.query && request.query.componentId) || '');
      if (!componentId) throw fail(400, 'LC_E_COMPONENT_ID', '缺少 componentId');
      const usage = await scanComponentUsage(target.adapter, componentId);
      return { ok: true, data: { usage, total: usageTotal(usage) } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/components/trash', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      return { ok: true, data: { items: await listTrash(target.adapter) } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/components/trash/:trashId/restore', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const trashId = String(request.params.trashId || '');
      if (!/^[A-Za-z0-9._-]+$/.test(trashId)) throw fail(400, 'LC_E_TRASH_ID', '回收站记录 ID 非法');
      let parsed;
      try {
        parsed = JSON.parse(await target.adapter.read(trashRel(trashId)));
      } catch {
        throw fail(404, 'LC_E_TRASH_NOT_FOUND', '回收站里没有这条记录：' + trashId);
      }
      const source = normalizeStoredComponent(parsed.component);
      if (!source.id) source.id = String(parsed.originalId || '').trim() || 'component';
      const existing = await listCustom(target.adapter);
      const takenIds = new Set(existing.map((item) => item.id));
      const takenNames = new Set(existing.map((item) => String(item.name).trim().toLowerCase()));
      const id = uniqueId(normalizeComponentId(source.id), takenIds);
      let name = source.name || id;
      if (takenNames.has(name.trim().toLowerCase())) {
        name = await uniqueCopyName(target.adapter, name, '（恢复）');
      }
      const component = normalizeComponent(Object.assign({}, source, { id, name }), { id });
      await target.adapter.write(componentRel(id), JSON.stringify(component, null, 2) + '\n');
      await target.adapter.delete(trashRel(trashId)).catch(() => {});
      const usage = await scanComponentUsage(target.adapter, id);
      return { ok: true, data: Object.assign({}, component, { usagePages: usage, usageCount: usageTotal(usage) }) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/components/preview', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      const result = renderPreview(body.component || body, { sample: body.sample });
      return { ok: true, data: result };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/components/import', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      let raw = body.component;
      if (typeof body.content === 'string' && body.content.trim()) {
        const bytes = Buffer.byteLength(body.content);
        if (bytes > COMPONENT_LIMITS.importBytes) {
          throw fail(413, 'LC_E_COMPONENT_IMPORT_SIZE',
            '文件超过 ' + Math.ceil(COMPONENT_LIMITS.importBytes / 1024) + ' KB（当前 ' + Math.ceil(bytes / 1024) + ' KB）');
        }
        try {
          raw = JSON.parse(body.content);
        } catch (error) {
          throw fail(422, 'LC_E_COMPONENT_IMPORT_FORMAT', '文件不是合法 JSON：' + error.message);
        }
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw fail(422, 'LC_E_COMPONENT_IMPORT_FORMAT', '导入内容里没有组件对象');
      }
      if (raw.format === 'lowcode-component') {
        raw = raw.component;
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw fail(422, 'LC_E_COMPONENT_IMPORT_FORMAT', '文件里没有 component 对象');
      }
      const filename = String(body.filename || '');
      const existing = await listCustom(target.adapter);
      const takenIds = new Set(existing.map((item) => item.id));
      const takenNames = new Set(existing.map((item) => String(item.name).trim().toLowerCase()));
      const notices = [];
      let requestedId = slugifyId(raw.id || filename.replace(/\.[^.]+$/, '') || raw.name, 'component');
      const id = uniqueId(requestedId, takenIds);
      if (id !== requestedId) notices.push('组件 ID 改为「' + id + '」');
      let name = String(raw.name || id).trim() || id;
      if (takenNames.has(name.toLowerCase())) {
        name = await uniqueCopyName(target.adapter, name, '（导入）');
        notices.push('名称改为「' + name + '」');
      }
      const component = normalizeComponent(Object.assign({}, raw, { id, name }), { id });
      await target.adapter.write(componentRel(id), JSON.stringify(component, null, 2) + '\n');
      const usage = [];
      return reply.code(201).send({
        ok: true,
        data: Object.assign({}, component, { usagePages: usage, usageCount: 0, notices })
      });
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/components', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const existing = await listCustom(target.adapter);
      if (existing.length >= COMPONENT_LIMITS.components) {
        throw fail(422, 'LC_E_COMPONENT_LIMIT', '最多 ' + COMPONENT_LIMITS.components + ' 个自定义组件');
      }
      const body = request.body || {};
      const id = normalizeComponentId(body.id || slugifyId(body.name, 'component'));
      if (existing.some((item) => item.id === id)) {
        throw fail(409, 'LC_E_COMPONENT_EXISTS', '组件 ID 已存在：' + id);
      }
      await assertNameFree(target.adapter, body.name, id);
      const component = normalizeComponent(body, { id });
      await target.adapter.write(componentRel(id), JSON.stringify(component, null, 2) + '\n');
      return reply.code(201).send({
        ok: true,
        data: Object.assign({}, component, { usagePages: [], usageCount: 0 })
      });
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/components/:componentId/export', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = String(request.params.componentId || '');
      if (isBuiltinId(id)) throw fail(403, 'LC_E_COMPONENT_READONLY', '内置组件只读，请先复制为自定义组件');
      const component = await readComponent(target.adapter, id);
      const payload = {
        format: 'lowcode-component',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        component
      };
      reply.header('content-disposition', 'attachment; filename="' + component.id + '.component.json"');
      return payload;
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get('/api/sites/:siteId/components/:componentId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = String(request.params.componentId || '');
      if (isBuiltinId(id)) {
        const builtin = findBuiltin(id);
        if (!builtin) throw fail(404, 'LC_E_COMPONENT_NOT_FOUND', '内置组件不存在：' + id);
        return {
          ok: true,
          data: Object.assign({}, builtin, {
            usagePages: [],
            usageCount: 0,
            readOnly: true,
            scope: buildScopeInfo(builtin.id)
          })
        };
      }
      const component = await readComponent(target.adapter, id);
      const usage = await scanComponentUsage(target.adapter, component.id);
      return {
        ok: true,
        data: Object.assign({}, component, {
          usagePages: usage,
          usageCount: usageTotal(usage),
          readOnly: false,
          scope: buildScopeInfo(component.id)
        })
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.put('/api/sites/:siteId/components/:componentId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = String(request.params.componentId || '');
      if (isBuiltinId(id)) throw fail(403, 'LC_E_COMPONENT_READONLY', '内置组件只读，不能修改；请复制为自定义组件');
      const previous = await readComponent(target.adapter, id);
      const body = request.body || {};
      const next = normalizeComponent(Object.assign({}, body, { id }), { id, existing: previous });
      if (String(next.name).trim().toLowerCase() !== String(previous.name).trim().toLowerCase()) {
        await assertNameFree(target.adapter, next.name, id);
      }
      const diff = diffFields(previous.fields, next.fields);
      const usage = diff.breaking.length ? await scanComponentUsage(target.adapter, id) : [];
      const confirmed = Boolean(body.confirm) || String((request.query && request.query.confirm) || '') === '1';
      if (diff.breaking.length && !confirmed) {
        throw fail(409, 'LC_E_COMPONENT_FIELDS', '字段改动会影响引用这个组件的页面，请先确认', {
          diff: diff.items,
          breaking: diff.breaking,
          usage
        });
      }
      if (diff.breaking.length) {
        await createBackup(target.adapter.siteDir, {
          siteId: target.siteId,
          reason: 'component-fields-' + id,
          paths: [componentRel(id)]
        });
      }
      await target.adapter.write(componentRel(id), JSON.stringify(next, null, 2) + '\n');
      const finalUsage = await scanComponentUsage(target.adapter, id);
      return {
        ok: true,
        data: Object.assign({}, next, {
          usagePages: finalUsage,
          usageCount: usageTotal(finalUsage),
          diff: diff.items
        })
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.delete('/api/sites/:siteId/components/:componentId', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = String(request.params.componentId || '');
      if (isBuiltinId(id)) throw fail(403, 'LC_E_COMPONENT_READONLY', '内置组件只读，不能删除');
      const component = await readComponent(target.adapter, id);
      const usage = await scanComponentUsage(target.adapter, id);
      const confirmed = String((request.query && request.query.confirm) || '') === '1';
      if (usage.length && !confirmed) {
        throw fail(409, 'LC_E_COMPONENT_IN_USE', '组件正被 ' + usage.length + ' 个页面使用，请先确认', { usage });
      }
      const trashId = trashIdFor(id);
      const envelope = {
        schemaVersion: 1,
        trashId,
        deletedAt: new Date().toISOString(),
        originalId: id,
        originalPath: componentRel(id),
        component
      };
      await target.adapter.write(trashRel(trashId), JSON.stringify(envelope, null, 2) + '\n');
      await target.adapter.delete(componentRel(id));
      return { ok: true, data: { deleted: true, trashId, name: component.name, usage } };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/components/:componentId/duplicate', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const id = String(request.params.componentId || '');
      let source;
      let builtin = false;
      if (isBuiltinId(id)) {
        const found = findBuiltin(id);
        if (!found) throw fail(404, 'LC_E_COMPONENT_NOT_FOUND', '内置组件不存在：' + id);
        source = found;
        builtin = true;
      } else {
        source = await readComponent(target.adapter, id);
      }
      const existing = await listCustom(target.adapter);
      const takenIds = new Set(existing.map((item) => item.id));
      const requestedBase = builtin
        ? slugifyId(source.builtinId || source.id.replace(/^builtin:/, ''), 'component')
        : slugifyId(source.id, 'component') + '-copy';
      const newId = uniqueId(requestedBase, takenIds);
      const suggestions = Array.isArray(source.tags) ? source.tags.filter((tag) => tag !== '内置') : [];
      const name = await uniqueCopyName(target.adapter, source.name, builtin ? '（自定义）' : '（副本）');
      const copy = normalizeComponent(Object.assign({}, source, {
        id: newId,
        name,
        tags: builtin ? suggestions : source.tags,
        builtin: false,
        builtinId: undefined,
        createdAt: undefined,
        updatedAt: undefined
      }), { id: newId });
      await target.adapter.write(componentRel(newId), JSON.stringify(copy, null, 2) + '\n');
      return reply.code(201).send({
        ok: true,
        data: Object.assign({}, copy, { usagePages: [], usageCount: 0, copiedFrom: id, notices: ['已复制为自定义组件「' + name + '」'] })
      });
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post('/api/sites/:siteId/components/validate', async (request, reply) => {
    const target = siteOf(reply, ctx, request);
    if (!target) return;
    try {
      const body = request.body || {};
      const danger = checkDangerousJs(body.js);
      const sample = sampleData(
        Array.isArray(body.fields) ? body.fields : [],
        body.sample
      );
      return {
        ok: true,
        data: { blocked: danger || null, sample }
      };
    } catch (error) {
      return respondError(reply, error);
    }
  });
}
