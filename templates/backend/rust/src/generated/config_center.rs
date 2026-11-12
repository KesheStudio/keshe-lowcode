// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 通用配置中心：只做类型转换、默认值与来源追踪，不做任何业务判断。
// 自定义项来自 configCenter.definitions / values；secret 只接受环境变量与 --cfg。
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::generated::config::ConfigError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConfigCenterConfig {
    pub definitions: Vec<ConfigCenterDefinition>,
    pub values: Map<String, Value>,
}

impl Default for ConfigCenterConfig {
    fn default() -> Self {
        Self {
            definitions: Vec::new(),
            values: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConfigCenterDefinition {
    pub key: String,
    #[serde(rename = "type")]
    pub value_type: String,
    pub default: Value,
    #[serde(rename = "enum")]
    pub enum_values: Vec<String>,
    pub secret: bool,
    pub description: String,
}

impl Default for ConfigCenterDefinition {
    fn default() -> Self {
        Self {
            key: String::new(),
            value_type: "string".to_string(),
            default: Value::Null,
            enum_values: Vec::new(),
            secret: false,
            description: String::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigCenterEntry {
    pub key: String,
    pub value: Value,
    pub source: String,
    pub value_type: String,
    pub secret: bool,
    pub description: String,
    pub enum_values: Vec<String>,
    /// 内置中间件组注入的字段：启动日志标「内置」，自定义声明标「自定义」。
    pub builtin: bool,
}

/// 运行时配置中心。用户代码可在 src/custom/routes.rs 里通过 state.config_center 读取。
#[derive(Debug, Clone)]
pub struct ConfigCenter {
    entries: Vec<ConfigCenterEntry>,
}

impl Default for ConfigCenter {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

// 配置中心的读取接口留给 src/custom/ 里的用户代码使用，生成区内不会全部调用到。
#[allow(dead_code)]
impl ConfigCenter {
    pub fn get(&self, key: &str) -> Option<Value> {
        self.entries
            .iter()
            .find(|entry| entry.key == key)
            .map(|entry| entry.value.clone())
    }

    pub fn source(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|entry| entry.key == key)
            .map(|entry| entry.source.as_str())
    }

    /// 给 /api/meta 用：只暴露声明信息与来源，绝不包含值。
    pub fn snapshot(&self) -> Value {
        Value::Array(
            self.entries
                .iter()
                .map(|entry| {
                    json!({
                        "key": entry.key,
                        "type": entry.value_type,
                        "secret": entry.secret,
                        "source": entry.source,
                        "description": entry.description,
                        "enum": entry.enum_values,
                    })
                })
                .collect(),
        )
    }

    /// 启动摘要：secret 一律打印 ***；内置项与自定义项分别标注来源。
    pub fn print_summary(&self) {
        for entry in &self.entries {
            let shown = if entry.secret {
                "***".to_string()
            } else {
                display_value(&entry.value)
            };
            let label = if entry.builtin {
                "[中间件][内置]"
            } else {
                "[中间件][自定义]"
            };
            tracing::info!(
                "{} {}={}（来源={}）",
                label,
                entry.key,
                shown,
                entry.source
            );
        }
    }

    /// 注入内置中间件组配置，供用户代码自行连接。
    pub fn inject(
        &mut self,
        key: &str,
        value: Value,
        source: &str,
        value_type: &str,
        secret: bool,
        description: &str,
    ) {
        if self.entries.iter().any(|entry| entry.key == key) {
            return;
        }
        self.entries.push(ConfigCenterEntry {
            key: key.to_string(),
            value,
            source: source.to_string(),
            value_type: value_type.to_string(),
            secret,
            description: description.to_string(),
            enum_values: Vec::new(),
            builtin: true,
        });
    }

    pub fn has(&self, key: &str) -> bool {
        self.entries.iter().any(|entry| entry.key == key)
    }

    /// 内置中间件的密钥字段同样不能出现在 snapshot 与启动摘要里。
    pub fn mark_secret(&mut self, key: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.key == key) {
            entry.secret = true;
        }
    }
}

pub fn env_name(key: &str) -> String {
    let mut out = String::from("LC_CFG_");
    for ch in key.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_uppercase());
        } else {
            out.push('_');
        }
    }
    out
}

fn display_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn values_at<'a>(root: &'a Value) -> Option<&'a Map<String, Value>> {
    root.get("configCenter")
        .and_then(|center| center.get("values"))
        .and_then(Value::as_object)
}

fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        _ => false,
    }
}

