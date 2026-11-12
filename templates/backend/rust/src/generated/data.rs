// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 集合 CRUD：读取 collectionsDir 下的 *.json 集合定义，行数据存在 collection_rows 表。
// 启动时加载一次集合定义（进程内缓存）；所有查询统一写 `?` 占位符，再交给 adapt_sql 适配 PostgreSQL。
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use axum::http::HeaderMap;
use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, Utc};
use serde_json::{Map, Number, Value};
use sqlx::any::AnyRow;
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::generated::auth::AuthService;
use crate::generated::config::DataApiConfig;
use crate::generated::db::{adapt_sql, safe_message};
use crate::generated::error::{bad, AppError, FieldIssue};

const DEFAULT_PAGE_SIZE: i64 = 20;
const PAGE_LIMIT: i64 = 1 << 30;
// 平台没有配置 maxLength 时，文本仍有一个硬上限，避免单行无限膨胀。
const TEXT_HARD_LIMIT: usize = 20000;

// ---------------------------------------------------------------- 集合定义

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldType {
    Text,
    Number,
    Boolean,
    Date,
    Enum,
    Reference,
    Json,
}

impl FieldType {
    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "text" => Some(Self::Text),
            "number" => Some(Self::Number),
            "boolean" => Some(Self::Boolean),
            "date" => Some(Self::Date),
            "enum" => Some(Self::Enum),
            "reference" => Some(Self::Reference),
            "json" => Some(Self::Json),
            _ => None,
        }
    }

    fn default_value(self, enum_values: &[String]) -> Value {
        match self {
            Self::Number => Value::Number(Number::from(0)),
            Self::Boolean => Value::Bool(false),
            Self::Enum => Value::String(enum_values.first().cloned().unwrap_or_default()),
            Self::Json => Value::Null,
            Self::Text | Self::Date | Self::Reference => Value::String(String::new()),
        }
    }

    fn is_string_like(self) -> bool {
        matches!(self, Self::Text | Self::Enum | Self::Reference | Self::Date)
    }
}

#[derive(Debug, Clone)]
struct Field {
    id: String,
    name: String,
    kind: FieldType,
    required: bool,
    unique: bool,
    enum_values: Vec<String>,
    max_length: usize,
    #[allow(dead_code)]
    ref_collection: String,
    #[allow(dead_code)]
    ref_field: String,
}

#[derive(Debug, Clone)]
struct IndexDef {
    id: String,
    fields: Vec<String>,
    unique: bool,
}

#[derive(Debug, Clone)]
struct Collection {
    id: String,
    #[allow(dead_code)]
    name: String,
    fields: Vec<Field>,
    field_map: HashMap<String, Field>,
    indexes: Vec<IndexDef>,
    read_authenticated: bool,
    write_roles: Vec<String>,
}

struct StoredRow {
    id: String,
    data: Map<String, Value>,
    created_at: String,
    updated_at: String,
}

impl Clone for StoredRow {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            data: self.data.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

pub struct DataService {
    config: DataApiConfig,
    pool: AnyPool,
    auth: Arc<AuthService>,
    collections: HashMap<String, Collection>,
}

impl DataService {
    pub fn new(config: &DataApiConfig, pool: AnyPool, auth: Arc<AuthService>) -> Self {
        let collections = load_collections(&config.collections_dir);
        Self {
            config: config.clone(),
            pool,
            auth,
            collections,
        }
    }

