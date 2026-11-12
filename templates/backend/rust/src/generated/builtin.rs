// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 内置中间件预设：数据库三选一、redis、对象存储 / 消息队列 / 搜索 / 反向代理。
// 关闭的组不保留任何配置键、不尝试连接；启用但本模板无客户端的能力只注入配置中心。
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::generated::config::{CacheConfig, Config, ConfigError};
use crate::generated::config_center::ConfigCenter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BuiltinMiddlewareConfig {
    pub postgres: BuiltinGroup,
    pub mysql: BuiltinGroup,
    pub sqlite: BuiltinGroup,
    pub redis: BuiltinGroup,
    pub object_storage: BuiltinGroup,
    pub message_queue: BuiltinGroup,
    pub search: BuiltinGroup,
    pub reverse_proxy: BuiltinGroup,
}

impl Default for BuiltinMiddlewareConfig {
    fn default() -> Self {
        Self {
            postgres: group(
                false,
                json!({
                    "host": "127.0.0.1", "port": 5432, "database": "app", "user": "lc",
                    "password": "", "sslMode": "disable", "maxOpenConns": 10,
                    "connectTimeoutSeconds": 5
                }),
            ),
            mysql: group(
                false,
                json!({
                    "host": "127.0.0.1", "port": 3306, "database": "app", "user": "lc",
                    "password": "", "maxOpenConns": 10, "connectTimeoutSeconds": 5
                }),
            ),
            sqlite: group(true, json!({ "file": "data/app.db" })),
            redis: group(
                false,
                json!({
                    "url": "redis://127.0.0.1:16379/0", "ttlSeconds": 30,
                    "keyPrefix": "lc:", "password": ""
                }),
            ),
            object_storage: group(
                false,
                json!({
                    "driver": "s3", "endpoint": "", "bucket": "", "region": "",
                    "accessKey": "", "secretKey": ""
                }),
            ),
            message_queue: group(
                false,
                json!({
                    "driver": "redis", "url": "", "queue": "lc"
                }),
            ),
            search: group(
                false,
                json!({
                    "driver": "opensearch", "url": "", "index": "lc"
                }),
            ),
            reverse_proxy: group(
                false,
                json!({
                    "upstream": "http://127.0.0.1:8080", "clientMaxBodySize": "1m"
                }),
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BuiltinGroup {
    pub enabled: bool,
    pub config: Map<String, Value>,
}

impl Default for BuiltinGroup {
    fn default() -> Self {
        Self {
            enabled: false,
            config: Map::new(),
        }
    }
}

fn group(enabled: bool, config: Value) -> BuiltinGroup {
    BuiltinGroup {
        enabled,
        config: config.as_object().cloned().unwrap_or_default(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinFieldSnapshot {
    pub group: String,
    pub field: String,
    pub source: String,
    pub value_type: String,
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinGroupStatus {
    pub group: String,
    pub enabled: bool,
    pub source: String,
    pub detail: String,
}

#[derive(Debug, Clone, Default)]
pub struct BuiltinRuntime {
    pub fields: Vec<BuiltinFieldSnapshot>,
    pub groups: Vec<BuiltinGroupStatus>,
}

impl BuiltinRuntime {
    /// 该组是否在配置里出现（无论开关），用于兼容模式与启动清单。
    pub fn present(&self, group: &str) -> bool {
        self.groups.iter().any(|item| item.group == group)
    }

    pub fn snapshot(&self) -> Value {
        json!({
            "groups": self.groups,
            "fields": self.fields,
        })
    }

    pub fn print(&self) {
        for group in &self.groups {
            let mark = if group.enabled { "✓" } else { "✗" };
            if group.enabled {
                tracing::info!(
                    "[中间件][内置] {} {} {}（来源={}）",
                    group.group,
                    mark,
                    group.detail,
                    group.source
                );
            } else {
                tracing::info!(
                    "[中间件][内置] {} {} {}（来源={}）",
                    group.group,
                    mark,
                    group.detail,
                    group.source
                );
            }
        }
    }
}

const GROUPS: [&str; 8] = [
    "postgres",
    "mysql",
    "sqlite",
    "redis",
    "objectStorage",
    "messageQueue",
    "search",
    "reverseProxy",
];

const SECRET_FIELDS: [(&str, &str); 5] = [
    ("postgres", "password"),
    ("mysql", "password"),
    ("redis", "password"),
    ("objectStorage", "accessKey"),
    ("objectStorage", "secretKey"),
];

fn is_secret(group: &str, field: &str) -> bool {
    SECRET_FIELDS
        .iter()
        .any(|(item_group, item_field)| *item_group == group && *item_field == field)
}

fn raw_group<'a>(root: &'a Value, group: &str) -> Option<&'a Value> {
    root.get("middleware")?.get("builtin")?.get(group)
}

fn group_declared(generated: &Value, user: &Value, group: &str) -> bool {
    raw_group(generated, group).is_some() || raw_group(user, group).is_some()
}

fn explicit_enabled(generated: &Value, user: &Value, group: &str) -> Option<bool> {
    for root in [generated, user] {
        if let Some(value) = raw_group(root, group).and_then(|item| item.get("enabled")) {
            if let Some(flag) = value.as_bool() {
                return Some(flag);
            }
        }
    }
    None
}

fn config_group_mut<'a>(config: &'a mut Config, group: &str) -> Option<&'a mut BuiltinGroup> {
    let builtin = &mut config.middleware.builtin;
    match group {
        "postgres" => Some(&mut builtin.postgres),
        "mysql" => Some(&mut builtin.mysql),
        "sqlite" => Some(&mut builtin.sqlite),
        "redis" => Some(&mut builtin.redis),
        "objectStorage" => Some(&mut builtin.object_storage),
        "messageQueue" => Some(&mut builtin.message_queue),
        "search" => Some(&mut builtin.search),
        "reverseProxy" => Some(&mut builtin.reverse_proxy),
        _ => None,
    }
}

fn config_group<'a>(config: &'a Config, group: &str) -> Option<&'a BuiltinGroup> {
    let builtin = &config.middleware.builtin;
    match group {
        "postgres" => Some(&builtin.postgres),
        "mysql" => Some(&builtin.mysql),
        "sqlite" => Some(&builtin.sqlite),
        "redis" => Some(&builtin.redis),
        "objectStorage" => Some(&builtin.object_storage),
        "messageQueue" => Some(&builtin.message_queue),
        "search" => Some(&builtin.search),
        "reverseProxy" => Some(&builtin.reverse_proxy),
        _ => None,
    }
}

fn config_group_in<'a>(
    builtin: &'a BuiltinMiddlewareConfig,
    group: &str,
) -> Option<&'a BuiltinGroup> {
    match group {
        "postgres" => Some(&builtin.postgres),
        "mysql" => Some(&builtin.mysql),
        "sqlite" => Some(&builtin.sqlite),
        "redis" => Some(&builtin.redis),
        "objectStorage" => Some(&builtin.object_storage),
        "messageQueue" => Some(&builtin.message_queue),
        "search" => Some(&builtin.search),
        "reverseProxy" => Some(&builtin.reverse_proxy),
        _ => None,
    }
}

