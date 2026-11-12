// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 中间件的顺序（由内向外）：压缩 → 限流 → 安全响应头 → CORS → 请求 ID/日志。
// 想调整业务行为请改 src/custom/，不要直接改这个文件。
use std::convert::Infallible;
use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderName, HeaderValue, Method};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::Router;
use tower::Service;
use tower_http::compression::predicate::SizeAbove;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use uuid::Uuid;

use crate::generated::config::{Config, CorsConfig, StaticCacheConfig};
use crate::generated::error::AppError;
use crate::generated::state::SharedState;

/// 给路由挂上全部可配置中间件。开关关闭时不产生额外开销。
pub fn apply(router: Router<SharedState>, state: &SharedState) -> Router<SharedState> {
    let config = &state.config;
    let mut router = router;

    if config.middleware.compression.enabled {
        // 通过 gzip/brotli 开关裁剪算法；两者都关时 validate() 已在启动阶段拦下。
        router = router.layer(
            CompressionLayer::new()
                .gzip(config.middleware.compression.gzip)
                .br(config.middleware.compression.brotli)
                // SizeAbove 的阈值是 u16；超过 64 KB 的配置按 64 KB 处理，宁可多压缩也不漏压。
                .compress_when(SizeAbove::new(
                    config
                        .middleware
                        .compression
                        .min_bytes
                        .min(u32::from(u16::MAX)) as u16,
                )),
        );
    }

    if config.middleware.rate_limit.enabled {
        router = router.layer(middleware::from_fn_with_state(state.clone(), rate_limit));
    }

    if config.middleware.security_headers.enabled {
        for (name, value) in security_header_values(&config.middleware.security_headers) {
            router = router.layer(SetResponseHeaderLayer::overriding(name, value));
        }
    }

    if config.cors.enabled {
        router = router.layer(build_cors(&config.cors));
        // tower-http 的预检响应默认是 200，这里统一成 204，和 Node/Go 两套保持一致。
        router = router.layer(middleware::from_fn(normalize_preflight));
    }

    if config.middleware.request_id || config.middleware.logging {
        router = router.layer(middleware::from_fn_with_state(
            state.clone(),
            request_context,
        ));
    }

    if config.middleware.concurrency.enabled {
        router = router.layer(middleware::from_fn_with_state(
            state.clone(),
            concurrency_limit,
        ));
    }
    if config.middleware.timeout.enabled {
        router = router.layer(middleware::from_fn_with_state(
            state.clone(),
            request_timeout,
        ));
    }

    router
}

fn security_header_values(
    config: &crate::generated::config::SecurityHeadersConfig,
) -> Vec<(HeaderName, HeaderValue)> {
    let mut values = Vec::new();
    let mut push = |name: HeaderName, value: &str| {
        if value.trim().is_empty() {
            return;
        }
        if let Ok(parsed) = HeaderValue::from_str(value) {
            values.push((name, parsed));
        }
    };
    push(header::X_CONTENT_TYPE_OPTIONS, &config.content_type_options);
    push(header::X_FRAME_OPTIONS, &config.frame_options);
    push(header::REFERRER_POLICY, &config.referrer_policy);
    push(
        HeaderName::from_static("permissions-policy"),
        &config.permissions_policy,
    );
    push(
        HeaderName::from_static("cross-origin-opener-policy"),
        &config.cross_origin_opener_policy,
    );
    if config.hsts.enabled {
        let mut value = format!("max-age={}", config.hsts.max_age_seconds);
        if config.hsts.include_subdomains {
            value.push_str("; includeSubDomains");
        }
        if config.hsts.preload {
            value.push_str("; preload");
        }
        push(header::STRICT_TRANSPORT_SECURITY, &value);
    }
    values
}

async fn request_timeout(
    State(state): State<SharedState>,
    request: Request,
    next: Next,
) -> Response {
    let seconds = state.config.middleware.timeout.seconds;
    match tokio::time::timeout(Duration::from_secs(u64::from(seconds)), next.run(request)).await {
        Ok(response) => response,
        Err(_) => AppError::Timeout { seconds }.into_response(),
    }
}

async fn concurrency_limit(
    State(state): State<SharedState>,
    request: Request,
    next: Next,
) -> Response {
    let limit = state.config.middleware.concurrency.max_in_flight;
    let permit = match state.concurrency.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            let mut response = AppError::ConcurrencyLimited {
                max_in_flight: limit,
            }
            .into_response();
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
            return response;
        }
    };
    let response = next.run(request).await;
    drop(permit);
    response
}

fn build_cors(cors: &CorsConfig) -> CorsLayer {
    // credentials 与 * 不能同时生效；配置校验阶段已拦住这种组合。
    let wildcard = cors.origins.iter().any(|origin| origin == "*") && !cors.credentials;
    let mut layer = CorsLayer::new();

    if wildcard {
        layer = layer.allow_origin(Any);
    } else {
        let origins: Vec<HeaderValue> = cors
            .origins
            .iter()
            .filter_map(|origin| origin.parse::<HeaderValue>().ok())
            .collect();
        if !origins.is_empty() {
            layer = layer.allow_origin(origins);
        }
    }

    let methods: Vec<Method> = cors
        .methods
        .iter()
        .filter_map(|method| method.parse::<Method>().ok())
        .collect();
    if !methods.is_empty() {
        layer = layer.allow_methods(methods);
    }

    let headers: Vec<HeaderName> = cors
        .headers
        .iter()
        .filter_map(|name| HeaderName::from_bytes(name.as_bytes()).ok())
        .collect();
    if !headers.is_empty() {
        layer = layer.allow_headers(headers);
    }

    if cors.credentials {
        layer = layer.allow_credentials(true);
    }

    layer.max_age(Duration::from_secs(u64::from(cors.max_age)))
}

