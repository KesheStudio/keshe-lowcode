/* 后端积木 · Node 代码生成
 *
 * 输入：节点树 → IR（flow/ir.js）→ 本文件的 Node codegen
 * 输出：落在生成区的一组文件（相对后端项目根）：
 *   src/generated/flows/runtime.js      运行时（表达式、集合、文件、HTTP、中间件）
 *   src/generated/flows/<flowId>.js     每个流程一个模块，按 IR 指令生成显式代码
 *   src/generated/flows/<flowId>.ir.json 语言无关 IR（Rust/Go codegen 的输入）
 *   src/generated/routes/flows.js       路由注册入口
 *   src/generated/routes/index.js       在原模板基础上追加 flows 注册
 *   src/generated/flows/manifest.json   IR 版本 / 节点树版本 / 哈希 / 组件版本
 *   src/custom/components/<id>.js       自定义组件的 Node 实现（用户区）
 * 用户代码节点不生成内容，只生成对 src/custom/handlers/<flowId>.<nodeId>.js 的 import。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { componentFileFor } from './nodes.js';
import { buildFlowIR, flowTreeHash, flowIRHash, IR_VERSION } from './ir.js';
import { emitJsExpression } from './expression.js';
import { componentFiles } from './components.js';
import {
  CompileError,
  Emitter,
  safeComment,
  identifierSafe,
  toArrayLiteral,
  generateFlowManifest,
  pageOverridePath
} from './codegen/common.js';
import { compileRustFlow } from './codegen/rust.js';
import { compileGoFlow } from './codegen/go.js';

export { flowTreeHash, flowIRHash, CompileError, pageOverridePath };

const RUNTIME_TEMPLATE = fileURLToPath(new URL('./node-runtime.js', import.meta.url));

/** 把 IR 值编译成 Node 表达式。 */
function emitValue(value) {
  if (!value || typeof value !== 'object') return 'undefined';
  switch (value.kind) {
    case 'undefined':
      return 'undefined';
    case 'literal':
      return JSON.stringify(value.value === undefined ? null : value.value);
    case 'expr': {
      const code = emitJsExpression(value.ast);
      return value.literal ? code : `evaluateCompiled(${JSON.stringify(code)}, ctx)`;
    }
    case 'template': {
      const parts = value.parts || [];
      if (!parts.length) return '""';
      if (parts.length === 1 && typeof parts[0] === 'object') {
        return emitValue({ kind: 'expr', ast: parts[0].ast });
      }
      return '(' + parts.map((part) => {
        if (typeof part === 'string') return JSON.stringify(part);
        return `String(${emitValue({ kind: 'expr', ast: part.ast })})`;
      }).join(' + ') + ')';
    }
    case 'array':
      return '[' + (value.items || []).map(emitValue).join(', ') + ']';
    case 'object':
      return '{ ' + (value.entries || [])
        .map((entry) => JSON.stringify(entry.key) + ': ' + emitValue(entry.value))
        .join(', ') + ' }';
    default:
      return 'undefined';
  }
}