fn expect_type(
    definition: &ConfigCenterDefinition,
    value: &Value,
    origin: &str,
) -> Result<Value, ConfigError> {
    let key = &definition.key;
    match definition.value_type.as_str() {
        "string" => match value {
            Value::String(_) => Ok(value.clone()),
            _ => Err(type_error(key, "string", origin)),
        },
        "number" => match value {
            Value::Number(_) => Ok(value.clone()),
            _ => Err(type_error(key, "number", origin)),
        },
        "bool" => match value {
            Value::Bool(_) => Ok(value.clone()),
            _ => Err(type_error(key, "bool", origin)),
        },
        "enum" => match value {
            Value::String(text) if definition.enum_values.iter().any(|item| item == text) => {
                Ok(value.clone())
            }
            Value::String(text) => Err(ConfigError(format!(
                "配置中心项 {key} 不在枚举范围：期望 enum [{}]，收到 {text}（{origin}）",
                definition.enum_values.join(", ")
            ))),
            _ => Err(type_error(key, "enum", origin)),
        },
        other => Err(ConfigError(format!(
            "配置中心项 {key} 的类型声明非法：{other}，只允许 string/number/bool/enum"
        ))),
    }
}

fn type_error(key: &str, expected: &str, origin: &str) -> ConfigError {
    ConfigError(format!(
        "配置中心项 {key} 类型不匹配：期望 {expected}（{origin}）；请检查环境变量 {} 或配置文件",
        env_name(key)
    ))
}

fn parse_string_value(
    definition: &ConfigCenterDefinition,
    raw: &str,
    origin: &str,
) -> Result<Value, ConfigError> {
    let key = &definition.key;
    match definition.value_type.as_str() {
        "string" => Ok(Value::String(raw.to_string())),
        "number" => raw
            .trim()
            .parse::<i64>()
            .map(Value::from)
            .or_else(|_| raw.trim().parse::<f64>().map(Value::from))
            .map_err(|_| type_error(key, "number", origin)),
        "bool" => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(Value::Bool(true)),
            "0" | "false" | "no" | "off" => Ok(Value::Bool(false)),
            _ => Err(type_error(key, "bool", origin)),
        },
        "enum" => {
            let text = raw.trim();
            if definition.enum_values.iter().any(|item| item == text) {
                Ok(Value::String(text.to_string()))
            } else {
                Err(ConfigError(format!(
                    "配置中心项 {key} 不在枚举范围：期望 enum [{}]，收到 {text}（{origin}）",
                    definition.enum_values.join(", ")
                )))
            }
        }
        other => Err(ConfigError(format!(
            "配置中心项 {key} 的类型声明非法：{other}，只允许 string/number/bool/enum"
        ))),
    }
}

fn infer_type(value: &Value) -> &'static str {
    match value {
        Value::Number(_) => "number",
        Value::Bool(_) => "bool",
        Value::Array(_) => "enum",
        _ => "string",
    }
}

fn infer_env_value(type_name: &str, raw: &str, key: &str) -> Result<Value, ConfigError> {
    match type_name {
        "number" => raw
            .trim()
            .parse::<i64>()
            .map(Value::from)
            .or_else(|_| raw.trim().parse::<f64>().map(Value::from))
            .map_err(|_| ConfigError(format!("配置中心项 {key} 期望 number，收到非数字值"))),
        "bool" => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(Value::Bool(true)),
            "0" | "false" | "no" | "off" => Ok(Value::Bool(false)),
            _ => Err(ConfigError(format!(
                "配置中心项 {key} 期望 bool，收到非布尔值"
            ))),
        },
        _ => Ok(Value::String(raw.to_string())),
    }
}

fn cli_override<'a>(cli: &'a [(String, String)], key: &str) -> Option<&'a str> {
    cli.iter()
        .rev()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

