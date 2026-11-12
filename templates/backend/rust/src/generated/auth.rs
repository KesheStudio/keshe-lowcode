// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 认证中心：注册 / 登录 / 刷新 / 登出 / 当前用户 / 最小 RBAC。
// 默认 jwt：短时 access JWT（HS256）+ 数据库里的可撤销 refresh token；auth.tokenMode=session 时改为服务端会话。
use argon2::password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::Argon2;
use axum::extract::rejection::JsonRejection;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, SecondsFormat, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::generated::config::AuthConfig;
use crate::generated::db::adapt_sql;
use crate::generated::error::{bad, ok, AppError};
use crate::generated::state::SharedState;

const SCRYPT_LIKE_ARGON_PREFIX: &str = "$argon2id$v=19$m=19456,t=2,p=1$";

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_in(seconds: i64) -> String {
    (Utc::now() + Duration::seconds(seconds)).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn hash_password_blocking(password: &str) -> anyhow::Result<String> {
    let hash = Argon2::default()
        .hash_password(password.as_bytes())
        .map_err(|err| anyhow::anyhow!("密码哈希失败：{err}"))?;
    Ok(hash.to_string())
}

async fn hash_password(password: &str) -> Result<String, AppError> {
    let owned = password.to_string();
    let joined = tokio::task::spawn_blocking(move || hash_password_blocking(&owned))
        .await
        .map_err(|err| AppError::Internal(format!("密码哈希任务失败：{err}")))?;
    joined.map_err(|err| AppError::Internal(format!("{err:#}")))
}

async fn verify_password(password: &str, stored: &str) -> bool {
    let owned = password.to_string();
    let stored = stored.to_string();
    tokio::task::spawn_blocking(move || {
        let Ok(parsed) = PasswordHash::new(&stored) else {
            return false;
        };
        Argon2::default()
            .verify_password(owned.as_bytes(), &parsed)
            .is_ok()
    })
    .await
    .unwrap_or(false)
}

pub struct AuthService {
    config: AuthConfig,
    pool: AnyPool,
    mode: String,
    secret: Vec<u8>,
    dummy_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    sub: String,
    name: String,
    roles: Vec<String>,
    mode: String,
    iat: i64,
    exp: i64,
    jti: String,
}

struct UserRow {
    id: String,
    username: String,
    password_hash: String,
    display_name: String,
    status: String,
}

pub struct AuthContext {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub status: String,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub token_mode: String,
    pub token_hash: Option<String>,
}

impl AuthContext {
    fn to_json(&self) -> Value {
        json!({
            "user": {
                "id": self.user_id,
                "username": self.username,
                "displayName": self.display_name,
                "status": self.status,
                "roles": self.roles,
                "permissions": self.permissions,
            },
            "roles": self.roles,
            "permissions": self.permissions,
            "tokenMode": self.token_mode,
        })
    }
}

impl AuthService {
    pub async fn new(config: &AuthConfig, pool: AnyPool) -> anyhow::Result<Self> {
        let mode = config.token_mode.trim().to_string();
        let mut secret = config.jwt_secret.clone();
        if mode == "jwt" && secret.is_empty() {
            secret = format!(
                "{}{}{}",
                Uuid::new_v4().simple(),
                Uuid::new_v4().simple(),
                Uuid::new_v4().simple()
            );
            tracing::warn!(
                "auth.jwtSecret 未配置，已生成进程内一次性密钥；重启后所有已签发令牌失效。生产请设置 LC_AUTH_JWT_SECRET。"
            );
        }
        let dummy_hash =
            tokio::task::spawn_blocking(|| hash_password_blocking("lc-dummy-password-for-timing"))
                .await
                .map_err(|err| anyhow::anyhow!("生成占位哈希失败：{err}"))??;
        let service = Self {
            config: config.clone(),
            pool,
            mode,
            secret: secret.into_bytes(),
            dummy_hash,
        };
        service.bootstrap().await?;
        Ok(service)
    }

    pub fn mode(&self) -> &str {
        &self.mode
    }

    async fn q(&self, sql: &str) -> String {
        adapt_sql(&self.pool, sql)
    }

    async fn find_user_by_id(&self, id: &str) -> Result<Option<UserRow>, AppError> {
        let sql = self.q("SELECT * FROM users WHERE id = ?").await;
        let row = sqlx::query(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(AppError::db)?;
        Ok(row.map(map_user))
    }

    async fn find_user_by_username(&self, username: &str) -> Result<Option<UserRow>, AppError> {
        let sql = self
            .q("SELECT * FROM users WHERE lower(username) = lower(?)")
            .await;
        let row = sqlx::query(&sql)
            .bind(username)
            .fetch_optional(&self.pool)
            .await
            .map_err(AppError::db)?;
        Ok(row.map(map_user))
    }

    async fn load_roles(&self, user_id: &str) -> Result<Vec<String>, AppError> {
        let sql = self
            .q("SELECT r.name FROM roles r \
                 JOIN user_roles ur ON ur.role_id = r.id \
                 WHERE ur.user_id = ? ORDER BY r.name")
            .await;
        let rows = sqlx::query(&sql)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(AppError::db)?;
        Ok(rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .collect())
    }

    async fn load_permissions(&self, user_id: &str) -> Result<Vec<String>, AppError> {
        let sql = self
            .q("SELECT DISTINCT p.code FROM permissions p \
                 JOIN role_permissions rp ON rp.permission_id = p.id \
                 JOIN user_roles ur ON ur.role_id = rp.role_id \
                 WHERE ur.user_id = ? ORDER BY p.code")
            .await;
        let rows = sqlx::query(&sql)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(AppError::db)?;
        Ok(rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("code").ok())
            .collect())
    }

    async fn role_id(&self, name: &str) -> Result<Option<String>, AppError> {
        let sql = self.q("SELECT id FROM roles WHERE name = ?").await;
        let row = sqlx::query(&sql)
            .bind(name)
            .fetch_optional(&self.pool)
            .await
            .map_err(AppError::db)?;
        Ok(row.and_then(|row| row.try_get::<String, _>("id").ok()))
    }

    async fn issue_tokens(
        &self,
        user: &UserRow,
        family_id: Option<String>,
        user_agent: &str,
    ) -> Result<Value, AppError> {
        let roles = self.load_roles(&user.id).await?;
        let permissions = self.load_permissions(&user.id).await?;
        let user_json = json!({
            "id": user.id,
            "username": user.username,
            "displayName": user.display_name,
            "status": user.status,
            "roles": roles,
            "permissions": permissions,
        });

        if self.mode == "session" {
            let token = random_token();
            let sql = self
                .q("INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .await;
            sqlx::query(&sql)
                .bind(Uuid::new_v4().to_string())
                .bind(&user.id)
                .bind(hash_token(&token))
                .bind(now_iso())
                .bind(iso_in(self.config.session_ttl_seconds as i64))
                .bind(Option::<String>::None)
                .bind(user_agent.chars().take(255).collect::<String>())
                .execute(&self.pool)
                .await
                .map_err(AppError::db)?;
            self.cleanup_expired().await;
            return Ok(json!({
                "accessToken": token,
                "refreshToken": Value::Null,
                "tokenType": "Bearer",
                "expiresIn": self.config.session_ttl_seconds,
                "refreshExpiresIn": 0,
                "tokenMode": "session",
                "user": user_json,
            }));
        }

        let issued_at = Utc::now().timestamp();
        let claims = Claims {
            sub: user.id.clone(),
            name: user.username.clone(),
            roles: roles.clone(),
            mode: "jwt".to_string(),
            iat: issued_at,
            exp: issued_at + self.config.access_token_ttl_seconds as i64,
            jti: Uuid::new_v4().to_string(),
        };
        let access = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )
        .map_err(|err| AppError::Internal(format!("签发访问令牌失败：{err}")))?;

        let refresh = random_token();
        let sql = self
            .q("INSERT INTO auth_refresh_tokens (id, user_id, token_hash, family_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .await;
        sqlx::query(&sql)
            .bind(Uuid::new_v4().to_string())
            .bind(&user.id)
            .bind(hash_token(&refresh))
            .bind(family_id.unwrap_or_else(|| Uuid::new_v4().to_string()))
            .bind(now_iso())
            .bind(iso_in(self.config.refresh_token_ttl_seconds as i64))
            .bind(Option::<String>::None)
            .execute(&self.pool)
            .await
            .map_err(AppError::db)?;
        self.cleanup_expired().await;

        Ok(json!({
            "accessToken": access,
            "refreshToken": refresh,
            "tokenType": "Bearer",
            "expiresIn": self.config.access_token_ttl_seconds,
            "refreshExpiresIn": self.config.refresh_token_ttl_seconds,
            "tokenMode": "jwt",
            "user": user_json,
        }))
    }

    async fn cleanup_expired(&self) {
        let now = now_iso();
        let _ = sqlx::query(
            &self
                .q("DELETE FROM auth_refresh_tokens WHERE expires_at <= ?")
                .await,
        )
        .bind(&now)
        .execute(&self.pool)
        .await;
        let _ = sqlx::query(
            &self
                .q("DELETE FROM auth_sessions WHERE expires_at <= ?")
                .await,
        )
        .bind(&now)
        .execute(&self.pool)
        .await;
    }

    async fn assert_not_locked(&self, identifier: &str) -> Result<(), AppError> {
        let sql = self
            .q("SELECT * FROM auth_login_attempts WHERE identifier = ?")
            .await;
        let row = sqlx::query(&sql)
            .bind(identifier)
            .fetch_optional(&self.pool)
            .await
            .map_err(AppError::db)?;
        let Some(row) = row else { return Ok(()) };
        let locked_until: Option<String> = row.try_get("locked_until").ok();
        if let Some(locked) = &locked_until {
            if locked > &now_iso() {
                return Err(AppError::TooManyRequests);
            }
            let delete = self
                .q("DELETE FROM auth_login_attempts WHERE identifier = ?")
                .await;
            let _ = sqlx::query(&delete)
                .bind(identifier)
                .execute(&self.pool)
                .await;
            return Ok(());
        }
        let window_started: String = row.try_get("window_started_at").unwrap_or_default();
        if window_started <= iso_in(-(self.config.failure_window_seconds as i64)) {
            let delete = self
                .q("DELETE FROM auth_login_attempts WHERE identifier = ?")
                .await;
            let _ = sqlx::query(&delete)
                .bind(identifier)
                .execute(&self.pool)
                .await;
        }
        Ok(())
    }

    async fn record_failure(&self, identifier: &str) -> Result<(), AppError> {
        let now = now_iso();
        let sql = self
            .q("SELECT * FROM auth_login_attempts WHERE identifier = ?")
            .await;
        let row = sqlx::query(&sql)
            .bind(identifier)
            .fetch_optional(&self.pool)
            .await
            .map_err(AppError::db)?;
        let (failures, window_start) = match row {
            Some(row) => {
                let failures: i32 = row.try_get("failures").unwrap_or(0);
                let started: String = row.try_get("window_started_at").unwrap_or_default();
                if started > iso_in(-(self.config.failure_window_seconds as i64)) {
                    (failures + 1, started)
                } else {
                    (1, now.clone())
                }
            }
            None => (1, now.clone()),
        };
        let locked_until = if failures as u32 >= self.config.max_login_failures {
            Some(iso_in(self.config.lock_seconds as i64))
        } else {
            None
        };
        if let Some(_) = sqlx::query(
            &self
                .q("SELECT identifier FROM auth_login_attempts WHERE identifier = ?")
                .await,
        )
        .bind(identifier)
        .fetch_optional(&self.pool)
        .await
        .map_err(AppError::db)?
        {
            let sql = self
                .q("UPDATE auth_login_attempts SET failures = ?, window_started_at = ?, locked_until = ? WHERE identifier = ?")
                .await;
            sqlx::query(&sql)
                .bind(failures)
                .bind(window_start)
                .bind(locked_until)
                .bind(identifier)
                .execute(&self.pool)
                .await
                .map_err(AppError::db)?;
        } else {
            let sql = self
                .q("INSERT INTO auth_login_attempts (identifier, failures, window_started_at, locked_until) VALUES (?, ?, ?, ?)")
                .await;
            sqlx::query(&sql)
                .bind(identifier)
                .bind(failures)
                .bind(window_start)
                .bind(locked_until)
                .execute(&self.pool)
                .await
                .map_err(AppError::db)?;
        }
        Ok(())
    }

    async fn clear_failures(&self, identifier: &str) {
        let sql = self
            .q("DELETE FROM auth_login_attempts WHERE identifier = ?")
            .await;
        let _ = sqlx::query(&sql).bind(identifier).execute(&self.pool).await;
    }

    pub async fn register(
        &self,
        username: &str,
        password: &str,
        display_name: &str,
    ) -> Result<Value, AppError> {
        validate_credentials(username, password, display_name)?;
        if self.find_user_by_username(username).await?.is_some() {
            return Err(bad("username", "用户名已存在"));
        }
        let Some(role_id) = self.role_id("user").await? else {
            return Err(AppError::Internal(
                "角色表缺少 user 角色，请重新执行迁移".to_string(),
            ));
        };
        let password_hash = hash_password(password).await?;
        let user_id = Uuid::new_v4().to_string();
        let now = now_iso();
        let mut tx = self.pool.begin().await.map_err(AppError::db)?;
        let sql = self
            .q("INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .await;
        sqlx::query(&sql)
            .bind(&user_id)
            .bind(username)
            .bind(&password_hash)
            .bind(display_name)
            .bind("active")
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(AppError::db)?;
        let sql = self
            .q("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)")
            .await;
        sqlx::query(&sql)
            .bind(&user_id)
            .bind(&role_id)
            .execute(&mut *tx)
            .await
            .map_err(AppError::db)?;
        tx.commit().await.map_err(AppError::db)?;

        let user = self
            .find_user_by_id(&user_id)
            .await?
            .ok_or_else(|| AppError::Internal("注册后读取用户失败".to_string()))?;
        self.issue_tokens(&user, None, "").await
    }

    pub async fn login(
        &self,
        username: &str,
        password: &str,
        user_agent: &str,
    ) -> Result<Value, AppError> {
        validate_login(username, password)?;
        let identifier = username.trim().to_lowercase();
        self.assert_not_locked(&identifier).await?;
        let user = self.find_user_by_username(&identifier).await?;
        let verified = match &user {
            Some(user) if user.status == "active" => {
                verify_password(password, &user.password_hash).await
            }
            _ => {
                let _ = verify_password(password, &self.dummy_hash).await;
                false
            }
        };
        if !verified {
            self.record_failure(&identifier).await?;
            return Err(AppError::Unauthorized("用户名或密码错误".to_string()));
        }
        let user = user.unwrap();
        self.clear_failures(&identifier).await;
        if !user.password_hash.starts_with(SCRYPT_LIKE_ARGON_PREFIX) {
            if let Ok(new_hash) = hash_password(password).await {
                let sql = self
                    .q("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
                    .await;
                let _ = sqlx::query(&sql)
                    .bind(new_hash)
                    .bind(now_iso())
                    .bind(&user.id)
                    .execute(&self.pool)
                    .await;
            }
        }
        self.issue_tokens(&user, None, user_agent).await
    }

    pub async fn refresh(
        &self,
        headers: &HeaderMap,
        refresh_token: Option<&str>,
        user_agent: &str,
    ) -> Result<Value, AppError> {
        if self.mode == "session" {
            let token = bearer(headers)
                .ok_or_else(|| AppError::Unauthorized("缺少会话令牌".to_string()))?;
            let sql = self
                .q("SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL")
                .await;
            let row = sqlx::query(&sql)
                .bind(hash_token(&token))
                .fetch_optional(&self.pool)
                .await
                .map_err(AppError::db)?;
            let row =
                row.ok_or_else(|| AppError::Unauthorized("未认证或令牌已失效".to_string()))?;
            let expires_at: String = row.try_get("expires_at").unwrap_or_default();
            if expires_at <= now_iso() {
                return Err(AppError::Unauthorized("未认证或令牌已失效".to_string()));
            }
            let user_id: String = row.try_get("user_id").unwrap_or_default();
            let session_id: String = row.try_get("id").unwrap_or_default();
            let user = self
                .find_user_by_id(&user_id)
                .await?
                .filter(|user| user.status == "active")
                .ok_or_else(|| AppError::Unauthorized("未认证或令牌已失效".to_string()))?;
            let sql = self
                .q("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?")
                .await;
            let _ = sqlx::query(&sql)
                .bind(now_iso())
                .bind(&session_id)
                .execute(&self.pool)
                .await;
            return self.issue_tokens(&user, None, user_agent).await;
        }

        let Some(refresh_token) = refresh_token.filter(|token| !token.is_empty()) else {
            return Err(AppError::Unauthorized("缺少刷新令牌".to_string()));
        };
        let sql = self
            .q("SELECT * FROM auth_refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL")
            .await;
        let row = sqlx::query(&sql)
            .bind(hash_token(refresh_token))
            .fetch_optional(&self.pool)
            .await
            .map_err(AppError::db)?;
        let row = row.ok_or_else(|| AppError::Unauthorized("未认证或令牌已失效".to_string()))?;
        let expires_at: String = row.try_get("expires_at").unwrap_or_default();
        if expires_at <= now_iso() {
            return Err(AppError::Unauthorized("未认证或令牌已失效".to_string()));
        }
        let user_id: String = row.try_get("user_id").unwrap_or_default();
        let token_id: String = row.try_get("id").unwrap_or_default();
        let family_id: String = row.try_get("family_id").unwrap_or_default();
        let user = self
            .find_user_by_id(&user_id)
            .await?
            .filter(|user| user.status == "active")
            .ok_or_else(|| AppError::Unauthorized("未认证或令牌已失效".to_string()))?;
        let sql = self
            .q("UPDATE auth_refresh_tokens SET revoked_at = ? WHERE id = ?")
            .await;
        let _ = sqlx::query(&sql)
            .bind(now_iso())
            .bind(&token_id)
            .execute(&self.pool)
            .await;
        self.issue_tokens(&user, Some(family_id), user_agent).await
    }

    pub async fn logout(
        &self,
        headers: &HeaderMap,
        refresh_token: Option<&str>,
    ) -> Result<Value, AppError> {
        let context = self.authenticate(headers).await?;
        if self.mode == "session" {
            let sql = self
                .q("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
                .await;
            let _ = sqlx::query(&sql)
                .bind(now_iso())
                .bind(context.token_hash.unwrap_or_default())
                .execute(&self.pool)
                .await;
            return Ok(json!({ "revoked": 1 }));
        }
        if let Some(token) = refresh_token.filter(|token| !token.is_empty()) {
            let sql = self
                .q("UPDATE auth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
                .await;
            let result = sqlx::query(&sql)
                .bind(now_iso())
                .bind(hash_token(token))
                .execute(&self.pool)
                .await
                .map_err(AppError::db)?;
            return Ok(json!({ "revoked": result.rows_affected() }));
        }
        let sql = self
            .q("UPDATE auth_refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
            .await;
        let result = sqlx::query(&sql)
            .bind(now_iso())
            .bind(&context.user_id)
            .execute(&self.pool)
            .await
            .map_err(AppError::db)?;
        Ok(json!({ "revoked": result.rows_affected() }))
    }

    pub async fn authenticate(&self, headers: &HeaderMap) -> Result<AuthContext, AppError> {
        let token = bearer(headers)
            .ok_or_else(|| AppError::Unauthorized("缺少 Authorization: Bearer 令牌".to_string()))?;
        let mut token_hash_value = None;
        let user = if self.mode == "session" {
            let hash = hash_token(&token);
            token_hash_value = Some(hash.clone());
            let sql = self
                .q("SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL")
                .await;
            let row = sqlx::query(&sql)
                .bind(&hash)
                .fetch_optional(&self.pool)
                .await
                .map_err(AppError::db)?;
            let Some(row) = row else {
                return Err(AppError::Unauthorized("未认证或令牌已失效".to_string()));
            };
            let expires_at: String = row.try_get("expires_at").unwrap_or_default();
            if expires_at <= now_iso() {
                return Err(AppError::Unauthorized("未认证或令牌已失效".to_string()));
            }
            let user_id: String = row.try_get("user_id").unwrap_or_default();
            self.find_user_by_id(&user_id).await?
        } else {
            let validation = Validation::new(Algorithm::HS256);
            let decoded =
                decode::<Claims>(&token, &DecodingKey::from_secret(&self.secret), &validation)
                    .map_err(|_| AppError::Unauthorized("未认证或令牌已失效".to_string()))?;
            self.find_user_by_id(&decoded.claims.sub).await?
        };

        let user = user
            .filter(|user| user.status == "active")
            .ok_or_else(|| AppError::Unauthorized("未认证或令牌已失效".to_string()))?;
        let roles = self.load_roles(&user.id).await?;
        let permissions = self.load_permissions(&user.id).await?;
        Ok(AuthContext {
            user_id: user.id,
            username: user.username,
            display_name: user.display_name,
            status: user.status,
            roles,
            permissions,
            token_mode: self.mode.clone(),
            token_hash: token_hash_value,
        })
    }

    pub fn require_permission(&self, context: &AuthContext, code: &str) -> Result<(), AppError> {
        if context
            .permissions
            .iter()
            .any(|permission| permission == code)
        {
            return Ok(());
        }
        Err(AppError::Forbidden("没有访问该接口的权限".to_string()))
    }

    pub async fn list_users(&self) -> Result<Value, AppError> {
        let sql = self
            .q("SELECT id, username, display_name, status, created_at FROM users ORDER BY created_at DESC")
            .await;
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(AppError::db)?;
        let mut items = Vec::new();
        for row in rows {
            let id: String = row.try_get("id").unwrap_or_default();
            items.push(json!({
                "id": id,
                "username": row.try_get::<String, _>("username").unwrap_or_default(),
                "displayName": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "createdAt": row.try_get::<String, _>("created_at").unwrap_or_default(),
                "roles": self.load_roles(&id).await?,
            }));
        }
        Ok(Value::Array(items))
    }

    async fn bootstrap(&self) -> anyhow::Result<()> {
        let username = self.config.bootstrap.username.trim();
        let password = self.config.bootstrap.password.as_str();
        if username.is_empty() || password.trim().is_empty() {
            return Ok(());
        }
        if !is_valid_username(username) {
            tracing::warn!("auth.bootstrap.username 不合法，已跳过创建");
            return Ok(());
        }
        if password.len() < 8 {
            tracing::warn!("auth.bootstrap.password 少于 8 位，已跳过创建");
            return Ok(());
        }
        if self
            .find_user_by_username(username)
            .await
            .map_err(|_| anyhow::anyhow!("认证初始化：查询引导用户失败"))?
            .is_some()
        {
            tracing::info!(username = %username, "引导用户已存在，跳过");
            return Ok(());
        }
        let role_name = if self.config.bootstrap.role.trim().is_empty() {
            "admin"
        } else {
            self.config.bootstrap.role.trim()
        };
        let Some(role_id) = self
            .role_id(role_name)
            .await
            .map_err(|_| anyhow::anyhow!("认证初始化：查询引导角色失败"))?
        else {
            tracing::warn!(role = %role_name, "引导角色不存在，已跳过创建");
            return Ok(());
        };
        let password_hash = hash_password(password)
            .await
            .map_err(|_| anyhow::anyhow!("认证初始化：生成密码哈希失败"))?;
        let user_id = Uuid::new_v4().to_string();
        let now = now_iso();
        let mut tx = self.pool.begin().await?;
        let sql = self
            .q("INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .await;
        sqlx::query(&sql)
            .bind(&user_id)
            .bind(username)
            .bind(&password_hash)
            .bind(username)
            .bind("active")
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        let sql = self
            .q("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)")
            .await;
        sqlx::query(&sql)
            .bind(&user_id)
            .bind(&role_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        tracing::info!(username = %username, role = %role_name, "已创建引导用户");
        Ok(())
    }
}

fn map_user(row: sqlx::any::AnyRow) -> UserRow {
    UserRow {
        id: row.try_get("id").unwrap_or_default(),
        username: row.try_get("username").unwrap_or_default(),
        password_hash: row.try_get("password_hash").unwrap_or_default(),
        display_name: row.try_get("display_name").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
    }
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    let value: &HeaderValue = headers.get(axum::http::header::AUTHORIZATION)?;
    let text = value.to_str().ok()?;
    let (scheme, token) = text.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn is_valid_username(username: &str) -> bool {
    let len = username.chars().count();
    (3..=32).contains(&len)
        && username
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
}

fn validate_credentials(
    username: &str,
    password: &str,
    display_name: &str,
) -> Result<(), AppError> {
    if !is_valid_username(username) {
        return Err(bad(
            "username",
            "用户名需为 3-32 位字母、数字、下划线、点或短横线",
        ));
    }
    if !(8..=128).contains(&password.chars().count()) {
        return Err(bad("password", "密码长度需为 8-128 位"));
    }
    if display_name.chars().count() > 64 {
        return Err(bad("displayName", "displayName 最多 64 个字符"));
    }
    Ok(())
}

fn validate_login(username: &str, password: &str) -> Result<(), AppError> {
    if username.trim().is_empty() || username.chars().count() > 64 {
        return Err(bad("username", "username 不能为空且最多 64 个字符"));
    }
    if password.chars().count() > 128 {
        return Err(bad("password", "password 最多 128 个字符"));
    }
    Ok(())
}

fn json_rejection(rejection: JsonRejection) -> AppError {
    if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::PayloadTooLarge
    } else {
        bad("body", "请求体必须是合法 JSON 对象")
    }
}

// ---------------------------------------------------------------- 路由

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/auth/mode", get(mode))
        .route("/api/admin/users", get(admin_users))
}

async fn register(
    State(state): State<SharedState>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let body = payload.map_err(json_rejection)?.0;
    let object = body
        .as_object()
        .ok_or_else(|| bad("body", "请求体必须是 JSON 对象"))?;
    let username = object
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = object
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let display_name = object
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let tokens = state
        .auth
        .register(username, password, display_name)
        .await?;
    Ok((StatusCode::CREATED, ok(tokens)))
}

async fn login(
    State(state): State<SharedState>,
    headers: HeaderMap,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, AppError> {
    let body = payload.map_err(json_rejection)?.0;
    let object = body
        .as_object()
        .ok_or_else(|| bad("body", "请求体必须是 JSON 对象"))?;
    let username = object
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = object
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tokens = state.auth.login(username, password, user_agent).await?;
    Ok(ok(tokens))
}

async fn refresh(
    State(state): State<SharedState>,
    headers: HeaderMap,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, AppError> {
    let refresh_token = payload.ok().and_then(|Json(value)| {
        value
            .get("refreshToken")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tokens = state
        .auth
        .refresh(&headers, refresh_token.as_deref(), user_agent)
        .await?;
    Ok(ok(tokens))
}

async fn logout(
    State(state): State<SharedState>,
    headers: HeaderMap,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, AppError> {
    let refresh_token = payload.ok().and_then(|Json(value)| {
        value
            .get("refreshToken")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let result = state
        .auth
        .logout(&headers, refresh_token.as_deref())
        .await?;
    Ok(ok(result))
}

async fn me(State(state): State<SharedState>, headers: HeaderMap) -> Result<Json<Value>, AppError> {
    let context = state.auth.authenticate(&headers).await?;
    Ok(ok(context.to_json()))
}

async fn mode(State(state): State<SharedState>) -> Json<Value> {
    ok(json!({ "tokenMode": state.auth.mode() }))
}

async fn admin_users(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let context = state.auth.authenticate(&headers).await?;
    state.auth.require_permission(&context, "users:read")?;
    Ok(ok(json!({ "items": state.auth.list_users().await? })))
}
