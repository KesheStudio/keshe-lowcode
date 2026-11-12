use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, RunEvent, State};
use tauri_plugin_updater::UpdaterExt;

/// 由 scripts/render-config.mjs 生成，运行时只关心「行为开关」，窗口尺寸等已写进 tauri.conf.json。
const RUNTIME_JSON: &str = include_str!("../desktop.runtime.json");
/// 首次启动时复制到应用配置目录；这份模板里不含数据库密码（密码走引导或环境变量）。
const BACKEND_TEMPLATE: &str = include_str!("../../config/backend.template.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    schema_version: u32,
    product_name: String,
    version: String,
    single_instance: bool,
    autostart: bool,
    update_active: bool,
    check_on_startup: bool,
    backend: BackendConfig,
    delivery: DeliveryConfig,
    #[serde(default)]
    sidecar: Option<SidecarConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendConfig {
    enabled: bool,
    base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryConfig {
    mode: String,
    protocol: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarConfig {
    enabled: bool,
    name: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_readiness_path")]
    readiness_path: String,
    #[serde(default = "default_readiness_timeout")]
    readiness_timeout_ms: u64,
    #[serde(default)]
    version_check: bool,
    #[serde(default)]
    env: HashMap<String, String>,
}

fn default_readiness_path() -> String {
    "/health".to_string()
}

fn default_readiness_timeout() -> u64 {
    10_000
}

/// 前端通过 invoke 读取的运行时状态；state 取值：
/// disabled / idle / starting / ready / error / setup-required。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    state: String,
    backend_url: Option<String>,
    version: Option<String>,
    needs_password: bool,
    message: String,
}

impl Default for SidecarStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            backend_url: None,
            version: None,
            needs_password: false,
            message: String::new(),
        }
    }
}

#[derive(Default)]
struct SidecarInner {
    child: Option<Child>,
    status: SidecarStatus,
}

/// 只保存子进程句柄与状态，不放密码。
pub struct SidecarState {
    inner: Mutex<SidecarInner>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self { inner: Mutex::new(SidecarInner::default()) }
    }
}

struct AppConfig(RuntimeConfig);

fn load_config() -> RuntimeConfig {
    serde_json::from_str(RUNTIME_JSON).unwrap_or_else(|err| {
        panic!("desktop.runtime.json 解析失败（{err}）：执行 npm run render 重新生成，不要手改该文件")
    })
}

/// 前端可见的更新状态。失败也要落成可读文字，绝不让界面停在「检查中」。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    state: String,
    version: Option<String>,
    notes: String,
    message: String,
    downloaded: u64,
    total: Option<u64>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            version: None,
            notes: String::new(),
            message: String::new(),
            downloaded: 0,
            total: None,
        }
    }
}

pub struct UpdateState {
    inner: Mutex<UpdateStatus>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self { inner: Mutex::new(UpdateStatus::default()) }
    }
}

fn set_update_status(app: &tauri::AppHandle, status: UpdateStatus) {
    if let Ok(mut inner) = app.state::<UpdateState>().inner.lock() {
        *inner = status.clone();
    }
    // 事件 + 主动查询双保险：自动检查可能发在前端监听之前。
    let _ = app.emit("lc:update-status", status);
}

fn update_error_text(err: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match err {
        E::Network(message) => format!("无法连接更新源：{message}。确认网络/代理是否可达，稍后可重试；不影响继续使用应用。"),
        E::Reqwest(e) if e.is_timeout() || e.is_connect() => {
            "更新源连接超时或被拒绝：检查地址与网络（离线时会这样），不影响继续使用应用。".to_string()
        }
        E::Reqwest(e) => format!("更新请求失败：{e}"),
        E::InsecureTransportProtocol => {
            "更新源未使用 https：正式环境请改用 TLS；本机调试需在 desktop.json 显式设置 update.insecureTransport=true 后重新构建。".to_string()
        }
        E::Minisign(_) | E::SignatureUtf8(_) | E::Base64(_) | E::InvalidUpdaterFormat => {
            "更新包签名校验失败：包被改动或公钥不匹配，已拒绝安装（应用仍可正常使用）。".to_string()
        }
        E::TargetNotFound(target) => format!("更新清单里没有当前平台条目：{target}。检查 latest.json 的 platforms 键名。"),
        E::TargetsNotFound(targets) => format!("更新清单里没有匹配的条目：{}。", targets.join(", ")),
        E::ReleaseNotFound => "更新源没有返回清单（可能是 404、空内容或半截 JSON）。".to_string(),
        other => format!("更新失败：{other}"),
    }
}

