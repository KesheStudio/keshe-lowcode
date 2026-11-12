/* 后端积木 · API
 *
 * GET    /api/sites/:siteId/backend-flow                  读取流程 + 节点类型
 * PUT    /api/sites/:siteId/backend-flow                  保存流程草稿（自动补代码节点文件）
 * POST   /api/sites/:siteId/backend-flow/sample           返回示例流程（不落盘）
 * POST   /api/sites/:siteId/backend-flow/validate         只校验
 * POST   /api/sites/:siteId/backend-flow/compile          校验 + 生成构建产物
 * POST   /api/sites/:siteId/backend-flow/preview/start    编译并启动隔离预览
 * POST   /api/sites/:siteId/backend-flow/preview/stop     停止预览
 * POST   /api/sites/:siteId/backend-flow/preview/request  对预览发真实请求
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeSiteId } from '../../../src/storage/path-safety.js';
import { fail } from '../templates/model.js';
import { NODE_TYPE_LIST, NODE_CATEGORIES, sampleFlow } from '../flow/nodes.js';
import { validateFlow } from '../flow/validation.js';
import { buildFlowIR } from '../flow/ir.js';
import { BuildError, buildFlowProject } from '../flow/build.js';
import { readFlow, saveFlow, listUserFiles, readCollections, ensureCodeFile, normalizeLanguage } from '../flow/store.js';
import { startPreview, stopPreview, previewInfo, requestPreview, stopAllPreviews } from '../flow/preview.js';
import {
  allComponents,
  listComponents,
  saveComponent,
  deleteComponent,
  exportComponent,
  ComponentError
} from '../flow/components.js';

const MAX_DOC_BYTES = 2 * 1024 * 1024;

function siteContext(ctx, request) {
  let siteId;
  try {
    siteId = sanitizeSiteId(request.params.siteId);
  } catch {
    throw fail(400, 'LC_E_SITE_ID', '站点 ID 不合法');
  }
  const siteDir = path.join(ctx.paths.dataDir, 'sites', siteId);
  return { siteId, siteDir };
}

async function requireSite(siteDir) {
  const exists = await fs.stat(path.join(siteDir, 'site.json')).catch(() => null);
  if (!exists) throw fail(404, 'LC_E_SITE_NOT_FOUND', '站点不存在');
}

function languageOf(request) {
  const raw = request.query && request.query.language ? request.query.language : 'node';
  const language = normalizeLanguage(raw);
  if (!language) throw fail(400, 'LC_E_FLOW_LANGUAGE', '当前只支持 Node 后端');
  return language;
}

function collectCodeNodes(doc) {
  const nodes = [];
  const walk = (list) => {
    for (const node of list || []) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'code.node') nodes.push(node);
      if (Array.isArray(node.children)) walk(node.children);
      if (Array.isArray(node.elseChildren)) walk(node.elseChildren);
    }
  };
  if (doc && doc.flow && doc.flow.root) walk(doc.flow.root.children);
  return nodes;
}

async function ensureCodeNodes(siteDir, language, doc) {
  const created = [];
  for (const node of collectCodeNodes(doc)) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(String(node.id || ''))) continue;
    const result = await ensureCodeFile(
      siteDir,
      language,
      doc.flow.id || 'main',
      node.id,
      node.name,
      String((node.params && node.params.codeLanguage) || 'node')
    );
    if (result.created) created.push(result.rel);
  }
  return created;
}

async function validationContext(siteDir, language) {
  const collections = await readCollections(siteDir);
  const userFiles = await listUserFiles(siteDir, language);
  return {
    collections: collections.map((item) => item.id),
    userFiles: new Set(userFiles.map((item) => item.rel))
  };
}

async function validationContextWithComponents(ctx, siteDir, language) {
  return {
    ...(await validationContext(siteDir, language)),
    components: await allComponents({ paths: ctx.paths, siteDir })
  };
}

function targetOf(request) {
  const raw = (request.body && request.body.target) || (request.query && request.query.target) || 'node';
  const target = String(raw);
  return ['node', 'rust', 'go'].includes(target) ? target : 'node';
}

async function payload(ctx, request) {
  const { siteId, siteDir } = siteContext(ctx, request);
  await requireSite(siteDir);
  const language = languageOf(request);
  const target = targetOf(request);
  const { doc, exists, file } = await readFlow(siteDir, siteId, language);
  const validation = validateFlow(doc, {
    ...(await validationContextWithComponents(ctx, siteDir, language)),
    target
  });
  return {
    siteId,
    siteDir,
    language,
    target,
    doc,
    exists,
    file,
    issues: validation.issues,
    ok: validation.ok
  };
}

function summarizeFiles(files) {
  return files.map((file) => ({
    path: file.path,
    bytes: Buffer.byteLength(file.content, 'utf8'),
    content: file.content.length > 120000 ? file.content.slice(0, 120000) + '\n…（已截断）' : file.content
  }));
}

function buildFailure(reply, err) {
  if (err instanceof BuildError) {
    return reply.code(422).send({
      ok: false,
      error: { code: 'LC_E_FLOW_INVALID', message: err.message },
      issues: err.issues || []
    });
  }
  /* 预览占用文件时不把 EBUSY 原文与绝对路径抛给界面。 */
  if (err && ['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
    return reply.code(409).send({
      ok: false,
      error: {
        code: 'LC_E_BUILD_LOCKED',
        message: '站点有后端预览实例正在运行，构建目录里的文件被占用。请先停止预览，或稍后重试'
      }
    });
  }
  throw err;
}

