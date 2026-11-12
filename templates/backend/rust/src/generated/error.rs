// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 用户区代码可以引用这里的 AppError / ok()，当作稳定的公共接口。
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};

/// 字段级校验错误。集合接口返回 409 时会在 error.fields 里带上这一组明细。
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct FieldIssue {
    pub field: String,
    pub code: String,
    pub message: String,
}

// 详情字段（DbUnavailable/Internal 里的 String）有意不返回给客户端，避免泄露内部信息。
#[allow(dead_code)]
#[derive(Debug)]
pub enum AppError {
    BadRequest {
        field: String,
        message: String,
    },
    NotFound(String),
    Unauthorized(String),
    Forbidden(String),
    TooManyRequests,
    PayloadTooLarge,
    Timeout {
        seconds: u32,
    },
    ConcurrencyLimited {
        max_in_flight: u32,
    },
    NotReady(String),
    MiddlewareDisabled {
        name: String,
        config_path: String,
        detail: String,
    },
    DbUnavailable(String),
    Internal(String),
    InvalidRow {
        field: String,
        message: String,
        fields: Vec<FieldIssue>,
    },
    RowConflict {
        field: String,
        message: String,
        fields: Vec<FieldIssue>,
    },
}

impl AppError {
    pub fn db(err: sqlx::Error) -> Self {
        // 连接被拒/超时/认证失败/库不存在都属于「依赖不可用」，返回 503；其余算 500。
        // 日志只用脱敏后的描述，绝不输出连接串或密码。
        let detail = crate::generated::db::safe_message(&err);
        if crate::generated::db::is_unavailable(&err) {
            tracing::error!(reason = %detail, "数据库不可用");
            Self::DbUnavailable(detail)
        } else {
            tracing::error!(reason = %detail, "数据库操作失败");
            Self::Internal(detail)
        }
    }
}

pub fn bad(field: &str, message: impl Into<String>) -> AppError {
    AppError::BadRequest {
        field: field.to_string(),
        message: message.into(),
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, detail, field, fields): (
            StatusCode,
            &str,
            String,
            String,
            String,
            Vec<FieldIssue>,
        ) = match self {
            AppError::BadRequest { field, message } => (
                StatusCode::BAD_REQUEST,
                "LC_E_INVALID_ARGUMENT",
                message,
                String::new(),
                field,
                Vec::new(),
            ),
            AppError::NotFound(message) => (
                StatusCode::NOT_FOUND,
                "LC_E_NOT_FOUND",
                message,
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::Unauthorized(message) => (
                StatusCode::UNAUTHORIZED,
                "LC_E_UNAUTHORIZED",
                message,
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::Forbidden(message) => (
                StatusCode::FORBIDDEN,
                "LC_E_FORBIDDEN",
                message,
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "LC_E_RATE_LIMITED",
                "请求过于频繁，请稍后再试".to_string(),
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::PayloadTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "LC_E_PAYLOAD_TOO_LARGE",
                "请求体超过 1 MiB 限制".to_string(),
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::Timeout { seconds } => (
                StatusCode::SERVICE_UNAVAILABLE,
                "LC_E_TIMEOUT",
                format!("请求处理超过 {seconds} 秒"),
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::ConcurrencyLimited { max_in_flight } => (
                StatusCode::SERVICE_UNAVAILABLE,
                "LC_E_CONCURRENCY_LIMITED",
                format!("在途请求已达上限 {max_in_flight}，请稍后重试"),
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::NotReady(detail) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "LC_E_NOT_READY",
                "服务尚未就绪".to_string(),
                detail,
                String::new(),
                Vec::new(),
            ),
            AppError::MiddlewareDisabled {
                name,
                config_path,
                detail,
            } => (
                StatusCode::SERVICE_UNAVAILABLE,
                "LC_E_MIDDLEWARE_DISABLED",
                format!("中间件 {name} 已关闭，该接口不可用"),
                format!("{detail}（配置键：{config_path}）"),
                String::new(),
                Vec::new(),
            ),
            AppError::DbUnavailable(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "LC_E_DB_UNAVAILABLE",
                "数据库不可用".to_string(),
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "LC_E_INTERNAL",
                "服务端处理失败".to_string(),
                String::new(),
                String::new(),
                Vec::new(),
            ),
            AppError::InvalidRow {
                field,
                message,
                fields,
            } => (
                StatusCode::CONFLICT,
                "LC_E_DATA_INVALID_ROW",
                message,
                String::new(),
                field,
                fields,
            ),
            AppError::RowConflict {
                field,
                message,
                fields,
            } => (
                StatusCode::CONFLICT,
                "LC_E_DATA_ROW_CONFLICT",
                message,
                String::new(),
                field,
                fields,
            ),
        };

        let mut error = json!({
            "code": code,
            "message": message,
            "detail": detail,
            "field": field
        });
        if !fields.is_empty() {
            error["fields"] = serde_json::to_value(&fields).unwrap_or(Value::Null);
        }

        (status, Json(json!({ "ok": false, "error": error }))).into_response()
    }
}

pub fn ok(data: Value) -> Json<Value> {
    Json(json!({ "ok": true, "data": data }))
}