async fn do_update_check(app: &tauri::AppHandle) -> UpdateStatus {
    set_update_status(
        app,
        UpdateStatus { state: "checking".to_string(), message: "正在检查更新…".to_string(), ..UpdateStatus::default() },
    );
    let updater = match app.updater() {
        Ok(u) => u,
        Err(err) => {
            let status = UpdateStatus {
                state: "error".to_string(),
                message: format!("更新插件未就绪：{err}"),
                ..UpdateStatus::default()
            };
            set_update_status(app, status.clone());
            return status;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let status = UpdateStatus {
                state: "available".to_string(),
                version: Some(update.version.clone()),
                notes: update.body.clone().unwrap_or_default(),
                message: format!("发现新版本 {}（当前 {}）。", update.version, update.current_version),
                ..UpdateStatus::default()
            };
            set_update_status(app, status.clone());
            status
        }
        Ok(None) => {
            let status = UpdateStatus {
                state: "up-to-date".to_string(),
                message: "已是最新版本。".to_string(),
                ..UpdateStatus::default()
            };
            set_update_status(app, status.clone());
            status
        }
        Err(err) => {
            let status = UpdateStatus {
                state: "error".to_string(),
                message: update_error_text(&err),
                ..UpdateStatus::default()
            };
            set_update_status(app, status.clone());
            status
        }
    }
}

fn spawn_update_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let status = do_update_check(&app).await;
        if status.state == "error" {
            eprintln!("[update] 启动检查失败（已显示在界面上，不影响使用）：{}", status.message);
        }
    });
}

/// 手动检查更新：无论成功失败都返回结构化状态，前端照常渲染。
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> UpdateStatus {
    do_update_check(&app).await
}

/// 下载 → 验签 → 启动安装程序。失败时返回 error 状态，按钮可再次点击，应用不会卡住。
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> UpdateStatus {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(err) => {
            let status = UpdateStatus {
                state: "error".to_string(),
                message: format!("更新插件未就绪：{err}"),
                ..UpdateStatus::default()
            };
            set_update_status(&app, status.clone());
            return status;
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            let status = UpdateStatus {
                state: "up-to-date".to_string(),
                message: "已是最新版本，无需安装。".to_string(),
                ..UpdateStatus::default()
            };
            set_update_status(&app, status.clone());
            return status;
        }
        Err(err) => {
            let status = UpdateStatus {
                state: "error".to_string(),
                message: update_error_text(&err),
                ..UpdateStatus::default()
            };
            set_update_status(&app, status.clone());
            return status;
        }
    };

    let version = update.version.clone();
    let progress_app = app.clone();
    let finish_app = app.clone();
    let finish_version = version.clone();
    set_update_status(
        &app,
        UpdateStatus {
            state: "downloading".to_string(),
            version: Some(version.clone()),
            message: "正在下载更新包…".to_string(),
            ..UpdateStatus::default()
        },
    );

    let result = update
        .download_and_install(
            move |chunk, total| {
                let snapshot = {
                    let state = progress_app.state::<UpdateState>();
                    let mut inner = match state.inner.lock() {
                        Ok(i) => i,
                        Err(_) => return,
                    };
                    inner.downloaded += chunk as u64;
                    inner.total = total;
                    inner.clone()
                };
                let _ = progress_app.emit("lc:update-status", snapshot);
            },
            move || {
                set_update_status(
                    &finish_app,
                    UpdateStatus {
                        state: "installing".to_string(),
                        version: Some(finish_version.clone()),
                        message: "下载完成，签名校验通过，正在启动安装程序…".to_string(),
                        ..UpdateStatus::default()
                    },
                );
            },
        )
        .await;

    match result {
        Ok(()) => {
            // Windows 上安装器启动后本进程会自行退出；走到这里通常是其它平台。
            let status = UpdateStatus {
                state: "installing".to_string(),
                version: Some(version),
                message: "安装程序已启动，应用即将退出并自动重启。".to_string(),
                ..UpdateStatus::default()
            };
            set_update_status(&app, status.clone());
            status
        }
        Err(err) => {
            let status = UpdateStatus {
                state: "error".to_string(),
                version: Some(version),
                message: update_error_text(&err),
                ..UpdateStatus::default()
            };
            set_update_status(&app, status.clone());
            status
        }
    }
}

