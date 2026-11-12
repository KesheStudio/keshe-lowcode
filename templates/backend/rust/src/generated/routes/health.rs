// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde_json::json;

use crate::generated::error::{ok, AppError};
use crate::generated::middleware::{disabled_error, snapshot};
use crate::generated::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ready", get(ready))
}

async fn probe_database(state: &SharedState) -> Result<(), String> {
    sqlx::query("SELECT 1")
        .execute(&state.pool)
        .await
        .map(|_| ())
        .map_err(|err| crate::generated::db::safe_message(&err))
}

fn health_disabled(state: &SharedState) -> Option<Response> {
    if state.config.middleware.health.enabled {
        return None;
    }
    Some(
        disabled_error(
            "health",
            "middleware.health.enabled",
            "健康/就绪探针已被关闭，部署与容器探针会失败。",
        )
        .into_response(),
    )
}

/// 存活检查：进程活着就 200，数据库不可用只体现在 databaseReachable。
async fn health(State(state): State<SharedState>) -> Response {
    if let Some(response) = health_disabled(&state) {
        return response;
    }

    let database = probe_database(&state).await;
    let (reachable, problem) = match &database {
        Ok(()) => (true, String::new()),
        Err(reason) => {
            tracing::error!(reason = %reason, "健康检查数据库探测失败");
            (false, reason.clone())
        }
    };

    ok(json!({
        "status": "ok",
        "language": state.config.language,
        "maturity": state.config.maturity,
        "version": env!("CARGO_PKG_VERSION"),
        "uptimeSeconds": state.started.elapsed().as_secs(),
        // 报告实际生效的驱动（url 的 scheme 优先于 database.driver）。
        "database": state.config.database.effective_driver(),
        "databaseReachable": reachable,
        "databaseProblem": problem,
        "cache": state.cache.effective_name(),
        "cacheConfigured": state.config.cache.driver,
        "cacheFallback": state.cache.is_fallback(),
        "static": state.config.static_files.enabled,
        "middleware": snapshot(&state.middleware),
    }))
    .into_response()
}

/// 就绪检查：按 readinessRequiresDatabase / readinessRequiresCache 返回 503。
async fn ready(State(state): State<SharedState>) -> Response {
    if let Some(response) = health_disabled(&state) {
        return response;
    }

    let health = &state.config.middleware.health;
    let mut problems: Vec<String> = Vec::new();
    let mut checked_database = false;
    let mut checked_cache = false;

    if health.readiness_requires_database {
        checked_database = true;
        if let Err(reason) = probe_database(&state).await {
            tracing::error!(reason = %reason, "就绪检查数据库探测失败");
            problems.push(format!("数据库不可用（{reason}）"));
        }
    }
    if health.readiness_requires_cache && state.cache.effective_name() == "redis" {
        checked_cache = true;
        if let Err(reason) = state.cache.probe().await {
            tracing::error!(reason = %reason, "就绪检查缓存探测失败");
            problems.push(format!("缓存不可用（{reason}）"));
        }
    }

    if !problems.is_empty() {
        return AppError::NotReady(problems.join("；")).into_response();
    }

    ok(json!({
        "status": "ready",
        "language": state.config.language,
        "version": env!("CARGO_PKG_VERSION"),
        "checked": {
            "database": checked_database,
            "cache": checked_cache,
        },
        "database": state.config.database.effective_driver(),
        "cache": state.cache.effective_name(),
        "middleware": snapshot(&state.middleware),
    }))
    .into_response()
}
