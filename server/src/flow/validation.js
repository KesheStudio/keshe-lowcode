/* 后端积木 · 生成前校验
 *
 * 校验分三层：
 *   1. 结构：节点 id、类型、挂载关系、嵌套深度、重复挂载；
 *   2. 参数：必填、类型、范围、正则、JSON、路径安全；
 *   3. 引用：表达式里的变量必须由前面的节点产生；并检测引用环。
 * 生成接口只要拿到 level=error 的条目就拒绝编译，错误里带 nodeId/nodeLabel/path，
 * 页面上能直接定位到具体节点。
 */
import { NODE_TYPES, nodeType, codeFileFor, FLOW_LANGUAGES } from './nodes.js';
import { compileExpression, expressionSource, placeholderSegments, hasPlaceholder, ExpressionError } from './expression.js';

const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const OUTPUT_RE = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_DEPTH = 12;
const MAX_NODES = 300;
const BLOCKED_HOSTS = [/^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /\.local$/i];

function mk(level, code, node, message, path = '') {
  return {
    level,
    code,
    nodeId: node && node.id ? node.id : '',
    nodeLabel: node ? (node.name || node.type || '') : '',
    path,
    message
  };
}

function emptyValue(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === '';
}

function parseJsonField(field, value, node, path, issues) {
  if (emptyValue(value)) return null;
  try {
    return JSON.parse(String(value));
  } catch (err) {
    issues.push(mk('error', 'LC_F_PARAM_JSON', node, `${field.label} 不是合法 JSON：${err.message}`, path));
    return null;
  }
}

function safeRelPath(value) {
  const text = String(value || '');
  if (!text || text.startsWith('/') || text.startsWith('\\') || text.includes('..') || text.includes('\0')) return false;
  return true;
}

function blockedHost(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '只允许 http / https';
    const host = parsed.hostname;
    if (BLOCKED_HOSTS.some((re) => re.test(host))) return `不允许访问本机或内网地址：${host}`;
    return '';
  } catch {
    return 'URL 格式不合法';
  }
}

/** 收集节点里所有需要编译的表达式：{ label, source } */
function expressionsOf(node, def) {
  const out = [];
  for (const field of def.fields) {
    const value = node.params ? node.params[field.key] : undefined;
    if (field.kind === 'expression') {
      if (emptyValue(value)) continue;
      out.push({ field, source: expressionSource(value).source, raw: String(value) });
      continue;
    }
    if (field.kind !== 'text' && field.kind !== 'textarea') continue;
    if (!hasPlaceholder(value)) continue;
    for (const segment of placeholderSegments(value)) {
      out.push({ field, source: segment.source, raw: segment.raw });
    }
  }
  return out;
}