#[tauri::command]
fn update_status(state: State<'_, UpdateState>) -> UpdateStatus {
    state.inner.lock().map(|inner| inner.clone()).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// sidecar：挑端口、启进程、健康探测、版本校验、退出清理
// ---------------------------------------------------------------------------

fn set_status(app: &tauri::AppHandle, status: SidecarStatus, event: &str) {
    let state = app.state::<SidecarState>();
    if let Ok(mut inner) = state.inner.lock() {
        inner.status = status.clone();
    }
    // 事件只是加速；前端启动时还会主动查一次，避免「事件发在前端监听之前」的空窗。
    let _ = app.emit(event, status);
}

fn fail(app: &tauri::AppHandle, message: String) {
    stop_child(app);
    set_status(
        app,
        SidecarStatus { state: "error".to_string(), message, ..SidecarStatus::default() },
        "lc:backend-error",
    );
}

/// 杀掉并回收子进程；先 kill 再 wait，避免留下僵尸/孤儿。
fn stop_child(app: &tauri::AppHandle) {
    let state = app.state::<SidecarState>();
    if let Ok(mut inner) = state.inner.lock() {
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    };
}

fn stop_sidecar(app: &tauri::AppHandle) {
    let was_running = {
        let state = app.state::<SidecarState>();
        state.inner.lock().map(|i| i.child.is_some()).unwrap_or(false)
    };
    if was_running {
        eprintln!("[sidecar] 应用退出，正在结束本地后端进程");
        stop_child(app);
    }
}

/// 端口不能写死：向系统要一个空闲端口，交给 sidecar，并把同一个端口拼成前端要用的地址。
/// 绑 0 再释放存在极小的抢占窗口；sidecar 绑不上会立刻报错退出，由这里转成可读错误，不会悄悄换端口。
fn pick_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("无法在本机挑选可用端口：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取监听端口失败：{e}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn resolve_sidecar(name: &str) -> Result<PathBuf, String> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
        }
    }
    // 开发/调试时的兜底：tauri-build 会把 externalBin 复制到 target 目录，
    // 但直接 `cargo run` 时仍可能只在源码目录里。
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));

    for dir in &dirs {
        let exact = dir.join(format!("{name}{suffix}"));
        if exact.is_file() {
            return Ok(exact);
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let file = entry.file_name().to_string_lossy().into_owned();
                if file.starts_with(&format!("{name}-")) && file.ends_with(suffix) {
                    return Ok(entry.path());
                }
            }
        }
    }
    let searched = dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join("、");
    Err(format!(
        "找不到本地后端程序 {name}{suffix}。打包前先执行 npm run sidecar:build；已查找：{searched}"
    ))
}

/// 读 sidecar 的 --version，与应用版本比对。前端更新了而后端还是旧版本时，
/// 接口字段会悄悄错位，所以宁可拒绝启动并给出明确提示。
fn probe_version(bin: &Path) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("无法执行 {} --version：{e}", bin.display()))?;
    if !out.status.success() {
        return Err(format!(
            "后端 --version 退出码 {:?}，版本校验无法完成",
            out.status.code()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let version = text
        .split_whitespace()
        .last()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if version.is_empty() {
        Err("后端 --version 没有输出版本号（应输出与应用一致的 semver）".to_string())
    } else {
        Ok(version)
    }
}

fn health_ok(port: u16, path: &str) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let request = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response
        .lines()
        .next()
        .map(|line| line.contains(" 200 "))
        .unwrap_or(false)
}

fn ensure_backend_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("取不到应用配置目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败（{}）：{e}", dir.display()))?;
    let file = dir.join("backend.json");
    if !file.is_file() {
        fs::write(&file, BACKEND_TEMPLATE)
            .map_err(|e| format!("写入默认后端配置失败（{}）：{e}", file.display()))?;
        eprintln!("[sidecar] 已生成默认后端配置（不含密码）：{}", file.display());
    }
    Ok(file)
}