function emitInstruction(ins, level, out) {
  const label = safeComment(ins.label || ins.op || ins.kind);
  out.line(`// ${ins.kind === 'op' ? ins.op : ins.kind} · ${label}`, level);
  out.line('try {', level);
  const inner = level + 1;
  const args = ins.args || {};

  switch (ins.kind) {
    case 'op':
      if (!ins.out && ins.op !== 'file.write') {
        throw new CompileError(`节点 ${ins.nodeId}（${ins.label}）需要输出变量`);
      }
      switch (ins.op) {
        case 'db.read':
          out.line(`ctx.vars.${ins.out} = await readCollection(deps, request, ${JSON.stringify(args.collection || '')}, {`, inner);
          out.line(`page: ${emitValue(args.page)},`, inner + 1);
          out.line(`pageSize: ${emitValue(args.pageSize)},`, inner + 1);
          out.line(`q: ${emitValue(args.q)},`, inner + 1);
          out.line(`filter: ${emitValue(args.filter)},`, inner + 1);
          out.line(`sort: ${JSON.stringify(args.sort || '')},`, inner + 1);
          out.line(`fields: ${JSON.stringify(args.fields || '')}`, inner + 1);
          out.line('})', inner);
          break;
        case 'db.insert':
          out.line(`ctx.vars.${ins.out} = await insertCollection(deps, request, ${JSON.stringify(args.collection || '')}, ${emitValue(args.body)})`, inner);
          break;
        case 'file.read':
          out.line(`ctx.vars.${ins.out} = await readDataFile(${JSON.stringify(args.path || '')}, ${JSON.stringify(args.encoding || 'utf8')})`, inner);
          break;
        case 'file.write':
          out.line(`await writeDataFile(${JSON.stringify(args.path || '')}, ${emitValue(args.content)}, { append: ${args.append === true} })`, inner);
          break;
        case 'http.request':
          out.line(`ctx.vars.${ins.out} = await requestJson(${emitValue(args.url)}, {`, inner);
          out.line(`method: ${JSON.stringify(args.method || 'GET')},`, inner + 1);
          out.line(`headers: ${emitValue(args.headers)},`, inner + 1);
          out.line(`body: ${emitValue(args.body)},`, inner + 1);
          out.line(`timeoutMs: ${Number(args.timeoutMs) || 8000}`, inner + 1);
          out.line('})', inner);
          break;
        case 'data.pick':
          out.line(`ctx.vars.${ins.out} = pickFields(${emitValue(args.input)}, ${toArrayLiteral(args.fields)})`, inner);
          break;
        case 'data.template':
          out.line(`ctx.vars.${ins.out} = ${emitValue(args.template)}`, inner);
          break;
        case 'code.run':
          out.line(`ctx.vars.${ins.out} = await code_${identifierSafe(ins.nodeId)}(ctx)`, inner);
          break;
        case 'component.run':
          out.line(`ctx.vars.${ins.out} = await component_${identifierSafe(ins.impl.componentId)}(ctx, ${emitValue(args.args)})`, inner);
          break;
        default:
          throw new CompileError(`IR 操作 ${ins.op} 没有对应的 Node codegen 分支`);
      }
      break;

    case 'branch':
      out.line(`if (${emitValue(ins.cond)}) {`, inner);
      emitInstructions(ins.then || [], inner + 1, out);
      out.line('} else {', inner);
      emitInstructions(ins.else || [], inner + 1, out);
      out.line('}', inner);
      break;

    case 'loop': {
      const seq = identifierSafe(ins.nodeId);
      const itemVar = String(args.itemVar || 'item');
      out.line('{', inner);
      out.line(`const __items_${seq} = toArray(${emitValue(args.source)})`, inner + 1);
      out.line(`const __collected_${seq} = []`, inner + 1);
      out.line(`const __limit_${seq} = Math.min(__items_${seq}.length, ${Number(args.limit) || 100})`, inner + 1);
      out.line(`for (let __i_${seq} = 0; __i_${seq} < __limit_${seq}; __i_${seq} += 1) {`, inner + 1);
      out.line(`ctx.vars.${itemVar} = __items_${seq}[__i_${seq}]`, inner + 2);
      out.line(`ctx.vars.itemIndex = __i_${seq}`, inner + 2);
      emitInstructions(ins.body || [], inner + 2, out);
      out.line(`__collected_${seq}.push(${emitValue(args.collect)})`, inner + 2);
      out.line('}', inner + 1);
      out.line(`ctx.vars.${ins.out} = __collected_${seq}`, inner + 1);
      out.line('}', inner);
      break;
    }

    case 'return':
      out.line(`return sendJson(reply, ${Number(args.status) || 200}, ${emitValue(args.body)}, ${emitValue(args.headers)})`, inner);
      break;

    default:
      throw new CompileError(`未知 IR 指令：${ins.kind}`);
  }

  out.line('} catch (err) {', level);
  out.line(`throw wrapNodeError(${JSON.stringify(ins.nodeId)}, ${JSON.stringify(ins.label || '')}, err)`, level + 1);
  out.line('}', level);
}

function emitInstructions(list, level, out) {
  for (const ins of list || []) emitInstruction(ins, level, out);
}