    pub async fn list(
        &self,
        collection_id: &str,
        headers: &HeaderMap,
        query: &HashMap<String, String>,
    ) -> Result<Value, AppError> {
        self.ensure_enabled()?;
        let collection = self.require_collection(collection_id)?;
        self.guard_read(collection, headers).await?;

        let page = read_int(query.get("page"), "page", 1, 1, PAGE_LIMIT)?;
        let requested_size = read_int(
            query.get("pageSize"),
            "pageSize",
            DEFAULT_PAGE_SIZE,
            1,
            PAGE_LIMIT,
        )?;
        let page_size = requested_size.min(i64::from(self.config.max_page_size));
        let filters = parse_filter(query.get("filter"), collection)?;
        let keyword = query
            .get("q")
            .map(|value| value.trim().to_lowercase())
            .unwrap_or_default();
        let sort = parse_sort(query.get("sort"), collection)?;
        let fields = parse_fields(query.get("fields"), collection)?;

        let all = self.read_rows(collection).await?;
        let mut matched: Vec<&StoredRow> = all
            .iter()
            .filter(|row| {
                filters.iter().all(|item| matches_filter(row, item))
                    && (keyword.is_empty() || keyword_matches(row, collection, &keyword))
            })
            .collect();
        matched.sort_by(|left, right| compare_rows(*left, *right, &sort));

        let total = matched.len() as i64;
        let start = (page - 1).saturating_mul(page_size);
        let items: Vec<Value> = matched
            .iter()
            .copied()
            .skip(start.max(0) as usize)
            .take(page_size.max(0) as usize)
            .map(|row| project(row, fields.as_deref()))
            .collect();

        let capped = requested_size > page_size;
        let has_more = start + (items.len() as i64) < total;
        let mut data = json_object(vec![
            ("items", Value::Array(items)),
            ("page", Value::from(page)),
            ("pageSize", Value::from(page_size)),
            ("total", Value::from(total)),
            ("hasMore", Value::Bool(has_more)),
            ("pageSizeCapped", Value::Bool(capped)),
        ]);
        if capped {
            data.insert("pageSizeRequested".to_string(), Value::from(requested_size));
        }
        Ok(Value::Object(data))
    }

    pub async fn get_one(
        &self,
        collection_id: &str,
        row_id: &str,
        headers: &HeaderMap,
    ) -> Result<Value, AppError> {
        self.ensure_enabled()?;
        let collection = self.require_collection(collection_id)?;
        self.guard_read(collection, headers).await?;
        let row = self.find_row(collection, row_id).await?;
        match row {
            Some(row) => Ok(project(&row, None)),
            None => Err(AppError::NotFound(format!("记录不存在：{row_id}"))),
        }
    }

    pub async fn create(
        &self,
        collection_id: &str,
        headers: &HeaderMap,
        body: &Value,
    ) -> Result<Value, AppError> {
        self.ensure_enabled()?;
        let collection = self.require_collection(collection_id)?;
        self.guard_write(collection, headers).await?;

        let all = self.read_rows(collection).await?;
        let data = normalize_row(collection, body, None)?;
        check_uniqueness(collection, None, &data, &all)?;

        let id = format!("row-{}", Uuid::new_v4());
        let now = now_iso();
        let data_text = serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string());
        let sql = adapt_sql(
            &self.pool,
            "INSERT INTO collection_rows (collection_id, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        );
        sqlx::query(&sql)
            .bind(&collection.id)
            .bind(&id)
            .bind(&data_text)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(db_failure)?;

        let mut out = data;
        out.insert("id".to_string(), Value::String(id));
        out.insert("createdAt".to_string(), Value::String(now.clone()));
        out.insert("updatedAt".to_string(), Value::String(now));
        Ok(Value::Object(out))
    }

    pub async fn update(
        &self,
        collection_id: &str,
        row_id: &str,
        headers: &HeaderMap,
        body: &Value,
    ) -> Result<Value, AppError> {
        self.ensure_enabled()?;
        let collection = self.require_collection(collection_id)?;
        self.guard_write(collection, headers).await?;

        let all = self.read_rows(collection).await?;
        let existing = all
            .iter()
            .find(|row| row.id == row_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("记录不存在：{row_id}")))?;
        let data = normalize_row(collection, body, Some(&existing))?;
        check_uniqueness(collection, Some(row_id), &data, &all)?;

        let now = now_iso();
        let data_text = serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string());
        let sql = adapt_sql(
            &self.pool,
            "UPDATE collection_rows SET data = ?, updated_at = ? WHERE collection_id = ? AND id = ?",
        );
        sqlx::query(&sql)
            .bind(&data_text)
            .bind(&now)
            .bind(&collection.id)
            .bind(row_id)
            .execute(&self.pool)
            .await
            .map_err(db_failure)?;