/// 后端配置里声明用哪个环境变量承载数据库密码；没有 database 段就表示不需要密码。
fn password_env_name(file: &Path) -> Result<Option<String>, String> {
    let raw = fs::read_to_string(file).map_err(|e| format!("读取后端配置失败：{e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("后端配置不是合法 JSON：{e}"))?;
    Ok(value
        .get("database")
        .and_then(|d| d.get("passwordEnv"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string()))
}

/// 密码来源顺序：进程环境变量（便于 CI / 内测）→ 本机 secrets.json（首次启动引导写入）。
/// 两条都没有就返回 None，外壳会显示首次启动引导，而不是拿空密码去连库。
fn read_password(app: &tauri::AppHandle, env_name: &str) -> Option<String> {
    if let Ok(value) = std::env::var(env_name) {
        if !value.is_empty() {
            return Some(value);
        }
    }
    let file = app.path().app_config_dir().ok()?.join("secrets.json");
    let raw = fs::read_to_string(file).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value
        .get("dbPassword")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn write_secrets(app: &tauri::AppHandle, password: &str) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("取不到应用配置目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    let file = dir.join("secrets.json");
    let body = serde_json::json!({ "dbPassword": password }).to_string();
    fs::write(&file, body).map_err(|e| format!("写入本机凭据失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&file, fs::Permissions::from_mode(0o600));
    }
    // 绝不打印密码本身。
    eprintln!("[sidecar] 已保存本机数据库凭据：{}", file.display());
    Ok(())
}

fn hide_console(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// sidecar 的 stderr 落到本机数据目录：后端因密码错误/端口占用退出时，
/// 把最后几行带回界面，用户能看到「认证失败」而不是只有一句退出码。
fn sidecar_stderr_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("sidecar.stderr.log"))
}

fn sidecar_stderr_tail(path: &Option<PathBuf>) -> String {
    let Some(file) = path else { return String::new() };
    let Ok(text) = fs::read_to_string(file) else { return String::new() };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let tail: String = {
        let rev: Vec<char> = trimmed.chars().rev().take(600).collect();
        rev.into_iter().rev().collect()
    };
    format!("\n后端最近输出：\n{tail}")
}

fn start_sidecar(app: tauri::AppHandle) {
    let config = app.state::<AppConfig>().0.clone();
    let sidecar = match config.sidecar.clone() {
        Some(sc) if sc.enabled => sc,
        _ => return,
    };

    {
        let state = app.state::<SidecarState>();
        if let Ok(inner) = state.inner.lock() {
            if matches!(inner.status.state.as_str(), "starting" | "ready") {
                return;
            }
        };
    };

    // 密码检查放在主线程里：需要引导时干脆不进入 starting，前端不会看到「启动中→要密码」的跳变。
    let backend_file = match ensure_backend_config(&app) {
        Ok(f) => f,
        Err(err) => {
            fail(&app, err);
            return;
        }
    };
    let password = match password_env_name(&backend_file) {
        Ok(None) => None,
        Ok(Some(env_name)) => match read_password(&app, &env_name) {
            Some(pw) => Some((env_name, pw)),
            None => {
                eprintln!("[sidecar] 未找到数据库密码，进入首次启动引导（不会启动后端）");
                set_status(
                    &app,
                    SidecarStatus {
                        state: "setup-required".to_string(),
                        needs_password: true,
                        message: format!(
                            "首次启动需要设置数据库密码。它不会进安装包，只保存在本机配置目录（{}），并以环境变量 {env_name} 交给后端。",
                            backend_file.display()
                        ),
                        ..SidecarStatus::default()
                    },
                    "lc:backend-setup-required",
                );
                return;
            }
        },
        Err(err) => {
            fail(&app, err);
            return;
        }
    };

    stop_child(&app);
    set_status(
        &app,
        SidecarStatus {
            state: "starting".to_string(),
            message: "正在启动本地后端…".to_string(),
            ..SidecarStatus::default()
        },
        "lc:backend-starting",
    );

    let handle = app.clone();
    std::thread::spawn(move || run_sidecar(handle, config, sidecar, backend_file, password));
}

fn run_sidecar(
    app: tauri::AppHandle,
    config: RuntimeConfig,
    sidecar: SidecarConfig,
    backend_file: PathBuf,
    password: Option<(String, String)>,
) {
    let bin = match resolve_sidecar(&sidecar.name) {
        Ok(p) => p,
        Err(err) => return fail(&app, err),
    };

    let version = if sidecar.version_check {
        match probe_version(&bin) {
            Ok(v) => {
                if v != config.version {
                    return fail(
                        &app,
                        format!(
                            "本地后端版本 {v} 与应用版本 {} 不一致，已拒绝启动。重新执行 npm run sidecar:build 用当前版本构建后端，不要只更新前端。",
                            config.version
                        ),
                    );
                }
                Some(v)
            }
            Err(err) => return fail(&app, err),
        }
    } else {
        probe_version(&bin).ok()
    };

    let port = match pick_port() {
        Ok(p) => p,
        Err(err) => return fail(&app, err),
    };

    let mut cmd = Command::new(&bin);
    cmd.arg("--port")
        .arg(port.to_string())
        .arg("--config")
        .arg(&backend_file);
    // 测试/排障钩子：应用进程带 LC_SIDECAR_PORT_FILE 时，让 sidecar 把实际端口写出来。
    if let Ok(file) = std::env::var("LC_SIDECAR_PORT_FILE") {
        cmd.arg("--port-file").arg(file);
    }
    for arg in &sidecar.args {
        cmd.arg(arg);
    }
    cmd.env("LC_BACKEND_PORT", port.to_string());
    for (key, value) in &sidecar.env {
        cmd.env(key, value);
    }
    if let Some((env_name, value)) = &password {
        cmd.env(env_name, value);
    }
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = fs::create_dir_all(&dir);
        cmd.current_dir(dir);
    }
    // stdin 保持打开：外壳崩溃时管道关闭，Go 侧看门狗读到 EOF 会主动退出，
    // 这是「被任务管理器强杀」时不留孤儿进程的兜底。
    cmd.stdin(Stdio::piped()).stdout(Stdio::null());
    // stderr 落文件而不是丢弃：失败时把最后几行带回界面，能显示后端自己的错误原因。
    let stderr_log = sidecar_stderr_path(&app);
    match stderr_log.as_ref().and_then(|p| fs::File::create(p).ok()) {
        Some(file) => {
            cmd.stderr(Stdio::from(file));
        }
        None => {
            cmd.stderr(Stdio::null());
        }
    }
    hide_console(&mut cmd);

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            return fail(
                &app,
                format!(
                    "本地后端启动失败（{}）：{err}。检查文件是否被隔离、是否有执行权限。{}",
                    bin.display(),
                    sidecar_stderr_tail(&stderr_log)
                ),
            );
        }
    };
    eprintln!("[sidecar] 已启动 {}，端口 {port}", bin.display());

    {
        let state = app.state::<SidecarState>();
        if let Ok(mut inner) = state.inner.lock() {
            inner.child = Some(child);
        };
    };

    let url = format!("http://127.0.0.1:{port}");
    let deadline = Instant::now() + Duration::from_millis(sidecar.readiness_timeout_ms);
    loop {
        if health_ok(port, &sidecar.readiness_path) {
            set_status(
                &app,
                SidecarStatus {
                    state: "ready".to_string(),
                    backend_url: Some(url),
                    version,
                    needs_password: false,
                    message: "本地后端已就绪".to_string(),
                },
                "lc:backend-ready",
            );
            return;
        }

        let exited = {
            let state = app.state::<SidecarState>();
            let mut inner = match state.inner.lock() {
                Ok(i) => i,
                Err(_) => return,
            };
            match inner.child.as_mut().map(|c| c.try_wait()) {
                Some(Ok(Some(status))) => {
                    inner.child = None;
                    Some(status)
                }
                _ => None,
            }
        };
        if let Some(status) = exited {
            let code = status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "未知".to_string());
            return fail(
                &app,
                format!(
                    "本地后端在健康检查通过前就退出了（退出码 {code}）。常见原因：数据库密码错误、端口被占、后端不支持 --port、依赖缺失或被杀毒软件拦截。{}",
                    sidecar_stderr_tail(&stderr_log)
                ),
            );
        }

        if Instant::now() >= deadline {
            stop_child(&app);
            return fail(
                &app,
                format!(
                    "本地后端 {} 毫秒内没有通过 {} 健康检查，已停止并清理进程。检查后端是否真的实现了该健康接口。{}",
                    sidecar.readiness_timeout_ms,
                    sidecar.readiness_path,
                    sidecar_stderr_tail(&stderr_log)
                ),
            );
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

#[tauri::command]
fn sidecar_status(state: State<'_, SidecarState>) -> SidecarStatus {
    state
        .inner
        .lock()
        .map(|inner| inner.status.clone())
        .unwrap_or_default()
}

/// 首次启动引导写入的密码只落在本机配置目录，不打进安装包。
#[tauri::command]
fn submit_backend_password(app: tauri::AppHandle, password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("密码不能为空。".to_string());
    }
    if password.trim().is_empty() {
        return Err("密码不能只有空白字符。".to_string());
    }
    if password.chars().count() > 256 {
        return Err(format!(
            "密码长度 {} 超过 256 个字符，请确认没有误粘贴整段文本。",
            password.chars().count()
        ));
    }
    write_secrets(&app, &password)?;
    start_sidecar(app);
    Ok(())
}

#[tauri::command]
fn restart_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    start_sidecar(app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = load_config();

    if config.schema_version != 1 {
        eprintln!("[warn] desktop.runtime.json 版本 {} 与当前外壳不匹配，建议重新渲染", config.schema_version);
    }
    if config.delivery.mode == "server" {
        eprintln!(
            "[warn] 当前为 server 接入（{}://），前端由外部服务提供；服务没起时窗口会是白屏",
            config.delivery.protocol
        );
    }
    if config.backend.enabled {
        eprintln!("[info] 后端地址：{}（前端跨域请求需允许 tauri 页面来源）", config.backend.base_url);
    }

    let mut builder = tauri::Builder::default();

    // 单实例与开机自启是桌面端能力，Android/iOS 上没有对应概念。
    #[cfg(desktop)]
    if config.single_instance {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    // 插件始终注册，是否真的写开机项由配置决定；关闭时不去掉系统里已有的项，
    // 避免用户手动加的自启被一次启动悄悄删掉。
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ));
    }

    if config.update_active {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let autostart_wanted = config.autostart;
    let update_wanted = config.update_active && config.check_on_startup;
    let sidecar_enabled = config.sidecar.as_ref().map(|s| s.enabled).unwrap_or(false);
    let app_name = config.product_name.clone();

    builder
        .manage(AppConfig(config))
        .manage(SidecarState::default())
        .manage(UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            sidecar_status,
            submit_backend_password,
            restart_sidecar,
            update_check,
            update_install,
            update_status
        ])
        .setup(move |app| {
            #[cfg(desktop)]
            if autostart_wanted {
                use tauri_plugin_autostart::ManagerExt;
                let manager = app.autolaunch();
                match manager.is_enabled() {
                    Ok(true) => {}
                    Ok(false) => {
                        if let Err(err) = manager.enable() {
                            eprintln!("[warn] 写入开机自启失败：{err}");
                        }
                    }
                    Err(err) => eprintln!("[warn] 读取自启状态失败：{err}"),
                }
            }
            if update_wanted {
                spawn_update_check(app.handle().clone());
            }
            if sidecar_enabled {
                start_sidecar(app.handle().clone());
            }
            eprintln!("[info] {app_name} 已启动");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("桌面外壳启动失败")
        .run(|app_handle, event| {
            // 正常退出（关窗口、托盘退出、任务管理器发 WM_CLOSE）走这里；
            // 被强杀时不走，由 sidecar 的 stdin 看门狗兜底。
            if let RunEvent::Exit = event {
                stop_sidecar(app_handle);
            }
        });
}
