// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 数据库连接层：sqlx AnyPool（SQLite / MySQL / PostgreSQL 同一套代码），负责
// URL 解析、SQLite 自动建目录与文件、启动探测，以及把底层错误翻译成中文排查提示。
// 任何日志/错误都只输出驱动名与 host:port/库名，绝不回显 URL 里的账号密码。
use std::io::ErrorKind;
use std::path::Path;
use std::str::FromStr;
use std::sync::Once;
use std::time::Duration;

use sqlx::any::{AnyConnectOptions, AnyPoolOptions};
use sqlx::AnyPool;

use crate::generated::config::Config;

static INIT_DRIVERS: Once = Once::new();

/// 数据库连接/迁移失败。code 只用于打印，不参与 HTTP 响应。
#[derive(Debug)]
pub struct DbFailure {
    pub code: &'static str,
    pub reason: String,
    pub hints: Vec<String>,
}

impl std::fmt::Display for DbFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.reason)
    }
}

impl std::error::Error for DbFailure {}

impl DbFailure {
    fn new(reason: impl Into<String>) -> Self {
        Self {
            code: "LC_E_DB_UNAVAILABLE",
            reason: reason.into(),
            hints: troubleshooting_hints(),
        }
    }

    /// 迁移失败：同样是退出码 1，但用独立错误码，便于和「连不上库」区分。
    pub fn migration(detail: impl std::fmt::Display) -> Self {
        Self {
            code: "LC_E_MIGRATION_FAILED",
            reason: format!("数据库迁移失败：{detail}"),
            hints: vec![
                "检查 migrations 目录是否随工程一起拷贝，且以 server/ 为启动目录。".to_string(),
                "确认数据库账号对目标库有建表 / ALTER 权限。".to_string(),
                "迁移按分号切分执行，SQL 字符串字面量里不要出现分号。".to_string(),
                "修好脚本后重新执行 `--migrate`；已成功应用的版本会自动跳过。".to_string(),
            ],
        }
    }
}

fn troubleshooting_hints() -> Vec<String> {
    vec![
        "确认数据库服务已启动：MySQL 看 `systemctl status mysql` / Windows 服务；PostgreSQL 用 `pg_isready`。".to_string(),
        "核对 host/port（MySQL 默认 3306，PostgreSQL 默认 5432），容器部署还要看端口映射。".to_string(),
        "核对账号密码；密码建议通过 LC_DB_PASSWORD / DATABASE_URL 环境变量注入，不要写进仓库。".to_string(),
        "目标库要先创建（MySQL `CREATE DATABASE <name>;`，PostgreSQL `createdb <name>`）；SQLite 会自动建文件。".to_string(),
        "检查防火墙/安全组是否放行；sslMode=require 时服务端必须已启用 TLS 且证书可验证。".to_string(),
    ]
}

/// 驱动只注册一次；重复调用是安全的。
pub fn install_drivers() {
    INIT_DRIVERS.call_once(|| sqlx::any::install_default_drivers());
}

struct ResolvedDb {
    driver: &'static str,
    url: String,
    display: String,
}

/// 建立连接池并做一次连通性探测。迁移由 migrate 模块单独执行。
pub async fn connect(config: &Config) -> Result<AnyPool, DbFailure> {
    install_drivers();

    let db = &config.database;
    let resolved = resolve(config)?;
    let options = AnyConnectOptions::from_str(&resolved.url)
        .map_err(|_| DbFailure::new("数据库连接串或驱动配置无效"))?;

    let max_connections = if resolved.driver == "sqlite" && resolved.url.contains(":memory:") {
        1
    } else {
        db.max_open_conns
    };

    let pool = AnyPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(u64::from(db.connect_timeout_seconds)))
        .connect_with(options)
        .await
        .map_err(|err| failure(&err, &resolved))?;

    // 连接池可能延迟建连，这里强制探测一次，把认证/库不存在等错误提前暴露。
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|err| failure(&err, &resolved))?;

    tracing::info!(database = %resolved.display, "数据库连接成功");
    Ok(pool)
}