        let mut out = data;
        out.insert("id".to_string(), Value::String(row_id.to_string()));
        out.insert("createdAt".to_string(), Value::String(existing.created_at));
        out.insert("updatedAt".to_string(), Value::String(now));
        Ok(Value::Object(out))
    }

    pub async fn remove(
        &self,
        collection_id: &str,
        row_id: &str,
        headers: &HeaderMap,
    ) -> Result<Value, AppError> {
        self.ensure_enabled()?;
        let collection = self.require_collection(collection_id)?;
        self.guard_write(collection, headers).await?;

        let sql = adapt_sql(
            &self.pool,
            "DELETE FROM collection_rows WHERE collection_id = ? AND id = ?",
        );
        let result = sqlx::query(&sql)
            .bind(&collection.id)
            .bind(row_id)
            .execute(&self.pool)
            .await
            .map_err(db_failure)?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("记录不存在：{row_id}")));
        }
        Ok(Value::Object(json_object(vec![
            ("id", Value::String(row_id.to_string())),
            ("deleted", Value::Bool(true)),
        ])))
    }

    // ---------------------------------------------------------------- 内部

    fn ensure_enabled(&self) -> Result<(), AppError> {
        if self.config.enabled {
            Ok(())
        } else {
            Err(AppError::NotFound("接口不存在".to_string()))
        }
    }

    fn require_collection(&self, id: &str) -> Result<&Collection, AppError> {
        self.collections
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("集合不存在：{id}")))
    }

    async fn guard_read(
        &self,
        collection: &Collection,
        headers: &HeaderMap,
    ) -> Result<(), AppError> {
        if !collection.read_authenticated && self.config.public_read {
            return Ok(());
        }
        self.auth.authenticate(headers).await?;
        Ok(())
    }

    async fn guard_write(
        &self,
        collection: &Collection,
        headers: &HeaderMap,
    ) -> Result<(), AppError> {
        let roles: &Vec<String> = if collection.write_roles.is_empty() {
            &self.config.write_roles
        } else {
            &collection.write_roles
        };
        if !roles.is_empty() {
            let context = self.auth.authenticate(headers).await?;
            if !context.roles.iter().any(|role| roles.contains(role)) {
                return Err(AppError::Forbidden("当前角色不能写入该集合".to_string()));
            }
            return Ok(());
        }
        if self.config.write_requires_auth {
            self.auth.authenticate(headers).await?;
        }
        Ok(())
    }

    async fn read_rows(&self, collection: &Collection) -> Result<Vec<StoredRow>, AppError> {
        let sql = adapt_sql(
            &self.pool,
            "SELECT id, data, created_at, updated_at FROM collection_rows WHERE collection_id = ?",
        );
        let rows = sqlx::query(&sql)
            .bind(&collection.id)
            .fetch_all(&self.pool)
            .await
            .map_err(db_failure)?;
        let mysql = is_mysql(&self.pool);
        rows.iter()
            .map(|row| to_stored_row(row, mysql))
            .collect::<Result<Vec<_>, AppError>>()
    }

    async fn find_row(
        &self,
        collection: &Collection,
        row_id: &str,
    ) -> Result<Option<StoredRow>, AppError> {
        let sql = adapt_sql(
            &self.pool,
            "SELECT id, data, created_at, updated_at FROM collection_rows WHERE collection_id = ? AND id = ?",
        );
        let row = sqlx::query(&sql)
            .bind(&collection.id)
            .bind(row_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_failure)?;
        let mysql = is_mysql(&self.pool);
        row.map(|row| to_stored_row(&row, mysql)).transpose()
    }
}

fn json_object(entries: Vec<(&str, Value)>) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert(key.to_string(), value);
    }
    map
}

fn db_failure(err: sqlx::Error) -> AppError {
    let detail = safe_message(&err);
    tracing::error!(reason = %detail, "数据接口数据库操作失败");
    AppError::DbUnavailable(detail)
}

fn is_mysql(pool: &AnyPool) -> bool {
    pool.connect_options().database_url.scheme() == "mysql"
}

/// MySQL 驱动把 TEXT 识别为 BLOB，按驱动分支解码。
fn read_text(row: &AnyRow, column: &str, mysql: bool) -> sqlx::Result<String> {
    if mysql {
        let bytes: Vec<u8> = row.try_get(column)?;
        String::from_utf8(bytes).map_err(|err| sqlx::Error::Decode(Box::new(err)))
    } else {
        row.try_get(column)
    }
}

