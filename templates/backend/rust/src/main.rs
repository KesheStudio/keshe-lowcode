// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 启动顺序：读配置 → 初始化日志 → 连库并跑迁移 → 初始化缓存 → 装配路由/中间件 → 监听。
// 业务代码请改 src/custom/，新增接口写 src/custom/routes.rs。
mod custom;
mod generated;

use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Context;
use axum::extract::DefaultBodyLimit;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing_subscriber::filter::LevelFilter;

use crate::generated::db::DbFailure;
use crate::generated::state::{AppState, SharedState};

#[tokio::main]
async fn main() {
    let loaded = match generated::config::load() {
        Ok(loaded) => loaded,
        Err(err) => {
            // 配置错误统一用退出码 2，方便部署脚本区分。
            eprintln!("[LC_E_CONFIG_INVALID] 配置无效：{err}");
            eprintln!("提示：检查 config.yaml，或用 --config 指定其它文件。");
            std::process::exit(2);
        }
    };

    init_logging(&loaded.config.log_level);
    for warning in &loaded.warnings {
        tracing::warn!("{warning}");
    }
    tracing::info!(
        generated = loaded.sources.generated.as_deref().unwrap_or("-"),
        user = loaded.sources.user.as_deref().unwrap_or("-"),
        overridden = loaded.sources.overridden,
        "配置加载完成"
    );

    loaded.config_center.print_summary();
    loaded.builtin_runtime.print();
    let plan = generated::middleware::build_plan(&loaded.config);
    generated::middleware::print_plan(&plan);

    // --migrate / --migrate-down 只做迁移，不启动 HTTP 服务。
    if loaded.migrate || loaded.migrate_down {
        if let Err(failure) = run_migration_cli(loaded).await {
            exit_db(failure);
        }
        return;
    }

    let state = match build_state(loaded, plan).await {
        Ok(state) => state,
        Err(failure) => exit_db(failure),
    };

    if let Err(err) = serve(state).await {
        tracing::error!(error = %format!("{err:#}"), "服务异常退出");
        std::process::exit(1);
    }
}

/// 连库 → 自动执行 up 迁移 → 初始化缓存。任一步失败都退出码 1 并打印排查提示。
async fn build_state(
    loaded: generated::config::LoadedConfig,
    plan: generated::middleware::MiddlewarePlan,
) -> Result<SharedState, DbFailure> {
    let pool = generated::db::connect(&loaded.config).await?;

    generated::migrate::up(&pool)
        .await
        .map_err(|err| DbFailure::migration(format!("{err:#}")))?;

    let cache = generated::cache::Cache::init(&loaded.config.cache).await;
    tracing::info!(
        cache = cache.effective_name(),
        fallback = cache.is_fallback(),
        "缓存初始化完成"
    );

    let auth = generated::auth::AuthService::new(&loaded.config.auth, pool.clone())
        .await
        .map_err(|err| DbFailure::migration(format!("认证中心初始化失败：{err:#}")))?;
    let auth = Arc::new(auth);
    let data = Arc::new(generated::data::DataService::new(
        &loaded.config.data_api,
        pool.clone(),
        auth.clone(),
    ));

    let concurrency = Arc::new(tokio::sync::Semaphore::new(
        loaded.config.middleware.concurrency.max_in_flight.max(1) as usize,
    ));

    Ok(Arc::new(AppState {
        config: loaded.config,
        pool,
        cache,
        auth,
        data,
        started: Instant::now(),
        started_iso: chrono::Utc::now().to_rfc3339(),
        sources: loaded.sources,
        rate: Mutex::new(HashMap::new()),
        middleware: plan,
        config_center: loaded.config_center,
        builtin: loaded.builtin_runtime,
        concurrency,
    }))
}

async fn run_migration_cli(loaded: generated::config::LoadedConfig) -> Result<(), DbFailure> {
    let pool = generated::db::connect(&loaded.config).await?;

    if loaded.migrate_down {
        match generated::migrate::down(&pool).await {
            Ok(Some(version)) => println!("已回滚迁移：{version}"),
            Ok(None) => println!("没有可回滚的迁移（migrations/down 下没有匹配的脚本）"),
            Err(err) => {
                pool.close().await;
                return Err(DbFailure::migration(format!("{err:#}")));
            }
        }
    } else {
        match generated::migrate::up(&pool).await {
            Ok(applied) if applied.is_empty() => println!("无待执行迁移"),
            Ok(applied) => println!("已应用迁移：{}", applied.join("、")),
            Err(err) => {
                pool.close().await;
                return Err(DbFailure::migration(format!("{err:#}")));
            }
        }
    }

    pool.close().await;
    Ok(())
}

fn exit_db(failure: DbFailure) -> ! {
    eprintln!("[{}] {}", failure.code, failure.reason);
    for hint in &failure.hints {
        eprintln!("  排查：{hint}");
    }
    std::process::exit(1)
}

async fn serve(state: SharedState) -> anyhow::Result<()> {
    let addr = generated::http::socket_addr(&state.config).map_err(anyhow::Error::msg)?;

    let router: Router<SharedState> = generated::routes::register(Router::new());
    let router = custom::routes::register(router);
    let router = if state.config.middleware.body_limit.enabled {
        router.layer(DefaultBodyLimit::max(
            state.config.middleware.body_limit.max_bytes as usize,
        ))
    } else {
        router.layer(DefaultBodyLimit::disable())
    };
    let router = generated::http::apply(router, &state);
    let mut app = router.with_state(state.clone());
    app = app.fallback(not_found);

    if state.config.static_files.enabled {
        // 静态根交给 ServeDir；文件不存在时回落到统一的 404（/api 仍返回 JSON）。
        let serve_dir = ServeDir::new(&state.config.static_files.root)
            .append_index_html_on_directories(true)
            .not_found_service(Router::new().fallback(not_found));
        let serve_dir =
            generated::http::static_service(serve_dir, &state.config.middleware.static_cache);
        app = app.fallback_service(serve_dir);
        tracing::info!(root = %state.config.static_files.root, "静态资源已启用");
    }

    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) if err.kind() == ErrorKind::AddrInUse => {
            anyhow::bail!(
                "端口 {} 已被占用。改 config.yaml 的 port，或用启动参数 --port 换一个端口。",
                addr.port()
            )
        }
        Err(err) => return Err(err).context("监听端口失败"),
    };

    tracing::info!(
        address = %addr,
        database = %state.config.database.effective_driver(),
        cache = %state.cache.effective_name(),
        "服务已启动，健康检查：http://{addr}/api/health"
    );
    tracing::info!("就绪检查：http://{addr}/api/ready");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("HTTP 服务异常退出")
}

/// 未匹配到任何路由时的统一 404：接口返回 JSON，其它路径返回纯文本。
async fn not_found(uri: Uri) -> Response {
    if uri.path().starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "ok": false,
                "error": {
                    "code": "LC_E_NOT_FOUND",
                    "message": "接口不存在",
                    "detail": "",
                    "field": ""
                }
            })),
        )
            .into_response();
    }

    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "404 Not Found",
    )
        .into_response()
}

fn init_logging(level: &str) {
    let filter = match level {
        "debug" => LevelFilter::DEBUG,
        "warn" => LevelFilter::WARN,
        "error" => LevelFilter::ERROR,
        _ => LevelFilter::INFO,
    };
    let _ = tracing_subscriber::fmt()
        .with_max_level(filter)
        .with_target(false)
        .try_init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::error!(error = %err, "无法监听 Ctrl+C");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(err) => tracing::error!(error = %err, "无法监听 SIGTERM"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("收到退出信号，正在关闭服务");
}
