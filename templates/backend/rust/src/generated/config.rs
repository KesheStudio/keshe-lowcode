// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 要改业务逻辑请去 src/custom/；要加接口请改 src/custom/routes.rs。
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug)]
pub struct ConfigError(pub String);

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ConfigError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub schema_version: u32,
    pub language: String,
    pub maturity: String,
    pub strict: bool,
    #[serde(rename = "override")]
    pub override_flag: bool,
    pub host: String,
    pub port: u16,
    pub log_level: String,
    pub cors: CorsConfig,
    pub database: DatabaseConfig,
    pub cache: CacheConfig,
    pub middleware: MiddlewareConfig,
    #[serde(rename = "static")]
    pub static_files: StaticConfig,
    pub auth: AuthConfig,
    pub data_api: DataApiConfig,
    pub config_center: crate::generated::config_center::ConfigCenterConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 1,
            language: "rust".to_string(),
            maturity: "full".to_string(),
            strict: true,
            override_flag: false,
            host: "127.0.0.1".to_string(),
            port: 8080,
            log_level: "info".to_string(),
            cors: CorsConfig::default(),
            database: DatabaseConfig::default(),
            cache: CacheConfig::default(),
            middleware: MiddlewareConfig::default(),
            static_files: StaticConfig::default(),
            auth: AuthConfig::default(),
            data_api: DataApiConfig::default(),
            config_center: crate::generated::config_center::ConfigCenterConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CorsConfig {
    pub enabled: bool,
    pub origins: Vec<String>,
    pub methods: Vec<String>,
    pub headers: Vec<String>,
    pub credentials: bool,
    pub max_age: u32,
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            origins: Vec::new(),
            methods: vec![
                "GET".to_string(),
                "POST".to_string(),
                "PUT".to_string(),
                "DELETE".to_string(),
                "OPTIONS".to_string(),
            ],
            headers: vec![
                "content-type".to_string(),
                "authorization".to_string(),
                "x-request-id".to_string(),
            ],
            credentials: false,
            max_age: 600,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DatabaseConfig {
    pub driver: String,
    pub url: String,
    pub host: String,
    pub port: u16,
    pub name: String,
    pub user: String,
    pub password: String,
    pub ssl_mode: String,
    pub max_open_conns: u32,
    pub connect_timeout_seconds: u32,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            driver: "sqlite".to_string(),
            url: "sqlite://data/app.db".to_string(),
            host: "127.0.0.1".to_string(),
            port: 0,
            name: "app".to_string(),
            user: String::new(),
            password: String::new(),
            ssl_mode: "disable".to_string(),
            max_open_conns: 10,
            connect_timeout_seconds: 5,
        }
    }
}