fn to_stored_row(row: &AnyRow, mysql: bool) -> Result<StoredRow, AppError> {
    let id: String = row.try_get("id").map_err(db_failure)?;
    let raw_data = read_text(row, "data", mysql).map_err(db_failure)?;
    let created_at: String = row.try_get("created_at").map_err(db_failure)?;
    let updated_at: String = row.try_get("updated_at").map_err(db_failure)?;
    let parsed: Value = serde_json::from_str(&raw_data)
        .map_err(|_| AppError::Internal("集合行数据损坏".to_string()))?;
    let data = match parsed {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    Ok(StoredRow {
        id,
        data,
        created_at,
        updated_at,
    })
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

// ---------------------------------------------------------------- 集合加载

fn load_collections(dir_value: &str) -> HashMap<String, Collection> {
    let dir = resolve_collections_dir(dir_value);
    let mut out = HashMap::new();
    if !dir.exists() {
        tracing::warn!(
            "集合目录不存在，数据接口暂无可服务的集合：{}",
            dir.display()
        );
        return out;
    }
    let mut names: Vec<String> = match fs::read_dir(&dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect(),
        Err(err) => {
            tracing::warn!("读取集合目录失败（{}）：{err}", dir.display());
            return out;
        }
    };
    names.sort();
    for name in names {
        if !name.ends_with(".json") {
            continue;
        }
        let path = dir.join(&name);
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) => {
                tracing::warn!("集合文件 {name} 已跳过：{err}");
                continue;
            }
        };
        let raw: Value = match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!("集合文件 {name} 已跳过：{err}");
                continue;
            }
        };
        match normalize_collection(&raw, &name) {
            Ok(collection) => {
                out.insert(collection.id.clone(), collection);
            }
            Err(err) => tracing::warn!("集合文件 {name} 已跳过：{err}"),
        }
    }
    out
}

fn resolve_collections_dir(dir_value: &str) -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let configured = cwd.join(dir_value);
    if configured.exists() {
        return configured;
    }
    let local = cwd.join("collections");
    if local.exists() {
        return local;
    }
    configured
}

fn normalize_collection(raw: &Value, file_name: &str) -> Result<Collection, String> {
    let source = raw.as_object().cloned().unwrap_or_default();
    let fallback_id = strip_json_suffix(file_name).to_lowercase();
    let raw_id = source.get("id").map(js_string_truthy).unwrap_or_default();
    let id = if raw_id.is_empty() {
        fallback_id
    } else {
        raw_id.to_lowercase()
    };
    if !is_valid_id(&id) {
        return Err(format!("集合 ID 非法：{id}"));
    }
    let raw_name = source.get("name").map(js_string_truthy).unwrap_or_default();
    let name = if raw_name.trim().is_empty() {
        id.clone()
    } else {
        raw_name.trim().to_string()
    };

    let mut fields = Vec::new();
    if let Some(items) = source.get("fields").and_then(Value::as_array) {
        for item in items {
            fields.push(normalize_field(item)?);
        }
    }
    if fields.is_empty() {
        return Err("集合至少需要一个字段".to_string());
    }
    let mut taken = HashSet::new();
    for field in &fields {
        if !taken.insert(field.id.clone()) {
            return Err(format!("字段 ID 重复：{}", field.id));
        }
    }
    let field_map: HashMap<String, Field> = fields
        .iter()
        .map(|field| (field.id.clone(), field.clone()))
        .collect();

    let mut indexes = Vec::new();
    if let Some(items) = source.get("indexes").and_then(Value::as_array) {
        for (index, item) in items.iter().enumerate() {
            let index_source = item.as_object().cloned().unwrap_or_default();
            let ids: Vec<String> = index_source
                .get("fields")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .map(js_string_truthy)
                        .filter(|value| taken.contains(value))
                        .collect()
                })
                .unwrap_or_default();
            if ids.is_empty() {
                return Err(format!("第 {} 个索引没有有效字段", index + 1));
            }
            let raw_index_id = index_source
                .get("id")
                .map(js_string_truthy)
                .unwrap_or_default();
            let index_id = if raw_index_id.is_empty() {
                format!("idx-{}", ids.join("-"))
            } else {
                raw_index_id
            };
            indexes.push(IndexDef {
                id: index_id,
                fields: ids,
                unique: index_source.get("unique").and_then(Value::as_bool) == Some(true),
            });
        }
    }

    let access = source.get("access").and_then(Value::as_object);
    let read_authenticated = access
        .and_then(|access| access.get("read"))
        .and_then(Value::as_str)
        == Some("authenticated");
    let write_roles = access
        .and_then(|access| access.get("write"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(js_string_truthy)
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Ok(Collection {
        id,
        name,
        fields,
        field_map,
        indexes,
        read_authenticated,
        write_roles,
    })
}

fn strip_json_suffix(name: &str) -> &str {
    if name.len() >= 5 {
        let suffix = name.get(name.len() - 5..).unwrap_or_default();
        if suffix.eq_ignore_ascii_case(".json") {
            return name.get(..name.len() - 5).unwrap_or(name);
        }
    }
    name
}

fn normalize_field(raw: &Value) -> Result<Field, String> {
    let source = raw.as_object().cloned().unwrap_or_default();
    let raw_id = source.get("id").map(js_string_truthy).unwrap_or_default();
    let id = raw_id.to_lowercase();
    if !is_valid_id(&id) {
        return Err(format!("字段 ID 非法：{raw_id}"));
    }
    let raw_type = source.get("type").map(js_string_truthy).unwrap_or_default();
    let type_name = if raw_type.is_empty() {
        "text".to_string()
    } else {
        raw_type.to_lowercase()
    };
    let kind = FieldType::parse(&type_name)
        .ok_or_else(|| format!("字段「{id}」类型不支持：{type_name}"))?;
    let raw_name = source.get("name").map(js_string_truthy).unwrap_or_default();
    let name = if raw_name.trim().is_empty() {
        id.clone()
    } else {
        raw_name
    };
    let enum_values: Vec<String> = source
        .get("enumValues")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .map(js_string)
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if kind == FieldType::Enum && enum_values.is_empty() {
        return Err(format!("枚举字段「{id}」缺少 enumValues"));
    }
    let max_length = source
        .get("maxLength")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0 && value.fract() == 0.0)
        .map(|value| value as usize)
        .unwrap_or(0);
    Ok(Field {
        id,
        name,
        kind,
        required: source.get("required").and_then(Value::as_bool) == Some(true),
        unique: source.get("unique").and_then(Value::as_bool) == Some(true),
        enum_values,
        max_length,
        ref_collection: source
            .get("refCollection")
            .map(js_string_truthy)
            .unwrap_or_default(),
        ref_field: source
            .get("refField")
            .map(js_string_truthy)
            .unwrap_or_default(),
    })
}