/// 覆盖链：default < generated < user < env < cli。secret 只接受 env / cli。
pub fn build(
    config: &ConfigCenterConfig,
    generated: &Value,
    user: &Value,
    env: &HashMap<String, String>,
    cli: &[(String, String)],
    warnings: &mut Vec<String>,
) -> Result<ConfigCenter, ConfigError> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    for definition in &config.definitions {
        let key = definition.key.trim();
        if key.is_empty() {
            return Err(ConfigError(
                "configCenter.definitions 存在空的 key".to_string(),
            ));
        }
        if !seen.insert(key.to_string()) {
            return Err(ConfigError(format!(
                "configCenter.definitions 存在重复 key：{key}"
            )));
        }

        let env_key = env_name(key);
        let cli_value = cli_override(cli, key);
        let env_value = env.get(&env_key).filter(|value| !value.is_empty());

        let mut value = definition.default.clone();
        let mut source = "default".to_string();

        if !definition.secret {
            if let Some(entry) = values_at(generated).and_then(|values| values.get(key)) {
                if !is_empty_value(entry) {
                    value = expect_type(definition, entry, "config.generated.yaml")?;
                    source = "generated".to_string();
                }
            }
            if let Some(entry) = values_at(user).and_then(|values| values.get(key)) {
                if !is_empty_value(entry) {
                    value = expect_type(definition, entry, "config.yaml")?;
                    source = "user".to_string();
                }
            }
        } else {
            let file_value = values_at(generated)
                .and_then(|values| values.get(key))
                .or_else(|| values_at(user).and_then(|values| values.get(key)));
            if file_value.is_some_and(|entry| !is_empty_value(entry)) {
                warnings.push(format!(
                    "配置中心项 {key} 是密钥，已忽略配置文件中的密钥值（不会打印原值）"
                ));
            }
        }

        if let Some(raw) = env_value {
            value = parse_string_value(definition, raw, &format!("环境变量 {env_key}"))?;
            source = "env".to_string();
        }
        if let Some(raw) = cli_value {
            value = parse_string_value(definition, raw, &format!("--cfg {key}"))?;
            source = "cli".to_string();
        }

        if definition.secret && source != "env" && source != "cli" {
            return Err(ConfigError(format!(
                "配置中心缺少密钥 {key}（type={}）：请设置环境变量 {env_key} 或使用 --cfg {key}=VALUE",
                definition.value_type
            )));
        }

        entries.push(ConfigCenterEntry {
            key: key.to_string(),
            value,
            source,
            value_type: definition.value_type.clone(),
            secret: definition.secret,
            description: definition.description.clone(),
            enum_values: definition.enum_values.clone(),
            builtin: false,
        });
    }

    // 未在 definitions 中声明的 values / 环境变量也允许读取（无类型声明，按值推断）。
    for (key, entry) in config.values.iter() {
        if seen.contains(key) || is_empty_value(entry) {
            continue;
        }
        seen.insert(key.clone());
        let mut value = entry.clone();
        let mut source = "user".to_string();
        if let Some(from_generated) = values_at(generated).and_then(|values| values.get(key)) {
            if !is_empty_value(from_generated) {
                value = from_generated.clone();
                source = "generated".to_string();
            }
        }
        if let Some(raw) = env.get(&env_name(key)).filter(|v| !v.is_empty()) {
            value = infer_env_value(infer_type(&value), raw, key)?;
            source = "env".to_string();
        }
        if let Some(raw) = cli_override(cli, key) {
            value = infer_env_value(infer_type(&value), raw, key)?;
            source = "cli".to_string();
        }
        entries.push(ConfigCenterEntry {
            value: value.clone(),
            key: key.clone(),
            source,
            value_type: infer_type(&value).to_string(),
            secret: false,
            description: String::new(),
            enum_values: Vec::new(),
            builtin: false,
        });
    }

    let mut extra_keys: Vec<String> = Vec::new();
    for (root, source) in [(generated, "generated"), (user, "user")] {
        if let Some(values) = values_at(root) {
            for key in values.keys() {
                if !seen.contains(key) && !extra_keys.iter().any(|item| item == key) {
                    let non_empty = values.get(key).is_some_and(|value| !is_empty_value(value));
                    if non_empty {
                        extra_keys.push(key.clone());
                    }
                }
            }
        }
        let _ = source;
    }
    for key in extra_keys {
        let generated_value = values_at(generated).and_then(|values| values.get(&key));
        let user_value = values_at(user).and_then(|values| values.get(&key));
        let mut value = Value::Null;
        let mut source = "default".to_string();
        if let Some(entry) = generated_value {
            if !is_empty_value(entry) {
                value = entry.clone();
                source = "generated".to_string();
            }
        }
        if let Some(entry) = user_value {
            if !is_empty_value(entry) {
                value = entry.clone();
                source = "user".to_string();
            }
        }
        if let Some(raw) = env.get(&env_name(&key)).filter(|v| !v.is_empty()) {
            value = infer_env_value(infer_type(&value), raw, &key)?;
            source = "env".to_string();
        }
        if let Some(raw) = cli_override(cli, &key) {
            value = infer_env_value(infer_type(&value), raw, &key)?;
            source = "cli".to_string();
        }
        seen.insert(key.clone());
        entries.push(ConfigCenterEntry {
            value: value.clone(),
            key: key.clone(),
            source,
            value_type: infer_type(&value).to_string(),
            secret: false,
            description: String::new(),
            enum_values: Vec::new(),
            builtin: false,
        });
    }

    Ok(ConfigCenter { entries })
}
