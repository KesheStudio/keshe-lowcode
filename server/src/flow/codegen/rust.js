/* 后端积木 · Rust codegen
 *
 * 生成区（相对 Rust 后端项目根）：
 *   src/generated/flows/runtime.rs    IR 解释执行、表达式求值、集合/文件读写、中间件
 *   src/generated/flows/mod.rs        模块出口 + 路由装配
 *   src/generated/flows/<flow>.rs     入口路由（include_str! 内嵌 IR JSON）
 *   src/generated/flows/<flow>.ir.json 语言无关 IR
 *   src/generated/flows/manifest.json IR / 节点树版本
 *   src/generated/mod.rs              追加 pub mod flows;
 *   src/generated/routes/mod.rs       追加 flows 路由；与示例路由冲突时跳过
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CompileError, Emitter, safeComment, prepareCompile, generateFlowManifest } from './common.js';

const RUNTIME_TEMPLATE = fileURLToPath(new URL('./rust-runtime.rs', import.meta.url));

function rustStr(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

/** Axum 0.8 用 {name} 表示路径参数，入口里的 :name 需要转换。 */
function axumPath(routePath) {
  return String(routePath || '/').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function generateFlowModule(ir, opts = {}) {
  const out = new Emitter();
  const entry = ir.entry || { method: 'GET', path: '/' };
  out.line('// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。');
  out.line(`// 流程：${safeComment(ir.flow.name)}（${ir.flow.id}） · 节点树版本 ${opts.treeVersion} · IR ${ir.irVersion}/${ir.irHash}`);
  out.line(`// 生成时间：${opts.generatedAt}`);
  out.blank();
  out.line('use std::collections::HashMap;');
  out.blank();
  out.line('use axum::body::Bytes;');
  out.line('use axum::extract::{Query, State};');
  out.line('use axum::http::{HeaderMap, Method, Uri};');
  out.line('use axum::response::Response;');
  out.line('use axum::routing::any;');
  out.line('use axum::Router;');
  out.line('use serde_json::Value;');
  out.blank();
  out.line('use crate::generated::flows::runtime::{self, FlowRequest};');
  out.line('use crate::generated::state::SharedState;');
  out.blank();
  out.line(`const IR_JSON: &str = include_str!(${rustStr(`${ir.flow.id}.ir.json`)});`);
  out.blank();
  out.line('pub fn routes() -> Router<SharedState> {');
  out.line('    Router::new()');
  out.line(`        .route(${rustStr(axumPath(entry.path))}, any(handler))`);
  out.line('}');
  out.blank();
  out.line('async fn handler(');
  out.line('    State(state): State<SharedState>,');
  out.line('    method: Method,');
  out.line('    uri: Uri,');
  out.line('    headers: HeaderMap,');
  out.line('    Query(query): Query<HashMap<String, String>>,');
  out.line('    body: Bytes,');
  out.line(') -> Response {');
  out.line('    let body_value = if body.is_empty() {');
  out.line('        Value::Null');
  out.line('    } else {');
  out.line('        serde_json::from_slice(&body).unwrap_or(Value::Null)');
  out.line('    };');
  out.line('    let request = FlowRequest {');
  out.line('        method: method.as_str().to_string(),');
  out.line('        path: uri.path().to_string(),');
  out.line('        url: uri.to_string(),');
  out.line('        query,');
  out.line('        params: HashMap::new(),');
  out.line('        headers,');
  out.line('        body: body_value,');
  out.line('    };');
  out.line('    runtime::execute(&state, IR_JSON, request).await');
  out.line('}');
  out.blank();
  return out.toString();
}

export function patchRustGeneratedMod(source) {
  if (source.includes('pub mod flows;')) return source;
  return source.replace('pub mod http;', 'pub mod flows;\npub mod http;');
}

export function patchRustRoutes(source, { skipItems = false } = {}) {
  if (source.includes('crate::generated::flows')) return source;
  let next = source;
  if (skipItems) {
    next = next.replace(/\n[ \t]*\.merge\(items::routes\(\)\)/, '');
  }
  const close = next.lastIndexOf('}');
  if (close < 0) throw new CompileError('模板 src/generated/routes/mod.rs 缺少闭合括号');
  return next.slice(0, close)
    + '        .merge(crate::generated::flows::routes())\n'
    + next.slice(close);
}

export function compileRustFlow(flowDoc, options = {}) {
  const { ir, opts, warnings, conflicts } = prepareCompile(flowDoc, { ...options, target: 'rust' });
  const flow = flowDoc.flow;
  const files = [
    { path: 'src/generated/flows/runtime.rs', content: fs.readFileSync(RUNTIME_TEMPLATE, 'utf8') },
    { path: 'src/generated/flows/mod.rs', content: [
      '// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。',
      'pub mod runtime;',
      'pub use runtime::FlowRequest;',
      '',
      `pub mod ${flow.id};`,
      '',
      'use axum::Router;',
      '',
      'use crate::generated::state::SharedState;',
      '',
      'pub fn routes() -> Router<SharedState> {',
      `    ${flow.id}::routes()`,
      '}',
      ''
    ].join('\n') },
    { path: `src/generated/flows/${flow.id}.rs`, content: generateFlowModule(ir, opts) },
    { path: `src/generated/flows/${ir.flow.id}.ir.json`, content: JSON.stringify(ir, null, 2) + '\n' },
    { path: 'src/generated/flows/manifest.json', content: generateFlowManifest(flowDoc, ir, opts) },
    { path: 'src/generated/mod.rs', content: patchRustGeneratedMod(options.generatedModSource || '') },
    { path: 'src/generated/routes/mod.rs', content: patchRustRoutes(options.routesIndexSource || '', { skipItems: conflicts.length > 0 }) }
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