fn is_valid_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    let mut chars = id.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    id.chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
}

// ---------------------------------------------------------------- 查询参数

fn read_int(
    raw: Option<&String>,
    field: &str,
    fallback: i64,
    min: i64,
    max: i64,
) -> Result<i64, AppError> {
    let Some(raw) = raw else {
        return Ok(fallback);
    };
    if raw.is_empty() {
        return Ok(fallback);
    }
    let value = raw
        .trim()
        .parse::<f64>()
        .map_err(|_| bad(field, format!("{field} 必须是 {min}-{max} 的整数")))?;
    if !value.is_finite() || value.fract() != 0.0 || value < min as f64 || value > max as f64 {
        return Err(bad(field, format!("{field} 必须是 {min}-{max} 的整数")));
    }
    Ok(value as i64)
}

enum FilterTarget {
    Id,
    Field(Field),
}

struct FilterItem {
    target: FilterTarget,
    value: Value,
}

fn parse_filter(
    raw: Option<&String>,
    collection: &Collection,
) -> Result<Vec<FilterItem>, AppError> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Ok(Vec::new());
    };
    let parsed: Value =
        serde_json::from_str(raw).map_err(|_| bad("filter", "filter 必须是 JSON 对象"))?;
    let Some(object) = parsed.as_object() else {
        return Err(bad("filter", "filter 必须是 JSON 对象"));
    };
    let mut out = Vec::new();
    for (key, value) in object {
        if key == "id" {
            out.push(FilterItem {
                target: FilterTarget::Id,
                value: value.clone(),
            });
            continue;
        }
        let Some(field) = collection.field_map.get(key) else {
            return Err(bad("filter", format!("filter 引用了不存在的字段：{key}")));
        };
        match field.kind {
            FieldType::Number if !js_number(value).is_finite() => {
                return Err(bad("filter", format!("filter 字段「{key}」需要数字")));
            }
            FieldType::Boolean if boolean_value(value).is_none() => {
                return Err(bad("filter", format!("filter 字段「{key}」需要布尔值")));
            }
            _ => {}
        }
        out.push(FilterItem {
            target: FilterTarget::Field(field.clone()),
            value: value.clone(),
        });
    }
    Ok(out)
}

struct SortKey {
    key: String,
    desc: bool,
}