export async function registerBackendFlowRoutes(app, ctx) {
  app.addHook('onClose', async () => {
    await stopAllPreviews();
  });

  app.get('/api/sites/:siteId/backend-flow', async (request) => {
    const result = await payload(ctx, request);
    return {
      ok: true,
      data: {
        siteId: result.siteId,
        language: result.language,
        exists: result.exists,
        file: path.relative(ctx.paths.dataDir, result.file).split(path.sep).join('/'),
        categories: NODE_CATEGORIES,
        nodeTypes: NODE_TYPE_LIST,
        flow: result.doc,
        issues: result.issues,
        components: await listComponents({ paths: ctx.paths, siteDir: result.siteDir }),
        preview: previewInfo(result.siteId, result.target)
      }
    };
  });

  app.put('/api/sites/:siteId/backend-flow', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const language = normalizeLanguage((request.body && request.body.language) || 'node');
    if (!language) throw fail(400, 'LC_E_FLOW_LANGUAGE', '当前只支持 Node 后端');
    const doc = request.body && request.body.doc;
    if (!doc) throw fail(400, 'LC_E_FLOW_BODY', '缺少 doc');
    if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw fail(413, 'LC_E_FLOW_TOO_LARGE', '流程文档超过 2 MB');

    const saved = await saveFlow(siteDir, siteId, language, doc);
    const created = await ensureCodeNodes(siteDir, language, saved.doc);
    const validation = validateFlow(saved.doc, await validationContextWithComponents(ctx, siteDir, language));
    return { ok: true, data: { flow: saved.doc, issues: validation.issues, createdCodeFiles: created } };
  });

  app.post('/api/sites/:siteId/backend-flow/sample', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const language = normalizeLanguage((request.body && request.body.language) || 'node');
    if (!language) throw fail(400, 'LC_E_FLOW_LANGUAGE', '当前只支持 Node 后端');
    return { ok: true, data: { flow: sampleFlow(siteId, language) } };
  });

  app.post('/api/sites/:siteId/backend-flow/validate', async (request) => {
    const result = await payload(ctx, request);
    return { ok: true, data: { ok: result.ok, issues: result.issues, flow: result.doc } };
  });

  app.post('/api/sites/:siteId/backend-flow/compile', async (request, reply) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const language = normalizeLanguage((request.body && request.body.language) || 'node');
    if (!language) throw fail(400, 'LC_E_FLOW_LANGUAGE', '当前只支持 Node 后端');
    const target = targetOf(request);

    let doc;
    if (request.body && request.body.doc) {
      if (JSON.stringify(request.body.doc).length > MAX_DOC_BYTES) throw fail(413, 'LC_E_FLOW_TOO_LARGE', '流程文档超过 2 MB');
      const saved = await saveFlow(siteDir, siteId, language, request.body.doc);
      await ensureCodeNodes(siteDir, language, saved.doc);
      doc = saved.doc;
    } else {
      doc = (await readFlow(siteDir, siteId, language)).doc;
    }

    if (target !== 'node') {
      const components = await allComponents({ paths: ctx.paths, siteDir });
      const built = buildFlowIR(doc, { target, components });
      const errors = built.diagnostics.filter((item) => item.level === 'error');
      if (errors.length) {
        const error = fail(422, 'LC_E_TARGET_CODEGEN', `目标语言 ${target} 的生成被阻断`);
        error.issues = errors;
        throw error;
      }
    }

    let build;
    try {
      build = await buildFlowProject({ paths: ctx.paths, siteId, siteDir, flowDoc: doc, target });
    } catch (err) {
      return buildFailure(reply, err);
    }

    const nextDoc = {
      ...doc,
      flow: {
        ...doc.flow,
        treeVersion: build.meta.treeVersion,
        lastCompiledAt: build.meta.generatedAt,
        lastTreeHash: build.meta.treeHash
      }
    };
    await saveFlow(siteDir, siteId, language, nextDoc);

    const warnings = build.issues.filter((item) => item.level === 'warning');
    return {
      ok: true,
      data: {
        treeVersion: build.meta.treeVersion,
        treeHash: build.meta.treeHash,
        irVersion: build.meta.irVersion,
        irHash: build.meta.irHash,
        targetLanguages: [build.meta.target || 'node'],
        components: build.meta.components || [],
        generatedAt: build.meta.generatedAt,
        buildDir: path.relative(ctx.paths.dataDir, build.serverDir).split(path.sep).join('/'),
        files: summarizeFiles(build.files),
        manifest: build.manifest.flows,
        issues: warnings,
        flow: nextDoc
      }
    };
  });

  app.post('/api/sites/:siteId/backend-flow/preview/start', async (request, reply) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const language = normalizeLanguage((request.body && request.body.language) || 'node');
    if (!language) throw fail(400, 'LC_E_FLOW_LANGUAGE', '当前只支持 Node 后端');
    const target = targetOf(request);

    let doc;
    try {
      if (request.body && request.body.doc) {
        if (JSON.stringify(request.body.doc).length > MAX_DOC_BYTES) throw fail(413, 'LC_E_FLOW_TOO_LARGE', '流程文档超过 2 MB');
        const saved = await saveFlow(siteDir, siteId, language, request.body.doc);
        await ensureCodeNodes(siteDir, language, saved.doc);
        doc = saved.doc;
      } else {
        doc = (await readFlow(siteDir, siteId, language)).doc;
      }
    } catch (err) {
      throw err;
    }

    try {
      const preview = await startPreview({ paths: ctx.paths, siteId, siteDir, flowDoc: doc, target });
      const nextDoc = {
        ...doc,
        flow: {
          ...doc.flow,
          treeVersion: preview.treeVersion,
          lastCompiledAt: new Date().toISOString(),
          lastTreeHash: preview.treeHash
        }
      };
      await saveFlow(siteDir, siteId, language, nextDoc);
      return { ok: true, data: { ...preview, flow: nextDoc } };
    } catch (err) {
      if (err instanceof BuildError) return buildFailure(reply, err);
      return reply.code(500).send({
        ok: false,
        error: { code: 'LC_E_FLOW_PREVIEW', message: err.message }
      });
    }
  });

  app.post('/api/sites/:siteId/backend-flow/preview/stop', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    return { ok: true, data: await stopPreview(siteId, targetOf(request)) };
  });

  app.get('/api/sites/:siteId/backend-flow/preview', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const target = targetOf(request);
    return { ok: true, data: { preview: previewInfo(siteId, target) } };
  });

  app.post('/api/sites/:siteId/backend-flow/preview/request', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    try {
      const result = await requestPreview(siteId, { ...(request.body || {}), target: targetOf(request) });
      return { ok: true, data: result };
    } catch (err) {
      throw fail(409, 'LC_E_FLOW_PREVIEW_REQUEST', err.message);
    }
  });

  // ------------------------------------------------------------ 后端组件

  function componentFailure(reply, err) {
    if (err instanceof ComponentError) {
      return reply.code(422).send({
        ok: false,
        error: { code: 'LC_E_COMPONENT_INVALID', message: err.message },
        issues: err.issues || []
      });
    }
    throw err;
  }

  app.get('/api/sites/:siteId/backend/components', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    return { ok: true, data: await listComponents({ paths: ctx.paths, siteDir }) };
  });

  app.put('/api/sites/:siteId/backend/components', async (request, reply) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    try {
      const body = request.body || {};
      const saved = await saveComponent({
        paths: ctx.paths,
        siteDir,
        component: body.component,
        scope: body.scope === 'global' ? 'global' : 'project'
      });
      return { ok: true, data: { component: saved } };
    } catch (err) {
      return componentFailure(reply, err);
    }
  });

  app.delete('/api/sites/:siteId/backend/components/:componentId', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const scope = request.query && request.query.scope === 'global' ? 'global' : 'project';
    return { ok: true, data: await deleteComponent({ paths: ctx.paths, siteDir, id: request.params.componentId, scope }) };
  });

  app.get('/api/sites/:siteId/backend/components/:componentId/export', async (request) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    const scope = request.query && request.query.scope === 'global' ? 'global' : 'project';
    const pool = await allComponents({ paths: ctx.paths, siteDir });
    const component = pool.find((item) => item.id === request.params.componentId);
    if (!component) throw fail(404, 'LC_E_COMPONENT_NOT_FOUND', '组件不存在');
    return { ok: true, data: { json: exportComponent(component), scope: scope || component.scope } };
  });

  app.post('/api/sites/:siteId/backend/components/import', async (request, reply) => {
    const { siteId, siteDir } = siteContext(ctx, request);
    await requireSite(siteDir);
    try {
      const body = request.body || {};
      let parsed = body.component;
      if (!parsed && typeof body.json === 'string') {
        try {
          parsed = JSON.parse(body.json);
        } catch (err) {
          throw new ComponentError('导入内容不是合法 JSON：' + err.message);
        }
      }
      const saved = await saveComponent({
        paths: ctx.paths,
        siteDir,
        component: parsed,
        scope: body.scope === 'global' ? 'global' : 'project'
      });
      return { ok: true, data: { component: saved } };
    } catch (err) {
      return componentFailure(reply, err);
    }
  });
}
