// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 缓存层：none / memory / redis。Redis 只用 tokio TcpStream 手写最小 RESP2
// （PING / GET / SETEX / DEL），不引入额外 crate。
// 连不上 Redis 时打印 warn 并降级为进程内内存缓存，服务照常启动。
use std::collections::HashMap;
use std::io;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::generated::config::CacheConfig;

const IO_TIMEOUT: Duration = Duration::from_secs(2);

fn fallback_kind(config: &CacheConfig) -> Kind {
    if config.fallback.trim() == "none" {
        Kind::None
    } else {
        Kind::Memory
    }
}

fn fallback_label(config: &CacheConfig) -> &'static str {
    if config.fallback.trim() == "none" {
        "无缓存"
    } else {
        "进程内存缓存"
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    None,
    Memory,
    Redis,
}

/// 缓存对外接口。redis 运行期出错时按「未命中」处理，不把错误抛给业务。
pub struct Cache {
    kind: Kind,
    fallback: bool,
    ttl: Duration,
    key_prefix: String,
    memory: Mutex<HashMap<String, (String, Instant)>>,
    redis: Option<RedisConn>,
}

impl Cache {
    pub async fn init(config: &CacheConfig) -> Self {
        let ttl = Duration::from_secs(u64::from(config.ttl_seconds));
        let key_prefix = config.key_prefix.clone();
        let fallback_kind = fallback_kind(config);
        let fallback_label = fallback_label(config);

        if !config.enabled {
            tracing::warn!(
                "缓存已关闭，已回退为{}（cache.enabled=false, cache.fallback={}）",
                fallback_label,
                config.fallback
            );
            return Self::base(fallback_kind, true, ttl, key_prefix);
        }

        match config.driver.trim() {
            "none" => Self::plain(Kind::None, ttl, key_prefix),
            "memory" => Self::plain(Kind::Memory, ttl, key_prefix),
            "redis" => match RedisConn::parse(&config.url) {
                Ok(conn) => match conn.ping().await {
                    Ok(()) => {
                        tracing::info!(cache = %conn.display(), "Redis 缓存已启用");
                        Self {
                            kind: Kind::Redis,
                            fallback: false,
                            ttl,
                            key_prefix,
                            memory: Mutex::new(HashMap::new()),
                            redis: Some(conn),
                        }
                    }
                    Err(err) => {
                        tracing::warn!(
                            error = %err,
                            fallback = %fallback_label,
                            "Redis 不可用，已回退为{}（cache.fallback={}，服务继续启动）",
                            fallback_label,
                            config.fallback
                        );
                        Self::base(fallback_kind, true, ttl, key_prefix)
                    }
                },
                Err(reason) => {
                    tracing::warn!(
                        reason = %reason,
                        fallback = %fallback_label,
                        "Redis 配置不可用，已回退为{}（cache.fallback={}，服务继续启动）",
                        fallback_label,
                        config.fallback
                    );
                    Self::base(fallback_kind, true, ttl, key_prefix)
                }
            },
            other => {
                tracing::warn!(driver = %other, "未知缓存驱动，已回退为{}", fallback_label);
                Self::base(fallback_kind, true, ttl, key_prefix)
            }
        }
    }

    /// 就绪检查用：redis 模式下真实 PING；其余模式恒为可用。
    pub async fn probe(&self) -> Result<(), String> {
        match self.kind {
            Kind::Redis => match &self.redis {
                Some(conn) => conn.ping().await,
                None => Err("Redis 连接不存在".to_string()),
            },
            _ => Ok(()),
        }
    }

    fn plain(kind: Kind, ttl: Duration, key_prefix: String) -> Self {
        Self::base(kind, false, ttl, key_prefix)
    }

    fn base(kind: Kind, fallback: bool, ttl: Duration, key_prefix: String) -> Self {
        Self {
            kind,
            fallback,
            ttl,
            key_prefix,
            memory: Mutex::new(HashMap::new()),
            redis: None,
        }
    }