fn parse_sort(raw: Option<&String>, collection: &Collection) -> Result<Vec<SortKey>, AppError> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Ok(vec![
            SortKey {
                key: "createdAt".to_string(),
                desc: true,
            },
            SortKey {
                key: "id".to_string(),
                desc: false,
            },
        ]);
    };
    let items: Vec<&str> = raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect();
    if items.is_empty() {
        return Err(bad("sort", "sort 不能为空"));
    }
    let mut out = Vec::new();
    for item in items {
        let desc = item.starts_with('-');
        let key = if desc { &item[1..] } else { item };
        if !sortable(collection, key) {
            return Err(bad("sort", format!("sort 引用了不存在的字段：{key}")));
        }
        out.push(SortKey {
            key: key.to_string(),
            desc,
        });
    }
    Ok(out)
}

fn sortable(collection: &Collection, key: &str) -> bool {
    matches!(key, "id" | "createdAt" | "updatedAt") || collection.field_map.contains_key(key)
}

fn parse_fields(
    raw: Option<&String>,
    collection: &Collection,
) -> Result<Option<Vec<String>>, AppError> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let items: Vec<&str> = raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect();
    if items.is_empty() {
        return Err(bad("fields", "fields 不能为空"));
    }
    for key in &items {
        if !sortable(collection, key) {
            return Err(bad("fields", format!("fields 引用了不存在的字段：{key}")));
        }
    }
    Ok(Some(items.iter().map(|item| item.to_string()).collect()))
}

// ---------------------------------------------------------------- 过滤 / 排序 / 投影

fn matches_filter(row: &StoredRow, item: &FilterItem) -> bool {
    match &item.target {
        FilterTarget::Id => js_string(&item.value) == row.id,
        FilterTarget::Field(field) => {
            let actual = row.data.get(&field.id);
            match field.kind {
                FieldType::Number => {
                    actual.map(js_number).unwrap_or(f64::NAN) == js_number(&item.value)
                }
                FieldType::Boolean => {
                    actual.map(js_truthy).unwrap_or(false)
                        == boolean_value(&item.value).unwrap_or(false)
                }
                FieldType::Json => match actual {
                    Some(value) => stable_text(value) == stable_text(&item.value),
                    None => false,
                },
                _ => {
                    actual.map(js_string_or_empty).unwrap_or_default()
                        == js_string_or_empty(&item.value)
                }
            }
        }
    }
}

fn keyword_matches(row: &StoredRow, collection: &Collection, keyword: &str) -> bool {
    for field in &collection.fields {
        if !matches!(
            field.kind,
            FieldType::Text | FieldType::Enum | FieldType::Reference
        ) {
            continue;
        }
        let text = row
            .data
            .get(&field.id)
            .map(js_string_or_empty)
            .unwrap_or_default()
            .to_lowercase();
        if text.contains(keyword) {
            return true;
        }
    }
    false
}

fn compare_rows(left: &StoredRow, right: &StoredRow, sort: &[SortKey]) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    for item in sort {
        let a = sort_value(left, &item.key);
        let b = sort_value(right, &item.key);
        let result = match (&a, &b) {
            (Value::Number(x), Value::Number(y)) => x
                .as_f64()
                .partial_cmp(&y.as_f64())
                .unwrap_or(Ordering::Equal),
            (Value::Bool(x), Value::Bool(y)) => (*x as i32).cmp(&(*y as i32)),
            _ => js_string(&a).cmp(&js_string(&b)),
        };
        if result != Ordering::Equal {
            return if item.desc { result.reverse() } else { result };
        }
    }
    left.id.cmp(&right.id)
}

fn sort_value(row: &StoredRow, key: &str) -> Value {
    match key {
        "id" => Value::String(row.id.clone()),
        "createdAt" => Value::String(row.created_at.clone()),
        "updatedAt" => Value::String(row.updated_at.clone()),
        _ => match row.data.get(key) {
            Some(Value::Null) | None => Value::String(String::new()),
            Some(value) => value.clone(),
        },
    }
}

