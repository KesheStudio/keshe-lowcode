// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 流程运行时：解释 IR 指令，提供表达式求值、集合/文件读写、CORS/鉴权/限流/日志。
// 所有积木的支持情况由 IR 构建阶段按能力矩阵过滤，这里只执行已经声明支持 Rust 的节点。
#![allow(dead_code)]

use std::collections::HashMap;
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Number, Value};

use crate::generated::error::AppError;
use crate::generated::state::SharedState;

const MAX_FILE_BYTES: usize = 1024 * 1024;

pub struct FlowRequest {
    pub method: String,
    pub path: String,
    pub url: String,
    pub query: HashMap<String, String>,
    pub params: HashMap<String, String>,
    pub headers: HeaderMap,
    pub body: Value,
}

struct Ctx {
    vars: HashMap<String, Value>,
    headers: HeaderMap,
    query: HashMap<String, String>,
    params: HashMap<String, String>,
    request: Value,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

static LIMITER: OnceLock<Mutex<HashMap<String, Bucket>>> = OnceLock::new();

pub async fn execute(state: &SharedState, ir_json: &str, request: FlowRequest) -> Response {
    let started = Instant::now();
    let ir: Value = match serde_json::from_str(ir_json) {
        Ok(value) => value,
        Err(err) => {
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "LC_E_FLOW_IR",
                &format!("流程 IR 解析失败：{err}"),
            )
        }
    };
    let middleware = ir
        .get("middleware")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let cors = middleware
        .iter()
        .find(|item| item.get("op").and_then(Value::as_str) == Some("middleware.cors"));
    let cors_headers = cors
        .map(|item| cors_headers(item, &request.headers))
        .unwrap_or_default();
    if request.method.eq_ignore_ascii_case("OPTIONS") && cors.is_some() {
        return build_response(StatusCode::NO_CONTENT, Value::Null, &Value::Null, &cors_headers);
    }

    match run(state, &ir, &middleware, request, started).await {
        Ok(mut response) => {
            insert_headers(response.headers_mut(), &cors_headers);
            response
        }
        Err(err) => {
            let mut response = err.into_response();
            insert_headers(response.headers_mut(), &cors_headers);
            response
        }
    }
}

async fn run(
    state: &SharedState,
    ir: &Value,
    middleware: &[Value],
    request: FlowRequest,
    started: Instant,
) -> Result<Response, AppError> {
    let request_value = json!({
        "method": request.method,
        "path": request.path,
        "url": request.url,
        "query": string_map_json(&request.query),
        "params": string_map_json(&request.params),
        "headers": headers_json(&request.headers),
        "body": request.body,
    });
    let mut ctx = Ctx {
        vars: HashMap::new(),
        headers: request.headers,
        query: request.query,
        params: request.params,
        request: request_value,
    };

    if let Some(entry) = ir.get("entry") {
        validate_entry(entry, &ctx)?;
    }

    if let Some(item) = find_middleware(middleware, "middleware.auth") {
        let auth = state.auth.authenticate(&ctx.headers).await?;
        let roles = split_roles(item.pointer("/params/roles").and_then(Value::as_str).unwrap_or(""));
        if !roles.is_empty() && !roles.iter().any(|role| auth.roles.iter().any(|item| item == role)) {
            return Err(AppError::Forbidden("当前账号没有访问该接口的角色".to_string()));
        }
    }

    if let Some(item) = find_middleware(middleware, "middleware.rateLimit") {
        let rps = item
            .pointer("/params/rps")
            .and_then(Value::as_f64)
            .unwrap_or(20.0);
        let burst = item
            .pointer("/params/burst")
            .and_then(Value::as_f64)
            .unwrap_or(40.0);
        let key_by = item
            .pointer("/params/keyBy")
            .and_then(Value::as_str)
            .unwrap_or("ip");
        let key = rate_key(key_by, &ctx.headers);
        if !take_token(&key, rps, burst) {
            return Err(AppError::TooManyRequests);
        }
    }

    let body = ir.get("body").and_then(Value::as_array).cloned().unwrap_or_default();
    let response = match run_instructions(state, &body, &mut ctx).await? {
        Some(response) => response,
        None => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "LC_E_FLOW_NO_RESPONSE",
            "流程没有返回响应",
        ),
    };

    if let Some(item) = find_middleware(middleware, "middleware.log") {
        let skip_health = item
            .pointer("/params/skipHealth")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let path = ctx
            .request
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("/")
            .to_string();
        if !(skip_health && path.starts_with("/api/health")) {
            let method_text = ctx
                .request
                .get("method")
                .and_then(|item| item.as_str())
                .unwrap_or("");
            tracing::info!(
                method = %method_text,
                path = %path,
                status = response.status().as_u16(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                "flow request"
            );
        }
    }

    Ok(response)
}