    /// 实际生效的缓存类型：none / memory / redis。
    pub fn effective_name(&self) -> &'static str {
        match self.kind {
            Kind::None => "none",
            Kind::Memory => "memory",
            Kind::Redis => "redis",
        }
    }

    /// redis 配置失败时是否已降级（其余情况为 false）。
    pub fn is_fallback(&self) -> bool {
        self.fallback
    }

    pub fn key(&self, suffix: &str) -> String {
        format!("{}{}", self.key_prefix, suffix)
    }

    pub async fn get(&self, key: &str) -> Option<String> {
        match self.kind {
            Kind::None => None,
            Kind::Memory => self.memory_get(key),
            Kind::Redis => {
                let Some(conn) = &self.redis else {
                    return None;
                };
                match conn.get(key).await {
                    Ok(value) => value,
                    Err(err) => {
                        tracing::warn!(error = %err, "Redis GET 失败，本次按缓存未命中处理");
                        None
                    }
                }
            }
        }
    }

    pub async fn set(&self, key: &str, value: String) {
        match self.kind {
            Kind::None => {}
            Kind::Memory => {
                if let Ok(mut map) = self.memory.lock() {
                    map.insert(key.to_string(), (value, Instant::now() + self.ttl));
                }
            }
            Kind::Redis => {
                let Some(conn) = &self.redis else {
                    return;
                };
                let ttl = self.ttl.as_secs().max(1).to_string();
                if let Err(err) = conn.setex(key, &ttl, &value).await {
                    tracing::warn!(error = %err, "Redis SETEX 失败，本次写入忽略");
                }
            }
        }
    }

    pub async fn del(&self, key: &str) {
        match self.kind {
            Kind::None => {}
            Kind::Memory => {
                if let Ok(mut map) = self.memory.lock() {
                    map.remove(key);
                }
            }
            Kind::Redis => {
                let Some(conn) = &self.redis else {
                    return;
                };
                if let Err(err) = conn.del(key).await {
                    tracing::warn!(error = %err, "Redis DEL 失败，本次删除忽略");
                }
            }
        }
    }

    fn memory_get(&self, key: &str) -> Option<String> {
        let mut map = self.memory.lock().ok()?;
        let now = Instant::now();
        match map.get(key) {
            Some((value, expires)) if *expires > now => Some(value.clone()),
            Some(_) => {
                map.remove(key);
                None
            }
            None => None,
        }
    }
}

struct RedisConn {
    host: String,
    port: u16,
    db: u32,
    username: Option<String>,
    password: Option<String>,
}

impl RedisConn {
    /// 支持 redis://[:password@]host:port/db 与 redis://user:password@host:port/db。
    fn parse(url: &str) -> Result<Self, String> {
        let url = url.trim();
        if url.starts_with("rediss://") {
            return Err(
                "暂不支持 rediss://（需要 TLS）；请改用 redis:// 或降级内存缓存".to_string(),
            );
        }
        let rest = url
            .strip_prefix("redis://")
            .ok_or_else(|| "缓存 URL 必须以 redis:// 开头".to_string())?;

        let (authority, db_part) = rest.split_once('/').unwrap_or((rest, ""));
        let db = if db_part.is_empty() {
            0
        } else {
            db_part
                .parse::<u32>()
                .map_err(|_| "Redis URL 的库编号必须是整数（如 /0）".to_string())?
        };

        let (userinfo, host_port) = match authority.rsplit_once('@') {
            Some((userinfo, host_port)) => (Some(userinfo), host_port),
            None => (None, authority),
        };
        let (username, password) = match userinfo {
            Some(info) => match info.split_once(':') {
                Some((user, pass)) => (
                    (!user.is_empty()).then(|| percent_decode(user)),
                    (!pass.is_empty()).then(|| percent_decode(pass)),
                ),
                None => (Some(percent_decode(info)), None),
            },
            None => (None, None),
        };

        let (host, port) = parse_host_port(host_port, 6379)?;
        Ok(Self {
            host,
            port,
            db,
            username,
            password,
        })
    }

    fn display(&self) -> String {
        format!("{}:{}/{}", self.host, self.port, self.db)
    }

    async fn ping(&self) -> Result<(), String> {
        match self.command(&["PING"]).await? {
            Resp::Simple(value) if value == "PONG" => Ok(()),
            Resp::Error(message) => Err(format!("Redis 返回错误：{message}")),
            _ => Err("Redis PING 返回了非预期响应".to_string()),
        }
    }

    async fn get(&self, key: &str) -> Result<Option<String>, String> {
        match self.command(&["GET", key]).await? {
            Resp::Bulk(value) => Ok(value),
            Resp::Error(message) => Err(format!("Redis 返回错误：{message}")),
            _ => Err("Redis GET 返回了非预期响应".to_string()),
        }
    }

    async fn setex(&self, key: &str, ttl: &str, value: &str) -> Result<(), String> {
        match self.command(&["SETEX", key, ttl, value]).await? {
            Resp::Simple(value) if value == "OK" => Ok(()),
            Resp::Error(message) => Err(format!("Redis 返回错误：{message}")),
            _ => Err("Redis SETEX 返回了非预期响应".to_string()),
        }
    }