fn project(row: &StoredRow, fields: Option<&[String]>) -> Value {
    let mut out = Map::new();
    out.insert("id".to_string(), Value::String(row.id.clone()));
    match fields {
        None => {
            for (key, value) in &row.data {
                out.insert(key.clone(), value.clone());
            }
            out.insert(
                "createdAt".to_string(),
                Value::String(row.created_at.clone()),
            );
            out.insert(
                "updatedAt".to_string(),
                Value::String(row.updated_at.clone()),
            );
        }
        Some(list) => {
            for key in list {
                match key.as_str() {
                    "id" => {}
                    "createdAt" => {
                        out.insert(
                            "createdAt".to_string(),
                            Value::String(row.created_at.clone()),
                        );
                    }
                    "updatedAt" => {
                        out.insert(
                            "updatedAt".to_string(),
                            Value::String(row.updated_at.clone()),
                        );
                    }
                    _ => {
                        if let Some(value) = row.data.get(key) {
                            out.insert(key.clone(), value.clone());
                        }
                    }
                }
            }
        }
    }
    Value::Object(out)
}

// ---------------------------------------------------------------- 字段校验

fn normalize_row(
    collection: &Collection,
    input: &Value,
    existing: Option<&StoredRow>,
) -> Result<Map<String, Value>, AppError> {
    let Some(object) = input.as_object() else {
        return Err(AppError::InvalidRow {
            field: "body".to_string(),
            message: "字段校验失败".to_string(),
            fields: vec![FieldIssue {
                field: "body".to_string(),
                code: "type".to_string(),
                message: "行必须是 JSON 对象".to_string(),
            }],
        });
    };

    let mut errors: Vec<FieldIssue> = Vec::new();
    for key in object.keys() {
        if matches!(key.as_str(), "id" | "_id" | "createdAt" | "updatedAt") {
            continue;
        }
        if !collection.field_map.contains_key(key) {
            errors.push(FieldIssue {
                field: key.clone(),
                code: "unknown".to_string(),
                message: format!("未知字段：{key}"),
            });
        }
    }

    let mut out = existing.map(|row| row.data.clone()).unwrap_or_default();
    for field in &collection.fields {
        let present = object.contains_key(&field.id);
        let raw = if present {
            object.get(&field.id)
        } else {
            existing.and_then(|row| row.data.get(&field.id))
        };
        match coerce(field, raw) {
            Ok(value) => {
                out.insert(field.id.clone(), value);
            }
            Err(issue) => errors.push(issue),
        }
    }

    if !errors.is_empty() {
        let field = errors[0].field.clone();
        return Err(AppError::InvalidRow {
            field,
            message: "字段校验失败".to_string(),
            fields: errors,
        });
    }
    Ok(out)
}

fn coerce(field: &Field, raw: Option<&Value>) -> Result<Value, FieldIssue> {
    let label = if field.name.is_empty() {
        &field.id
    } else {
        &field.name
    };
    let empty = match raw {
        None => true,
        Some(value) => is_empty(field.kind, value),
    };
    if empty {
        if field.required {
            return Err(issue(field, "required", format!("字段「{label}」必填")));
        }
        return Ok(field.kind.default_value(&field.enum_values));
    }
    let raw = raw.unwrap();
    match field.kind {
        FieldType::Text => match raw {
            Value::String(text) => {
                let limit = if field.max_length > 0 {
                    field.max_length
                } else {
                    TEXT_HARD_LIMIT
                };
                if text.chars().count() > limit {
                    return Err(issue(
                        field,
                        "length",
                        format!("字段「{label}」最多 {limit} 个字符"),
                    ));
                }
                Ok(Value::String(text.clone()))
            }
            _ => Err(issue(field, "type", format!("字段「{label}」需要文本"))),
        },
        FieldType::Number => {
            let value = js_number(raw);
            if !value.is_finite() {
                return Err(issue(field, "type", format!("字段「{label}」需要数字")));
            }
            Ok(number_value(value))
        }
        FieldType::Boolean => match raw {
            Value::Bool(value) => Ok(Value::Bool(*value)),
            _ => Err(issue(field, "type", format!("字段「{label}」需要布尔值"))),
        },
        FieldType::Date => match raw {
            Value::String(text) if parse_date_ok(text) => Ok(Value::String(text.clone())),
            _ => Err(issue(
                field,
                "type",
                format!("字段「{label}」需要有效日期字符串"),
            )),
        },
        FieldType::Enum => {
            let value = js_string(raw);
            if !field.enum_values.contains(&value) {
                return Err(issue(
                    field,
                    "enum",
                    format!("字段「{label}」只能是：{}", field.enum_values.join(" / ")),
                ));
            }
            Ok(Value::String(value))
        }
        FieldType::Reference => match raw {
            Value::String(value) => Ok(Value::String(value.clone())),
            Value::Number(_) => Ok(Value::String(js_string(raw))),
            _ => Err(issue(field, "type", format!("字段「{label}」需要引用 ID"))),
        },
        FieldType::Json => {
            if let Value::String(text) = raw {
                match serde_json::from_str::<Value>(text) {
                    Ok(value) => Ok(value),
                    Err(_) => Err(issue(
                        field,
                        "type",
                        format!("字段「{label}」不是合法 JSON"),
                    )),
                }
            } else {
                Ok(raw.clone())
            }
        }
    }
}