fn resolve(config: &Config) -> Result<ResolvedDb, DbFailure> {
    let db = &config.database;
    let raw = db.url.trim();

    if raw.is_empty() {
        return build_from_fields(config);
    }

    if db.effective_driver() == "sqlite" {
        let url = sqlite_url(raw)?;
        let path = sqlite_path(raw).unwrap_or_else(|| ":memory:".to_string());
        return Ok(ResolvedDb {
            driver: "sqlite",
            url,
            display: format!("sqlite {path}"),
        });
    }

    Ok(ResolvedDb {
        driver: db.effective_driver(),
        display: describe_url(raw, db.effective_driver()),
        url: raw.to_string(),
    })
}

fn build_from_fields(config: &Config) -> Result<ResolvedDb, DbFailure> {
    let db = &config.database;
    let driver = db.effective_driver();
    let host = db.host.trim();

    if driver == "sqlite" {
        let name = db.name.trim();
        let raw = format!("sqlite://data/{name}.db");
        let url = sqlite_url(&raw)?;
        return Ok(ResolvedDb {
            driver,
            display: format!("sqlite data/{name}.db"),
            url,
        });
    }

    let port = if db.port == 0 {
        if driver == "mysql" {
            3306
        } else {
            5432
        }
    } else {
        db.port
    };
    let host_part = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let user = encode_component(db.user.trim());
    let password = encode_component(&db.password);
    let name = encode_component(db.name.trim());

    let authority = if user.is_empty() {
        format!("{host_part}:{port}")
    } else if db.password.is_empty() {
        format!("{user}@{host_part}:{port}")
    } else {
        format!("{user}:{password}@{host_part}:{port}")
    };

    let url = if driver == "mysql" {
        let ssl = if db.ssl_mode.trim() == "require" {
            "required"
        } else {
            "disabled"
        };
        format!("mysql://{authority}/{name}?ssl-mode={ssl}")
    } else {
        let ssl = db.ssl_mode.trim();
        format!("postgres://{authority}/{name}?sslmode={ssl}")
    };

    Ok(ResolvedDb {
        driver,
        display: format!("{driver} {host}:{port}/{name}"),
        url,
    })
}

/// SQLite 需要显式 `mode=rwc` 才会自动建库文件；目录由我们提前创建。
fn sqlite_url(raw: &str) -> Result<String, DbFailure> {
    if raw == "sqlite::memory:" || raw.starts_with("sqlite::memory:?") {
        return Ok(raw.to_string());
    }

    let path =
        sqlite_path(raw).ok_or_else(|| DbFailure::new("database.url 缺少 SQLite 文件路径"))?;
    if path == ":memory:" {
        return Ok("sqlite::memory:".to_string());
    }

    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                DbFailure::new(format!(
                    "创建 SQLite 目录失败：{}（{err}）",
                    parent.display()
                ))
            })?;
        }
    }

    let query = raw.split_once('?').map(|(_, query)| query).unwrap_or("");
    let has_mode = query.split('&').any(|pair| pair.starts_with("mode="));
    // 必须用单冒号 `sqlite:<path>`：AnyPool 会先把 URL 交给 WHATWG 解析器，
    // `sqlite://C:/...` 里的盘符会被当成 host 丢掉冒号（变成相对路径 C/... 而打不开库）。
    if query.is_empty() {
        Ok(format!("sqlite:{path}?mode=rwc"))
    } else if has_mode {
        Ok(format!("sqlite:{path}?{query}"))
    } else {
        Ok(format!("sqlite:{path}?{query}&mode=rwc"))
    }
}