fn find_middleware<'a>(list: &'a [Value], op: &str) -> Option<&'a Value> {
    list.iter()
        .find(|item| item.get("op").and_then(Value::as_str) == Some(op))
}

fn run_instructions<'a>(
    state: &'a SharedState,
    list: &'a [Value],
    ctx: &'a mut Ctx,
) -> Pin<Box<dyn Future<Output = Result<Option<Response>, AppError>> + Send + 'a>> {
    Box::pin(async move {
        for ins in list {
            if let Some(response) = run_instruction(state, ins, ctx).await? {
                return Ok(Some(response));
            }
        }
        Ok(None)
    })
}

async fn run_instruction(
    state: &SharedState,
    ins: &Value,
    ctx: &mut Ctx,
) -> Result<Option<Response>, AppError> {
    match ins.get("kind").and_then(Value::as_str).unwrap_or("") {
        "op" => {
            run_op(state, ins, ctx).await?;
            Ok(None)
        }
        "branch" => {
            let condition = eval_value(ins.get("cond").unwrap_or(&Value::Null), ctx);
            let list = if truthy(&condition) {
                ins.get("then")
            } else {
                ins.get("else")
            };
            run_instructions(state, list.and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]), ctx).await
        }
        "loop" => {
            let args = ins.get("args").unwrap_or(&Value::Null);
            let source = eval_value(args.get("source").unwrap_or(&Value::Null), ctx);
            let items = source.as_array().cloned().unwrap_or_default();
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
            let item_var = args
                .get("itemVar")
                .and_then(Value::as_str)
                .unwrap_or("item")
                .to_string();
            let body = ins
                .get("body")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let mut collected: Vec<Value> = Vec::new();
            for (index, item) in items.iter().take(limit).enumerate() {
                ctx.vars.insert(item_var.clone(), item.clone());
                ctx.vars.insert("itemIndex".to_string(), json!(index));
                if let Some(response) = run_instructions(state, body, ctx).await? {
                    return Ok(Some(response));
                }
                collected.push(eval_value(args.get("collect").unwrap_or(&Value::Null), ctx));
            }
            if let Some(out) = ins.get("out").and_then(Value::as_str) {
                ctx.vars.insert(out.to_string(), Value::Array(collected));
            }
            Ok(None)
        }
        "return" => {
            let args = ins.get("args").unwrap_or(&Value::Null);
            let status = args.get("status").and_then(Value::as_u64).unwrap_or(200) as u16;
            let body = eval_value(args.get("body").unwrap_or(&Value::Null), ctx);
            let headers = eval_value(args.get("headers").unwrap_or(&Value::Null), ctx);
            Ok(Some(json_response(status, body, &headers)))
        }
        other => Err(AppError::Internal(format!("未知流程指令：{other}"))),
    }
}

