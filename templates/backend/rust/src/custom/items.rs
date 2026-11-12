// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// 这是 items 接口的处理器扩展点。只改这个文件就能调整 /api/items 的入参校验与返回结构。
// 需要换存储实现时改 ./store.rs，不必动这里。
use std::collections::HashMap;

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::{json, Value};

use crate::custom::store::{create_item, delete_item, get_item, list_items, update_item};
use crate::generated::error::{bad, ok, AppError};
use crate::generated::models::Item;
use crate::generated::state::SharedState;

const MAX_TITLE: usize = 200;
const MAX_BODY: usize = 20000;

pub async fn list(
    State(state): State<SharedState>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let limit = read_int(query.get("limit"), 20, "limit", 1, 100)?;
    let offset = read_int(query.get("offset"), 0, "offset", 0, i64::MAX)?;

    let (items, total) = list_items(&state.pool, limit, offset)
        .await
        .map_err(AppError::db)?;

    Ok(ok(json!({
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    })))
}

pub async fn get_one(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let cache_key = state.cache.key(&format!("items:{id}"));
    if let Some(raw) = state.cache.get(&cache_key).await {
        if let Ok(item) = serde_json::from_str::<Item>(&raw) {
            return Ok(ok(json!(item)));
        }
    }

    let item = get_item(&state.pool, &id).await.map_err(AppError::db)?;
    match &item {
        Some(item) => {
            if let Ok(raw) = serde_json::to_string(item) {
                state.cache.set(&cache_key, raw).await;
            }
            Ok(ok(json!(item)))
        }
        None => Err(AppError::NotFound("items 记录不存在".to_string())),
    }
}

pub async fn create(
    State(state): State<SharedState>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = payload.map_err(json_rejection)?.0;
    let (title, body) = read_item_input(&body)?;

    let item = create_item(&state.pool, &title, &body)
        .await
        .map_err(AppError::db)?;

    Ok((StatusCode::CREATED, ok(json!(item))))
}

pub async fn update(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, AppError> {
    let body = payload.map_err(json_rejection)?.0;
    let (title, body) = read_item_input(&body)?;

    let item = update_item(&state.pool, &id, &title, &body)
        .await
        .map_err(AppError::db)?;

    // 写操作直接失效缓存，下一次读再回填，避免读到旧数据。
    state
        .cache
        .del(&state.cache.key(&format!("items:{id}")))
        .await;

    match item {
        Some(item) => Ok(ok(json!(item))),
        None => Err(AppError::NotFound("items 记录不存在".to_string())),
    }
}

pub async fn remove(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let removed = delete_item(&state.pool, &id).await.map_err(AppError::db)?;
    if !removed {
        return Err(AppError::NotFound("items 记录不存在".to_string()));
    }
    state
        .cache
        .del(&state.cache.key(&format!("items:{id}")))
        .await;
    Ok(ok(json!({ "id": id })))
}

/// 保留 axum 对超大请求体的 413 语义，其余解析失败统一按 400 返回。
fn json_rejection(rejection: JsonRejection) -> AppError {
    if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::PayloadTooLarge
    } else {
        bad("body", "请求体必须是合法 JSON 对象")
    }
}

fn read_int(
    raw: Option<&String>,
    fallback: i64,
    field: &str,
    min: i64,
    max: i64,
) -> Result<i64, AppError> {
    let Some(raw) = raw else {
        return Ok(fallback);
    };
    let value = raw
        .trim()
        .parse::<i64>()
        .map_err(|_| bad(field, format!("{field} 必须是 {min}-{max} 的整数")))?;
    if value < min || value > max {
        return Err(bad(field, format!("{field} 必须是 {min}-{max} 的整数")));
    }
    Ok(value)
}

fn read_item_input(body: &Value) -> Result<(String, String), AppError> {
    let Some(object) = body.as_object() else {
        return Err(bad("body", "请求体必须是 JSON 对象"));
    };

    let title = match object.get("title").and_then(Value::as_str) {
        Some(title) if !title.trim().is_empty() => title.trim().to_string(),
        _ => return Err(bad("title", "title 必须是非空字符串")),
    };
    if title.chars().count() > MAX_TITLE {
        return Err(bad("title", format!("title 最长 {MAX_TITLE} 个字符")));
    }

    let detail = match object.get("body") {
        None => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(_) => return Err(bad("body", "body 必须是字符串")),
    };
    if detail.chars().count() > MAX_BODY {
        return Err(bad("body", format!("body 最长 {MAX_BODY} 个字符")));
    }

    Ok((title, detail))
}