function importPathFromFlows(file) {
  return '../../' + String(file || '').replace(/^src\//, '');
}

function generateFlowModule(ir, opts) {
  const out = new Emitter();
  const entry = ir.entry || { method: 'GET', path: '/' };

  out.line('// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。');
  out.line(`// 流程：${safeComment(ir.flow.name)}（${ir.flow.id}） · 节点树版本 ${opts.treeVersion} · IR ${ir.irVersion}/${ir.irHash}`);
  out.line(`// 生成时间：${opts.generatedAt}`);
  out.blank();
  out.line('import {');
  out.line('  applyCors,');
  out.line('  createRateLimiter,');
  out.line('  createRequestLog,');
  out.line('  evaluateCompiled,');
  out.line('  insertCollection,');
  out.line('  pickFields,');
  out.line('  readCollection,');
  out.line('  readDataFile,');
  out.line('  requestJson,');
  out.line('  requireAuth,');
  out.line('  sendJson,');
  out.line('  toArray,');
  out.line('  validateEntryParams,');
  out.line('  wrapNodeError,');
  out.line('  writeDataFile');
  out.line("} from './runtime.js'");

  for (const item of ir.codeModules || []) {
    out.line(`import { run as code_${identifierSafe(item.nodeId)} } from ${JSON.stringify(importPathFromFlows(item.file))}`);
  }
  if (opts.pageOverride) {
    out.line(`import { run as runPageOverride } from ${JSON.stringify(importPathFromFlows(pageOverridePath(ir.flow.id, 'node')))}`);
  }
  const seenComponents = new Set();
  for (const item of ir.components || []) {
    if (seenComponents.has(item.id)) continue;
    seenComponents.add(item.id);
    out.line(`import { run as component_${identifierSafe(item.id)} } from ${JSON.stringify(importPathFromFlows(componentFileFor(item.id, item.language)))}`);
  }
  out.blank();

  out.line('export const meta = {');
  out.line(`  id: ${JSON.stringify(ir.flow.id)},`);
  out.line(`  name: ${JSON.stringify(ir.flow.name || '')},`);
  out.line(`  treeVersion: ${opts.treeVersion},`);
  out.line(`  treeHash: ${JSON.stringify(opts.treeHash)},`);
  out.line(`  irVersion: ${ir.irVersion},`);
  out.line(`  irHash: ${JSON.stringify(ir.irHash)},`);
  out.line(`  generatedAt: ${JSON.stringify(opts.generatedAt)},`);
  out.line(`  entry: { method: ${JSON.stringify(entry.method)}, path: ${JSON.stringify(entry.path)} }`);
  out.line('}');
  out.blank();

  out.line('export async function registerFlow(app, deps) {');
  const middlewareVars = {};
  for (const item of ir.middleware || []) {
    const params = item.params || {};
    const varName = `__mw_${identifierSafe(item.nodeId)}`;
    middlewareVars[item.op] = varName;
    if (item.op === 'middleware.cors') {
      const origins = String(params.origins || '').split(',').map((value) => value.trim()).filter(Boolean);
      out.line(`  const ${varName} = applyCors({ origins: ${toArrayLiteral(origins)}, credentials: ${params.credentials === true}, maxAgeSeconds: ${Number(params.maxAgeSeconds) || 600} })`);
    } else if (item.op === 'middleware.log') {
      out.line(`  const ${varName} = createRequestLog({ level: ${JSON.stringify(String(params.level || 'info'))}, skipHealth: ${params.skipHealth !== false} })`);
    } else if (item.op === 'middleware.auth') {
      const roles = String(params.roles || '').split(',').map((value) => value.trim()).filter(Boolean);
      out.line(`  const ${varName} = requireAuth(deps, ${toArrayLiteral(roles)})`);
    } else if (item.op === 'middleware.rateLimit') {
      out.line(`  const ${varName} = createRateLimiter({ rps: ${Number(params.rps) || 20}, burst: ${Number(params.burst) || 40}, keyBy: ${JSON.stringify(String(params.keyBy || 'ip'))} })`);
    }
  }
  if ((ir.middleware || []).length) out.blank();

  const onRequest = [];
  const onResponse = [];
  const preHandler = [];
  if (middlewareVars['middleware.cors']) onRequest.push(`${middlewareVars['middleware.cors']}.onRequest`);
  if (middlewareVars['middleware.log']) {
    onRequest.push(`${middlewareVars['middleware.log']}.onRequest`);
    onResponse.push(`${middlewareVars['middleware.log']}.onResponse`);
  }
  const rules = Array.isArray(entry.params) ? entry.params : [];
  if (rules.length) preHandler.push(`validateEntryParams(${JSON.stringify(rules)})`);
  if (middlewareVars['middleware.auth']) preHandler.push(middlewareVars['middleware.auth']);
  if (middlewareVars['middleware.rateLimit']) preHandler.push(middlewareVars['middleware.rateLimit']);

  out.line('  app.route({');
  out.line(`    method: ${JSON.stringify(entry.method)},`);
  out.line(`    url: ${JSON.stringify(entry.path)},`);
  if (onRequest.length) out.line(`    onRequest: [${onRequest.join(', ')}],`);
  if (preHandler.length) out.line(`    preHandler: [${preHandler.join(', ')}],`);
  if (onResponse.length) out.line(`    onResponse: [${onResponse.join(', ')}],`);
  out.line('    handler: async (request, reply) => {');
  out.line('      const ctx = { request, reply, deps, vars: {} }');
  out.blank();
  if (opts.pageOverride) {
    out.line('      // 页面级用户代码：入口、参数校验与中间件仍由生成区负责，业务处理交给用户区。');
    out.line('      const pageResult = await runPageOverride(ctx)');
    out.line('      if (pageResult === undefined) return reply');
    out.line('      const pageEnvelope = pageResult && (pageResult.status !== undefined || pageResult.headers !== undefined || pageResult.body !== undefined)');
    out.line('      const pageStatus = pageEnvelope && pageResult.status !== undefined ? Number(pageResult.status) || 200 : 200');
    out.line('      const pageBody = pageEnvelope ? pageResult.body : pageResult');
    out.line('      const pageHeaders = pageEnvelope ? pageResult.headers : undefined');
    out.line('      return sendJson(reply, pageStatus, pageBody, pageHeaders)');
  } else {
    emitInstructions(ir.body, 3, out);
    out.blank();
    out.line("      return sendJson(reply, 500, { ok: false, error: { code: 'LC_E_FLOW_NO_RESPONSE', message: '流程没有返回响应' } })");
  }
  out.line('    }');
  out.line('  })');

  if (middlewareVars['middleware.cors'] && entry.method !== 'OPTIONS') {
    out.blank();
    out.line('  // CORS 节点的预检路由（和主路由同路径，只处理 OPTIONS）');
    out.line(`  app.options(${JSON.stringify(entry.path)}, { onRequest: [${middlewareVars['middleware.cors']}.onRequest] }, async (_request, reply) => reply.code(204).send())`);
  }

  out.line('}');
  out.blank();
  return out.toString();
}

function generateRoutesFlows(flowId) {
  const name = `register_${identifierSafe(flowId)}`;
  return [
    '// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。',
    `import { registerFlow as ${name} } from '../flows/${flowId}.js'`,
    '',
    'export async function registerFlowRoutes(app, deps) {',
    `  await ${name}(app, deps)`,
    '}',
    ''
  ].join('\n');
}

// 模板自带的示例路由模块；流程入口若与它们撞路径，生成区会跳过该模块，让流程接管。
const DEMO_ROUTE_MODULES = [
  { module: 'itemsRoutes', base: '/api/items', label: '示例物品接口' }
];

function demoRouteConflicts(entry) {
  const routePath = String(entry && entry.path ? entry.path : '');
  return DEMO_ROUTE_MODULES.filter((item) => routePath === item.base || routePath.startsWith(item.base + '/'));
}

export function patchRoutesIndex(source, flowId, skipModules = []) {
  if (!source.includes('export async function registerRoutes(app, deps) {')) {
    throw new CompileError('模板 src/generated/routes/index.js 结构变化：找不到 registerRoutes，编译器需要同步更新');
  }
  if (source.includes('registerFlowRoutes')) return source;
  const marker = 'export async function registerRoutes(app, deps) {';
  const markerIndex = source.indexOf(marker);
  let next = source.slice(0, markerIndex)
    + "import { registerFlowRoutes } from './flows.js'\n"
    + source.slice(markerIndex);

  for (const item of skipModules) {
    const line = `  await ${item.module}(app, deps)`;
    if (!next.includes(line)) continue;
    next = next.replace(
      line,
      `  // 流程入口（${item.reason}）接管了 ${item.base}，跳过${item.label}模块\n  // ${line.trim()}`
    );
  }

  const close = next.lastIndexOf('}');
  if (close < 0) throw new CompileError('模板 src/generated/routes/index.js 缺少闭合括号');
  return next.slice(0, close)
    + `  await registerFlowRoutes(app, deps)\n`
    + next.slice(close);
}

/**
 * 编译流程为生成区文件。
 * @param {object} flowDoc 完整流程文档
 * @param {{ routesIndexSource: string, treeVersion?: number, generatedAt?: string, target?: string, components?: Array<object> }} options
 * @returns {{ files: Array<{path: string, content: string}>, meta: object }}
 */
export function compileFlowToFiles(flowDoc, options = {}) {
  const target = String(options.target || 'node');
  if (target === 'rust') return compileRustFlow(flowDoc, options);
  if (target === 'go') return compileGoFlow(flowDoc, options);
  if (target !== 'node') {
    throw new CompileError(`未知目标语言：${target}`);
  }
  const flow = flowDoc.flow;
  if (!flow || !flow.id) throw new CompileError('流程缺少 id');
  if (!options.routesIndexSource) {
    throw new CompileError('缺少模板 routes/index.js，无法接入流程路由');
  }
  const components = Array.isArray(options.components) ? options.components : [];
  const built = buildFlowIR(flowDoc, { target, components });
  if (!built.ok) {
    const errors = built.diagnostics.filter((item) => item.level === 'error');
    throw new CompileError(
      '流程 IR 构建失败，已停止生成',
      errors.map((item) => `${item.nodeId || '-'} ${item.message}`).join('；')
    );
  }
  const ir = built.ir;
  const treeVersion = Number.isInteger(options.treeVersion) ? options.treeVersion : (flow.treeVersion || 0) + 1;
  const treeHash = flowTreeHash(flowDoc);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const userFiles = options.userFiles instanceof Set ? options.userFiles : new Set(options.userFiles || []);
  const pageOverride = userFiles.has(pageOverridePath(flow.id, 'node'));
  const opts = { treeVersion, treeHash, generatedAt, target, pageOverride };

  const conflicts = demoRouteConflicts(ir.entry);
  const skipModules = conflicts.map((item) => ({
    module: item.module,
    base: item.base,
    label: item.label,
    reason: `${ir.entry.method} ${ir.entry.path}`
  }));
  const warnings = [
    ...built.diagnostics.filter((item) => item.level !== 'error'),
    ...conflicts.map((item) => ({
      level: 'warning',
      code: 'LC_F_ROUTE_OVERRIDE',
      nodeId: ir.entry.nodeId,
      nodeLabel: ir.entry.label,
      path: '',
      message: `入口 ${ir.entry.method} ${ir.entry.path} 与模板示例路由冲突，已跳过 ${item.module}（${item.base} 及其子路径）`
    }))
  ];

  const usedComponents = ir.components
    .map((item) => components.find((component) => component.id === item.id))
    .filter(Boolean);
  const files = [
    { path: 'src/generated/flows/runtime.js', content: fs.readFileSync(RUNTIME_TEMPLATE, 'utf8') },
    { path: `src/generated/flows/${flow.id}.js`, content: generateFlowModule(ir, opts) },
    { path: `src/generated/flows/${flow.id}.ir.json`, content: JSON.stringify(ir, null, 2) + '\n' },
    { path: 'src/generated/routes/flows.js', content: generateRoutesFlows(flow.id) },
    { path: 'src/generated/routes/index.js', content: patchRoutesIndex(options.routesIndexSource, flow.id, skipModules) },
    { path: 'src/generated/flows/manifest.json', content: generateFlowManifest(flowDoc, ir, opts) },
    ...componentFiles(usedComponents, target)
  ];

  return {
    files,
    meta: {
      ...opts,
      irVersion: IR_VERSION,
      irHash: ir.irHash,
      entry: ir.entry,
      pageOverride,
      components: (ir.components || []).map((item) => ({
        id: item.id,
        version: item.version,
        scope: item.scope,
        language: item.language
      })),
      warnings,
      diagnostics: built.diagnostics
    }
  };
}

export { expressionSource, ExpressionError } from './expression.js';
