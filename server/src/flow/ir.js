/* 后端积木 · 语言无关中间表示（IR）
 *
 * 节点树 → IR → 各语言 codegen。IR 只描述“做什么”，不出现任何目标语言语法：
 *   - 中间件按固定优先级排在入口上；
 *   - 处理节点是 op / branch / loop / return 指令；
 *   - 表达式是受限 AST（literal / ref / unary / binary / ternary / member / index）；
 *   - 代码节点与自定义组件是“黑盒调用”，IR 只记录实现文件与语言。
 *
 * 目标语言筛选也在这里：每个节点类型声明 languages（设计能力）与
 * implementedLanguages（当前 codegen），不满足时产出带 nodeId 的诊断，绝不静默跳过。
 */
import crypto from 'node:crypto';
import { nodeType, codeFileFor, componentFileFor, FLOW_LANGUAGES } from './nodes.js';
import {
  parseExpression,
  expressionSource,
  placeholderSegments,
  hasPlaceholder,
  ExpressionError
} from './expression.js';

export const IR_VERSION = 1;

function mk(level, code, node, message, extra = {}) {
  return {
    level,
    code,
    nodeId: node && node.id ? node.id : '',
    nodeLabel: node ? (node.name || node.type || '') : '',
    path: extra.path || '',
    message,
    suggestion: extra.suggestion || ''
  };
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function flowTreeHash(flowDoc) {
  const payload = {
    flow: flowDoc.flow && flowDoc.flow.root,
    configCenter: flowDoc.settings && flowDoc.settings.configCenter ? flowDoc.settings.configCenter : null
  };
  return crypto.createHash('sha256').update(canonical(payload)).digest('hex').slice(0, 16);
}

function textOf(params, key) {
  return String((params && params[key]) == null ? '' : params[key]);
}

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  return String(value).trim() === '';
}

/* ------------------------------------------------------------------ 表达式与值 */

function exprIR(value, roots, node, diagnostics, label) {
  if (isEmpty(value)) return { kind: 'undefined' };
  const { source, mode } = expressionSource(value);
  try {
    const { ast } = parseExpression(source, roots);
    return mode === 'expression'
      ? { kind: 'expr', ast }
      : { kind: 'expr', ast, literal: true };
  } catch (err) {
    const message = err instanceof ExpressionError ? err.message : String(err.message);
    diagnostics.push(mk('error', 'LC_F_IR_EXPR', node, `${label}：${message}`));
    return { kind: 'undefined' };
  }
}