export function validateFlow(flowDoc, { collections = [], userFiles = null, components = [], target = 'node' } = {}) {
  const issues = [];
  const add = (level, code, node, message, path = '') => issues.push(mk(level, code, node, message, path));

  if (!flowDoc || typeof flowDoc !== 'object') {
    add('error', 'LC_F_DOC', null, '流程文档不是对象');
    return { issues, ok: false };
  }
  if (flowDoc.schemaVersion !== 1) {
    add('error', 'LC_F_SCHEMA', null, `不支持的流程 schemaVersion：${flowDoc.schemaVersion}`);
  }
  if (flowDoc.language !== 'node') {
    add('error', 'LC_F_LANGUAGE', null, `当前只支持 Node 后端，收到：${flowDoc.language || '（空）'}`);
  }
  const flow = flowDoc.flow;
  if (!flow || typeof flow !== 'object') {
    add('error', 'LC_F_FLOW', null, '缺少 flow 对象');
    return { issues, ok: false };
  }
  if (!flow.root || typeof flow.root !== 'object') {
    add('error', 'LC_F_ROOT', null, '缺少流程根节点');
    return { issues, ok: false };
  }
  if (String(flow.name || '').length > 64) {
    add('error', 'LC_F_NAME', null, '流程名称不能超过 64 个字符');
  }

  const seenIds = new Map();
  const seenObjects = new Set();
  const seenOutputs = new Map();
  const allOutputs = new Set();
  const refsByNode = new Map();
  const nodePaths = new Map();
  const allNodes = [];
  let nodeCount = 0;
  let structuralError = false;

  function checkNodeShape(node, path, depth, nested) {
    if (!node || typeof node !== 'object') {
      add('error', 'LC_F_NODE', null, `节点不是对象：${path}`);
      structuralError = true;
      return false;
    }
    nodeCount += 1;
    if (nodeCount > MAX_NODES) {
      add('error', 'LC_F_TOO_MANY', node, `节点数量超过上限 ${MAX_NODES}`, path);
      structuralError = true;
      return false;
    }
    if (seenObjects.has(node)) {
      add('error', 'LC_F_CYCLE_TREE', node, '同一个节点被重复挂载，形成结构环', path);
      structuralError = true;
      return false;
    }
    seenObjects.add(node);

    const id = String(node.id || '');
    if (!ID_RE.test(id)) {
      add('error', 'LC_F_ID', node, `节点 id 不合法：${id || '（空）'}；只允许小写字母、数字、下划线，且以字母开头`, path);
      structuralError = true;
    } else if (seenIds.has(id)) {
      add('error', 'LC_F_ID_DUP', node, `节点 id 重复：${id}（另一个在 ${seenIds.get(id)}）`, path);
      structuralError = true;
    } else {
      seenIds.set(id, path);
    }

    const def = nodeType(node.type);
    if (!def) {
      add('error', 'LC_F_TYPE', node, `未知节点类型：${node.type}`, path);
      structuralError = true;
      return false;
    }
    if (node.enabled !== undefined && typeof node.enabled !== 'boolean') {
      add('error', 'LC_F_ENABLED', node, 'enabled 必须是 true / false', path);
    }
    if (node.type === 'entry.request' && nested) {
      add('error', 'LC_F_ENTRY_NESTED', node, '入口节点必须挂在流程根下，不能放进分支或循环', path);
    }
    if (def.category === 'middleware' && nested) {
      add('error', 'LC_F_MW_NESTED', node, '中间件节点必须挂在流程根下，不能放进分支或循环', path);
    }
    nodePaths.set(node.id, path);
    allNodes.push({ node, def, path, depth });
    return true;
  }

  function walk(node, path, depth, nested) {
    if (depth > MAX_DEPTH) {
      add('error', 'LC_F_DEPTH', node, `嵌套超过 ${MAX_DEPTH} 层，请拆分成多个流程或用户代码`, path);
      return;
    }
    if (!checkNodeShape(node, path, depth, nested)) return;
    const def = nodeType(node.type);
    if (!def || !def.container) return;
    for (const slot of def.slots) {
      const list = Array.isArray(node[slot.key]) ? node[slot.key] : [];
      list.forEach((child, index) => {
        walk(child, `${path}.${slot.key}[${index}]`, depth + 1, true);
      });
    }
  }

  const rootChildren = Array.isArray(flow.root.children) ? flow.root.children : [];
  rootChildren.forEach((node, index) => walk(node, `root.children[${index}]`, 1, false));

  if (!rootChildren.length) {
    add('error', 'LC_F_EMPTY', null, '流程是空的：至少需要一个入口和一个响应节点');
  }

  // ------------------------------------------------------------ 参数与输出
  function checkParams(node, def, path) {
    const params = node.params && typeof node.params === 'object' ? node.params : {};
    for (const field of def.fields) {
      const value = params[field.key];
      if (field.required && emptyValue(value)) {
        add('error', 'LC_F_REQUIRED', node, `必填参数「${field.label}」为空`, path);
        continue;
      }
      if (emptyValue(value)) continue;

      if (field.kind === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          add('error', 'LC_F_PARAM_NUMBER', node, `参数「${field.label}」必须是数字`, path);
        } else {
          if (field.min !== undefined && num < field.min) add('error', 'LC_F_PARAM_RANGE', node, `参数「${field.label}」不能小于 ${field.min}`, path);
          if (field.max !== undefined && num > field.max) add('error', 'LC_F_PARAM_RANGE', node, `参数「${field.label}」不能大于 ${field.max}`, path);
        }
      }
      if (field.kind === 'select' && Array.isArray(field.options) && field.options.length && !field.options.includes(String(value))) {
        add('error', 'LC_F_PARAM_ENUM', node, `参数「${field.label}」只能是：${field.options.join(' / ')}`, path);
      }
      if (field.kind === 'text' && field.pattern && !new RegExp(field.pattern).test(String(value))) {
        add('error', 'LC_F_PARAM_PATTERN', node, `参数「${field.label}」格式不合法：${value}`, path);
      }
      if (field.kind === 'text' && field.key === 'path' && def.category === 'data' && !safeRelPath(value)) {
        add('error', 'LC_F_FILE_PATH', node, '文件路径必须是 data/files 下的相对路径，不能包含 .. 或以 / 开头', path);
      }
      if (field.json) parseJsonField(field, value, node, path, issues);
    }

    if (node.type === 'entry.request') {
      const list = Array.isArray(params.params) ? params.params : [];
      const names = new Set();
      list.forEach((item, index) => {
        const name = String(item && item.name ? item.name : '');
        if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) {
          add('error', 'LC_F_PARAM_SCHEMA', node, `第 ${index + 1} 个参数名不合法：${name || '（空）'}`, path);
          return;
        }
        if (names.has(name)) add('error', 'LC_F_PARAM_SCHEMA', node, `参数名重复：${name}`, path);
        names.add(name);
        if (!['query', 'body', 'params', 'header'].includes(item.in)) add('error', 'LC_F_PARAM_SCHEMA', node, `参数 ${name} 的位置不合法`, path);
        if (!['string', 'number', 'boolean'].includes(item.type)) add('error', 'LC_F_PARAM_SCHEMA', node, `参数 ${name} 的类型不合法`, path);
      });
    }

    if (node.type === 'middleware.cors') {
      const origins = String(params.origins || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (origins.includes('*') && params.credentials === true) {
        add('error', 'LC_F_CORS', node, '允许来源为 * 时不能同时开启凭证', path);
      }
    }
    if (node.type === 'middleware.auth') {
      const roles = String(params.roles || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const role of roles) {
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(role)) add('error', 'LC_F_ROLE', node, `角色名不合法：${role}`, path);
      }
    }
    if (node.type === 'http.request') {
      const url = String(params.url || '');
      if (url && !hasPlaceholder(url)) {
        const reason = blockedHost(url);
        if (reason) add('error', 'LC_F_HTTP', node, `外部 HTTP 地址不可用：${reason}`, path);
      }
    }
    if (node.type === 'response.json') {
      const headers = parseJsonField({ label: '响应头' }, params.headers, node, path, issues);
      if (headers != null && (typeof headers !== 'object' || Array.isArray(headers))) {
        add('error', 'LC_F_HEADERS', node, '响应头必须是 JSON 对象', path);
      }
      if (headers && typeof headers === 'object') {
        for (const [key, val] of Object.entries(headers)) {
          if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) add('error', 'LC_F_HEADERS', node, `响应头名称不合法：${key}`, path);
          if (/[\r\n]/.test(String(val))) add('error', 'LC_F_HEADERS', node, `响应头 ${key} 不能包含换行`, path);
        }
      }
    }

    if (def.fields.some((f) => f.key === 'output')) {
      const output = String(params.output || '');
      if (!OUTPUT_RE.test(output)) {
        add('error', 'LC_F_OUTPUT', node, `输出变量不合法：${output || '（空）'}`, path);
      } else if (seenOutputs.has(output)) {
        add('error', 'LC_F_OUTPUT_DUP', node, `输出变量重复：${output}（另一个在 ${seenOutputs.get(output)}）`, path);
      } else {
        seenOutputs.set(output, path);
      }
    }
  }

  // ------------------------------------------------------------ 表达式与引用
  function checkExpressions(node, def, roots, path) {
    const refs = [];
    for (const item of expressionsOf(node, def)) {
      try {
        const compiled = compileExpression(item.source, roots);
        refs.push(...compiled.roots);
      } catch (err) {
        let message = err instanceof ExpressionError ? err.message : String(err && err.message);
        const unknown = /未知变量「(.+?)」/.exec(message);
        if (unknown && allOutputs.has(unknown[1])) {
          message = `变量「${unknown[1]}」由后面的节点产生，执行到这里时还没有值；请把产生它的节点移到前面`;
        }
        add('error', 'LC_F_EXPR', node, `${item.field.label}：${message}`, path);
      }
    }
    if (refs.length) refsByNode.set(node.id, refs);
  }

  function executionOrder(list, roots, path, reachable) {
    let live = true;
    list.forEach((node, index) => {
      if (!node || node.enabled === false) return;
      const def = nodeType(node.type);
      if (!def) return;
      const nodePath = `${path}[${index}]`;

      if (def.category === 'entry' || def.category === 'middleware') {
        if (node.type === 'entry.request') {
          // 入口本身不消费表达式之外的变量
        }
        checkParams(node, def, nodePath);
        checkExpressions(node, def, roots, nodePath);
        return;
      }

      if (!live) {
        add('warning', 'LC_F_UNREACHABLE', node, '前面的响应节点已经返回，这个节点不会执行', nodePath);
        return;
      }

      checkParams(node, def, nodePath);
      const exprDef = node.type === 'flow.loop'
        ? { ...def, fields: def.fields.filter((f) => f.key !== 'collect') }
        : def;
      checkExpressions(node, exprDef, roots, nodePath);

      if (node.type === 'flow.branch') {
        const snapshot = new Set(roots);
        executionOrder(node.children || [], snapshot, `${nodePath}.children`, live);
        executionOrder(node.elseChildren || [], new Set(snapshot), `${nodePath}.elseChildren`, live);
        return;
      }

      if (node.type === 'flow.loop') {
        const itemVar = String((node.params && node.params.itemVar) || 'item');
        const loopRoots = new Set(roots);
        loopRoots.add(itemVar);
        loopRoots.add('itemIndex');
        executionOrder(node.children || [], loopRoots, `${nodePath}.children`, live);
        // collect 在循环体执行之后求值，可以引用循环体里产生的变量。
        const collectFields = def.fields.filter((f) => f.key === 'collect');
        checkExpressions(node, { fields: collectFields }, loopRoots, nodePath);
      }

      if (def.fields.some((f) => f.key === 'output')) {
        const output = String((node.params && node.params.output) || '');
        if (OUTPUT_RE.test(output)) {
          roots.add(output);
          allOutputs.add(output);
        }
      }

      if (node.type === 'response.json') live = false;
    });
  }

  const enabledRoot = rootChildren.filter((node) => node && node.enabled !== false);
  const entries = enabledRoot.filter((node) => node && node.type === 'entry.request');
  if (entries.length === 0) {
    add('error', 'LC_F_ENTRY_MISSING', null, '没有启用的入口节点');
  } else if (entries.length > 1) {
    for (const entry of entries.slice(1)) {
      add('error', 'LC_F_ENTRY_DUP', entry, '一个流程只能有一个启用的入口节点', nodePaths.get(entry.id));
    }
  }

  const mwNodes = enabledRoot.filter((node) => node && nodeType(node.type)?.category === 'middleware');
  const mwTypes = new Map();
  for (const node of mwNodes) {
    if (mwTypes.has(node.type)) {
      add('error', 'LC_F_MW_DUP', node, `同一类型中间件只能出现一次：${nodeType(node.type).label}（另一个在 ${nodePaths.get(mwTypes.get(node.type).id) || '未知位置'}）`, nodePaths.get(node.id));
    } else {
      mwTypes.set(node.type, node);
    }
  }
  const entryIndex = enabledRoot.indexOf(entries[0]);
  const lastMiddlewareIndex = mwNodes.reduce((max, node) => Math.max(max, enabledRoot.indexOf(node)), -1);
  mwNodes.forEach((node) => {
    const index = enabledRoot.indexOf(node);
    if (entryIndex >= 0 && index < entryIndex) {
      add('warning', 'LC_F_MW_ORDER', node, '中间件放在入口前面了；实际执行时仍按 CORS → 日志 → 鉴权 → 限流 排序', nodePaths.get(node.id));
    }
  });
  enabledRoot.forEach((node, index) => {
    if (!node || node.enabled === false) return;
    const def = nodeType(node.type);
    if (!def || def.category === 'entry' || def.category === 'middleware') return;
    if (lastMiddlewareIndex > index) {
      add('warning', 'LC_F_MW_ORDER', node, '中间件通常在处理节点之前；生成时中间件仍会先执行', nodePaths.get(node.id));
    }
  });

  const responses = allNodes.filter(({ node, def }) => def.category === 'output' && node.enabled !== false);
  if (!responses.length) add('error', 'LC_F_RESPONSE_MISSING', null, '没有响应节点：流程必须显式返回');

  // 引用必须指向更早的输出：用顺序遍历收集 roots。
  const rootOrder = [];
  rootChildren.forEach((node) => { if (node && node.enabled !== false) rootOrder.push(node); });
  const roots = new Set(['request']);
  // 先声明所有输出，便于把“后面才有”与“根本不存在”区分开。
  for (const { node, def } of allNodes) {
    if (node.enabled === false) continue;
    if (def.fields.some((f) => f.key === 'output')) {
      const output = String((node.params && node.params.output) || '');
      if (OUTPUT_RE.test(output)) allOutputs.add(output);
    }
  }
  executionOrder(rootOrder, roots, 'root.children', true);

  // ------------------------------------------------------------ 目标语言能力矩阵
  if (!FLOW_LANGUAGES.includes(target)) {
    add('error', 'LC_F_LANG_TARGET', null, `未知目标语言：${target}`);
  }
  for (const { node, def, path } of allNodes) {
    if (node.enabled === false) continue;
    if (Array.isArray(def.languages) && !def.languages.includes(target)) {
      add('error', 'LC_F_LANG_NODE', node,
        `积木「${def.label}」不支持目标语言 ${target}（它支持：${(def.languages || []).join(' / ')}）；请换用同类积木，或插入代码节点并把代码语言声明为 ${target}`,
        path);
      continue;
    }
    if (Array.isArray(def.implementedLanguages) && !def.implementedLanguages.includes(target)) {
      add('error', 'LC_F_LANG_CODEGEN', node,
        `目标语言 ${target} 的代码生成器尚未实现（积木「${def.label}」）；当前只能生成 Node`,
        path);
      continue;
    }
    if (node.type === 'code.node') {
      const codeLanguage = String((node.params && node.params.codeLanguage) || 'node');
      if (!FLOW_LANGUAGES.includes(codeLanguage)) {
        add('error', 'LC_F_CODE_LANG', node, `代码节点的语言只能是：${FLOW_LANGUAGES.join(' / ')}`, path);
      }
    }
    if (node.type === 'component.custom') {
      const componentId = String((node.params && node.params.component) || '');
      const component = components.find((item) => item.id === componentId);
      if (!component) {
        add('error', 'LC_F_COMPONENT_MISSING', node,
          `引用了不存在的后端组件：${componentId || '（空）'}；请先在组件库创建或导入`,
          path);
        continue;
      }
      if (!Array.isArray(component.languages) || !component.languages.includes(target)) {
        add('error', 'LC_F_COMPONENT_LANG', node,
          `组件「${component.name || component.id}」不支持目标语言 ${target}（支持：${(component.languages || []).join(' / ')}）`,
          path);
      } else if (!(component.implementedLanguages || ['node']).includes(target)) {
        add('error', 'LC_F_COMPONENT_CODEGEN', node,
          `组件「${component.name || component.id}」的 ${target} 实现尚未接入 codegen`,
          path);
      }
    }
  }

  // ------------------------------------------------------------ 状态与代码文件
  for (const { node, def, path } of allNodes) {
    if (def.codeNode) {
      const codeLanguage = String((node.params && node.params.codeLanguage) || 'node');
      const rel = codeFileFor(flow.id, node.id, FLOW_LANGUAGES.includes(codeLanguage) ? codeLanguage : 'node');
      if (userFiles && !userFiles.has(rel)) {
        add('error', 'LC_F_CODE_FILE', node, `用户代码文件不存在：${rel}；请在属性面板保存一次`, path);
      }
    }
  }

  // ------------------------------------------------------------ 引用环
  const graph = new Map();
  const producer = new Map();
  for (const [output, path] of seenOutputs.entries()) {
    const id = (/root\.children\[\d+\]/.exec(path) || [])[0];
    // 用路径反查节点，只用于环路提示，找不到就跳过。
    const matched = allNodes.find((item) => item.path === path);
    if (matched && id) producer.set(output, matched.node.id);
  }
  for (const [nodeId, refs] of refsByNode.entries()) {
    const targets = [];
    for (const root of refs) {
      if (producer.has(root)) targets.push(producer.get(root));
    }
    graph.set(nodeId, targets);
  }
  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    add('error', 'LC_F_REF_CYCLE', null, '检测到引用环：' + cycle.join(' → '));
  }

  // ------------------------------------------------------------ 配置中心
  validateConfigCenter(flowDoc, add);

  // ------------------------------------------------------------ 集合提示
  if (Array.isArray(collections) && collections.length) {
    const known = new Set(collections);
    for (const { node } of allNodes) {
      if (node.type !== 'db.readCollection' && node.type !== 'db.insertCollection') continue;
      const id = String((node.params && node.params.collection) || '');
      if (id && !known.has(id)) {
        add('warning', 'LC_F_COLLECTION', node, `站点里没有集合 ${id}；预览运行会返回集合不存在`, nodePaths.get(node.id));
      }
    }
  }

  const errors = issues.filter((item) => item.level === 'error');
  return { issues, ok: errors.length === 0, errors: errors.length, warnings: issues.length - errors.length };
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const start = stack.indexOf(id);
      if (start >= 0) cycles.push([...stack.slice(start), id]);
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const next of graph.get(id) || []) visit(next);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of graph.keys()) visit(id);
  return cycles.slice(0, 3);
}