async fn run_op(state: &SharedState, ins: &Value, ctx: &mut Ctx) -> Result<(), AppError> {
    let op = ins.get("op").and_then(Value::as_str).unwrap_or("");
    let out = ins.get("out").and_then(Value::as_str).unwrap_or("");
    let args = ins.get("args").unwrap_or(&Value::Null);
    match op {
        "db.read" => {
            let collection = args.get("collection").and_then(Value::as_str).unwrap_or("");
            let page = to_int(&eval_value(args.get("page").unwrap_or(&Value::Null), ctx), 1, 1, 1_000_000);
            let page_size = to_int(
                &eval_value(args.get("pageSize").unwrap_or(&Value::Null), ctx),
                20,
                1,
                1_000_000,
            );
            let mut query: HashMap<String, String> = HashMap::new();
            query.insert("page".to_string(), page.to_string());
            query.insert("pageSize".to_string(), page_size.to_string());
            if let Some(value) = optional_text(&eval_value(args.get("q").unwrap_or(&Value::Null), ctx)) {
                query.insert("q".to_string(), value);
            }
            let filter_value = eval_value(args.get("filter").unwrap_or(&Value::Null), ctx);
            if let Value::Object(object) = &filter_value {
                if !object.is_empty() {
                    query.insert("filter".to_string(), filter_value.to_string());
                }
            }
            if let Some(value) = optional_str(args.get("sort")) {
                query.insert("sort".to_string(), value);
            }
            if let Some(value) = optional_str(args.get("fields")) {
                query.insert("fields".to_string(), value);
            }
            let value = state.data.list(collection, &ctx.headers, &query).await?;
            ctx.vars.insert(out.to_string(), value);
        }
        "db.insert" => {
            let collection = args.get("collection").and_then(Value::as_str).unwrap_or("");
            let body = eval_value(args.get("body").unwrap_or(&Value::Null), ctx);
            if !body.is_object() {
                return Err(AppError::BadRequest {
                    field: "body".to_string(),
                    message: "写入内容必须是对象".to_string(),
                });
            }
            let value = state.data.create(collection, &ctx.headers, &body).await?;
            ctx.vars.insert(out.to_string(), value);
        }
        "file.read" => {
            let rel = args.get("path").and_then(Value::as_str).unwrap_or("");
            let encoding = args.get("encoding").and_then(Value::as_str).unwrap_or("utf8");
            let target = safe_file_path(rel)?;
            let bytes = tokio::fs::read(&target).await.map_err(|err| {
                if err.kind() == std::io::ErrorKind::NotFound {
                    AppError::NotFound("文件不存在".to_string())
                } else {
                    AppError::Internal(format!("读取文件失败：{err}"))
                }
            })?;
            if bytes.len() > MAX_FILE_BYTES {
                return Err(AppError::PayloadTooLarge);
            }
            let value = if encoding == "base64" {
                Value::String(base64_encode(&bytes))
            } else {
                match String::from_utf8(bytes) {
                    Ok(text) => Value::String(text),
                    Err(_) => {
                        return Err(AppError::BadRequest {
                            field: "encoding".to_string(),
                            message: "文件不是 UTF-8 文本，请改用 base64".to_string(),
                        })
                    }
                }
            };
            ctx.vars.insert(out.to_string(), value);
        }
        "file.write" => {
            let rel = args.get("path").and_then(Value::as_str).unwrap_or("");
            let content = eval_value(args.get("content").unwrap_or(&Value::Null), ctx);
            let append = args.get("append").and_then(Value::as_bool).unwrap_or(false);
            let target = safe_file_path(rel)?;
            let text = match content {
                Value::String(text) => text,
                other => serde_json::to_string_pretty(&other).unwrap_or_default(),
            };
            let bytes = text.into_bytes();
            if bytes.len() > MAX_FILE_BYTES {
                return Err(AppError::PayloadTooLarge);
            }
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|err| AppError::Internal(format!("创建目录失败：{err}")))?;
            }
            if append {
                use tokio::io::AsyncWriteExt;
                let mut file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&target)
                    .await
                    .map_err(|err| AppError::Internal(format!("打开文件失败：{err}")))?;
                file.write_all(&bytes)
                    .await
                    .map_err(|err| AppError::Internal(format!("写入文件失败：{err}")))?;
            } else {
                tokio::fs::write(&target, bytes)
                    .await
                    .map_err(|err| AppError::Internal(format!("写入文件失败：{err}")))?;
            }
        }
        "data.pick" => {
            let input = eval_value(args.get("input").unwrap_or(&Value::Null), ctx);
            let fields = args
                .get("fields")
                .and_then(Value::as_array)
                .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
                .unwrap_or_default();
            ctx.vars.insert(out.to_string(), pick_fields(&input, &fields));
        }
        "data.template" => {
            let value = eval_value(args.get("template").unwrap_or(&Value::Null), ctx);
            ctx.vars.insert(out.to_string(), value);
        }
        "http.request" => {
            return Err(AppError::Internal(
                "Rust 模板未声明 http.request 的 codegen 实现".to_string(),
            ))
        }
        "code.run" | "component.run" => {
            return Err(AppError::Internal(format!(
                "Rust 目标不支持 {op}：请改用支持 Rust 的积木"
            )))
        }
        other => return Err(AppError::Internal(format!("未知流程操作：{other}"))),
    }
    Ok(())
}

