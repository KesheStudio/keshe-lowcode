/* 后端积木 · 多语言 codegen 公共部分
 *
 * Node / Rust / Go 三个生成器共用：错误类型、缩进器、标识符清洗、清单生成，
 * 以及“节点树 → IR + 版本/hash”的准备工作。各语言的代码写在同目录下。
 */
import { buildFlowIR, flowTreeHash, IR_VERSION } from '../ir.js';
import { nodeType } from '../nodes.js';

export class CompileError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.name = 'CompileError';
    this.detail = detail;
  }
}

export class Emitter {
  constructor() {
    this.lines = [];
  }

  line(text = '', level = 0) {
    this.lines.push('  '.repeat(level) + text);
  }

  blank() {
    this.lines.push('');
  }

  toString() {
    return this.lines.join('\n');
  }
}

export function safeComment(value) {
  return String(value || '').replace(/[\r\n*]/g, ' ').slice(0, 80);
}

export function identifierSafe(value) {
  return String(value || '').replace(/[^A-Za-z0-9_]/g, '_');
}

/** 页面级覆盖文件：流程实例的用户区入口，生成区只负责引用。 */
export function pageOverridePath(flowId, target = 'node') {
  const ext = target === 'rust' ? 'rs' : target === 'go' ? 'go' : 'js';
  return (target === 'go' ? 'internal/custom/flows/' : 'src/custom/flows/') + flowId + '.' + ext;
}

export function toArrayLiteral(list) {
  return JSON.stringify(Array.isArray(list) ? list : []);
}

export function countNodes(flowDoc) {
  let total = 0;
  let enabled = 0;
  const walk = (list) => {
    for (const node of list || []) {
      total += 1;
      if (node && node.enabled !== false) enabled += 1;
      const def = nodeType(node && node.type);
      for (const slot of (def && def.slots) || []) walk(node[slot.key]);
    }
  };
  walk(flowDoc.flow && flowDoc.flow.root ? flowDoc.flow.root.children : []);
  return { total, enabled };
}

export function generateFlowManifest(flowDoc, ir, opts) {
  const counts = countNodes(flowDoc);
  return JSON.stringify({
    schemaVersion: 2,
    generator: 'lowcode-backend-flow',
    language: opts.target,
    targetLanguages: [opts.target],
    irVersion: IR_VERSION,
    irHash: ir.irHash,
    treeVersion: opts.treeVersion,
    treeHash: opts.treeHash,
    generatedAt: opts.generatedAt,
    entry: ir.entry ? { method: ir.entry.method, path: ir.entry.path } : null,
    nodes: counts,
    components: (ir.components || []).map((item) => ({
      id: item.id,
      version: item.version,
      scope: item.scope,
      language: item.language
    })),
    codeModules: (ir.codeModules || []).map((item) => ({ nodeId: item.nodeId, language: item.language, file: item.file }))
  }, null, 2) + '\n';
}

// Rust / Go 模板自带的示例接口；流程入口与它们撞路径时，生成区跳过示例注册。
const DEMO_ROUTE_MODULES = [
  { module: 'items', base: '/api/items', label: '示例物品接口' }
];

export function demoRouteConflicts(entry) {
  const routePath = String(entry && entry.path ? entry.path : '');
  return DEMO_ROUTE_MODULES.filter((item) => routePath === item.base || routePath.startsWith(item.base + '/'));
}

/**
 * 校验 + 构建 IR，供 Rust / Go 生成器共用。Node 生成器仍走 compile.js 里的主流程。
 * @returns {{ ir: object, opts: object, warnings: Array<object>, components: Array<object> }}
 */
export function prepareCompile(flowDoc, options = {}) {
  const flow = flowDoc.flow;
  if (!flow || !flow.id) throw new CompileError('流程缺少 id');
  if (!options.routesIndexSource) {
    throw new CompileError('缺少模板路由装配文件，无法接入流程路由');
  }
  const target = String(options.target || 'node');
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
  const conflicts = demoRouteConflicts(ir.entry);
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
  return {
    ir,
    opts: { treeVersion, treeHash, generatedAt, target },
    warnings,
    components,
    conflicts
  };
}

export { flowTreeHash, flowIRHash } from '../ir.js';