fn to_upper_snake(text: &str) -> String {
    let mut out = String::new();
    let mut previous_lower = false;
    for ch in text.chars() {
        if ch.is_ascii_uppercase() {
            if previous_lower {
                out.push('_');
            }
            out.push(ch);
        } else {
            out.push(ch.to_ascii_uppercase());
        }
        previous_lower = ch.is_ascii_lowercase();
    }
    out
}

fn screaming(group: &str, field: &str) -> String {
    format!("{}_{}", to_upper_snake(group), to_upper_snake(field))
}

fn env_key_for(key: &str) -> String {
    format!("LC_CFG_{}", to_upper_snake(key))
}

fn parse_bool_flag(text: &str) -> Option<bool> {
    match text.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Some(true),
        "false" | "0" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn env_enabled_flag(env: &HashMap<String, String>, group: &str) -> Option<bool> {
    env.get(&format!("LC_CFG_{}_ENABLED", to_upper_snake(group)))
        .and_then(|value| parse_bool_flag(value))
}

fn cli_enabled_flag(cli: &[(String, String)], group: &str) -> Option<bool> {
    cli_value(cli, group, "enabled").and_then(parse_bool_flag)
}

/// 该组是否在配置文件的生成层 / 用户层 / 环境变量 / 启动参数里出现过。
fn group_touched(env: &HashMap<String, String>, cli: &[(String, String)], group: &str) -> bool {
    let env_prefix = format!("LC_CFG_{}_", to_upper_snake(group));
    let cli_prefix = format!("{group}.");
    let cli_env_style = format!("{}_", to_upper_snake(group));
    env.keys().any(|key| key.starts_with(&env_prefix))
        || cli
            .iter()
            .any(|(key, _)| key.starts_with(&cli_prefix) || key.starts_with(&cli_env_style))
}

fn enabled_source(
    generated: &Value,
    user: &Value,
    env: &HashMap<String, String>,
    cli: &[(String, String)],
    group: &str,
) -> String {
    if cli_enabled_flag(cli, group).is_some() {
        return "cli".to_string();
    }
    if env_enabled_flag(env, group).is_some() {
        return "env".to_string();
    }
    if raw_group(user, group).is_some() {
        return "user".to_string();
    }
    if raw_group(generated, group).is_some() {
        return "generated".to_string();
    }
    "default".to_string()
}

/// 内置组字段的启动参数写法：--cfg <group>.<field>=<value>（同时兼容 GROUP_FIELD）。
fn cli_value<'a>(cli: &'a [(String, String)], group: &str, field: &str) -> Option<&'a str> {
    let dotted = format!("{group}.{field}");
    let snake = screaming(group, field);
    cli.iter()
        .rev()
        .find(|(name, _)| name == &dotted || name == &snake)
        .map(|(_, value)| value.as_str())
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Number(_) => "number",
        Value::Bool(_) => "bool",
        _ => "string",
    }
}