/* ------------------------------------------------------------------ 参数校验与中间件 */

fn validate_entry(entry: &Value, ctx: &Ctx) -> Result<(), AppError> {
    let rules = entry
        .get("params")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for rule in rules {
        let name = rule.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let location = rule.get("in").and_then(Value::as_str).unwrap_or("query");
        let kind = rule.get("type").and_then(Value::as_str).unwrap_or("string");
        let required = rule.get("required").and_then(Value::as_bool).unwrap_or(false);
        let value = param_value(ctx, location, name);
        let present = !matches!(value, Value::Null)
            && !(value.is_string() && value.as_str().map(str::is_empty).unwrap_or(false));
        if !present {
            if required {
                return Err(AppError::BadRequest {
                    field: name.to_string(),
                    message: format!("缺少必填参数 {name}"),
                });
            }
            continue;
        }
        let ok = match kind {
            "number" => {
                value.is_number()
                    || value
                        .as_str()
                        .map(|text| text.trim().parse::<f64>().is_ok())
                        .unwrap_or(false)
            }
            "boolean" => {
                value.is_boolean()
                    || matches!(value.as_str(), Some("true") | Some("false") | Some("1") | Some("0"))
            }
            _ => value.is_string() || value.is_number() || value.is_boolean(),
        };
        if !ok {
            return Err(AppError::BadRequest {
                field: name.to_string(),
                message: format!("参数 {name} 类型应为 {kind}"),
            });
        }
    }
    Ok(())
}

fn param_value(ctx: &Ctx, location: &str, name: &str) -> Value {
    match location {
        "query" => ctx
            .query
            .get(name)
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
        "params" => ctx
            .params
            .get(name)
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
        "header" => ctx
            .headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(|value| Value::String(value.to_string()))
            .unwrap_or(Value::Null),
        _ => ctx
            .request
            .get("body")
            .and_then(|body| body.get(name))
            .cloned()
            .unwrap_or(Value::Null),
    }
}