    async fn del(&self, key: &str) -> Result<(), String> {
        match self.command(&["DEL", key]).await? {
            Resp::Integer => Ok(()),
            Resp::Error(message) => Err(format!("Redis 返回错误：{message}")),
            _ => Err("Redis DEL 返回了非预期响应".to_string()),
        }
    }

    async fn command(&self, parts: &[&str]) -> Result<Resp, String> {
        let address = if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        };
        let task = async {
            let mut stream = TcpStream::connect(&address)
                .await
                .map_err(|err| format!("连接 Redis {address} 失败：{err}"))?;

            if let Some(password) = &self.password {
                let reply = match &self.username {
                    Some(username) => send(&mut stream, &["AUTH", username, password]).await?,
                    None => send(&mut stream, &["AUTH", password]).await?,
                };
                expect_ok(reply, "AUTH")?;
            }
            if self.db != 0 {
                let db = self.db.to_string();
                let reply = send(&mut stream, &["SELECT", &db]).await?;
                expect_ok(reply, "SELECT")?;
            }

            send(&mut stream, parts).await
        };

        timeout(IO_TIMEOUT, task)
            .await
            .map_err(|_| format!("Redis 操作超时（{address}）"))?
    }
}

enum Resp {
    Simple(String),
    Error(String),
    Integer,
    Bulk(Option<String>),
}

fn expect_ok(reply: Resp, command: &str) -> Result<(), String> {
    match reply {
        Resp::Simple(value) if value == "OK" || value == "PONG" => Ok(()),
        Resp::Error(message) => Err(format!("Redis {command} 失败：{message}")),
        _ => Err(format!("Redis {command} 返回了非预期响应")),
    }
}

async fn send(stream: &mut TcpStream, parts: &[&str]) -> Result<Resp, String> {
    let payload = encode(parts);
    stream
        .write_all(payload.as_bytes())
        .await
        .map_err(|err| format!("写入 Redis 命令失败：{err}"))?;
    read_resp(stream)
        .await
        .map_err(|err| format!("读取 Redis 响应失败：{err}"))
}

fn encode(parts: &[&str]) -> String {
    let mut out = format!("*{}\r\n", parts.len());
    for part in parts {
        out.push_str(&format!("${}\r\n{}\r\n", part.len(), part));
    }
    out
}

async fn read_resp(stream: &mut TcpStream) -> io::Result<Resp> {
    let kind = read_byte(stream).await?;
    match kind {
        b'+' => Ok(Resp::Simple(read_line(stream).await?)),
        b'-' => Ok(Resp::Error(read_line(stream).await?)),
        b':' => {
            let _ = read_line(stream).await?;
            Ok(Resp::Integer)
        }
        b'$' => {
            let length: i64 = read_line(stream).await?.trim().parse().unwrap_or(-1);
            if length < 0 {
                return Ok(Resp::Bulk(None));
            }
            let mut buffer = vec![0u8; length as usize];
            stream.read_exact(&mut buffer).await?;
            let mut crlf = [0u8; 2];
            stream.read_exact(&mut crlf).await?;
            Ok(Resp::Bulk(Some(
                String::from_utf8_lossy(&buffer).to_string(),
            )))
        }
        other => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("无法识别的 Redis 响应类型：{other}"),
        )),
    }
}

async fn read_byte(stream: &mut TcpStream) -> io::Result<u8> {
    let mut buffer = [0u8; 1];
    stream.read_exact(&mut buffer).await?;
    Ok(buffer[0])
}

async fn read_line(stream: &mut TcpStream) -> io::Result<String> {
    let mut buffer = Vec::new();
    loop {
        let byte = read_byte(stream).await?;
        if byte == b'\n' {
            break;
        }
        buffer.push(byte);
    }
    if buffer.last() == Some(&b'\r') {
        buffer.pop();
    }
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

fn parse_host_port(value: &str, default_port: u16) -> Result<(String, u16), String> {
    if let Some(rest) = value.strip_prefix('[') {
        let end = rest
            .find(']')
            .ok_or_else(|| "Redis URL 的 IPv6 地址缺少 ]".to_string())?;
        let host = rest[..end].to_string();
        let port = rest[end + 1..]
            .strip_prefix(':')
            .and_then(|port| port.parse::<u16>().ok())
            .unwrap_or(default_port);
        return Ok((host, port));
    }
    match value.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() => Ok((
            host.to_string(),
            port.parse::<u16>()
                .map_err(|_| "Redis URL 的端口必须是 0-65535 的整数".to_string())?,
        )),
        _ if !value.is_empty() => Ok((value.to_string(), default_port)),
        _ => Err("Redis URL 缺少主机名".to_string()),
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                out.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