fn parse_env_like(
    default: &Value,
    raw: &str,
    origin: &str,
    key: &str,
) -> Result<Value, ConfigError> {
    match type_name(default) {
        "number" => raw
            .trim()
            .parse::<i64>()
            .map(Value::from)
            .or_else(|_| raw.trim().parse::<f64>().map(Value::from))
            .map_err(|_| {
                ConfigError(format!(
                    "内置中间件字段 {key} 类型不匹配：期望 number（{origin}）；请检查环境变量 {}",
                    env_key_for(key)
                ))
            }),
        "bool" => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(Value::Bool(true)),
            "0" | "false" | "no" | "off" => Ok(Value::Bool(false)),
            _ => Err(ConfigError(format!(
                "内置中间件字段 {key} 类型不匹配：期望 bool（{origin}）；请检查环境变量 {}",
                env_key_for(key)
            ))),
        },
        _ => Ok(Value::String(raw.to_string())),
    }
}

fn check_file_value(
    default: &Value,
    value: &Value,
    key: &str,
    origin: &str,
) -> Result<(), ConfigError> {
    let ok = match default {
        Value::Number(_) => value.is_number(),
        Value::Bool(_) => value.is_boolean(),
        _ => value.is_string(),
    };
    if ok {
        Ok(())
    } else {
        Err(ConfigError(format!(
            "内置中间件字段 {key} 类型不匹配：期望 {}（{origin}）；请检查环境变量 {}",
            type_name(default),
            env_key_for(key)
        )))
    }
}

fn is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        _ => false,
    }
}

fn rank(source: &str) -> u8 {
    match source {
        "cli" => 4,
        "env" => 3,
        "user" => 2,
        "generated" => 1,
        _ => 0,
    }
}

fn field_u64(config: &Config, group: &str, field: &str, fallback: u64) -> u64 {
    config_group(config, group)
        .and_then(|item| item.config.get(field))
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
}