/// 把 CORS 预检的 200 统一成 204（无响应体）。
async fn normalize_preflight(request: Request, next: Next) -> Response {
    let is_options = request.method() == Method::OPTIONS;
    let mut response = next.run(request).await;
    if is_options
        && response.status() == axum::http::StatusCode::OK
        && response
            .headers()
            .contains_key(header::ACCESS_CONTROL_ALLOW_METHODS)
    {
        *response.status_mut() = axum::http::StatusCode::NO_CONTENT;
    }
    response
}

/// 固定窗口限流：按客户端 IP，每秒最多 rps 次。
async fn rate_limit(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let limit = state.config.middleware.rate_limit.rps;
    let key = peer.ip().to_string();
    let window = Duration::from_secs(1);

    let allowed = {
        let mut buckets = state.rate.lock().await;
        let now = Instant::now();

        if buckets.len() > 10_000 {
            buckets.retain(|_, (start, _)| now.saturating_duration_since(*start) < window);
        }

        let entry = buckets.entry(key).or_insert((now, 0));
        if now.saturating_duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= limit
    };

    if !allowed {
        let mut response = AppError::TooManyRequests.into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        return response;
    }

    next.run(request).await
}

/// 只使用服务端生成的请求 ID，不回显客户端传值，避免日志注入。
async fn request_context(
    State(state): State<SharedState>,
    request: Request,
    next: Next,
) -> Response {
    let request_id = Uuid::new_v4().to_string();
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let started = Instant::now();

    let mut response = next.run(request).await;

    if state.config.middleware.request_id {
        if let Ok(value) = HeaderValue::from_str(&request_id) {
            response
                .headers_mut()
                .insert(HeaderName::from_static("x-request-id"), value);
        }
    }

    if state.config.middleware.logging {
        tracing::info!(
            request_id = %request_id,
            method = %method,
            path = %path,
            status = response.status().as_u16(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "request"
        );
    }

    response
}

/// 静态资源层：按文件是否为内容指纹命名写入 Cache-Control。
#[derive(Clone)]
pub struct StaticCacheService<S> {
    inner: S,
    enabled: bool,
    max_age: u64,
    immutable_max_age: u64,
}

pub fn static_service<S>(serve_dir: S, config: &StaticCacheConfig) -> StaticCacheService<S> {
    StaticCacheService {
        inner: serve_dir,
        enabled: config.enabled,
        max_age: config.max_age_seconds,
        immutable_max_age: config.immutable_max_age_seconds,
    }
}

fn has_content_hash(file_name: &str) -> bool {
    let Some((stem, _extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    let bytes = stem.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'.' || bytes[index] == b'-' {
            let start = index + 1;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_hexdigit() {
                end += 1;
            }
            if end - start >= 8 {
                return true;
            }
            index = end.max(index + 1);
        } else {
            index += 1;
        }
    }
    false
}

fn cache_control_value(max_age: u64, immutable_max_age: u64, path: &str) -> String {
    let file_name = path.rsplit('/').next().unwrap_or(path);
    if has_content_hash(file_name) {
        format!("public, max-age={}, immutable", immutable_max_age)
    } else {
        format!("public, max-age={}", max_age)
    }
}

impl<S, ResBody> Service<axum::http::Request<axum::body::Body>> for StaticCacheService<S>
where
    S: Service<
            axum::http::Request<axum::body::Body>,
            Response = Response<ResBody>,
            Error = Infallible,
        > + Send
        + 'static,
    S::Future: Send + 'static,
    ResBody: Send + 'static,
{
    type Response = Response<ResBody>;
    type Error = Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Infallible>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: axum::http::Request<axum::body::Body>) -> Self::Future {
        let path = request.uri().path().to_string();
        let enabled = self.enabled;
        let max_age = self.max_age;
        let immutable_max_age = self.immutable_max_age;
        let future = self.inner.call(request);
        Box::pin(async move {
            let mut response = future.await?;
            if enabled {
                let value = cache_control_value(max_age, immutable_max_age, &path);
                if let Ok(header_value) = HeaderValue::from_str(&value) {
                    response
                        .headers_mut()
                        .insert(header::CACHE_CONTROL, header_value);
                }
            }
            Ok(response)
        })
    }
}

/// 给启动逻辑用：把 host/port 拼成可绑定的地址。
pub fn socket_addr(config: &Config) -> Result<SocketAddr, String> {
    let host = config.host.trim();
    let text = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{}", config.port)
    } else {
        format!("{host}:{}", config.port)
    };
    text.parse::<SocketAddr>()
        .map_err(|_| format!("host/port 无法组合成有效监听地址：{text}"))
}