fn cors_headers(item: &Value, request_headers: &HeaderMap) -> Vec<(HeaderName, HeaderValue)> {
    let params = item.get("params").unwrap_or(&Value::Null);
    let origins: Vec<String> = params
        .get("origins")
        .and_then(Value::as_str)
        .unwrap_or("*")
        .split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    let credentials = params
        .get("credentials")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let max_age = params
        .get("maxAgeSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(600);
    let origin = request_headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let allow_origin = if origins.iter().all(|item| item == "*") && !credentials {
        "*".to_string()
    } else if !origin.is_empty() && origins.iter().any(|item| item == origin) {
        origin.to_string()
    } else if origins.len() == 1 {
        origins[0].clone()
    } else {
        String::new()
    };
    let mut out = Vec::new();
    if allow_origin.is_empty() {
        return out;
    }
    push_header(&mut out, header::ACCESS_CONTROL_ALLOW_ORIGIN, &allow_origin);
    push_header(&mut out, header::VARY, "Origin");
    if credentials {
        push_header(&mut out, header::ACCESS_CONTROL_ALLOW_CREDENTIALS, "true");
    }
    push_header(
        &mut out,
        header::ACCESS_CONTROL_ALLOW_METHODS,
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    push_header(
        &mut out,
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        "Content-Type,Authorization",
    );
    push_header(&mut out, header::ACCESS_CONTROL_MAX_AGE, &max_age.to_string());
    out
}

fn push_header(list: &mut Vec<(HeaderName, HeaderValue)>, name: HeaderName, value: &str) {
    if let Ok(parsed) = HeaderValue::from_str(value) {
        list.push((name, parsed));
    }
}

fn insert_headers(target: &mut HeaderMap, list: &[(HeaderName, HeaderValue)]) {
    for (name, value) in list {
        target.insert(name.clone(), value.clone());
    }
}

fn rate_key(key_by: &str, headers: &HeaderMap) -> String {
    if key_by == "token" {
        if let Some(value) = headers.get("authorization").and_then(|item| item.to_str().ok()) {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            value.hash(&mut hasher);
            return format!("token:{:x}", hasher.finish());
        }
        return "token:anonymous".to_string();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "local".to_string())
}

fn take_token(key: &str, rps: f64, burst: f64) -> bool {
    let limiter = LIMITER.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = match limiter.lock() {
        Ok(guard) => guard,
        Err(err) => err.into_inner(),
    };
    let now = Instant::now();
    let entry = guard.entry(key.to_string()).or_insert(Bucket {
        tokens: burst,
        last: now,
    });
    let elapsed = now.duration_since(entry.last).as_secs_f64();
    entry.tokens = (entry.tokens + elapsed * rps).min(burst);
    entry.last = now;
    if entry.tokens >= 1.0 {
        entry.tokens -= 1.0;
        true
    } else {
        false
    }
}

/* ------------------------------------------------------------------ 值 / 表达式 */

fn eval_value(value: &Value, ctx: &Ctx) -> Value {
    match value.get("kind").and_then(Value::as_str).unwrap_or("undefined") {
        "undefined" => Value::Null,
        "literal" => value.get("value").cloned().unwrap_or(Value::Null),
        "expr" => eval_ast(value.get("ast").unwrap_or(&Value::Null), ctx),
        "template" => {
            let parts = value
                .get("parts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if parts.is_empty() {
                return Value::String(String::new());
            }
            if parts.len() == 1 && !parts[0].is_string() {
                return eval_value(&parts[0], ctx);
            }
            let mut text = String::new();
            for part in &parts {
                if let Some(literal) = part.as_str() {
                    text.push_str(literal);
                } else {
                    text.push_str(&to_text(&eval_value(part, ctx)));
                }
            }
            Value::String(text)
        }
        "array" => Value::Array(
            value
                .get("items")
                .and_then(Value::as_array)
                .map(|items| items.iter().map(|item| eval_value(item, ctx)).collect())
                .unwrap_or_default(),
        ),
        "object" => {
            let mut map = Map::new();
            if let Some(entries) = value.get("entries").and_then(Value::as_array) {
                for entry in entries {
                    let key = entry.get("key").and_then(Value::as_str).unwrap_or("");
                    map.insert(
                        key.to_string(),
                        eval_value(entry.get("value").unwrap_or(&Value::Null), ctx),
                    );
                }
            }
            Value::Object(map)
        }
        _ => Value::Null,
    }
}

fn eval_ast(ast: &Value, ctx: &Ctx) -> Value {
    match ast.get("kind").and_then(Value::as_str).unwrap_or("undefined") {
        "number" => match ast.get("value") {
            Some(Value::Number(number)) => Value::Number(number.clone()),
            Some(Value::String(text)) => text
                .parse::<f64>()
                .ok()
                .and_then(Number::from_f64)
                .map(Value::Number)
                .unwrap_or(Value::Null),
            _ => Value::Null,
        },
        "string" => Value::String(unquote(ast.get("value").and_then(Value::as_str).unwrap_or(""))),
        "boolean" => Value::Bool(ast.get("value").and_then(Value::as_bool).unwrap_or(false)),
        "null" | "undefined" => Value::Null,
        "ref" => {
            let root = ast.get("root").and_then(Value::as_str).unwrap_or("");
            if root == "request" {
                ctx.request.clone()
            } else {
                ctx.vars.get(root).cloned().unwrap_or(Value::Null)
            }
        }
        "member" => {
            let object = eval_ast(ast.get("object").unwrap_or(&Value::Null), ctx);
            let property = ast.get("property").and_then(Value::as_str).unwrap_or("");
            member(&object, property)
        }
        "index" => {
            let object = eval_ast(ast.get("object").unwrap_or(&Value::Null), ctx);
            let index = eval_ast(ast.get("index").unwrap_or(&Value::Null), ctx);
            index_value(&object, &index)
        }
        "unary" => {
            let op = ast.get("op").and_then(Value::as_str).unwrap_or("");
            let operand = eval_ast(ast.get("operand").unwrap_or(&Value::Null), ctx);
            match op {
                "!" => Value::Bool(!truthy(&operand)),
                "-" => num(-to_number(&operand)),
                _ => Value::Null,
            }
        }
        "binary" => eval_binary(ast, ctx),
        "ternary" => {
            let test = eval_ast(ast.get("test").unwrap_or(&Value::Null), ctx);
            let branch = if truthy(&test) { "consequent" } else { "alternate" };
            eval_ast(ast.get(branch).unwrap_or(&Value::Null), ctx)
        }
        _ => Value::Null,
    }
}

fn eval_binary(ast: &Value, ctx: &Ctx) -> Value {
    let op = ast.get("op").and_then(Value::as_str).unwrap_or("");
    if op == "&&" {
        let left = eval_ast(ast.get("left").unwrap_or(&Value::Null), ctx);
        return if truthy(&left) {
            eval_ast(ast.get("right").unwrap_or(&Value::Null), ctx)
        } else {
            left
        };
    }
    if op == "||" {
        let left = eval_ast(ast.get("left").unwrap_or(&Value::Null), ctx);
        return if truthy(&left) {
            left
        } else {
            eval_ast(ast.get("right").unwrap_or(&Value::Null), ctx)
        };
    }
    let left = eval_ast(ast.get("left").unwrap_or(&Value::Null), ctx);
    let right = eval_ast(ast.get("right").unwrap_or(&Value::Null), ctx);
    match op {
        "+" => {
            if left.is_string() || right.is_string() {
                Value::String(format!("{}{}", to_text(&left), to_text(&right)))
            } else {
                num(to_number(&left) + to_number(&right))
            }
        }
        "-" => num(to_number(&left) - to_number(&right)),
        "*" => num(to_number(&left) * to_number(&right)),
        "/" => {
            let divisor = to_number(&right);
            if divisor == 0.0 {
                Value::Null
            } else {
                num(to_number(&left) / divisor)
            }
        }
        "%" => {
            let divisor = to_number(&right);
            if divisor == 0.0 {
                Value::Null
            } else {
                num(to_number(&left) % divisor)
            }
        }
        "===" => Value::Bool(strict_eq(&left, &right)),
        "!==" => Value::Bool(!strict_eq(&left, &right)),
        "==" => Value::Bool(loose_eq(&left, &right)),
        "!=" => Value::Bool(!loose_eq(&left, &right)),
        "<" => Value::Bool(compare(&left, &right).map(|order| order.is_lt()).unwrap_or(false)),
        ">" => Value::Bool(compare(&left, &right).map(|order| order.is_gt()).unwrap_or(false)),
        "<=" => Value::Bool(compare(&left, &right).map(|order| order.is_le()).unwrap_or(false)),
        ">=" => Value::Bool(compare(&left, &right).map(|order| order.is_ge()).unwrap_or(false)),
        _ => Value::Null,
    }
}

fn member(object: &Value, property: &str) -> Value {
    match object {
        Value::Object(map) => map.get(property).cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn index_value(object: &Value, index: &Value) -> Value {
    match object {
        Value::Object(map) => index
            .as_str()
            .and_then(|key| map.get(key))
            .cloned()
            .unwrap_or(Value::Null),
        Value::Array(list) => index
            .as_f64()
            .and_then(|value| {
                let position = value.trunc() as i64;
                if position < 0 {
                    None
                } else {
                    list.get(position as usize).cloned()
                }
            })
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn pick_fields(input: &Value, fields: &[String]) -> Value {
    match input {
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| pick_fields(item, fields)).collect())
        }
        Value::Object(map) => {
            let mut out = Map::new();
            for field in fields {
                if let Some(value) = map.get(field) {
                    out.insert(field.clone(), value.clone());
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn num(value: f64) -> Value {
    Number::from_f64(value).map(Value::Number).unwrap_or(Value::Null)
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(number) => number.as_f64().map(|value| value != 0.0 && !value.is_nan()).unwrap_or(false),
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

fn to_number(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(0.0),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Value::Bool(value) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Value::Null => 0.0,
        _ => f64::NAN,
    }
}

fn to_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn to_int(value: &Value, fallback: i64, min: i64, max: i64) -> i64 {
    // 缺失引用等价于 JS 的 undefined：用默认值，而不是 Number(null) = 0。
    if value.is_null() {
        return fallback.clamp(min, max);
    }
    let number = to_number(value);
    if number.is_nan() {
        return fallback.clamp(min, max);
    }
    (number.trunc() as i64).clamp(min, max)
}

fn optional_text(value: &Value) -> Option<String> {
    let text = to_text(value);
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn optional_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|text| !text.trim().is_empty())
}

fn strict_eq(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::String(a), Value::String(b)) => a == b,
        _ => false,
    }
}

fn loose_eq(left: &Value, right: &Value) -> bool {
    if strict_eq(left, right) {
        return true;
    }
    match (left, right) {
        (Value::String(_), Value::Number(_))
        | (Value::Number(_), Value::String(_))
        | (Value::Bool(_), Value::Number(_))
        | (Value::Number(_), Value::Bool(_)) => to_number(left) == to_number(right),
        _ => false,
    }
}

fn compare(left: &Value, right: &Value) -> Option<std::cmp::Ordering> {
    if let (Value::String(a), Value::String(b)) = (left, right) {
        return Some(a.cmp(b));
    }
    to_number(left).partial_cmp(&to_number(right))
}

fn unquote(raw: &str) -> String {
    if raw.starts_with('"') {
        if let Ok(text) = serde_json::from_str::<String>(raw) {
            return text;
        }
    }
    if raw.len() >= 2 && raw.starts_with('\'') && raw.ends_with('\'') {
        return raw[1..raw.len() - 1]
            .replace("\\'", "'")
            .replace("\\\\", "\\");
    }
    raw.to_string()
}

/* ------------------------------------------------------------------ 响应与文件 */

fn json_response(status: u16, body: Value, headers: &Value) -> Response {
    build_response(
        StatusCode::from_u16(status).unwrap_or(StatusCode::OK),
        body,
        headers,
        &[],
    )
}

fn build_response(
    status: StatusCode,
    body: Value,
    headers: &Value,
    extra: &[(HeaderName, HeaderValue)],
) -> Response {
    let mut response = if status == StatusCode::NO_CONTENT {
        status.into_response()
    } else {
        (status, Json(body)).into_response()
    };
    if let Value::Object(map) = headers {
        for (key, value) in map {
            if let (Ok(name), Ok(parsed)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(&to_text(value)),
            ) {
                response.headers_mut().insert(name, parsed);
            }
        }
    }
    insert_headers(response.headers_mut(), extra);
    response
}

fn error_body(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({
            "ok": false,
            "error": { "code": code, "message": message, "field": "" }
        })),
    )
        .into_response()
}

fn safe_file_path(rel: &str) -> Result<PathBuf, AppError> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest {
            field: "path".to_string(),
            message: "文件路径不能为空".to_string(),
        });
    }
    let path = Path::new(trimmed);
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err(AppError::BadRequest {
            field: "path".to_string(),
            message: "文件路径必须是 data/files 下的相对路径，且不能包含 ..".to_string(),
        });
    }
    let root = std::env::current_dir()
        .map_err(|err| AppError::Internal(format!("无法定位工作目录：{err}")))?
        .join("data")
        .join("files");
    Ok(root.join(path))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0] as u32;
        let second = *chunk.get(1).unwrap_or(&0) as u32;
        let third = *chunk.get(2).unwrap_or(&0) as u32;
        let value = (first << 16) | (second << 8) | third;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((value >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(value & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn string_map_json(map: &HashMap<String, String>) -> Value {
    let mut out = Map::new();
    for (key, value) in map {
        out.insert(key.clone(), Value::String(value.clone()));
    }
    Value::Object(out)
}

fn headers_json(headers: &HeaderMap) -> Value {
    let mut out = Map::new();
    for (name, value) in headers {
        if let Ok(text) = value.to_str() {
            out.insert(name.as_str().to_string(), Value::String(text.to_string()));
        }
    }
    Value::Object(out)
}

fn split_roles(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}