function validateConfigCenter(flowDoc, add) {
  const settings = flowDoc.settings && typeof flowDoc.settings === 'object' ? flowDoc.settings : {};
  const center = settings.configCenter && typeof settings.configCenter === 'object' ? settings.configCenter : { definitions: [], values: {} };
  const definitions = Array.isArray(center.definitions) ? center.definitions : [];
  const values = center.values && typeof center.values === 'object' ? center.values : {};
  const keys = new Set();

  definitions.forEach((def, index) => {
    if (!def || typeof def !== 'object') {
      add('error', 'LC_F_CFG', null, `配置中心第 ${index + 1} 项不是对象`);
      return;
    }
    const key = String(def.key || '');
    if (!/^[a-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      add('error', 'LC_F_CFG', null, `配置项 key 不合法：${key || '（空）'}`);
      return;
    }
    if (keys.has(key)) add('error', 'LC_F_CFG', null, `配置项 key 重复：${key}`);
    keys.add(key);
    if (!['string', 'number', 'bool', 'enum'].includes(def.type)) {
      add('error', 'LC_F_CFG', null, `配置项 ${key} 的 type 只能是 string / number / bool / enum`);
    }
    if (def.type === 'enum' && (!Array.isArray(def.enum) || !def.enum.length)) {
      add('error', 'LC_F_CFG', null, `配置项 ${key} 是枚举，但 enum 为空`);
    }
    if (def.secret === true && String(def.default ?? '') !== '') {
      add('error', 'LC_F_CFG_SECRET', null, `密钥配置项 ${key} 不能写默认值；值只能来自环境变量`);
    }
  });

  for (const [key, value] of Object.entries(values)) {
    const def = definitions.find((item) => item && item.key === key);
    if (!def) {
      add('error', 'LC_F_CFG', null, `配置值 ${key} 没有对应的定义`);
      continue;
    }
    if (def.secret === true) {
      add('error', 'LC_F_CFG_SECRET', null, `密钥配置项 ${key} 不允许把值写进流程文件；请用环境变量`);
    }
    if (def.type === 'number' && !Number.isFinite(Number(value))) {
      add('error', 'LC_F_CFG', null, `配置项 ${key} 需要数字`);
    }
    if (def.type === 'bool' && typeof value !== 'boolean') {
      add('error', 'LC_F_CFG', null, `配置项 ${key} 需要布尔值`);
    }
    if (def.type === 'enum' && Array.isArray(def.enum) && !def.enum.map(String).includes(String(value))) {
      add('error', 'LC_F_CFG', null, `配置项 ${key} 只能是：${def.enum.join(' / ')}`);
    }
  }
}

export function collectOutputNames(flowDoc) {
  const outputs = new Set();
  const walk = (list) => {
    for (const node of list || []) {
      if (!node || node.enabled === false) continue;
      const def = nodeType(node.type);
      if (!def) continue;
      if (def.fields.some((f) => f.key === 'output')) outputs.add(String((node.params && node.params.output) || ''));
      for (const slot of def.slots || []) walk(node[slot.key]);
    }
  };
  walk(flowDoc.flow && flowDoc.flow.root ? flowDoc.flow.root.children : []);
  return outputs;
}

export { NODE_TYPES };
