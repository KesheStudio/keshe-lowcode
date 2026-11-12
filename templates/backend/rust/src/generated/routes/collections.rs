// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 集合 CRUD 的 HTTP 接线：路径与前端 rowsPath 契约对齐（列表行固定在 data.items）。
use std::collections::HashMap;

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::Value;

use crate::generated::error::{bad, ok, AppError};
use crate::generated::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route(
            "/api/collections/{collectionId}/rows",
            get(list).post(create),
        )
        .route(
            "/api/collections/{collectionId}/rows/{rowId}",
            get(get_one).put(update).delete(remove),
        )
}

async fn list(
    State(state): State<SharedState>,
    Path(collection_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppError> {
    let data = state.data.list(&collection_id, &headers, &query).await?;
    Ok(ok(data))
}

async fn get_one(
    State(state): State<SharedState>,
    Path((collection_id, row_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let data = state
        .data
        .get_one(&collection_id, &row_id, &headers)
        .await?;
    Ok(ok(data))
}

async fn create(
    State(state): State<SharedState>,
    Path(collection_id): Path<String>,
    headers: HeaderMap,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = payload.map_err(json_rejection)?.0;
    let data = state.data.create(&collection_id, &headers, &body).await?;
    Ok((StatusCode::CREATED, ok(data)))
}

async fn update(
    State(state): State<SharedState>,
    Path((collection_id, row_id)): Path<(String, String)>,
    headers: HeaderMap,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, AppError> {
    let body = payload.map_err(json_rejection)?.0;
    let data = state
        .data
        .update(&collection_id, &row_id, &headers, &body)
        .await?;
    Ok(ok(data))
}

async fn remove(
    State(state): State<SharedState>,
    Path((collection_id, row_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let data = state.data.remove(&collection_id, &row_id, &headers).await?;
    Ok(ok(data))
}

/// 保留 axum 对超大请求体的 413 语义，其余解析失败统一按 400 返回。
fn json_rejection(rejection: JsonRejection) -> AppError {
    if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::PayloadTooLarge
    } else {
        bad("body", "请求体必须是合法 JSON 对象")
    }
}