fn sqlite_path(raw: &str) -> Option<String> {
    let rest = raw
        .strip_prefix("sqlite://")
        .or_else(|| raw.strip_prefix("sqlite:"))
        .unwrap_or(raw);
    let path = rest.split('?').next().unwrap_or("").trim();
    if path == ":memory:" {
        Some(":memory:".to_string())
    } else if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// 只用于日志的安全描述：丢弃 userinfo，只保留 driver host:port/库名。
fn describe_url(url: &str, driver: &str) -> String {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let without_query = rest.split('?').next().unwrap_or(rest);
    let (authority, name) = without_query.split_once('/').unwrap_or((without_query, ""));
    let host_port = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    format!("{driver} {host_port}/{name}")
}

fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn failure(err: &sqlx::Error, resolved: &ResolvedDb) -> DbFailure {
    let reason = match err {
        sqlx::Error::Io(io) => match io.kind() {
            ErrorKind::ConnectionRefused => "数据库拒绝连接（连接被拒绝）".to_string(),
            ErrorKind::TimedOut => "连接数据库超时".to_string(),
            _ => "数据库连接中断".to_string(),
        },
        sqlx::Error::PoolTimedOut => "连接数据库超时（连接池等待超时）".to_string(),
        sqlx::Error::Tls(_) => "数据库 TLS 握手失败".to_string(),
        sqlx::Error::Configuration(_) => "数据库连接串或驱动配置无效".to_string(),
        sqlx::Error::Database(db_err) => match db_err.code().as_deref() {
            Some("1049") => "目标数据库不存在（MySQL 1049）".to_string(),
            Some("1045") => "数据库认证失败（MySQL 1045，账号或密码错误）".to_string(),
            Some("3D000") => "目标数据库不存在（PostgreSQL 3D000）".to_string(),
            Some("28P01") | Some("28000") => {
                "数据库认证失败（PostgreSQL 28P01，账号或密码错误）".to_string()
            }
            Some(code) if code.starts_with("08") => "数据库连接中断（SQLSTATE 08 类）".to_string(),
            Some(code) => format!("数据库返回错误（错误码 {code}）"),
            None => "数据库返回错误".to_string(),
        },
        _ => "连接数据库失败".to_string(),
    };

    tracing::error!(
        database = %resolved.display,
        reason = %reason,
        "数据库不可用"
    );

    DbFailure::new(format!("{}（{}）", reason, resolved.display))
}

/// 运行时判断是否属于「数据库不可用」，用于把 500 改成 503。
pub fn is_unavailable(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed => true,
        sqlx::Error::Database(db_err) => match db_err.code().as_deref() {
            Some("1049") | Some("1045") | Some("3D000") | Some("28P01") | Some("28000") => true,
            Some(code) => code.starts_with("08"),
            None => false,
        },
        _ => false,
    }
}

/// 日志里使用的安全错误描述：不输出可能带连接串的 Configuration 原文。
pub fn safe_message(err: &sqlx::Error) -> String {
    match err {
        sqlx::Error::Configuration(_) => "数据库连接串或驱动配置无效".to_string(),
        sqlx::Error::Database(db_err) => match db_err.code() {
            Some(code) => format!("数据库返回错误码 {code}"),
            None => "数据库返回错误".to_string(),
        },
        other => other.to_string(),
    }
}

/// 源码统一写 `?` 占位符；PostgreSQL 原生只认 `$1/$2`，这里做一次轻量适配。
pub fn adapt_sql(pool: &AnyPool, sql: &str) -> String {
    let scheme = pool.connect_options().database_url.scheme().to_string();
    if matches!(scheme.as_str(), "postgres" | "postgresql") {
        rewrite_placeholders(sql)
    } else {
        sql.to_string()
    }
}

fn rewrite_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 8);
    let mut index = 0usize;
    let mut in_single_quote = false;
    for ch in sql.chars() {
        match ch {
            '\'' => {
                in_single_quote = !in_single_quote;
                out.push(ch);
            }
            '?' if !in_single_quote => {
                index += 1;
                out.push('$');
                out.push_str(&index.to_string());
            }
            _ => out.push(ch),
        }
    }
    out
}
