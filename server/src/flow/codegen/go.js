/* 后端积木 · Go codegen
 *
 * 生成区（相对 Go 后端项目根）：
 *   internal/generated/flows/runtime.go    IR 解释执行、表达式求值、集合/文件/HTTP、中间件
 *   internal/generated/flows/<flow>.go     流程入口（go:embed 内嵌 IR JSON）
 *   internal/generated/flows/register.go   路由注册
 *   internal/generated/flows/<flow>.ir.json 语言无关 IR
 *   internal/generated/flows/manifest.json IR / 节点树版本
 *   internal/generated/routes/routes.go    追加 flows.Register；冲突时删掉示例 items 路由
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CompileError, Emitter, safeComment, prepareCompile, generateFlowManifest } from './common.js';

const RUNTIME_TEMPLATE = fileURLToPath(new URL('./go-runtime.go', import.meta.url));

function goStr(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function goIdent(value) {
  const text = String(value || '').replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(text) ? text : `flow_${text}`;
}

function generateFlowModule(ir) {
  const id = goIdent(ir.flow.id);
  const file = `${ir.flow.id}.ir.json`;
  return [
    '// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。',
    `// 流程：${safeComment(ir.flow.name)}（${ir.flow.id}） · IR ${ir.irVersion}/${ir.irHash}`,
    'package flows',
    '',
    'import (',
    '\t_ "embed"',
    '\t"net/http"',
    '',
    '\t"lowcode/server/internal/generated/app"',
    ')',
    '',
    `//go:embed ${file}`,
    `var ${id}IR string`,
    '',
    `func handle_${id}(w http.ResponseWriter, r *http.Request, deps *app.Deps) {`,
    `\tExecute(w, r, deps, ${id}IR)`,
    '}',
    ''
  ].join('\n');
}

function generateRegister(ir) {
  const entry = ir.entry || { method: 'GET', path: '/' };
  const handler = `handle_${goIdent(ir.flow.id)}`;
  const method = String(entry.method || 'GET').toUpperCase();
  const path = String(entry.path || '/');
  const hasCors = (ir.middleware || []).some((item) => item.op === 'middleware.cors');
  const lines = [
    '// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。',
    'package flows',
    '',
    'import (',
    '\t"net/http"',
    '',
    '\t"lowcode/server/internal/generated/app"',
    ')',
    '',
    '// Register 挂载流程路由；重新生成会整块替换。',
    'func Register(mux *http.ServeMux, deps *app.Deps) {',
    `\tmux.HandleFunc(${goStr(`${method} ${path}`)}, func(w http.ResponseWriter, r *http.Request) {`,
    `\t\t${handler}(w, r, deps)`,
    '\t})'
  ];
  if (hasCors && method !== 'OPTIONS') {
    lines.push(
      `\tmux.HandleFunc(${goStr(`OPTIONS ${path}`)}, func(w http.ResponseWriter, r *http.Request) {`,
      `\t\t${handler}(w, r, deps)`,
      '\t})'
    );
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function patchGoRoutes(source, { skipItems = false } = {}) {
  let next = source;
  if (!next.includes('generated/flows')) {
    next = next.replace(
      '\t"lowcode/server/internal/generated/httpx"',
      '\t"lowcode/server/internal/generated/flows"\n\t"lowcode/server/internal/generated/httpx"'
    );
  }
  if (!next.includes('flows.Register(mux, deps)')) {
    if (!next.includes('\tregisterAuth(mux, deps)')) {
      throw new CompileError('模板 routes.go 结构变化：找不到 registerAuth，编译器需要同步更新');
    }
    next = next.replace('\tregisterAuth(mux, deps)', '\tflows.Register(mux, deps)\n\tregisterAuth(mux, deps)');
  }
  if (skipItems) {
    next = removeHandleFuncs(next, '/api/items');
    if (!next.includes('custom.')) {
      next = next.replace('\t"lowcode/server/internal/custom"\n', '');
    }
  }
  return next;
}

/** 删掉示例 items 路由：流程入口接管同路径后，ServeMux 重复注册会 panic。 */
function removeHandleFuncs(source, base) {
  const lines = source.split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pattern = line.match(/^\s*mux\.HandleFunc\("(?:[A-Z]+ )?([^" ]+)/);
    if (pattern && (pattern[1] === base || pattern[1].startsWith(base + '/'))) {
      // 跳过整个 HandleFunc 块，直到遇到缩进为单个 tab 的 "})"。
      while (index < lines.length && !/^\t\}\)\s*$/.test(lines[index])) index += 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function compileGoFlow(flowDoc, options = {}) {
  const { ir, opts, warnings, conflicts } = prepareCompile(flowDoc, { ...options, target: 'go' });
  const flow = flowDoc.flow;
  const files = [
    { path: 'internal/generated/flows/runtime.go', content: fs.readFileSync(RUNTIME_TEMPLATE, 'utf8') },
    { path: `internal/generated/flows/${flow.id}.go`, content: generateFlowModule(ir) },
    { path: 'internal/generated/flows/register.go', content: generateRegister(ir) },
    { path: `internal/generated/flows/${ir.flow.id}.ir.json`, content: JSON.stringify(ir, null, 2) + '\n' },
    { path: 'internal/generated/flows/manifest.json', content: generateFlowManifest(flowDoc, ir, opts) },
    { path: 'internal/generated/routes/routes.go', content: patchGoRoutes(options.routesIndexSource || '', { skipItems: conflicts.length > 0 }) }
  ];

  return {
    files,
    meta: {
      ...opts,
      irVersion: ir.irVersion,
      irHash: ir.irHash,
      entry: ir.entry,
      components: (ir.components || []).map((item) => ({
        id: item.id,
        version: item.version,
        scope: item.scope,
        language: item.language
      })),
      warnings,
      diagnostics: []
    }
  };
}
