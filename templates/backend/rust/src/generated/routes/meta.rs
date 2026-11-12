// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
use axum::extract::State;
use axum::routing::get;
use axum::Router;
use serde_json::json;

use crate::generated::error::ok;
use crate::generated::middleware::snapshot;
use crate::generated::state::SharedState;

pub fn routes() -> Router<SharedState> {
    Router::new().route("/api/meta", get(meta))
}

fn database_target(config: &crate::generated::config::Config) -> String {
    let url = config.database.url.trim();
    if url.is_empty() {
        return format!(
            "{}://{}:{}/{}",
            config.database.effective_driver(),
            config.database.host,
            config.database.port,
            config.database.name
        );
    }
    if let Some(path) = url
        .strip_prefix("sqlite://")
        .or_else(|| url.strip_prefix("sqlite:"))
    {
        return format!("sqlite:{}", path.split('?').next().unwrap_or(path));
    }
    // 非 SQLite 连接串不返回，避免泄露账号密码；只给 scheme。
    format!("{}://…", config.database.effective_driver())
}

async fn meta(State(state): State<SharedState>) -> axum::Json<serde_json::Value> {
    ok(json!({
        "siteName": std::env::var("LC_SITE_NAME").unwrap_or_else(|_| "低代码站点".to_string()),
        "language": state.config.language,
        "maturity": state.config.maturity,
        "version": env!("CARGO_PKG_VERSION"),
        "configVersion": state.config.schema_version,
        "database": {
            "driver": state.config.database.driver,
            "effectiveDriver": state.config.database.effective_driver(),
            "target": database_target(&state.config),
            "pool": {
                "maxOpenConns": state.config.database.max_open_conns,
                "connectTimeoutSeconds": state.config.database.connect_timeout_seconds,
            },
        },
        "cache": {
            "enabled": state.config.cache.enabled,
            "driver": state.config.cache.driver,
            "effective": state.cache.effective_name(),
            "fallback": state.config.cache.fallback,
            "fallbackTarget": state.config.cache.fallback,
            "keyPrefix": state.config.cache.key_prefix,
            "ttlSeconds": state.config.cache.ttl_seconds,
            "fallbackActive": state.cache.is_fallback(),
        },
        "static": state.config.static_files.enabled,
        "startedAt": state.started_iso,
        // 让用户能从接口上确认配置到底来自哪一层，排查“改了不生效”时很有用。
        "configSources": {
            "generated": state.sources.generated,
            "user": state.sources.user,
            "override": state.sources.overridden,
            "env": state.sources.env,
            "cli": state.sources.cli,
        },
        "middleware": snapshot(&state.middleware),
        "middlewareImpacts": state.middleware.impacts,
        "middlewareBuiltin": state.builtin.snapshot(),
        "configCenter": {
            "sources": state.config_center.snapshot(),
        },
        "ignoredMiddleware": [],
    }))
}
