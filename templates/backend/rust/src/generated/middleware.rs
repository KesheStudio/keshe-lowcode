// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 中间件生效清单：固定服务能力开关，不含任何按 id 动态加载的用户自定义中间件。
use serde::Serialize;
use serde_json::{json, Value};

use crate::generated::config::Config;
use crate::generated::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiddlewareEntry {
    pub name: String,
    pub enabled: bool,
    pub effective: String,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiddlewareImpact {
    pub name: String,
    pub routes: Vec<String>,
    pub message: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiddlewarePlan {
    pub entries: Vec<MiddlewareEntry>,
    pub impacts: Vec<MiddlewareImpact>,
}

pub fn build_plan(config: &Config) -> MiddlewarePlan {
    let mw = &config.middleware;
    let mut entries = Vec::new();
    let mut impacts = Vec::new();

    entries.push(entry(
        "requestId",
        mw.request_id,
        if mw.request_id {
            format!("生成 x-request-id，并写入日志与响应头（driver={}）", "ulid")
        } else {
            "不生成请求 ID；日志无法把同一次请求的多条记录串起来".to_string()
        },
        "middleware.requestId",
    ));

    entries.push(entry(
        "logging",
        mw.logging,
        if mw.logging {
            "输出方法、路径、状态码、耗时与 requestId（access log）".to_string()
        } else {
            "只保留错误日志，不输出访问日志；业务请求不会 panic".to_string()
        },
        "middleware.logging",
    ));

    entries.push(entry(
        "bodyLimit",
        mw.body_limit.enabled,
        if mw.body_limit.enabled {
            format!("请求体上限 {} 字节，超出返回 413", mw.body_limit.max_bytes)
        } else {
            "不限制请求体大小，仍受反向代理/内核限制".to_string()
        },
        "middleware.bodyLimit.enabled",
    ));

    entries.push(entry(
        "timeout",
        mw.timeout.enabled,
        if mw.timeout.enabled {
            format!(
                "单个请求超过 {} 秒返回 503 LC_E_TIMEOUT",
                mw.timeout.seconds
            )
        } else {
            "不设置服务端超时，慢请求会一直占用连接".to_string()
        },
        "middleware.timeout.enabled",
    ));

    entries.push(entry(
        "concurrency",
        mw.concurrency.enabled,
        if mw.concurrency.enabled {
            format!(
                "在途请求上限 {}，超出返回 503 LC_E_CONCURRENCY_LIMITED",
                mw.concurrency.max_in_flight
            )
        } else {
            "不限制并发请求数（默认关闭，仅记录 info）".to_string()
        },
        "middleware.concurrency.enabled",
    ));

    entries.push(entry(
        "rateLimit",
        mw.rate_limit.enabled,
        if mw.rate_limit.enabled {
            format!("每 IP 每秒 {} 次，超出返回 429", mw.rate_limit.rps)
        } else {
            "不限制请求速率（默认关闭，仅记录 info）".to_string()
        },
        "middleware.rateLimit.enabled",
    ));

    entries.push(entry(
        "cors",
        config.cors.enabled,
        if config.cors.enabled {
            format!("允许来源：{}", config.cors.origins.join(", "))
        } else {
            "不发送 CORS 响应头，浏览器跨域请求会被拦截".to_string()
        },
        "cors.enabled",
    ));

    entries.push(entry(
        "compression",
        mw.compression.enabled,
        if mw.compression.enabled {
            let mut algorithms = Vec::new();
            if mw.compression.gzip {
                algorithms.push("gzip");
            }
            if mw.compression.brotli {
                algorithms.push("br");
            }
            format!(
                "压缩算法：{}；minBytes={}",
                algorithms.join(", "),
                mw.compression.min_bytes
            )
        } else {
            "不压缩响应体，带宽占用更高".to_string()
        },
        "middleware.compression.enabled",
    ));

    entries.push(entry(
        "staticCache",
        mw.static_cache.enabled,
        if mw.static_cache.enabled {
            format!(
                "静态资源 Cache-Control：max-age={}，指纹文件 immutable max-age={}",
                mw.static_cache.max_age_seconds, mw.static_cache.immutable_max_age_seconds
            )
        } else {
            "静态资源不发送 Cache-Control，浏览器每次都回源".to_string()
        },
        "middleware.staticCache.enabled",
    ));

    entries.push(entry(
        "health",
        mw.health.enabled,
        if mw.health.enabled {
            format!(
                "提供 /api/health 与 /api/ready；ready 依赖 database={} cache={}",
                mw.health.readiness_requires_database, mw.health.readiness_requires_cache
            )
        } else {
            "两个探针接口都返回 503 LC_E_MIDDLEWARE_DISABLED".to_string()
        },
        "middleware.health.enabled",
    ));

    entries.push(entry(
        "securityHeaders",
        mw.security_headers.enabled,
        if mw.security_headers.enabled {
            format!(
                "安全头：contentTypeOptions={} frameOptions={} hsts={}",
                display_or_off(&mw.security_headers.content_type_options),
                display_or_off(&mw.security_headers.frame_options),
                if mw.security_headers.hsts.enabled {
                    "on"
                } else {
                    "off"
                }
            )
        } else {
            "不发送任何安全响应头".to_string()
        },
        "middleware.securityHeaders.enabled",
    ));

    entries.push(entry(
        "cache",
        config.cache.enabled,
        if config.cache.enabled {
            format!(
                "缓存已启用：driver={} ttl={}s prefix={}",
                config.cache.driver, config.cache.ttl_seconds, config.cache.key_prefix
            )
        } else {
            format!(
                "缓存已关闭，回退目标={}（memory/none）",
                config.cache.fallback
            )
        },
        "cache.enabled",
    ));

    // 关闭项影响：rateLimit / concurrency / cache 默认关闭时只记 info，不告警。
    if !mw.body_limit.enabled {
        impacts.push(impact(
            "bodyLimit",
            all_data_routes(),
            "关闭后不会拒绝超大请求体，可能被超大 JSON 拖慢或打满内存。",
            "把 middleware.bodyLimit.enabled 改为 true 后重启。",
        ));
    }
    if !mw.timeout.enabled {
        impacts.push(impact(
            "timeout",
            all_data_routes(),
            "关闭后慢查询/慢下游会一直占用连接，容易造成请求堆积。",
            "把 middleware.timeout.enabled 改为 true 后重启。",
        ));
    }
    if !mw.static_cache.enabled {
        impacts.push(impact(
            "staticCache",
            vec!["/static/*".to_string()],
            "关闭后静态资源不带 Cache-Control，浏览器每次都会回源。",
            "把 middleware.staticCache.enabled 改为 true 后重启。",
        ));
    }
    if !mw.compression.enabled {
        impacts.push(impact(
            "compression",
            all_routes(),
            "关闭后响应不压缩，JSON/HTML/JS 传输体积变大。",
            "把 middleware.compression.enabled 改为 true 后重启。",
        ));
    }
    if !mw.security_headers.enabled {
        impacts.push(impact(
            "securityHeaders",
            all_routes(),
            "关闭后浏览器端缺少 nosniff / frameOptions 等防护。",
            "把 middleware.securityHeaders.enabled 改为 true 后重启。",
        ));
    }
    if !mw.health.enabled {
        impacts.push(impact(
            "health",
            vec!["/api/health".to_string(), "/api/ready".to_string()],
            "关闭后容器与部署探针都会收到 503，滚动发布可能失败。",
            "把 middleware.health.enabled 改为 true 后重启。",
        ));
    }
    if !config.cache.enabled && config.cache.fallback.trim() == "none" {
        impacts.push(impact(
            "cache",
            all_data_routes(),
            "缓存关闭且 fallback=none：读接口每次都直读数据库，数据库压力明显上升。",
            "把 cache.enabled 改为 true，或 cache.fallback 改为 memory 后重启。",
        ));
    }
    if !mw.rate_limit.enabled {
        tracing::info!("[中间件] rateLimit 未启用（默认关闭，仅记录 info）");
    }
    if !mw.concurrency.enabled {
        tracing::info!("[中间件] concurrency 未启用（默认关闭，仅记录 info）");
    }

    MiddlewarePlan { entries, impacts }
}

fn entry(name: &str, enabled: bool, effective: String, config_path: &str) -> MiddlewareEntry {
    MiddlewareEntry {
        name: name.to_string(),
        enabled,
        effective,
        config_path: config_path.to_string(),
    }
}

fn impact(name: &str, routes: Vec<String>, message: &str, hint: &str) -> MiddlewareImpact {
    MiddlewareImpact {
        name: name.to_string(),
        routes,
        message: message.to_string(),
        hint: hint.to_string(),
    }
}

fn all_routes() -> Vec<String> {
    vec![
        "/static/*".to_string(),
        "/api/health".to_string(),
        "/api/ready".to_string(),
    ]
}

fn all_data_routes() -> Vec<String> {
    vec![
        "/api/health".to_string(),
        "/api/ready".to_string(),
        "/api/meta".to_string(),
        "/api/data/*".to_string(),
        "/api/auth/*".to_string(),
        "/static/*".to_string(),
    ]
}

fn display_or_off(value: &str) -> &str {
    if value.trim().is_empty() {
        "off"
    } else {
        value
    }
}

pub fn snapshot(plan: &MiddlewarePlan) -> Value {
    serde_json::to_value(&plan.entries).unwrap_or_else(|_| json!([]))
}

pub fn disabled_error(name: &str, config_path: &str, detail: &str) -> AppError {
    let detail = if detail.trim().is_empty() {
        format!("改回 {config_path}=true 后重启即可恢复。")
    } else {
        format!("{detail} 恢复配置：{config_path}=true。")
    };
    AppError::MiddlewareDisabled {
        name: name.to_string(),
        config_path: config_path.to_string(),
        detail,
    }
}

pub fn print_plan(plan: &MiddlewarePlan) {
    let enabled = plan.entries.iter().filter(|entry| entry.enabled).count();
    tracing::info!(
        "[中间件] 本次生效清单：{}/{} 项开启",
        enabled,
        plan.entries.len()
    );
    for entry in &plan.entries {
        let mark = if entry.enabled { "✓" } else { "✗" };
        tracing::info!("[中间件] {} {}（{}）", mark, entry.name, entry.effective);
    }
    for impact in &plan.impacts {
        tracing::warn!(
            "[中间件][影响] {} 已关闭：受影响路由 {}；{} 可操作提示：{}",
            impact.name,
            impact.routes.join(", "),
            impact.message,
            impact.hint
        );
    }
}
