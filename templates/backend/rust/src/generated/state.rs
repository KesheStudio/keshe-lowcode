// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use sqlx::AnyPool;
use tokio::sync::Mutex;

use crate::generated::auth::AuthService;
use crate::generated::builtin::BuiltinRuntime;
use crate::generated::cache::Cache;
use crate::generated::config::{Config, ConfigSources};
use crate::generated::config_center::ConfigCenter;
use crate::generated::data::DataService;
use crate::generated::middleware::MiddlewarePlan;

pub struct AppState {
    pub config: Config,
    pub pool: AnyPool,
    pub cache: Cache,
    pub auth: Arc<AuthService>,
    pub data: Arc<DataService>,
    pub started: Instant,
    pub started_iso: String,
    pub sources: ConfigSources,
    pub rate: Mutex<HashMap<String, (Instant, u32)>>,
    pub middleware: MiddlewarePlan,
    /// 通用配置中心：用户在 src/custom/routes.rs 里可通过 state.config_center.get("KEY") 读取。
    pub config_center: ConfigCenter,
    pub builtin: BuiltinRuntime,
    pub concurrency: Arc<tokio::sync::Semaphore>,
}

pub type SharedState = Arc<AppState>;