impl DatabaseConfig {
    /// url 非空时由 scheme 决定实际驱动；url 为空时退回 driver 字段。
    pub fn effective_driver(&self) -> &'static str {
        let url = self.url.trim();
        if !url.is_empty() {
            if url.starts_with("sqlite:") {
                return "sqlite";
            }
            if url.starts_with("mysql:") {
                return "mysql";
            }
            if url.starts_with("postgres:") || url.starts_with("postgresql:") {
                return "postgres";
            }
        }
        match self.driver.trim() {
            "mysql" => "mysql",
            "postgres" => "postgres",
            _ => "sqlite",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CacheConfig {
    pub enabled: bool,
    pub fallback: String,
    pub driver: String,
    pub url: String,
    pub ttl_seconds: u32,
    pub key_prefix: String,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            fallback: "memory".to_string(),
            driver: "memory".to_string(),
            url: "redis://127.0.0.1:16379/0".to_string(),
            ttl_seconds: 30,
            key_prefix: "lc:".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MiddlewareConfig {
    pub request_id: bool,
    pub logging: bool,
    pub body_limit: BodyLimitConfig,
    pub timeout: TimeoutConfig,
    pub concurrency: ConcurrencyConfig,
    pub compression: CompressionConfig,
    pub rate_limit: RateLimitConfig,
    pub static_cache: StaticCacheConfig,
    pub health: HealthConfig,
    pub security_headers: SecurityHeadersConfig,
    pub builtin: crate::generated::builtin::BuiltinMiddlewareConfig,
}

impl Default for MiddlewareConfig {
    fn default() -> Self {
        Self {
            request_id: true,
            logging: true,
            body_limit: BodyLimitConfig::default(),
            timeout: TimeoutConfig::default(),
            concurrency: ConcurrencyConfig::default(),
            compression: CompressionConfig::default(),
            rate_limit: RateLimitConfig::default(),
            static_cache: StaticCacheConfig::default(),
            health: HealthConfig::default(),
            security_headers: SecurityHeadersConfig::default(),
            builtin: crate::generated::builtin::BuiltinMiddlewareConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BodyLimitConfig {
    pub enabled: bool,
    pub max_bytes: u64,
}

impl Default for BodyLimitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_bytes: 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TimeoutConfig {
    pub enabled: bool,
    pub seconds: u32,
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            seconds: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConcurrencyConfig {
    pub enabled: bool,
    pub max_in_flight: u32,
}

impl Default for ConcurrencyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_in_flight: 64,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompressionConfig {
    pub enabled: bool,
    pub gzip: bool,
    pub brotli: bool,
    pub min_bytes: u32,
}

impl Default for CompressionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            gzip: true,
            brotli: true,
            min_bytes: 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RateLimitConfig {
    pub enabled: bool,
    pub rps: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            rps: 20,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StaticCacheConfig {
    pub enabled: bool,
    pub max_age_seconds: u64,
    pub immutable_max_age_seconds: u64,
}

impl Default for StaticCacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_age_seconds: 3600,
            immutable_max_age_seconds: 31536000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HealthConfig {
    pub enabled: bool,
    pub readiness_requires_database: bool,
    pub readiness_requires_cache: bool,
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            readiness_requires_database: true,
            readiness_requires_cache: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SecurityHeadersConfig {
    pub enabled: bool,
    pub hsts: HstsConfig,
    pub content_type_options: String,
    pub frame_options: String,
    pub referrer_policy: String,
    pub permissions_policy: String,
    pub cross_origin_opener_policy: String,
}

impl Default for SecurityHeadersConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            hsts: HstsConfig::default(),
            content_type_options: "nosniff".to_string(),
            frame_options: "SAMEORIGIN".to_string(),
            referrer_policy: "strict-origin-when-cross-origin".to_string(),
            permissions_policy: "geolocation=(), microphone=(), camera=()".to_string(),
            cross_origin_opener_policy: "same-origin".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HstsConfig {
    pub enabled: bool,
    pub max_age_seconds: u64,
    pub include_subdomains: bool,
    pub preload: bool,
}

impl Default for HstsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_age_seconds: 31536000,
            include_subdomains: true,
            preload: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StaticConfig {
    pub enabled: bool,
    pub root: String,
}

impl Default for StaticConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            root: "../web".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AuthConfig {
    pub token_mode: String,
    pub jwt_secret: String,
    pub access_token_ttl_seconds: u32,
    pub refresh_token_ttl_seconds: u32,
    pub session_ttl_seconds: u32,
    pub max_login_failures: u32,
    pub failure_window_seconds: u32,
    pub lock_seconds: u32,
    pub bootstrap: BootstrapConfig,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            token_mode: "jwt".to_string(),
            jwt_secret: String::new(),
            access_token_ttl_seconds: 900,
            refresh_token_ttl_seconds: 604800,
            session_ttl_seconds: 28800,
            max_login_failures: 5,
            failure_window_seconds: 300,
            lock_seconds: 900,
            bootstrap: BootstrapConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BootstrapConfig {
    pub username: String,
    pub password: String,
    pub role: String,
}

impl Default for BootstrapConfig {
    fn default() -> Self {
        Self {
            username: String::new(),
            password: String::new(),
            role: "admin".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DataApiConfig {
    pub enabled: bool,
    pub public_read: bool,
    pub write_requires_auth: bool,
    pub write_roles: Vec<String>,
    pub max_page_size: u32,
    pub collections_dir: String,
}

impl Default for DataApiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            public_read: true,
            write_requires_auth: true,
            write_roles: Vec::new(),
            max_page_size: 100,
            collections_dir: "../web/data/collections".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSources {
    pub generated: Option<String>,
    pub user: Option<String>,
    pub overridden: bool,
    pub env: Vec<String>,
    pub cli: Vec<String>,
}

#[derive(Debug)]
pub struct LoadedConfig {
    pub config: Config,
    pub config_center: crate::generated::config_center::ConfigCenter,
    pub builtin_runtime: crate::generated::builtin::BuiltinRuntime,
    pub warnings: Vec<String>,
    pub sources: ConfigSources,
    pub migrate: bool,
    pub migrate_down: bool,
}

#[derive(Default)]
struct Cli {
    host: Option<String>,
    port: Option<String>,
    log_level: Option<String>,
    config: Option<String>,
    body_limit_bytes: Option<String>,
    timeout_seconds: Option<String>,
    cache_enabled: Option<String>,
    cfg_overrides: Vec<(String, String)>,
    override_flag: bool,
    migrate: bool,
    migrate_down: bool,
}

// ---------------------------------------------------------------- 加载入口

pub fn load() -> Result<LoadedConfig, ConfigError> {
    let args: Vec<String> = env::args().collect();
    let env_map: HashMap<String, String> = env::vars().collect();
    load_with(&args, &env_map, Path::new("."))
}

pub fn load_with(
    args: &[String],
    env_map: &HashMap<String, String>,
    cwd: &Path,
) -> Result<LoadedConfig, ConfigError> {
    let cli = parse_cli(args)?;
    let config_path = resolve_config_path(&cli, env_map, cwd)?;
    let mut sources = ConfigSources::default();
    let mut warnings = Vec::new();

    let user_raw = read_if_exists(&config_path)?;
    let user_value = match &user_raw {
        Some(text) => parse_config_text(text, &config_path)?,
        None => Value::Object(Map::new()),
    };

    let env_override = env_bool(env_map, "LC_OVERRIDE")?.unwrap_or(false);
    let user_override = user_value
        .get("override")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let override_flag = cli.override_flag || env_override || user_override;
    sources.overridden = override_flag;

    let mut base = serde_json::to_value(Config::default())
        .map_err(|err| ConfigError(format!("内置默认配置序列化失败：{err}")))?;
    let mut generated_value = Value::Object(Map::new());
    let user_for_center = user_value.clone();

    let generated_path = first_existing(&[
        config_path
            .parent()
            .unwrap_or(cwd)
            .join("config.generated.yaml"),
        config_path
            .parent()
            .unwrap_or(cwd)
            .join("config.generated.json"),
    ]);
    if !override_flag {
        if let Some(path) = &generated_path {
            let text = read_if_exists(path)?
                .ok_or_else(|| ConfigError(format!("生成配置读取失败：{}", path.display())))?;
            let value = parse_config_text(&text, path)?;
            merge(&mut base, value.clone());
            generated_value = value;
            sources.generated = Some(path.display().to_string());
        }
    }
    if user_raw.is_some() {
        merge(&mut base, user_value);
        sources.user = Some(config_path.display().to_string());
    }

    normalize_middleware_shapes(&mut base, &mut warnings);

    let strict = base.get("strict").and_then(Value::as_bool).unwrap_or(true);
    check_unknown_keys(&base, strict, &mut warnings)?;
    check_types(&base)?;

    let mut config: Config = serde_json::from_value(base)
        .map_err(|err| ConfigError(format!("配置结构与字段类型不匹配：{err}")))?;

    apply_env(&mut config, env_map, &mut sources.env)?;
    apply_cli(&mut config, &cli, &mut sources.cli)?;

    let mut config_center = crate::generated::config_center::build(
        &config.config_center,
        &generated_value,
        &user_for_center,
        env_map,
        &cli.cfg_overrides,
        &mut warnings,
    )?;
    let builtin_runtime = crate::generated::builtin::apply(
        &mut config,
        &generated_value,
        &user_for_center,
        env_map,
        &cli.cfg_overrides,
        &mut warnings,
        &mut config_center,
    )?;

    validate(&config)?;

    let effective_driver = config.database.effective_driver();
    if !config.database.url.trim().is_empty() && config.database.driver.trim() != effective_driver {
        warnings.push(format!(
            "database.url 的 scheme 决定实际驱动为 {effective_driver}，已忽略 database.driver={}",
            config.database.driver
        ));
    }

    if config.language != "rust" {
        warnings.push(format!(
            "配置文件声明 language={}，与本模板 rust 不一致；运行时以模板为准",
            config.language
        ));
    }
    config.language = "rust".to_string();
    config.maturity = "full".to_string();

    Ok(LoadedConfig {
        config,
        config_center,
        builtin_runtime,
        warnings,
        sources,
        migrate: cli.migrate,
        migrate_down: cli.migrate_down,
    })
}

fn normalize_middleware_shapes(base: &mut Value, warnings: &mut Vec<String>) {
    let defaults = [
        (
            "compression",
            serde_json::to_value(CompressionConfig::default()).unwrap_or(Value::Null),
        ),
        (
            "securityHeaders",
            serde_json::to_value(SecurityHeadersConfig::default()).unwrap_or(Value::Null),
        ),
    ];
    let Some(middleware) = base.get_mut("middleware").and_then(Value::as_object_mut) else {
        return;
    };
    for (key, default_object) in defaults {
        let Some(value) = middleware.get_mut(key) else {
            continue;
        };
        if let Value::Bool(flag) = *value {
            let mut object = default_object;
            if let Value::Object(map) = &mut object {
                map.insert("enabled".to_string(), Value::Bool(flag));
            }
            warnings.push(format!(
                "middleware.{key} 使用了简写布尔值，已规范化为 {{ enabled: {flag} }} 并套用默认参数"
            ));
            *value = object;
        }
    }

    // 关闭的内置组直接丢弃 config 内容：既避免残留键触发反序列化错误，也保证不会尝试连接。
    if let Some(builtin) = middleware.get_mut("builtin").and_then(Value::as_object_mut) {
        for value in builtin.values_mut() {
            if let Value::Object(entry) = value {
                let enabled = entry
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !enabled {
                    entry.insert("config".to_string(), Value::Object(Map::new()));
                }
            }
        }
    }
}

fn parse_cli(args: &[String]) -> Result<Cli, ConfigError> {
    let mut cli = Cli::default();
    let mut index = 1;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--override" {
            cli.override_flag = true;
            index += 1;
            continue;
        }
        if arg == "--migrate" {
            cli.migrate = true;
            index += 1;
            continue;
        }
        if arg == "--migrate-down" {
            cli.migrate_down = true;
            index += 1;
            continue;
        }
        if !arg.starts_with("--") {
            return Err(ConfigError(format!("无法识别的启动参数：{arg}")));
        }
        let body = &arg[2..];
        let (key, inline) = match body.split_once('=') {
            Some((key, value)) => (key, Some(value.to_string())),
            None => (body, None),
        };
        let allowed = [
            "host",
            "port",
            "log-level",
            "config",
            "body-limit-bytes",
            "timeout-seconds",
            "cache-enabled",
            "cfg",
        ];
        if !allowed.contains(&key) {
            return Err(ConfigError(format!(
                "未知启动参数：{arg}，可用：--host --port --log-level --config --body-limit-bytes --timeout-seconds --cache-enabled --cfg KEY=VALUE --override --migrate --migrate-down"
            )));
        }
        let has_inline = inline.is_some();
        let value = match inline {
            Some(value) if !value.is_empty() => value,
            Some(_) => {
                return Err(ConfigError(format!("启动参数 {arg} 缺少值")));
            }
            None => args
                .get(index + 1)
                .filter(|v| !v.starts_with("--"))
                .cloned()
                .ok_or_else(|| ConfigError(format!("启动参数 {arg} 缺少值")))?,
        };
        let consumed = if has_inline { 1 } else { 2 };
        match key {
            "host" => cli.host = Some(value),
            "port" => cli.port = Some(value),
            "log-level" => cli.log_level = Some(value),
            "config" => cli.config = Some(value),
            "body-limit-bytes" => cli.body_limit_bytes = Some(value),
            "timeout-seconds" => cli.timeout_seconds = Some(value),
            "cache-enabled" => cli.cache_enabled = Some(value),
            "cfg" => {
                let (name, raw) = value.split_once('=').ok_or_else(|| {
                    ConfigError(format!("--cfg 必须是 KEY=VALUE 形式，收到：{value}"))
                })?;
                if name.trim().is_empty() {
                    return Err(ConfigError("--cfg 的 KEY 不能为空".to_string()));
                }
                cli.cfg_overrides
                    .push((name.trim().to_string(), raw.to_string()));
            }
            _ => unreachable!(),
        }
        index += consumed;
    }
    if cli.migrate && cli.migrate_down {
        return Err(ConfigError(
            "--migrate 与 --migrate-down 不能同时使用".to_string(),
        ));
    }
    Ok(cli)
}

fn resolve_config_path(
    cli: &Cli,
    env_map: &HashMap<String, String>,
    cwd: &Path,
) -> Result<PathBuf, ConfigError> {
    if let Some(explicit) = cli
        .config
        .as_ref()
        .or_else(|| env_map.get("LC_CONFIG_FILE"))
    {
        let resolved = cwd.join(explicit);
        if !resolved.exists() {
            return Err(ConfigError(format!(
                "指定的配置文件不存在：{}",
                resolved.display()
            )));
        }
        return Ok(resolved);
    }
    let deploy_dir = cwd.join("..").join("deploy").join("backend");
    if deploy_dir.exists() {
        return Ok(deploy_dir.join("config.yaml"));
    }
    Ok(cwd.join("config.yaml"))
}

fn read_if_exists(path: &Path) -> Result<Option<String>, ConfigError> {
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(|text| Some(text.trim_start_matches('\u{FEFF}').to_string()))
        .map_err(|err| ConfigError(format!("读取配置失败 {}：{err}", path.display())))
}

fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|p| p.exists()).cloned()
}

// ---------------------------------------------------------------- 环境变量 / 启动参数

fn apply_env(
    config: &mut Config,
    env_map: &HashMap<String, String>,
    used: &mut Vec<String>,
) -> Result<(), ConfigError> {
    if let Some(value) = non_empty(env_map, "LC_HOST") {
        config.host = value.to_string();
        used.push("LC_HOST".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_PORT") {
        config.port = value
            .parse::<u16>()
            .map_err(|_| ConfigError(format!("LC_PORT 必须是 1024-65535 的整数，收到：{value}")))?;
        used.push("LC_PORT".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_LOG_LEVEL") {
        config.log_level = value.to_string();
        used.push("LC_LOG_LEVEL".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_CORS_ORIGINS") {
        config.cors.origins = value
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        used.push("LC_CORS_ORIGINS".to_string());
    }
    if let Some(value) = non_empty(env_map, "DATABASE_URL") {
        config.database.url = value.to_string();
        used.push("DATABASE_URL".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_DRIVER") {
        config.database.driver = value.to_string();
        used.push("LC_DB_DRIVER".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_HOST") {
        config.database.host = value.to_string();
        used.push("LC_DB_HOST".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_PORT") {
        config.database.port = value
            .parse::<u16>()
            .map_err(|_| ConfigError(format!("LC_DB_PORT 必须是 0-65535 的整数，收到：{value}")))?;
        used.push("LC_DB_PORT".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_NAME") {
        config.database.name = value.to_string();
        used.push("LC_DB_NAME".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_USER") {
        config.database.user = value.to_string();
        used.push("LC_DB_USER".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_PASSWORD") {
        config.database.password = value.to_string();
        // 只记录变量名，绝不把密码写进日志或 sources。
        used.push("LC_DB_PASSWORD".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_SSL_MODE") {
        config.database.ssl_mode = value.to_string();
        used.push("LC_DB_SSL_MODE".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_MAX_OPEN_CONNS") {
        config.database.max_open_conns = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_DB_MAX_OPEN_CONNS 必须是 1-100 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_DB_MAX_OPEN_CONNS".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DB_CONNECT_TIMEOUT") {
        config.database.connect_timeout_seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_DB_CONNECT_TIMEOUT 必须是 1-60 的整数（秒），收到：{value}"
            ))
        })?;
        used.push("LC_DB_CONNECT_TIMEOUT".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_CACHE_DRIVER") {
        config.cache.driver = value.to_string();
        used.push("LC_CACHE_DRIVER".to_string());
    }
    if let Some(value) = non_empty(env_map, "REDIS_URL") {
        config.cache.url = value.to_string();
        used.push("REDIS_URL".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_CACHE_TTL_SECONDS") {
        config.cache.ttl_seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_CACHE_TTL_SECONDS 必须是 1-86400 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_CACHE_TTL_SECONDS".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_CACHE_ENABLED")? {
        config.cache.enabled = value;
        used.push("LC_CACHE_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_CACHE_FALLBACK") {
        config.cache.fallback = value.to_string();
        used.push("LC_CACHE_FALLBACK".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_REQUEST_ID")? {
        config.middleware.request_id = value;
        used.push("LC_MW_REQUEST_ID".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_LOGGING")? {
        config.middleware.logging = value;
        used.push("LC_MW_LOGGING".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_BODY_LIMIT_ENABLED")? {
        config.middleware.body_limit.enabled = value;
        used.push("LC_MW_BODY_LIMIT_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_MW_BODY_LIMIT_BYTES") {
        config.middleware.body_limit.max_bytes = value.parse::<u64>().map_err(|_| {
            ConfigError(format!(
                "LC_MW_BODY_LIMIT_BYTES 必须是 1024-268435456 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_MW_BODY_LIMIT_BYTES".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_TIMEOUT_ENABLED")? {
        config.middleware.timeout.enabled = value;
        used.push("LC_MW_TIMEOUT_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_MW_TIMEOUT_SECONDS") {
        config.middleware.timeout.seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_MW_TIMEOUT_SECONDS 必须是 1-600 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_MW_TIMEOUT_SECONDS".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_CONCURRENCY_ENABLED")? {
        config.middleware.concurrency.enabled = value;
        used.push("LC_MW_CONCURRENCY_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_MW_MAX_IN_FLIGHT") {
        config.middleware.concurrency.max_in_flight = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_MW_MAX_IN_FLIGHT 必须是 1-10000 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_MW_MAX_IN_FLIGHT".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_COMPRESSION_ENABLED")? {
        config.middleware.compression.enabled = value;
        used.push("LC_MW_COMPRESSION_ENABLED".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_COMPRESSION_GZIP")? {
        config.middleware.compression.gzip = value;
        used.push("LC_MW_COMPRESSION_GZIP".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_COMPRESSION_BROTLI")? {
        config.middleware.compression.brotli = value;
        used.push("LC_MW_COMPRESSION_BROTLI".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_RATE_LIMIT_ENABLED")? {
        config.middleware.rate_limit.enabled = value;
        used.push("LC_MW_RATE_LIMIT_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_MW_RATE_LIMIT_RPS") {
        config.middleware.rate_limit.rps = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_MW_RATE_LIMIT_RPS 必须是 1-10000 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_MW_RATE_LIMIT_RPS".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_STATIC_CACHE_ENABLED")? {
        config.middleware.static_cache.enabled = value;
        used.push("LC_MW_STATIC_CACHE_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_MW_STATIC_MAX_AGE") {
        config.middleware.static_cache.max_age_seconds = value.parse::<u64>().map_err(|_| {
            ConfigError(format!(
                "LC_MW_STATIC_MAX_AGE 必须是 0-31536000 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_MW_STATIC_MAX_AGE".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_HEALTH_ENABLED")? {
        config.middleware.health.enabled = value;
        used.push("LC_MW_HEALTH_ENABLED".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_SECURITY_HEADERS_ENABLED")? {
        config.middleware.security_headers.enabled = value;
        used.push("LC_MW_SECURITY_HEADERS_ENABLED".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_MW_HSTS_ENABLED")? {
        config.middleware.security_headers.hsts.enabled = value;
        used.push("LC_MW_HSTS_ENABLED".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_STATIC_ENABLED")? {
        config.static_files.enabled = value;
        used.push("LC_STATIC_ENABLED".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_TOKEN_MODE") {
        config.auth.token_mode = value.to_string();
        used.push("LC_AUTH_TOKEN_MODE".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_JWT_SECRET") {
        config.auth.jwt_secret = value.to_string();
        used.push("LC_AUTH_JWT_SECRET".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_ACCESS_TTL_SECONDS") {
        config.auth.access_token_ttl_seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_AUTH_ACCESS_TTL_SECONDS 必须是整数，收到：{value}"
            ))
        })?;
        used.push("LC_AUTH_ACCESS_TTL_SECONDS".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_REFRESH_TTL_SECONDS") {
        config.auth.refresh_token_ttl_seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_AUTH_REFRESH_TTL_SECONDS 必须是整数，收到：{value}"
            ))
        })?;
        used.push("LC_AUTH_REFRESH_TTL_SECONDS".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_SESSION_TTL_SECONDS") {
        config.auth.session_ttl_seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_AUTH_SESSION_TTL_SECONDS 必须是整数，收到：{value}"
            ))
        })?;
        used.push("LC_AUTH_SESSION_TTL_SECONDS".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_MAX_LOGIN_FAILURES") {
        config.auth.max_login_failures = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_AUTH_MAX_LOGIN_FAILURES 必须是整数，收到：{value}"
            ))
        })?;
        used.push("LC_AUTH_MAX_LOGIN_FAILURES".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_LOCK_SECONDS") {
        config.auth.lock_seconds = value
            .parse::<u32>()
            .map_err(|_| ConfigError(format!("LC_AUTH_LOCK_SECONDS 必须是整数，收到：{value}")))?;
        used.push("LC_AUTH_LOCK_SECONDS".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_BOOTSTRAP_USERNAME") {
        config.auth.bootstrap.username = value.to_string();
        used.push("LC_AUTH_BOOTSTRAP_USERNAME".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_BOOTSTRAP_PASSWORD") {
        config.auth.bootstrap.password = value.to_string();
        used.push("LC_AUTH_BOOTSTRAP_PASSWORD".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_AUTH_BOOTSTRAP_ROLE") {
        config.auth.bootstrap.role = value.to_string();
        used.push("LC_AUTH_BOOTSTRAP_ROLE".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_DATA_API_ENABLED")? {
        config.data_api.enabled = value;
        used.push("LC_DATA_API_ENABLED".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_DATA_PUBLIC_READ")? {
        config.data_api.public_read = value;
        used.push("LC_DATA_PUBLIC_READ".to_string());
    }
    if let Some(value) = env_bool(env_map, "LC_DATA_WRITE_REQUIRES_AUTH")? {
        config.data_api.write_requires_auth = value;
        used.push("LC_DATA_WRITE_REQUIRES_AUTH".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DATA_WRITE_ROLES") {
        config.data_api.write_roles = value
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        used.push("LC_DATA_WRITE_ROLES".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DATA_MAX_PAGE_SIZE") {
        config.data_api.max_page_size = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "LC_DATA_MAX_PAGE_SIZE 必须是 1-1000 的整数，收到：{value}"
            ))
        })?;
        used.push("LC_DATA_MAX_PAGE_SIZE".to_string());
    }
    if let Some(value) = non_empty(env_map, "LC_DATA_COLLECTIONS_DIR") {
        config.data_api.collections_dir = value.to_string();
        used.push("LC_DATA_COLLECTIONS_DIR".to_string());
    }
    Ok(())
}

fn apply_cli(config: &mut Config, cli: &Cli, used: &mut Vec<String>) -> Result<(), ConfigError> {
    if let Some(host) = &cli.host {
        config.host = host.clone();
        used.push("--host".to_string());
    }
    if let Some(port) = &cli.port {
        config.port = port
            .parse::<u16>()
            .map_err(|_| ConfigError(format!("--port 必须是 1024-65535 的整数，收到：{port}")))?;
        used.push("--port".to_string());
    }
    if let Some(level) = &cli.log_level {
        config.log_level = level.clone();
        used.push("--log-level".to_string());
    }
    if let Some(value) = &cli.body_limit_bytes {
        config.middleware.body_limit.enabled = true;
        config.middleware.body_limit.max_bytes = value.parse::<u64>().map_err(|_| {
            ConfigError(format!(
                "--body-limit-bytes 必须是 1024-268435456 的整数，收到：{value}"
            ))
        })?;
        used.push("--body-limit-bytes".to_string());
    }
    if let Some(value) = &cli.timeout_seconds {
        config.middleware.timeout.enabled = true;
        config.middleware.timeout.seconds = value.parse::<u32>().map_err(|_| {
            ConfigError(format!(
                "--timeout-seconds 必须是 1-600 的整数，收到：{value}"
            ))
        })?;
        used.push("--timeout-seconds".to_string());
    }
    if let Some(value) = &cli.cache_enabled {
        config.cache.enabled = parse_bool_text(value, "--cache-enabled")?;
        used.push("--cache-enabled".to_string());
    }
    if !cli.cfg_overrides.is_empty() {
        used.push("--cfg".to_string());
    }
    if cli.override_flag {
        config.override_flag = true;
        used.push("--override".to_string());
    }
    Ok(())
}

fn parse_bool_text(raw: &str, origin: &str) -> Result<bool, ConfigError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(ConfigError(format!(
            "{origin} 只能是 true/false，收到：{raw}"
        ))),
    }
}

fn non_empty<'a>(env_map: &'a HashMap<String, String>, key: &str) -> Option<&'a String> {
    env_map.get(key).filter(|v| !v.is_empty())
}

fn env_bool(env_map: &HashMap<String, String>, key: &str) -> Result<Option<bool>, ConfigError> {
    let Some(raw) = non_empty(env_map, key) else {
        return Ok(None);
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(Some(true)),
        "0" | "false" | "no" | "off" => Ok(Some(false)),
        _ => Err(ConfigError(format!("{key} 只能是 true/false，收到：{raw}"))),
    }
}

// ---------------------------------------------------------------- 校验

fn allowed_keys(path: &str) -> Option<&'static [&'static str]> {
    match path {
        "" => Some(&[
            "schemaVersion",
            "language",
            "maturity",
            "strict",
            "override",
            "host",
            "port",
            "logLevel",
            "cors",
            "database",
            "cache",
            "middleware",
            "static",
            "auth",
            "dataApi",
            "configCenter",
        ]),
        "cors" => Some(&[
            "enabled",
            "origins",
            "methods",
            "headers",
            "credentials",
            "maxAge",
        ]),
        "database" => Some(&[
            "driver",
            "url",
            "host",
            "port",
            "name",
            "user",
            "password",
            "sslMode",
            "maxOpenConns",
            "connectTimeoutSeconds",
        ]),
        "cache" => Some(&[
            "enabled",
            "fallback",
            "driver",
            "url",
            "ttlSeconds",
            "keyPrefix",
        ]),
        "middleware" => Some(&[
            "requestId",
            "logging",
            "bodyLimit",
            "timeout",
            "concurrency",
            "compression",
            "rateLimit",
            "staticCache",
            "health",
            "securityHeaders",
            "builtin",
        ]),
        "middleware.bodyLimit" => Some(&["enabled", "maxBytes"]),
        "middleware.timeout" => Some(&["enabled", "seconds"]),
        "middleware.concurrency" => Some(&["enabled", "maxInFlight"]),
        "middleware.compression" => Some(&["enabled", "gzip", "brotli", "minBytes"]),
        "middleware.rateLimit" => Some(&["enabled", "rps"]),
        "middleware.staticCache" => Some(&["enabled", "maxAgeSeconds", "immutableMaxAgeSeconds"]),
        "middleware.health" => Some(&[
            "enabled",
            "readinessRequiresDatabase",
            "readinessRequiresCache",
        ]),
        "middleware.securityHeaders" => Some(&[
            "enabled",
            "hsts",
            "contentTypeOptions",
            "frameOptions",
            "referrerPolicy",
            "permissionsPolicy",
            "crossOriginOpenerPolicy",
        ]),
        "middleware.securityHeaders.hsts" => {
            Some(&["enabled", "maxAgeSeconds", "includeSubdomains", "preload"])
        }
        "middleware.builtin" => Some(&[
            "postgres",
            "mysql",
            "sqlite",
            "redis",
            "objectStorage",
            "messageQueue",
            "search",
            "reverseProxy",
        ]),
        "middleware.builtin.postgres"
        | "middleware.builtin.mysql"
        | "middleware.builtin.sqlite"
        | "middleware.builtin.redis"
        | "middleware.builtin.objectStorage"
        | "middleware.builtin.messageQueue"
        | "middleware.builtin.search"
        | "middleware.builtin.reverseProxy" => Some(&["enabled", "config"]),
        // 关闭的内置组允许残留任意配置键，运行时直接丢弃；strict 不报未知。
        "middleware.builtin.postgres.config"
        | "middleware.builtin.mysql.config"
        | "middleware.builtin.sqlite.config"
        | "middleware.builtin.redis.config"
        | "middleware.builtin.objectStorage.config"
        | "middleware.builtin.messageQueue.config"
        | "middleware.builtin.search.config"
        | "middleware.builtin.reverseProxy.config" => None,
        "configCenter" => Some(&["definitions", "values"]),
        "configCenter.definitions" => {
            Some(&["key", "type", "default", "enum", "secret", "description"])
        }
        "configCenter.values" => None,
        "static" => Some(&["enabled", "root"]),
        "auth" => Some(&[
            "tokenMode",
            "jwtSecret",
            "accessTokenTtlSeconds",
            "refreshTokenTtlSeconds",
            "sessionTtlSeconds",
            "maxLoginFailures",
            "failureWindowSeconds",
            "lockSeconds",
            "bootstrap",
        ]),
        "auth.bootstrap" => Some(&["username", "password", "role"]),
        "dataApi" => Some(&[
            "enabled",
            "publicRead",
            "writeRequiresAuth",
            "writeRoles",
            "maxPageSize",
            "collectionsDir",
        ]),
        _ => None,
    }
}

fn check_unknown_keys(
    value: &Value,
    strict: bool,
    warnings: &mut Vec<String>,
) -> Result<(), ConfigError> {
    let mut unknown = Vec::new();
    collect_unknown(value, "", &mut unknown);
    if unknown.is_empty() {
        return Ok(());
    }
    if strict {
        return Err(ConfigError(format!("未知配置项：{}", unknown.join("、"))));
    }
    warnings.push(format!("未知配置项被忽略：{}", unknown.join("、")));
    Ok(())
}

fn collect_unknown(value: &Value, prefix: &str, out: &mut Vec<String>) {
    let Some(keys) = allowed_keys(prefix) else {
        return;
    };
    let Value::Object(map) = value else {
        return;
    };
    for (key, child) in map {
        let full = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        if !keys.contains(&key.as_str()) {
            out.push(full);
        } else {
            collect_unknown(child, &full, out);
        }
    }
}

fn check_types(base: &Value) -> Result<(), ConfigError> {
    require_int(base, "schemaVersion")?;
    require_bool(base, "strict")?;
    require_bool(base, "override")?;
    require_string(base, "host")?;
    require_int(base, "port")?;
    require_string(base, "logLevel")?;
    require_string(base, "language")?;
    require_string(base, "maturity")?;

    require_bool_path(base, "cors.enabled")?;
    require_bool_path(base, "cors.credentials")?;
    require_string_array(base, "cors.origins")?;
    require_string_array(base, "cors.methods")?;
    require_string_array(base, "cors.headers")?;
    require_int_path(base, "cors.maxAge")?;

    require_string_path(base, "database.driver")?;
    require_string_path(base, "database.url")?;
    require_string_path(base, "database.host")?;
    require_int_path(base, "database.port")?;
    require_string_path(base, "database.name")?;
    require_string_path(base, "database.user")?;
    require_string_path(base, "database.password")?;
    require_string_path(base, "database.sslMode")?;
    require_int_path(base, "database.maxOpenConns")?;
    require_int_path(base, "database.connectTimeoutSeconds")?;

    require_bool_path(base, "cache.enabled")?;
    require_string_path(base, "cache.fallback")?;
    require_string_path(base, "cache.driver")?;
    require_string_path(base, "cache.url")?;
    require_int_path(base, "cache.ttlSeconds")?;
    require_string_path(base, "cache.keyPrefix")?;

    require_bool_path(base, "middleware.requestId")?;
    require_bool_path(base, "middleware.logging")?;
    require_bool_path(base, "middleware.bodyLimit.enabled")?;
    require_int_path(base, "middleware.bodyLimit.maxBytes")?;
    require_bool_path(base, "middleware.timeout.enabled")?;
    require_int_path(base, "middleware.timeout.seconds")?;
    require_bool_path(base, "middleware.concurrency.enabled")?;
    require_int_path(base, "middleware.concurrency.maxInFlight")?;
    require_bool_path(base, "middleware.compression.enabled")?;
    require_bool_path(base, "middleware.compression.gzip")?;
    require_bool_path(base, "middleware.compression.brotli")?;
    require_int_path(base, "middleware.compression.minBytes")?;
    require_bool_path(base, "middleware.rateLimit.enabled")?;
    require_int_path(base, "middleware.rateLimit.rps")?;
    require_bool_path(base, "middleware.staticCache.enabled")?;
    require_int_path(base, "middleware.staticCache.maxAgeSeconds")?;
    require_int_path(base, "middleware.staticCache.immutableMaxAgeSeconds")?;
    require_bool_path(base, "middleware.health.enabled")?;
    require_bool_path(base, "middleware.health.readinessRequiresDatabase")?;
    require_bool_path(base, "middleware.health.readinessRequiresCache")?;
    require_bool_path(base, "middleware.securityHeaders.enabled")?;
    require_bool_path(base, "middleware.securityHeaders.hsts.enabled")?;
    require_int_path(base, "middleware.securityHeaders.hsts.maxAgeSeconds")?;
    require_bool_path(base, "middleware.securityHeaders.hsts.includeSubdomains")?;
    require_bool_path(base, "middleware.securityHeaders.hsts.preload")?;
    require_string_path(base, "middleware.securityHeaders.contentTypeOptions")?;
    require_string_path(base, "middleware.securityHeaders.frameOptions")?;
    require_string_path(base, "middleware.securityHeaders.referrerPolicy")?;
    require_string_path(base, "middleware.securityHeaders.permissionsPolicy")?;
    require_string_path(base, "middleware.securityHeaders.crossOriginOpenerPolicy")?;

    check_config_center_types(base)?;
    check_builtin_types(base)?;

    require_bool_path(base, "static.enabled")?;
    require_string_path(base, "static.root")?;

    require_string_path(base, "auth.tokenMode")?;
    require_string_path(base, "auth.jwtSecret")?;
    require_int_path(base, "auth.accessTokenTtlSeconds")?;
    require_int_path(base, "auth.refreshTokenTtlSeconds")?;
    require_int_path(base, "auth.sessionTtlSeconds")?;
    require_int_path(base, "auth.maxLoginFailures")?;
    require_int_path(base, "auth.failureWindowSeconds")?;
    require_int_path(base, "auth.lockSeconds")?;
    require_string_path(base, "auth.bootstrap.username")?;
    require_string_path(base, "auth.bootstrap.password")?;
    require_string_path(base, "auth.bootstrap.role")?;

    require_bool_path(base, "dataApi.enabled")?;
    require_bool_path(base, "dataApi.publicRead")?;
    require_bool_path(base, "dataApi.writeRequiresAuth")?;
    require_string_array(base, "dataApi.writeRoles")?;
    require_int_path(base, "dataApi.maxPageSize")?;
    require_string_path(base, "dataApi.collectionsDir")?;
    Ok(())
}

/// configCenter 允许 definitions/values 下自由出现任意 key，这里只约束结构；
/// 每一项的类型与业务无关，仅校验声明字段本身。
fn check_config_center_types(base: &Value) -> Result<(), ConfigError> {
    let Some(center) = value_at(base, "configCenter") else {
        return Ok(());
    };
    let Value::Object(map) = center else {
        return Err(ConfigError("configCenter 必须是对象".to_string()));
    };
    if let Some(definitions) = map.get("definitions") {
        let Value::Array(items) = definitions else {
            return Err(ConfigError(
                "configCenter.definitions 必须是列表".to_string(),
            ));
        };
        for (index, item) in items.iter().enumerate() {
            let Value::Object(entry) = item else {
                return Err(ConfigError(format!(
                    "configCenter.definitions[{index}] 必须是对象"
                )));
            };
            for field in ["key", "type", "secret"] {
                if !entry.contains_key(field) {
                    return Err(ConfigError(format!(
                        "configCenter.definitions[{index}].{field} 缺失"
                    )));
                }
            }
            if !entry.get("key").is_some_and(Value::is_string) {
                return Err(ConfigError(format!(
                    "configCenter.definitions[{index}].key 必须是字符串"
                )));
            }
            if !entry.get("type").is_some_and(Value::is_string) {
                return Err(ConfigError(format!(
                    "configCenter.definitions[{index}].type 必须是字符串"
                )));
            }
            if !entry.get("secret").is_some_and(Value::is_boolean) {
                return Err(ConfigError(format!(
                    "configCenter.definitions[{index}].secret 必须是 true/false"
                )));
            }
            if let Some(enum_values) = entry.get("enum") {
                let Value::Array(values) = enum_values else {
                    return Err(ConfigError(format!(
                        "configCenter.definitions[{index}].enum 必须是字符串列表"
                    )));
                };
                if !values.iter().all(Value::is_string) {
                    return Err(ConfigError(format!(
                        "configCenter.definitions[{index}].enum 必须是字符串列表"
                    )));
                }
            }
            if let Some(description) = entry.get("description") {
                if !description.is_string() {
                    return Err(ConfigError(format!(
                        "configCenter.definitions[{index}].description 必须是字符串"
                    )));
                }
            }
        }
    }
    if let Some(values) = map.get("values") {
        if !values.is_object() {
            return Err(ConfigError("configCenter.values 必须是对象".to_string()));
        }
    }
    Ok(())
}

/// 内置中间件只校验外壳结构；关闭组的 config 内容一律忽略（不校验类型、不报未知键）。
fn check_builtin_types(base: &Value) -> Result<(), ConfigError> {
    let Some(builtin) = value_at(base, "middleware.builtin") else {
        return Ok(());
    };
    let Value::Object(groups) = builtin else {
        return Err(ConfigError("middleware.builtin 必须是对象".to_string()));
    };
    for (group, value) in groups {
        let Value::Object(entry) = value else {
            return Err(ConfigError(format!(
                "middleware.builtin.{group} 必须是对象"
            )));
        };
        if let Some(enabled) = entry.get("enabled") {
            if !enabled.is_boolean() {
                return Err(ConfigError(format!(
                    "middleware.builtin.{group}.enabled 必须是 true/false"
                )));
            }
        }
        let enabled = entry
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if enabled {
            if let Some(config) = entry.get("config") {
                if !config.is_object() {
                    return Err(ConfigError(format!(
                        "middleware.builtin.{group}.config 必须是对象"
                    )));
                }
            }
        }
    }
    Ok(())
}

fn value_at<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = root;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

fn require_int(root: &Value, path: &str) -> Result<(), ConfigError> {
    require_int_path(root, path)
}

fn require_int_path(root: &Value, path: &str) -> Result<(), ConfigError> {
    match value_at(root, path) {
        Some(Value::Number(n)) if n.as_i64().is_some() => Ok(()),
        _ => Err(ConfigError(format!("{path} 必须是整数"))),
    }
}

fn require_bool(root: &Value, path: &str) -> Result<(), ConfigError> {
    require_bool_path(root, path)
}

fn require_bool_path(root: &Value, path: &str) -> Result<(), ConfigError> {
    match value_at(root, path) {
        Some(Value::Bool(_)) => Ok(()),
        _ => Err(ConfigError(format!("{path} 必须是 true/false"))),
    }
}

fn require_string(root: &Value, path: &str) -> Result<(), ConfigError> {
    require_string_path(root, path)
}

fn require_string_path(root: &Value, path: &str) -> Result<(), ConfigError> {
    match value_at(root, path) {
        Some(Value::String(_)) => Ok(()),
        _ => Err(ConfigError(format!("{path} 必须是字符串"))),
    }
}

fn require_string_array(root: &Value, path: &str) -> Result<(), ConfigError> {
    match value_at(root, path) {
        Some(Value::Array(items)) if items.iter().all(Value::is_string) => Ok(()),
        _ => Err(ConfigError(format!("{path} 必须是字符串列表"))),
    }
}

fn validate(config: &Config) -> Result<(), ConfigError> {
    if config.schema_version != 1 {
        return Err(ConfigError(format!(
            "schemaVersion 必须为 1，收到：{}",
            config.schema_version
        )));
    }
    if !["rust", "node", "go"].contains(&config.language.as_str()) {
        return Err(ConfigError("language 只能是 rust / node / go".to_string()));
    }
    if !["full", "usable", "minimal"].contains(&config.maturity.as_str()) {
        return Err(ConfigError(
            "maturity 只能是 full / usable / minimal".to_string(),
        ));
    }
    if config.host.trim().is_empty() {
        return Err(ConfigError("host 必须是非空字符串".to_string()));
    }
    if config.port < 1024 {
        return Err(ConfigError(format!(
            "port 必须是 1024-65535 的整数，收到：{}",
            config.port
        )));
    }
    if !["debug", "info", "warn", "error"].contains(&config.log_level.as_str()) {
        return Err(ConfigError(
            "logLevel 只能是 debug / info / warn / error".to_string(),
        ));
    }
    if config.cors.max_age > 86400 {
        return Err(ConfigError("cors.maxAge 必须是 0-86400 的整数".to_string()));
    }
    if config.cors.credentials && config.cors.origins.iter().any(|o| o == "*") {
        return Err(ConfigError(
            "cors.credentials 为 true 时 origins 不能包含 *".to_string(),
        ));
    }
    if !["sqlite", "mysql", "postgres"].contains(&config.database.driver.trim()) {
        return Err(ConfigError(
            "database.driver 只能是 sqlite / mysql / postgres".to_string(),
        ));
    }
    if !(1..=100).contains(&config.database.max_open_conns) {
        return Err(ConfigError(
            "database.maxOpenConns 必须是 1-100 的整数".to_string(),
        ));
    }
    if !(1..=60).contains(&config.database.connect_timeout_seconds) {
        return Err(ConfigError(
            "database.connectTimeoutSeconds 必须是 1-60 的整数".to_string(),
        ));
    }
    if !["disable", "require"].contains(&config.database.ssl_mode.trim()) {
        return Err(ConfigError(
            "database.sslMode 只能是 disable / require".to_string(),
        ));
    }
    let db_url = config.database.url.trim();
    if !db_url.is_empty() {
        let supported = db_url.starts_with("sqlite:")
            || db_url.starts_with("mysql:")
            || db_url.starts_with("postgres:");
        if !supported {
            return Err(ConfigError(
                "database.url 仅支持 sqlite:// / mysql:// / postgres://（postgresql:// 等价）"
                    .to_string(),
            ));
        }
        if db_url.starts_with("sqlite:") {
            let path = db_url
                .strip_prefix("sqlite://")
                .or_else(|| db_url.strip_prefix("sqlite:"))
                .unwrap_or("")
                .split('?')
                .next()
                .unwrap_or("")
                .trim();
            if path.is_empty() {
                return Err(ConfigError(
                    "database.url 缺少 SQLite 文件路径；内存库请写 sqlite::memory:".to_string(),
                ));
            }
        }
    } else {
        if config.database.host.trim().is_empty() {
            return Err(ConfigError(
                "database.url 为空时 database.host 不能为空".to_string(),
            ));
        }
        if config.database.name.trim().is_empty() {
            return Err(ConfigError(
                "database.url 为空时 database.name 不能为空".to_string(),
            ));
        }
    }
    if !["none", "memory", "redis"].contains(&config.cache.driver.trim()) {
        return Err(ConfigError(
            "cache.driver 只能是 none / memory / redis".to_string(),
        ));
    }
    if !(1..=86400).contains(&config.cache.ttl_seconds) {
        return Err(ConfigError(
            "cache.ttlSeconds 必须是 1-86400 的整数".to_string(),
        ));
    }
    if config.cache.key_prefix.trim().is_empty() {
        return Err(ConfigError("cache.keyPrefix 必须是非空字符串".to_string()));
    }
    if config.cache.driver.trim() == "redis" && config.cache.url.trim().is_empty() {
        return Err(ConfigError(
            "cache.driver=redis 时 cache.url 不能为空".to_string(),
        ));
    }
    if !["memory", "none"].contains(&config.cache.fallback.trim()) {
        return Err(ConfigError(
            "cache.fallback 只能是 memory / none".to_string(),
        ));
    }
    if !(1..=10000).contains(&config.middleware.rate_limit.rps) {
        return Err(ConfigError(
            "middleware.rateLimit.rps 必须是 1-10000 的整数".to_string(),
        ));
    }
    if !(1024..=268435456).contains(&config.middleware.body_limit.max_bytes) {
        return Err(ConfigError(
            "middleware.bodyLimit.maxBytes 必须是 1024-268435456 的整数".to_string(),
        ));
    }
    if !(1..=600).contains(&config.middleware.timeout.seconds) {
        return Err(ConfigError(
            "middleware.timeout.seconds 必须是 1-600 的整数".to_string(),
        ));
    }
    if !(1..=10000).contains(&config.middleware.concurrency.max_in_flight) {
        return Err(ConfigError(
            "middleware.concurrency.maxInFlight 必须是 1-10000 的整数".to_string(),
        ));
    }
    if config.middleware.compression.enabled
        && !config.middleware.compression.gzip
        && !config.middleware.compression.brotli
    {
        return Err(ConfigError(
            "middleware.compression 启用时 gzip/brotli 至少要开启一个".to_string(),
        ));
    }
    if config.middleware.compression.min_bytes > 1048576 {
        return Err(ConfigError(
            "middleware.compression.minBytes 必须是 0-1048576 的整数".to_string(),
        ));
    }
    if config.middleware.static_cache.max_age_seconds > 31536000
        || config.middleware.static_cache.immutable_max_age_seconds > 31536000
    {
        return Err(ConfigError(
            "middleware.staticCache 的 maxAgeSeconds / immutableMaxAgeSeconds 必须是 0-31536000 的整数"
                .to_string(),
        ));
    }
    if config.middleware.security_headers.hsts.max_age_seconds > 31536000 {
        return Err(ConfigError(
            "middleware.securityHeaders.hsts.maxAgeSeconds 必须是 0-31536000 的整数".to_string(),
        ));
    }
    for definition in &config.config_center.definitions {
        if !["string", "number", "bool", "enum"].contains(&definition.value_type.as_str()) {
            return Err(ConfigError(format!(
                "configCenter.definitions 项 {} 的 type 只能是 string/number/bool/enum，收到 {}",
                definition.key, definition.value_type
            )));
        }
        if definition.value_type == "enum" && definition.enum_values.is_empty() {
            return Err(ConfigError(format!(
                "configCenter.definitions 项 {} 是 enum，但 enum 列表为空",
                definition.key
            )));
        }
    }
    if config.static_files.root.trim().is_empty() {
        return Err(ConfigError("static.root 必须是非空字符串".to_string()));
    }
    if !["jwt", "session"].contains(&config.auth.token_mode.trim()) {
        return Err(ConfigError(
            "auth.tokenMode 只能是 jwt / session".to_string(),
        ));
    }
    if !(60..=86400).contains(&config.auth.access_token_ttl_seconds) {
        return Err(ConfigError(
            "auth.accessTokenTtlSeconds 必须是 60-86400 的整数".to_string(),
        ));
    }
    if !(3600..=2592000).contains(&config.auth.refresh_token_ttl_seconds) {
        return Err(ConfigError(
            "auth.refreshTokenTtlSeconds 必须是 3600-2592000 的整数".to_string(),
        ));
    }
    if !(60..=2592000).contains(&config.auth.session_ttl_seconds) {
        return Err(ConfigError(
            "auth.sessionTtlSeconds 必须是 60-2592000 的整数".to_string(),
        ));
    }
    if !(1..=100).contains(&config.auth.max_login_failures) {
        return Err(ConfigError(
            "auth.maxLoginFailures 必须是 1-100 的整数".to_string(),
        ));
    }
    if !(10..=86400).contains(&config.auth.failure_window_seconds) {
        return Err(ConfigError(
            "auth.failureWindowSeconds 必须是 10-86400 的整数".to_string(),
        ));
    }
    if !(10..=86400).contains(&config.auth.lock_seconds) {
        return Err(ConfigError(
            "auth.lockSeconds 必须是 10-86400 的整数".to_string(),
        ));
    }
    if !(1..=1000).contains(&config.data_api.max_page_size) {
        return Err(ConfigError(
            "dataApi.maxPageSize 必须是 1-1000 的整数".to_string(),
        ));
    }
    if config.data_api.collections_dir.trim().is_empty() {
        return Err(ConfigError(
            "dataApi.collectionsDir 必须是非空字符串".to_string(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------- 合并

fn merge(base: &mut Value, over: Value) {
    match (base, over) {
        (Value::Object(base_map), Value::Object(over_map)) => {
            for (key, value) in over_map {
                match base_map.get_mut(&key) {
                    Some(existing) => merge(existing, value),
                    None => {
                        base_map.insert(key, value);
                    }
                }
            }
        }
        (base_value, over_value) => *base_value = over_value,
    }
}

// ---------------------------------------------------------------- YAML 子集 / JSON

pub fn parse_config_text(text: &str, file: &Path) -> Result<Value, ConfigError> {
    let body = text.trim_start_matches('\u{feff}').trim();
    if body.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    if body.starts_with('{') || body.starts_with('[') {
        return serde_json::from_str(body)
            .map_err(|err| ConfigError(format!("{} 不是合法 JSON：{err}", file.display())));
    }
    parse_yaml(text, file)
}

struct YLine {
    indent: usize,
    text: String,
    line_no: usize,
}

fn parse_yaml(text: &str, file: &Path) -> Result<Value, ConfigError> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<YLine> = Vec::new();
    for (index, raw) in normalized.split('\n').enumerate() {
        let line_no = index + 1;
        let lead: String = raw
            .chars()
            .take_while(|c| *c == ' ' || *c == '\t')
            .collect();
        if lead.contains('\t') {
            return Err(ConfigError(format!(
                "{}:{line_no} 缩进只能用空格",
                file.display()
            )));
        }
        let content = strip_comment(raw.chars().skip(lead.len()).collect::<String>().as_str())
            .trim_end()
            .to_string();
        if content.trim().is_empty() {
            continue;
        }
        lines.push(YLine {
            indent: lead.len(),
            text: content,
            line_no,
        });
    }
    if lines.is_empty() {
        return Ok(Value::Null);
    }

    let mut index = 0usize;
    let value = parse_block(&lines, &mut index, lines[0].indent, file)?;
    if index < lines.len() {
        return Err(line_error(file, &lines[index], "缩进层级无法识别"));
    }
    Ok(value)
}

fn line_error(file: &Path, line: &YLine, message: &str) -> ConfigError {
    ConfigError(format!("{}:{} {message}", file.display(), line.line_no))
}

fn parse_block(
    lines: &[YLine],
    index: &mut usize,
    indent: usize,
    file: &Path,
) -> Result<Value, ConfigError> {
    if *index >= lines.len() {
        return Ok(Value::Null);
    }
    if lines[*index].indent != indent {
        return Err(line_error(
            file,
            &lines[*index],
            &format!("缩进不一致，期望 {indent} 个空格"),
        ));
    }
    let first = &lines[*index];
    if first.text == "-" || first.text.starts_with("- ") {
        parse_seq(lines, index, indent, file)
    } else {
        parse_map(lines, index, indent, file)
    }
}

fn parse_map(
    lines: &[YLine],
    index: &mut usize,
    indent: usize,
    file: &Path,
) -> Result<Value, ConfigError> {
    let mut map = Map::new();
    while *index < lines.len() && lines[*index].indent == indent {
        let line = &lines[*index];
        if line.text == "-" || line.text.starts_with("- ") {
            return Err(line_error(file, line, "同一层级不能混用列表和映射"));
        }
        let Some((raw_key, raw_rest)) = line.text.split_once(':') else {
            return Err(line_error(file, line, "缺少“键: 值”结构"));
        };
        let key = raw_key.trim().to_string();
        if key.is_empty() {
            return Err(line_error(file, line, "键不能为空"));
        }
        let rest = raw_rest.trim().to_string();
        let line_no = line.line_no;
        *index += 1;

        if map.contains_key(&key) {
            return Err(ConfigError(format!(
                "{}:{line_no} 重复的键：{key}",
                file.display()
            )));
        }

        let value = if rest.is_empty() {
            if *index < lines.len() && lines[*index].indent > indent {
                let child_indent = lines[*index].indent;
                parse_block(lines, index, child_indent, file)?
            } else {
                Value::Null
            }
        } else {
            parse_scalar(&rest, line_no, file)?
        };
        map.insert(key, value);
    }
    Ok(Value::Object(map))
}

fn parse_seq(
    lines: &[YLine],
    index: &mut usize,
    indent: usize,
    file: &Path,
) -> Result<Value, ConfigError> {
    let mut items = Vec::new();
    while *index < lines.len() && lines[*index].indent == indent {
        let line = &lines[*index];
        if !(line.text == "-" || line.text.starts_with("- ")) {
            return Err(line_error(file, line, "列表项必须以“- ”开头"));
        }
        let rest = line.text[1..].trim().to_string();
        let line_no = line.line_no;
        *index += 1;

        if rest.is_empty() {
            if *index < lines.len() && lines[*index].indent > indent {
                let child_indent = lines[*index].indent;
                items.push(parse_block(lines, index, child_indent, file)?);
            } else {
                items.push(Value::Null);
            }
        } else if let Some((key, rest_value)) = split_block_map(&rest) {
            // 支持列表块映射：
            // - key: value
            //   other: value
            let mut map = Map::new();
            if rest_value.trim().is_empty() {
                if *index < lines.len() && lines[*index].indent > indent {
                    let child_indent = lines[*index].indent;
                    map.insert(
                        key.to_string(),
                        parse_block(lines, index, child_indent, file)?,
                    );
                } else {
                    map.insert(key.to_string(), Value::Null);
                }
            } else {
                map.insert(
                    key.to_string(),
                    parse_scalar(rest_value.trim(), line_no, file)?,
                );
            }
            let map_indent = indent + 2;
            if *index < lines.len()
                && lines[*index].indent == map_indent
                && !lines[*index].text.starts_with('-')
            {
                if let Value::Object(more) = parse_block(lines, index, map_indent, file)? {
                    for (name, value) in more {
                        map.insert(name, value);
                    }
                }
            }
            items.push(Value::Object(map));
        } else {
            items.push(parse_scalar(&rest, line_no, file)?);
        }
    }
    Ok(Value::Array(items))
}

fn split_block_map(text: &str) -> Option<(&str, &str)> {
    let (key, rest) = text.split_once(':')?;
    if key.is_empty() || key.contains(char::is_whitespace) {
        return None;
    }
    if !rest.is_empty() && !rest.starts_with(' ') {
        return None;
    }
    Some((key, rest))
}

fn parse_scalar(raw: &str, line_no: usize, file: &Path) -> Result<Value, ConfigError> {
    let text = raw.trim();
    if text.starts_with('[') {
        if !text.ends_with(']') {
            return Err(ConfigError(format!(
                "{}:{line_no} 行内列表缺少右括号 ]",
                file.display()
            )));
        }
        let inner = &text[1..text.len() - 1];
        let mut items = Vec::new();
        for item in split_inline(inner) {
            items.push(parse_scalar(&item, line_no, file)?);
        }
        return Ok(Value::Array(items));
    }
    if text.starts_with('"') && text.ends_with('"') && text.len() >= 2 {
        return Ok(Value::String(
            text[1..text.len() - 1]
                .replace("\\\"", "\"")
                .replace("\\\\", "\\"),
        ));
    }
    if text.starts_with('\'') && text.ends_with('\'') && text.len() >= 2 {
        return Ok(Value::String(text[1..text.len() - 1].replace("''", "'")));
    }
    match text {
        "true" => return Ok(Value::Bool(true)),
        "false" => return Ok(Value::Bool(false)),
        "null" | "~" => return Ok(Value::Null),
        _ => {}
    }
    if let Ok(value) = text.parse::<i64>() {
        return Ok(Value::from(value));
    }
    if text.contains('.') {
        if let Ok(value) = text.parse::<f64>() {
            return Ok(Value::from(value));
        }
    }
    Ok(Value::String(text.to_string()))
}

fn strip_comment(text: &str) -> String {
    let mut out = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' && in_double {
            out.push(ch);
            if let Some(next) = chars.next() {
                out.push(next);
            }
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
        } else if ch == '\'' && !in_double {
            in_single = !in_single;
        } else if ch == '#'
            && !in_single
            && !in_double
            && out.chars().last().map_or(true, |c| c.is_whitespace())
        {
            break;
        }
        out.push(ch);
    }
    out
}

fn split_inline(text: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in text.chars() {
        if let Some(q) = quote {
            current.push(ch);
            if ch == q {
                quote = None;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        if ch == ',' {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                items.push(trimmed);
            }
            current.clear();
            continue;
        }
        current.push(ch);
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        items.push(trimmed);
    }
    items
}