fn field_str(config: &Config, group: &str, field: &str, fallback: &str) -> String {
    config_group(config, group)
        .and_then(|item| item.config.get(field))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn encode_password(password: &str) -> String {
    let mut out = String::new();
    for byte in password.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn redis_url_with_password(url: &str, password: &str) -> String {
    if password.trim().is_empty() {
        return url.to_string();
    }
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    let (authority, tail) = match rest.split_once('/') {
        Some((authority, tail)) => (authority, format!("/{tail}")),
        None => (rest, String::new()),
    };
    if authority.contains('@') {
        return url.to_string();
    }
    format!(
        "{scheme}://:{}@{authority}{tail}",
        encode_password(password.trim())
    )
}

/// 解析内置中间件、映射到数据库/缓存，并把无客户端能力注入配置中心。
pub fn apply(
    config: &mut Config,
    generated: &Value,
    user: &Value,
    env: &HashMap<String, String>,
    cli: &[(String, String)],
    warnings: &mut Vec<String>,
    center: &mut ConfigCenter,
) -> Result<BuiltinRuntime, ConfigError> {
    let mut runtime = BuiltinRuntime::default();
    let defaults = BuiltinMiddlewareConfig::default();

    for name in GROUPS {
        let declared = group_declared(generated, user, name) || group_touched(env, cli, name);
        if !declared {
            // 未在配置里出现的组按兼容模式处理，不计入生效清单。
            continue;
        }
        let file_flag = explicit_enabled(generated, user, name);
        let flag = cli_enabled_flag(cli, name)
            .or(env_enabled_flag(env, name))
            .or(file_flag);
        let stored = config_group(config, name).is_some_and(|g| g.enabled);
        let enabled = flag.unwrap_or(stored);

        if !enabled {
            warn_disabled_secrets(name, generated, user, warnings);
            if let Some(item) = config_group_mut(config, name) {
                item.enabled = false;
                item.config.clear();
            }
            runtime.groups.push(BuiltinGroupStatus {
                group: name.to_string(),
                enabled: false,
                source: enabled_source(generated, user, env, cli, name),
                detail: if file_flag == Some(false) || flag == Some(false) {
                    "已关闭（不保留配置、不尝试连接）".to_string()
                } else {
                    "未启用（不保留配置、不尝试连接）".to_string()
                },
            });
            continue;
        }

        let default_group = config_group_in(&defaults, name)
            .cloned()
            .unwrap_or_default();
        let mut group_source = enabled_source(generated, user, env, cli, name);
        let mut resolved = Map::new();

        if let Some(item) = config_group_mut(config, name) {
            item.enabled = true;
            item.config.clear();
        }

        for (field, default_value) in &default_group.config {
            let key = format!("{name}_{field}");
            let cli_key = screaming(name, field);
            let env_key = format!("LC_CFG_{cli_key}");
            let secret = is_secret(name, field);
            let mut value = default_value.clone();
            let mut source = "default".to_string();

            if !secret {
                for (root, root_source, label) in [
                    (generated, "generated", "config.generated.yaml"),
                    (user, "user", "config.yaml"),
                ] {
                    if let Some(raw) = raw_group(root, name)
                        .and_then(|item| item.get("config"))
                        .and_then(|item| item.get(field))
                    {
                        if !is_empty(raw) {
                            check_file_value(default_value, raw, &key, label)?;
                            value = raw.clone();
                            source = root_source.to_string();
                        }
                    }
                }
            } else {
                let file_value = raw_group(generated, name)
                    .and_then(|item| item.get("config"))
                    .and_then(|item| item.get(field))
                    .filter(|raw| !is_empty(raw));
                let user_value = raw_group(user, name)
                    .and_then(|item| item.get("config"))
                    .and_then(|item| item.get(field))
                    .filter(|raw| !is_empty(raw));
                if file_value.is_some() || user_value.is_some() {
                    warnings.push(format!(
                        "内置中间件密钥 {key} 已忽略配置文件中的值（不会打印原值），只接受环境变量 {env_key}"
                    ));
                }
            }

            if let Some(raw) = env.get(&env_key).filter(|value| !value.is_empty()) {
                value = parse_env_like(default_value, raw, &format!("环境变量 {env_key}"), &key)?;
                source = "env".to_string();
            }
            if let Some(raw) = cli_value(cli, name, field) {
                value = parse_env_like(default_value, raw, &format!("--cfg {cli_key}"), &key)?;
                source = "cli".to_string();
            }

            if secret && source != "env" && source != "cli" {
                return Err(ConfigError(format!(
                    "内置中间件 {} 已启用但缺少密钥 {}（type={}）：请设置环境变量 {} 或使用 --cfg {}=VALUE",
                    name,
                    key,
                    type_name(default_value),
                    env_key,
                    cli_key
                )));
            }

            if rank(&source) > rank(&group_source) {
                group_source = source.clone();
            }
            resolved.insert(field.clone(), value.clone());
            runtime.fields.push(BuiltinFieldSnapshot {
                group: name.to_string(),
                field: field.clone(),
                source: source.clone(),
                value_type: type_name(default_value).to_string(),
                secret,
            });
            // 注入配置中心（用户代码可读；snapshot/日志对 secret 打码）。
            center.inject(
                &screaming(name, field),
                value,
                &source,
                type_name(default_value),
                secret,
                &format!("内置中间件 {name}.{field}"),
            );
            if secret {
                center.mark_secret(&screaming(name, field));
            }
        }

        if let Some(item) = config_group_mut(config, name) {
            item.config = resolved;
        }

        let detail = match name {
            "postgres" | "mysql" | "sqlite" => "数据库连接参数已应用".to_string(),
            "redis" => "缓存已切换为 redis".to_string(),
            _ => "配置已注入（连接由用户代码负责）".to_string(),
        };
        runtime.groups.push(BuiltinGroupStatus {
            group: name.to_string(),
            enabled: true,
            source: group_source,
            detail,
        });
    }

    apply_database(config, &runtime, warnings)?;
    apply_cache(config, &runtime);
    Ok(runtime)
}

fn warn_disabled_secrets(group: &str, generated: &Value, user: &Value, warnings: &mut Vec<String>) {
    for (secret_group, field) in SECRET_FIELDS {
        if secret_group != group {
            continue;
        }
        let has_value = [generated, user].iter().any(|root| {
            raw_group(root, group)
                .and_then(|item| item.get("config"))
                .and_then(|item| item.get(field))
                .is_some_and(|raw| !is_empty(raw))
        });
        if has_value {
            warnings.push(format!(
                "内置中间件密钥 {group}_{field} 已忽略配置文件中的值（不会打印原值），只接受环境变量 {}",
                env_key_for(&format!("{group}_{field}"))
            ));
        }
    }
}

fn apply_database(
    config: &mut Config,
    runtime: &BuiltinRuntime,
    warnings: &mut Vec<String>,
) -> Result<(), ConfigError> {
    let mut enabled_drivers: Vec<&str> = Vec::new();
    for (group, driver) in [
        ("postgres", "postgres"),
        ("mysql", "mysql"),
        ("sqlite", "sqlite"),
    ] {
        if runtime.present(group) && config_group(config, group).is_some_and(|item| item.enabled) {
            enabled_drivers.push(driver);
        }
    }
    if enabled_drivers.len() > 1 {
        return Err(ConfigError(format!(
            "middleware.builtin 的数据库组只能三选一，当前同时启用：{}",
            enabled_drivers.join(" / ")
        )));
    }
    let Some(driver) = enabled_drivers.first().copied() else {
        warnings.push("未启用内置数据库中间件，使用顶层 database（兼容模式）".to_string());
        return Ok(());
    };

    let mut db = config.database.clone();
    db.driver = driver.to_string();
    db.url = String::new();
    match driver {
        "sqlite" => {
            let file = field_str(config, "sqlite", "file", "data/app.db");
            db.url = format!("sqlite:{file}");
            db.host = String::new();
            db.port = 0;
            db.name = std::path::Path::new(&file)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("app")
                .to_string();
            db.user = String::new();
            db.password = String::new();
            db.ssl_mode = "disable".to_string();
            db.max_open_conns = 10;
            db.connect_timeout_seconds = 5;
        }
        "postgres" => {
            db.host = field_str(config, "postgres", "host", "127.0.0.1");
            db.port = field_u64(config, "postgres", "port", 5432) as u16;
            db.name = field_str(config, "postgres", "database", "app");
            db.user = field_str(config, "postgres", "user", "lc");
            db.password = field_str(config, "postgres", "password", "");
            db.ssl_mode = field_str(config, "postgres", "sslMode", "disable");
            db.max_open_conns = field_u64(config, "postgres", "maxOpenConns", 10) as u32;
            db.connect_timeout_seconds =
                field_u64(config, "postgres", "connectTimeoutSeconds", 5) as u32;
        }
        "mysql" => {
            db.host = field_str(config, "mysql", "host", "127.0.0.1");
            db.port = field_u64(config, "mysql", "port", 3306) as u16;
            db.name = field_str(config, "mysql", "database", "app");
            db.user = field_str(config, "mysql", "user", "lc");
            db.password = field_str(config, "mysql", "password", "");
            db.ssl_mode = "disable".to_string();
            db.max_open_conns = field_u64(config, "mysql", "maxOpenConns", 10) as u32;
            db.connect_timeout_seconds =
                field_u64(config, "mysql", "connectTimeoutSeconds", 5) as u32;
        }
        _ => {}
    }
    config.database = db;
    Ok(())
}

fn apply_cache(config: &mut Config, runtime: &BuiltinRuntime) {
    if !runtime.present("redis") {
        // 没有显式配置 redis 组时，保持顶层 cache.driver（memory 等）的兼容行为。
        return;
    }
    let Some(redis) = config_group(config, "redis") else {
        return;
    };
    if !redis.enabled {
        config.cache.enabled = false;
        config.cache.driver = "none".to_string();
        return;
    }
    let url = field_str(config, "redis", "url", "redis://127.0.0.1:16379/0");
    let password = field_str(config, "redis", "password", "");
    let cache = CacheConfig {
        enabled: true,
        fallback: config.cache.fallback.clone(),
        driver: "redis".to_string(),
        url: redis_url_with_password(&url, &password),
        ttl_seconds: field_u64(config, "redis", "ttlSeconds", 30) as u32,
        key_prefix: field_str(config, "redis", "keyPrefix", "lc:"),
    };
    config.cache = cache;
}