fn issue(field: &Field, code: &str, message: String) -> FieldIssue {
    FieldIssue {
        field: field.id.clone(),
        code: code.to_string(),
        message,
    }
}

fn is_empty(kind: FieldType, raw: &Value) -> bool {
    if raw.is_null() {
        return true;
    }
    if kind.is_string_like() {
        if let Value::String(text) = raw {
            return text.trim().is_empty();
        }
    }
    false
}

fn parse_date_ok(text: &str) -> bool {
    if DateTime::parse_from_rfc3339(text).is_ok() {
        return true;
    }
    if NaiveDate::parse_from_str(text, "%Y-%m-%d").is_ok() {
        return true;
    }
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").is_ok()
        || NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f").is_ok()
        || NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").is_ok()
}

fn number_value(value: f64) -> Value {
    if value.fract() == 0.0 && value >= i64::MIN as f64 && value <= i64::MAX as f64 {
        Value::Number(Number::from(value as i64))
    } else {
        Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

// ---------------------------------------------------------------- 唯一约束

struct UniqueCheck {
    fields: Vec<String>,
    label: String,
}

fn check_uniqueness(
    collection: &Collection,
    candidate_id: Option<&str>,
    data: &Map<String, Value>,
    rows: &[StoredRow],
) -> Result<(), AppError> {
    let mut checks = Vec::new();
    for field in &collection.fields {
        if field.unique {
            checks.push(UniqueCheck {
                fields: vec![field.id.clone()],
                label: format!("字段「{}」", field.name),
            });
        }
    }
    for index in &collection.indexes {
        if index.unique {
            checks.push(UniqueCheck {
                fields: index.fields.clone(),
                label: format!("索引「{}」", index.id),
            });
        }
    }

    for check in checks {
        let probe: Vec<Option<String>> = check
            .fields
            .iter()
            .map(|id| data.get(id).map(stable_text))
            .collect();
        for other in rows {
            if candidate_id == Some(other.id.as_str()) {
                continue;
            }
            let target: Vec<Option<String>> = check
                .fields
                .iter()
                .map(|id| other.data.get(id).map(stable_text))
                .collect();
            if probe == target {
                let fields = check
                    .fields
                    .iter()
                    .map(|id| FieldIssue {
                        field: id.clone(),
                        code: "unique".to_string(),
                        message: format!("{}必须唯一", check.label),
                    })
                    .collect();
                return Err(AppError::RowConflict {
                    field: check.fields[0].clone(),
                    message: format!("{}必须唯一，已存在相同值的行", check.label),
                    fields,
                });
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- JS 语义辅助

fn stable_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| js_string(value))
}

/// 近似 JS 的 String(value)：null 行为由调用方决定，这里按 JS 的默认输出。
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::String(text) => text.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

/// String(value == null ? '' : value)
fn js_string_or_empty(value: &Value) -> String {
    if value.is_null() {
        String::new()
    } else {
        js_string(value)
    }
}

/// 用于“truthy 取默认值”的场景：空字符串 / null / false 视为空。
fn js_string_truthy(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(false) => String::new(),
        Value::Bool(true) => "true".to_string(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn js_number(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::Bool(true) => 1.0,
        Value::Bool(false) => 0.0,
        Value::Null => 0.0,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}

fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(number) => number
            .as_f64()
            .map(|value| value != 0.0 && !value.is_nan())
            .unwrap_or(false),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(_) => true,
    }
}

fn boolean_value(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::String(text) => match text.to_lowercase().as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        Value::Number(number) => match number.as_f64() {
            Some(value) if value == 1.0 => Some(true),
            Some(value) if value == 0.0 => Some(false),
            _ => None,
        },
        _ => None,
    }
}