function templateIR(text, roots, node, diagnostics, label) {
  const value = String(text == null ? '' : text);
  if (!hasPlaceholder(value)) return { kind: 'literal', value };
  const parts = [];
  let cursor = 0;
  for (const segment of placeholderSegments(value)) {
    if (segment.start > cursor) parts.push(value.slice(cursor, segment.start));
    try {
      const { ast } = parseExpression(segment.source, roots);
      parts.push({ kind: 'expr', ast });
    } catch (err) {
      const message = err instanceof ExpressionError ? err.message : String(err.message);
      diagnostics.push(mk('error', 'LC_F_IR_EXPR', node, `${label}：${message}`));
      parts.push({ kind: 'literal', value: segment.raw });
    }
    cursor = segment.end;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return { kind: 'template', parts };
}

function jsonValueIR(value, roots, node, diagnostics, label) {
  if (typeof value === 'string') return templateIR(value, roots, node, diagnostics, label);
  if (Array.isArray(value)) {
    return { kind: 'array', items: value.map((item) => jsonValueIR(item, roots, node, diagnostics, label)) };
  }
  if (value && typeof value === 'object') {
    return {
      kind: 'object',
      entries: Object.entries(value).map(([key, item]) => ({
        key,
        value: jsonValueIR(item, roots, node, diagnostics, label)
      }))
    };
  }
  return { kind: 'literal', value: value === undefined ? null : value };
}

function jsonTextIR(text, roots, node, diagnostics, label) {
  const raw = String(text == null ? '' : text);
  if (raw.trim() === '') return { kind: 'undefined' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    diagnostics.push(mk('error', 'LC_F_IR_JSON', node, `${label} 不是合法 JSON：${err.message}`));
    return { kind: 'undefined' };
  }
  return jsonValueIR(parsed, roots, node, diagnostics, label);
}

/* ------------------------------------------------------------------ 能力矩阵 */

function languageIssue(node, def, target, diagnostics) {
  if (!Array.isArray(def.languages) || !def.languages.includes(target)) {
    const supported = (def.languages || []).join(' / ') || '（无）';
    diagnostics.push(mk('error', 'LC_F_LANG_NODE', node,
      `积木「${def.label}」不支持目标语言 ${target}（它支持：${supported}）`,
      { suggestion: `换成 ${target} 支持的同类积木，或插入一个代码节点并把代码语言声明为 ${target}` }));
    return false;
  }
  if (!Array.isArray(def.implementedLanguages) || !def.implementedLanguages.includes(target)) {
    const implemented = (def.implementedLanguages || []).join(' / ') || '（无）';
    diagnostics.push(mk('error', 'LC_F_LANG_CODEGEN', node,
      `积木「${def.label}」还没有 ${target} 实现（已实现：${implemented}）`,
      { suggestion: `换成支持 ${target} 的同类积木；如确有自定义逻辑，插入一个代码节点并把代码语言声明为 ${target}` }));
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ 主体 */

function buildInstructions(list, roots, ctx, diagnostics) {
  const out = [];
  for (const node of list || []) {
    if (!node || node.enabled === false) continue;
    const def = nodeType(node.type);
    if (!def) {
      diagnostics.push(mk('error', 'LC_F_IR_TYPE', node, `未知节点类型：${node.type}`));
      continue;
    }
    if (def.category === 'entry' || def.category === 'middleware') continue;
    if (!languageIssue(node, def, ctx.target, diagnostics)) continue;

    const params = node.params && typeof node.params === 'object' ? node.params : {};
    const label = node.name || def.label;
    const base = { nodeId: node.id, label };

    if (node.type === 'code.node') {
      const codeLanguage = String(params.codeLanguage || 'node');
      if (codeLanguage !== ctx.target) {
        diagnostics.push(mk('warning', 'LC_F_CODE_SKIP', node,
          `代码节点声明为 ${codeLanguage}，生成 ${ctx.target} 时跳过`,
          { suggestion: `如果这段逻辑也要在 ${ctx.target} 复用，请为 ${ctx.target} 再放一个代码节点，或把逻辑拆成通用积木` }));
        continue;
      }
      const file = codeFileFor(ctx.flow.id, node.id, ctx.target);
      out.push({
        kind: 'op',
        op: 'code.run',
        ...base,
        out: textOf(params, 'output'),
        impl: { language: ctx.target, file },
        args: { codeLanguage }
      });
      ctx.codeModules.push({ nodeId: node.id, language: ctx.target, file });
      roots.add(textOf(params, 'output'));
      continue;
    }

    if (node.type === 'component.custom') {
      const componentId = textOf(params, 'component');
      const component = ctx.components.find((item) => item.id === componentId);
      if (!component) {
        diagnostics.push(mk('error', 'LC_F_COMPONENT_MISSING', node,
          `流程引用了不存在的后端组件：${componentId || '（空）'}`,
          { suggestion: '打开组件库创建该组件，或先把组件导入本项目；悬空引用不会被生成' }));
        continue;
      }
      if (!Array.isArray(component.languages) || !component.languages.includes(ctx.target)) {
        diagnostics.push(mk('error', 'LC_F_COMPONENT_LANG', node,
          `组件「${component.name || componentId}」不支持目标语言 ${ctx.target}（支持：${(component.languages || []).join(' / ') || '（无）'}）`,
          { suggestion: `换用支持 ${ctx.target} 的组件，或给该组件补一份 ${ctx.target} 实现` }));
        continue;
      }
      if (!(component.implementedLanguages || ['node']).includes(ctx.target)) {
        diagnostics.push(mk('error', 'LC_F_COMPONENT_CODEGEN', node,
          `组件「${component.name || componentId}」的 ${ctx.target} 实现尚未接入 codegen`,
          { suggestion: '先选择 Node 目标；组件多语言实现沿用同一份参数 schema' }));
        continue;
      }
      out.push({
        kind: 'op',
        op: 'component.run',
        ...base,
        out: textOf(params, 'output'),
        impl: {
          componentId: component.id,
          version: Number(component.version) || 1,
          scope: component.scope || 'project',
          language: ctx.target,
          file: componentFileFor(component.id, ctx.target)
        },
        args: { args: jsonTextIR(params.args || '{}', roots, node, diagnostics, '调用参数') }
      });
      ctx.componentsUsed.push({
        id: component.id,
        version: Number(component.version) || 1,
        scope: component.scope || 'project',
        language: ctx.target
      });
      roots.add(textOf(params, 'output'));
      continue;
    }

    switch (node.type) {
      case 'db.readCollection': {
        out.push({
          kind: 'op', op: 'db.read', ...base,
          out: textOf(params, 'output'),
          args: {
            collection: textOf(params, 'collection'),
            page: exprIR(params.page, roots, node, diagnostics, '页码'),
            pageSize: exprIR(params.pageSize, roots, node, diagnostics, '每页条数'),
            q: exprIR(params.q, roots, node, diagnostics, '关键字'),
            filter: exprIR(params.filter, roots, node, diagnostics, '过滤条件'),
            sort: textOf(params, 'sort'),
            fields: textOf(params, 'fields')
          }
        });
        break;
      }
      case 'db.insertCollection': {
        out.push({
          kind: 'op', op: 'db.insert', ...base,
          out: textOf(params, 'output'),
          args: {
            collection: textOf(params, 'collection'),
            body: exprIR(params.body, roots, node, diagnostics, '写入内容')
          }
        });
        break;
      }
      case 'file.read': {
        out.push({
          kind: 'op', op: 'file.read', ...base,
          out: textOf(params, 'output'),
          args: { path: textOf(params, 'path'), encoding: textOf(params, 'encoding') || 'utf8' }
        });
        break;
      }
      case 'file.write': {
        out.push({
          kind: 'op', op: 'file.write', ...base,
          args: {
            path: textOf(params, 'path'),
            content: exprIR(params.content, roots, node, diagnostics, '写入内容'),
            append: params.append === true
          }
        });
        break;
      }
      case 'http.request': {
        const bodyRaw = textOf(params, 'body');
        const jsonLike = bodyRaw.trim().startsWith('{') || bodyRaw.trim().startsWith('[');
        out.push({
          kind: 'op', op: 'http.request', ...base,
          out: textOf(params, 'output'),
          args: {
            method: textOf(params, 'method') || 'GET',
            url: templateIR(params.url, roots, node, diagnostics, '地址'),
            headers: jsonTextIR(params.headers || '{}', roots, node, diagnostics, '请求头'),
            body: bodyRaw.trim() === ''
              ? { kind: 'undefined' }
              : jsonLike
                ? jsonTextIR(bodyRaw, roots, node, diagnostics, '请求体')
                : templateIR(bodyRaw, roots, node, diagnostics, '请求体'),
            timeoutMs: Number(params.timeoutMs) || 8000
          }
        });
        break;
      }
      case 'data.transform': {
        if (params.mode === 'template') {
          out.push({
            kind: 'op', op: 'data.template', ...base,
            out: textOf(params, 'output'),
            args: { template: jsonTextIR(params.template || '{}', roots, node, diagnostics, '输出模板') }
          });
        } else {
          out.push({
            kind: 'op', op: 'data.pick', ...base,
            out: textOf(params, 'output'),
            args: {
              input: exprIR(params.input, roots, node, diagnostics, '输入数据'),
              fields: String(params.fields || '').split(',').map((item) => item.trim()).filter(Boolean)
            }
          });
        }
        break;
      }
      case 'flow.branch': {
        const cond = exprIR(params.condition, roots, node, diagnostics, '条件');
        out.push({
          kind: 'branch', ...base, cond,
          then: buildInstructions(node.children || [], new Set(roots), ctx, diagnostics),
          else: buildInstructions(node.elseChildren || [], new Set(roots), ctx, diagnostics)
        });
        continue;
      }
      case 'flow.loop': {
        const itemVar = String(params.itemVar || 'item');
        const bodyRoots = new Set(roots);
        bodyRoots.add(itemVar);
        bodyRoots.add('itemIndex');
        const body = buildInstructions(node.children || [], bodyRoots, ctx, diagnostics);
        out.push({
          kind: 'loop', ...base,
          out: textOf(params, 'output'),
          args: {
            source: exprIR(params.source, roots, node, diagnostics, '数据源'),
            itemVar,
            limit: Math.min(1000, Math.max(1, Number(params.maxIterations) || 100)),
            collect: exprIR(params.collect, bodyRoots, node, diagnostics, '收集表达式')
          },
          body
        });
        roots.add(textOf(params, 'output'));
        continue;
      }
      case 'response.json': {
        out.push({
          kind: 'return', ...base,
          args: {
            status: Number(params.status) || 200,
            body: jsonTextIR(params.body, roots, node, diagnostics, '响应体'),
            headers: jsonTextIR(params.headers || '{}', roots, node, diagnostics, '响应头')
          }
        });
        continue;
      }
      default:
        diagnostics.push(mk('error', 'LC_F_IR_OP', node, `节点类型 ${node.type} 还没有 IR 映射`));
        continue;
    }

    if (def.fields.some((field) => field.key === 'output') && textOf(params, 'output')) {
      roots.add(textOf(params, 'output'));
    }
  }
  return out;
}

/**
 * 节点树 → IR。
 * @param {object} flowDoc 流程文档
 * @param {{ target?: string, components?: Array<object> }} options
 * @returns {{ ok: boolean, ir: object, diagnostics: Array<object> }}
 */
export function buildFlowIR(flowDoc, options = {}) {
  const target = String(options.target || 'node');
  const diagnostics = [];
  const components = Array.isArray(options.components) ? options.components : [];
  const flow = flowDoc && flowDoc.flow ? flowDoc.flow : null;
  const ir = {
    irVersion: IR_VERSION,
    target,
    flow: { id: flow ? flow.id : '', name: flow ? flow.name || '' : '', treeVersion: Number(flow && flow.treeVersion) || 0 },
    entry: null,
    middleware: [],
    body: [],
    codeModules: [],
    components: [],
    diagnostics: []
  };

  if (!FLOW_LANGUAGES.includes(target)) {
    diagnostics.push(mk('error', 'LC_F_LANG_TARGET', null, `未知目标语言：${target}`));
    ir.diagnostics = diagnostics;
    return { ok: false, ir, diagnostics };
  }
  if (!flow || !flow.root) {
    diagnostics.push(mk('error', 'LC_F_IR_FLOW', null, '缺少流程根节点'));
    ir.diagnostics = diagnostics;
    return { ok: false, ir, diagnostics };
  }

  const children = Array.isArray(flow.root.children) ? flow.root.children : [];
  const enabled = children.filter((node) => node && node.enabled !== false);
  const entry = enabled.find((node) => node.type === 'entry.request');
  if (!entry) {
    diagnostics.push(mk('error', 'LC_F_IR_ENTRY', null, '没有启用的入口节点'));
  } else {
    const params = entry.params || {};
    ir.entry = {
      nodeId: entry.id,
      label: entry.name || 'HTTP 入口',
      method: String(params.method || 'GET'),
      path: String(params.path || '/'),
      params: Array.isArray(params.params) ? params.params : []
    };
  }

  const middleware = enabled
    .filter((node) => {
      const def = nodeType(node.type);
      return def && def.category === 'middleware';
    })
    .sort((a, b) => {
      const pa = nodeType(a.type).middlewarePriority || 100;
      const pb = nodeType(b.type).middlewarePriority || 100;
      return pa - pb;
    });
  for (const node of middleware) {
    const def = nodeType(node.type);
    if (!languageIssue(node, def, target, diagnostics)) continue;
    ir.middleware.push({ nodeId: node.id, op: node.type, label: node.name || def.label, params: node.params || {} });
  }

  const ctx = {
    target,
    flow: flow || { id: '' },
    components,
    componentsUsed: ir.components,
    codeModules: ir.codeModules
  };
  ir.body = buildInstructions(children, new Set(['request']), ctx, diagnostics);
  ir.diagnostics = diagnostics;
  ir.irHash = flowIRHash(ir);
  return { ok: diagnostics.every((item) => item.level !== 'error'), ir, diagnostics };
}

/** IR 内容哈希（不含诊断与时间信息）。 */
export function flowIRHash(ir) {
  return crypto.createHash('sha256').update(canonical({
    irVersion: ir.irVersion,
    target: ir.target,
    flow: { id: ir.flow && ir.flow.id, treeVersion: ir.flow && ir.flow.treeVersion },
    entry: ir.entry,
    middleware: ir.middleware,
    body: ir.body,
    components: ir.components
  })).digest('hex').slice(0, 16);
}
