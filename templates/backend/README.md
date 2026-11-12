# 后端模板（三语言）

> **安全红线**：不要连接本机已有的数据库实例（MySQL / PostgreSQL / Redis 等），那里可能是真实业务数据。需要验证时只允许临时隔离实例（独立端口、独立空目录、独立空库、一次性密码、只监听 127.0.0.1），用完立即停止并删除；做不到就写「本机无法安全验证」。下面示例刻意避开 3306 / 3307 / 5432 / 6379 默认端口。

导出站点时，`server/` 目录从这里的某一套模板复制。三套模板**共用同一套接口形状、配置文件结构、健康检查路径和错误响应**，换语言不用重新学一套约定。差别只在成熟度、实现方式和本地依赖。

## 1. 选型表

| 语言 | 目录 | 档位 | 运行时基线 | 存储 | 适合 |
| --- | --- | --- | --- | --- | --- |
| Rust | `rust/` | `full` | rustc/cargo ≥ 1.80 | SQLite / MySQL / PostgreSQL（sqlx，连接池） | 默认推荐，长期运行、要求稳定性 |
| Node | `node/` | `full` | Node ≥ 22.5（推荐 24 LTS） | SQLite / MySQL / PostgreSQL（`node:sqlite` + mysql2 + pg） | 已经用 JS、想少装工具链 |
| Go | `go/` | `usable` | Go ≥ 1.22 | SQLite / MySQL / PostgreSQL（`database/sql` + 纯 Go 驱动） | 单二进制部署、不想碰 Node/Rust |

三套都支持 `cache.driver: none / memory / redis`；Redis 不可达时自动降级进程内存，不影响启动。

## 2. 落位与启动

导出包中的位置：

| 内容 | 路径 |
| --- | --- |
| 后端工程 | `server/`（把某一语言目录的内容整个拷进去） |
| 后端配置 | `deploy/backend/config.yaml`（`config.generated.yaml` 为平台生成底稿） |
| 静态站 | `web/` |
| nginx 配置 | `deploy/nginx/nginx.conf` |

启动命令（在 `server/` 目录执行）：

| 语言 | 启动 |
| --- | --- |
| Rust | `cargo run --release`（或 `cargo build --release` 后跑 `target/release/lowcode-server`） |
| Node | `npm ci --omit=dev` 然后 `npm start` |
| Go | `go build ./...` 后跑 `lowcode-server`（Windows 为 `lowcode-server.exe`） |

配置默认按这个顺序找：`../deploy/backend/config.yaml` → `./config.yaml` → 内置默认值。也可以显式指定。

迁移命令（三套统一）：`--migrate` 执行未应用迁移，`--migrate-down` 回滚最近一版；Node 另提供 `npm run migrate` / `npm run migrate:down`。数据库、缓存与迁移的配置细节见第 8.1 节。

## 3. 目录三区（三套同一规则）

每套模板都按三类文件分区，README 顶部与文件头都带标记：

| 区域 | 标记 | Rust | Node | Go | 重新生成时 |
| --- | --- | --- | --- | --- | --- | --- |
| 平台生成 / 可被重新生成 | `[LC-GENERATED]` | `src/generated/`、`src/main.rs`、`migrations/generated/`、`scripts/`、`Cargo.toml`、`README.md`、`GENERATED-MANIFEST.json` | `src/generated/`、`src/main.js`、`migrations/generated/`、`scripts/`、`package.json`、`README.md`、`GENERATED-MANIFEST.json` | `internal/generated/`、`main.go`、`migrations/generated/`、`scripts/`、`go.mod`、`README.md`、`.env.example`、`.gitignore`、`GENERATED-MANIFEST.json` | **整块替换**，不要手改 |
| 用户自定义 | `[LC-CUSTOM]` | `src/custom/`、`migrations/custom/`、`config.yaml`、`.env` | `src/custom/`、`migrations/custom/`、`deploy/backend/config.yaml`、`config.yaml`、`.env` | `internal/custom/`、`migrations/custom/`、`config.yaml`、`.env` | **原样保留**，随便改、随便加文件 |
| 运行产物 | 无 | `target/`、`data/`、`logs/` | `node_modules/`、`data/`、`logs/` | 编译出的二进制、`data/`、`logs/` | 不提交、可随时删，已在 `.gitignore` |

判断规则只有一条：**要改业务找 `custom/`；看到 `[LC-GENERATED]` 就停手**。

依赖锁文件（`Cargo.lock`、`package-lock.json`、`go.sum`）与 `config.generated.yaml` 属于平台生成但**不进生成区清单**：前者是依赖解析产物，后者是配置底稿，允许用户用 `override: true` 整体接管。

## 4. 扩展点：只改一处，不动其他模块

| 想改什么 | Rust | Node | Go |
| --- | --- | --- | --- |
| `/api/items` 的校验、返回结构、业务逻辑 | `src/custom/items.rs`（`list / get_one / create / update / remove`） | `src/custom/handlers/items.js`（`list / get / create / update / remove`） | `internal/custom/items.go`（`ListItems / GetItem / CreateItem / UpdateItem / DeleteItem`） |
| items 的存储实现（换外部服务 / 对象存储） | `src/custom/store.rs`（五个函数签名） | `src/custom/services/items-store.js`（五个函数签名） | `internal/custom/store.go`（五个函数签名） |
| 新增接口（如 `/api/custom/orders`） | `src/custom/routes.rs`（`register(router)`） | `src/custom/routes.js`（`registerCustomRoutes(app, deps)`） | `internal/custom/routes.go`（`Register(mux, deps)`） |
| 新增数据表 | `migrations/custom/0002_xxx.sql` | `migrations/custom/0002_xxx.sql` | `migrations/custom/0002_xxx.sql` |
| 中间件、路由分发、配置读取 | 生成区（改完要同步回平台模板，否则重跑会覆盖） | 生成区 | 生成区 |

生成区的路由/启动代码只做内置路由分发与调用扩展点，所以新增接口不需要改 `Router`/`Main`。Rust、Go 的用户区各带一个 `/api/custom/example` 示例，可直接删掉或照着写；Node 的示例在 `src/custom/routes.js`。

## 5. 重新生成的语义

平台重跑生成器时：

1. **只覆盖生成区**；`custom/`、`migrations/custom/`、`config.yaml`、`.env*` 原样保留。
2. 覆盖前先跑 `node scripts/generated-manifest.mjs verify`：
   - 退出码 `0`：生成区一致，可安全覆盖。
   - 退出码 `3`：生成区有 `modified` / `missing` / `extra`，**不允许静默覆盖**。
   - 退出码 `4`：清单缺失或损坏，同样不能直接覆盖。
3. 有漂移时让用户三选一，不自动决定：
   - **覆盖**：丢弃生成区手改（先列出会丢什么）。
   - **保留**：把改过的生成文件另存到 `custom/legacy/` 并生成 `MIGRATION-NOTES.md`，同时**阻断导出**，等用户把改动搬进扩展点。
   - **取消**：本次不重新生成。
4. 重生成完成后，由平台执行 `node scripts/generated-manifest.mjs create` 刷新清单。

清单只覆盖生成区路径；运行产物、`config.yaml`、`.env*`、依赖锁文件都不在清单里。

## 6. 导出前检查与秘密告警

三套都提供 `scripts/check-user.mjs`，导出打包前必须跑：

| 语言 | 编译 / 语法检查 | 本机缺工具 |
| --- | --- | --- |
| Rust | `cargo check`（覆盖 `src/custom/`） | 退出码 `2`（`BLOCKED`） |
| Node | `node --check`（`src/custom/` 下所有 JS） | 退出码 `2` |
| Go | `go vet ./...` | 退出码 `2` |

- 检查不过退出码 `1`，**构建流程必须在打包前拦住**，不能生成一个起不来的导出包。
- 秘密扫描覆盖 `custom/`、`migrations/custom/`、`config.yaml`、`.env*`：疑似私钥块、密码、secret/token、带账号密码的连接串、云厂商 key 会告警。**只输出类别与行号，绝不打印命中内容**。
- 默认告警不阻断（退出码 `0`）；`--strict-secrets` 时告警也失败（退出码 `1`），用于发布前。

## 7. 接口形状

统一响应：

```json
{ "ok": true, "data": { } }
```

```json
{ "ok": false, "error": { "code": "LC_E_XXX", "message": "人话说明", "detail": "", "field": "" } }
```

| 方法 | 路径 | 说明 | 成功状态 |
| --- | --- | --- | --- |
| GET | `/api/health` | 存活检查：进程能响应就返回 200；数据库探测结果放在 `databaseReachable` / `databaseProblem`，不改状态码 | 200 |
| GET | `/api/ready` | 就绪检查：数据库（可选缓存）不可用时返回 503 `LC_E_NOT_READY`，并写明哪个依赖不可用 | 200 / 503 |
| GET | `/api/meta` | 站点/运行时摘要，含配置来源与中间件清单，不含任何密钥值 | 200 |
| GET | `/api/items?limit=&offset=` | 列表，`limit` 1–100 默认 20，`offset` ≥ 0 默认 0 | 200 |
| POST | `/api/items` | 新建，body `{ "title": "", "body": "" }` | 201 |
| GET | `/api/items/:id` | 单条 | 200 / 404 |
| PUT | `/api/items/:id` | 更新，body 同 POST | 200 / 404 |
| DELETE | `/api/items/:id` | 删除 | 200 / 404 |
| GET | `/api/collections/{collectionId}/rows` | 集合列表：分页 / 筛选 / 排序 / 字段选择 | 200 / 401 / 503 |
| POST | `/api/collections/{collectionId}/rows` | 新建行（默认要求登录） | 201 / 401 / 403 / 409 |
| GET | `/api/collections/{collectionId}/rows/{rowId}` | 单条 | 200 / 401 / 404 |
| PUT | `/api/collections/{collectionId}/rows/{rowId}` | 合并式更新 | 200 / 401 / 403 / 404 / 409 |
| DELETE | `/api/collections/{collectionId}/rows/{rowId}` | 删除 | 200 / 401 / 403 / 404 |
| POST | `/api/auth/register` | 注册，body `{ "username": "", "password": "", "displayName": "" }` | 201 |
| POST | `/api/auth/login` | 登录，body `{ "username": "", "password": "" }` | 200 / 401 / 429 |
| POST | `/api/auth/refresh` | 刷新令牌；JWT 模式传 `refreshToken`，session 模式传 Bearer 会话令牌 | 200 / 401 |
| POST | `/api/auth/logout` | 登出并撤销令牌；JWT 模式可传 `refreshToken`，不传则撤销该用户全部刷新令牌 | 200 / 401 |
| GET | `/api/auth/me` | 当前用户、角色与权限点 | 200 / 401 |
| GET | `/api/auth/mode` | 当前令牌方案（`jwt` / `session`） | 200 |
| GET | `/api/admin/users` | 最小 RBAC 示例，需要 `users:read` 权限 | 200 / 401 / 403 |

`/api/health` 成功示例（存活检查不因依赖不可用而返回 503）：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "language": "rust",
    "maturity": "full",
    "version": "0.1.0",
    "uptimeSeconds": 12,
    "database": "sqlite",
    "cache": "memory",
    "cacheFallback": false,
    "static": false,
    "databaseReachable": true,
    "databaseProblem": "",
    "middleware": [
      { "name": "requestId", "enabled": true, "effective": "生成 x-request-id，日志与响应共用", "configPath": "middleware.requestId" }
    ]
  }
}
```

`/api/ready` 依赖不可用时返回 503：

```json
{
  "ok": false,
  "error": {
    "code": "LC_E_NOT_READY",
    "message": "服务尚未就绪",
    "detail": "数据库不可用：无法连接数据库（host:port/库名）",
    "field": ""
  }
}
```

规则：

- 每个响应都带 `x-request-id`（服务端生成 UUID，不接受客户端伪造；日志里用同一个值）。
- 400 = 参数不合法（`LC_E_INVALID_ARGUMENT`），401 = 未认证或令牌失效（`LC_E_UNAUTHORIZED`），403 = 缺少权限（`LC_E_FORBIDDEN`），404 = 记录不存在（`LC_E_NOT_FOUND`），413 = 请求体超限（`LC_E_PAYLOAD_TOO_LARGE`），429 = 触发限流 / 登录失败锁定（`LC_E_RATE_LIMITED`），500 = 服务端错误（`LC_E_INTERNAL`），503 = 存储不可用（`LC_E_DB_UNAVAILABLE`）/ 未就绪（`LC_E_NOT_READY`）/ 超时（`LC_E_TIMEOUT`）/ 并发超限（`LC_E_CONCURRENCY_LIMITED`）/ 中间件已关闭（`LC_E_MIDDLEWARE_DISABLED`）。
- 中间件被关闭时，依赖它的接口不会静默失效：能降级的降级（缓存回退、压缩交给 nginx），不能降级的返回 `LC_E_MIDDLEWARE_DISABLED` 并说明恢复键；启动日志同时打印影响范围与恢复提示。
- 错误体统一为 `{ ok:false, error:{ code, message, detail, field } }`；集合数据校验失败时额外带 `error.fields[]`，给每条字段级错误（见 14.3）。
- 静态站与 API 同进程时，`static.enabled: true`，非 `/api/*` 路径走静态文件；`backend+nginx` 形态保持 `false`，静态文件交给 nginx。
- 这是一套可扩展的业务骨架：`items` 是演示资源，照着它的分层加自己的表即可。

## 8. 配置结构与覆盖链

三套模板读**同一份 YAML**，结构完全一致：

```yaml
schemaVersion: 1
language: rust
maturity: full
strict: true
override: false
host: 127.0.0.1
port: 8080
logLevel: info
cors:
  enabled: true
  origins: []
  methods: [GET, POST, PUT, DELETE, OPTIONS]
  headers: [content-type, authorization, x-request-id]
  credentials: false
  maxAge: 600
database:                     # 未启用内置数据库组时使用（兼容模式）
  driver: sqlite              # sqlite / mysql / postgres
  url: "sqlite://data/app.db" # 非空时优先，scheme 决定驱动
  host: 127.0.0.1
  port: 0                     # 0 = 默认 3306 / 5432
  name: app
  user: ""
  password: ""                # 只从 LC_DB_PASSWORD 注入
  sslMode: disable            # disable / require
  maxOpenConns: 10
  connectTimeoutSeconds: 5
cache:
  enabled: true               # false = 关闭缓存；按 fallback 回退并在启动日志写明
  fallback: memory            # memory / none
  driver: memory              # none / memory / redis
  url: "redis://127.0.0.1:16379/0"
  ttlSeconds: 30
  keyPrefix: "lc:"
auth:
  tokenMode: jwt              # jwt（默认）/ session
  jwtSecret: ""               # 只用环境变量 LC_AUTH_JWT_SECRET 注入
  accessTokenTtlSeconds: 900
  refreshTokenTtlSeconds: 604800
  sessionTtlSeconds: 28800
  maxLoginFailures: 5
  failureWindowSeconds: 300
  lockSeconds: 900
  bootstrap:
    username: ""
    password: ""
    role: admin
dataApi:
  enabled: true
  publicRead: true            # 读默认公开；集合 access.read 可改为 authenticated
  writeRequiresAuth: true     # 未配置写角色时，写操作是否要求登录
  writeRoles: []              # 全局写角色白名单；集合 access.write 优先
  maxPageSize: 100            # pageSize 硬上限，超过按上限返回并标注
  collectionsDir: "../web/data/collections"
middleware:                   # 服务自身能力，不属于用户可自定义的业务配置
  requestId: true             # 关闭后日志无法串联同一次请求
  logging: true               # 关闭后只保留启动/错误日志，不会崩
  bodyLimit:
    enabled: true
    maxBytes: 1048576         # 超限 413 LC_E_PAYLOAD_TOO_LARGE
  timeout:
    enabled: true
    seconds: 30               # 超时 503 LC_E_TIMEOUT
  concurrency:
    enabled: false            # 默认关闭；开启后超限 503 LC_E_CONCURRENCY_LIMITED
    maxInFlight: 64
  compression:
    enabled: true
    gzip: true
    brotli: true              # Go 模板仅 gzip，启动日志会写明
    minBytes: 1024
  rateLimit:
    enabled: false            # 默认关闭；开启后超限 429 LC_E_RATE_LIMITED
    rps: 20
  staticCache:
    enabled: true
    maxAgeSeconds: 3600
    immutableMaxAgeSeconds: 31536000
  health:
    enabled: true             # 关闭后 /api/health 与 /api/ready 返回 503 并给出恢复键
    readinessRequiresDatabase: true
    readinessRequiresCache: false
  securityHeaders:
    enabled: true
    hsts:
      enabled: false          # 纯 HTTP 部署默认关闭，HTTPS 站点建议开启
      maxAgeSeconds: 31536000
      includeSubdomains: true
      preload: false
    contentTypeOptions: nosniff
    frameOptions: SAMEORIGIN
    referrerPolicy: strict-origin-when-cross-origin
    permissionsPolicy: "geolocation=(), microphone=(), camera=()"
    crossOriginOpenerPolicy: same-origin
  builtin:                    # 内置中间件预设组；关闭组完全不加载
    sqlite:
      enabled: true
      config:
        file: "data/app.db"
    postgres:
      enabled: false
      config:
        host: 127.0.0.1
        port: 5432
        database: app
        user: lc
        password: ""          # 只从 LC_CFG_POSTGRES_PASSWORD 注入
        sslMode: disable
        maxOpenConns: 10
        connectTimeoutSeconds: 5
    mysql:
      enabled: false          # 字段同 postgres；口令走 LC_CFG_MYSQL_PASSWORD
      config:
        host: 127.0.0.1
        port: 3306
        database: app
        user: lc
        password: ""
        maxOpenConns: 10
        connectTimeoutSeconds: 5
    redis:
      enabled: false          # 启用后接管缓存
      config:
        url: "redis://127.0.0.1:16379/0"
        ttlSeconds: 30
        keyPrefix: "lc:"
        password: ""          # 只从 LC_CFG_REDIS_PASSWORD 注入
    objectStorage:
      enabled: false          # 本模板不内置厂商 SDK，启用即注入配置
      config:
        driver: s3
        endpoint: ""
        bucket: ""
        region: ""
        accessKey: ""         # LC_CFG_OBJECT_STORAGE_ACCESS_KEY
        secretKey: ""         # LC_CFG_OBJECT_STORAGE_SECRET_KEY
    messageQueue:
      enabled: false
      config:
        driver: redis
        url: ""
        queue: lc
    search:
      enabled: false
      config:
        driver: opensearch
        url: ""
        index: lc
    reverseProxy:
      enabled: false
      config:
        upstream: "http://127.0.0.1:8080"
        clientMaxBodySize: "1m"
configCenter:                 # 用户自定义键值；骨架只做类型转换与缺省值
  definitions:
    - key: APP_MODE
      type: enum
      default: standard
      enum: [standard, strict]
      secret: false
      description: 运行模式
    - key: PAYMENT_API_KEY
      type: string
      default: ""
      secret: true            # 只从 LC_CFG_PAYMENT_API_KEY 读取，文件里的值会被忽略
  values:
    APP_MODE: standard
static:
  enabled: false
  root: "../web"
```

完整带注释的样例见 [config.example.yaml](config.example.yaml)。

覆盖链（后面的覆盖前面的）：

```
内置默认值 < config.generated.yaml < config.yaml（用户文件） < 环境变量 < 启动参数
```

| 环节 | 说明 |
| --- | --- |
| 内置默认值 | 各语言代码里硬编码同一份，缺文件也能启动 |
| `config.generated.yaml` | 平台生成的底稿，不手改；与用户文件同目录 |
| `config.yaml` | 用户的文件，逐键覆盖；声明 `override: true` 时**忽略生成底稿**，以「默认 + 用户文件」为最终结果 |
| 环境变量 | 见下表，优先级高于文件 |
| 启动参数 | 见下表，优先级最高 |

环境变量：

| 变量 | 对应字段 | 示例 |
| --- | --- | --- |
| `LC_HOST` | `host` | `127.0.0.1` |
| `LC_PORT` | `port` | `8080` |
| `LC_LOG_LEVEL` | `logLevel` | `debug` |
| `LC_CORS_ORIGINS` | `cors.origins` | `https://example.com,http://localhost:8310` |
| `DATABASE_URL` | `database.url` | `postgres://user:pass@db.example.com:15432/app` |
| `LC_DB_DRIVER` | `database.driver` | `mysql` |
| `LC_DB_HOST` | `database.host` | `127.0.0.1` |
| `LC_DB_PORT` | `database.port` | `3306` |
| `LC_DB_NAME` | `database.name` | `app` |
| `LC_DB_USER` | `database.user` | `app` |
| `LC_DB_PASSWORD` | `database.password` | （只在环境变量里设置） |
| `LC_DB_SSL_MODE` | `database.sslMode` | `require` |
| `LC_DB_MAX_OPEN_CONNS` | `database.maxOpenConns` | `10` |
| `LC_DB_CONNECT_TIMEOUT` | `database.connectTimeoutSeconds` | `5` |
| `LC_CACHE_ENABLED` | `cache.enabled` | `false` |
| `LC_CACHE_FALLBACK` | `cache.fallback` | `memory` / `none` |
| `LC_CACHE_DRIVER` | `cache.driver` | `redis` |
| `REDIS_URL` | `cache.url` | `redis://127.0.0.1:16379/0` |
| `LC_CACHE_TTL_SECONDS` | `cache.ttlSeconds` | `30` |
| `LC_MW_REQUEST_ID` | `middleware.requestId` | `true` |
| `LC_MW_LOGGING` | `middleware.logging` | `true` |
| `LC_MW_BODY_LIMIT_ENABLED` / `LC_MW_BODY_LIMIT_BYTES` | `middleware.bodyLimit.*` | `true` / `1048576` |
| `LC_MW_TIMEOUT_ENABLED` / `LC_MW_TIMEOUT_SECONDS` | `middleware.timeout.*` | `true` / `30` |
| `LC_MW_CONCURRENCY_ENABLED` / `LC_MW_MAX_IN_FLIGHT` | `middleware.concurrency.*` | `false` / `64` |
| `LC_MW_COMPRESSION_ENABLED` / `LC_MW_COMPRESSION_GZIP` / `LC_MW_COMPRESSION_BROTLI` | `middleware.compression.*` | `true` / `true` / `true` |
| `LC_MW_RATE_LIMIT_ENABLED` / `LC_MW_RATE_LIMIT_RPS` | `middleware.rateLimit.*` | `false` / `20` |
| `LC_MW_STATIC_CACHE_ENABLED` / `LC_MW_STATIC_MAX_AGE` | `middleware.staticCache.*` | `true` / `3600` |
| `LC_MW_HEALTH_ENABLED` | `middleware.health.enabled` | `true` |
| `LC_MW_SECURITY_HEADERS_ENABLED` / `LC_MW_HSTS_ENABLED` | `middleware.securityHeaders.*` | `true` / `false` |
| `LC_CFG_<KEY>` | 自定义配置项（大写，非字母数字转 `_`） | `LC_CFG_PAYMENT_API_KEY=…` |
| `LC_CFG_<GROUP>_<FIELD>` | 内置组非密钥字段（如 `LC_CFG_POSTGRES_HOST`、`LC_CFG_REDIS_URL`） | 覆盖生成/用户文件层 |
| `LC_CFG_POSTGRES_PASSWORD` / `LC_CFG_MYSQL_PASSWORD` | 内置数据库组口令 | 只在环境变量里设置 |
| `LC_CFG_REDIS_PASSWORD` | 内置 Redis 组口令 | 只在环境变量里设置 |
| `LC_CFG_OBJECT_STORAGE_ACCESS_KEY` / `LC_CFG_OBJECT_STORAGE_SECRET_KEY` | 内置对象存储组密钥 | 只在环境变量里设置 |
| `LC_AUTH_TOKEN_MODE` | `auth.tokenMode` | `jwt` / `session` |
| `LC_AUTH_JWT_SECRET` | `auth.jwtSecret` | （只在环境变量里设置） |
| `LC_AUTH_ACCESS_TTL_SECONDS` | `auth.accessTokenTtlSeconds` | `900` |
| `LC_AUTH_REFRESH_TTL_SECONDS` | `auth.refreshTokenTtlSeconds` | `604800` |
| `LC_AUTH_SESSION_TTL_SECONDS` | `auth.sessionTtlSeconds` | `28800` |
| `LC_AUTH_MAX_LOGIN_FAILURES` | `auth.maxLoginFailures` | `5` |
| `LC_AUTH_LOCK_SECONDS` | `auth.lockSeconds` | `900` |
| `LC_AUTH_BOOTSTRAP_USERNAME` / `LC_AUTH_BOOTSTRAP_PASSWORD` / `LC_AUTH_BOOTSTRAP_ROLE` | `auth.bootstrap.*` | （首次启动创建管理员） |
| `LC_DATA_API_ENABLED` | `dataApi.enabled` | `true` |
| `LC_DATA_PUBLIC_READ` | `dataApi.publicRead` | `true` |
| `LC_DATA_WRITE_REQUIRES_AUTH` | `dataApi.writeRequiresAuth` | `true` |
| `LC_DATA_WRITE_ROLES` | `dataApi.writeRoles` | `admin,editor` |
| `LC_DATA_MAX_PAGE_SIZE` | `dataApi.maxPageSize` | `100` |
| `LC_DATA_COLLECTIONS_DIR` | `dataApi.collectionsDir` | `../web/data/collections` |
| `LC_STATIC_ENABLED` | `static.enabled` | `true` |
| `LC_CONFIG_FILE` | 配置文件路径 | `../deploy/backend/config.yaml` |
| `LC_OVERRIDE` | `override` | `true` |
| `LC_SITE_NAME` | `/api/meta` 的站点名 | `示例站点` |

启动参数（三套一致）：

| 参数 | 对应字段 |
| --- | --- |
| `--host` | `host` |
| `--port` | `port` |
| `--log-level` | `logLevel` |
| `--config` | 配置文件路径 |
| `--override` | `override`（出现即 true） |
| `--body-limit-bytes` | `middleware.bodyLimit.maxBytes`（同时把该项打开） |
| `--timeout-seconds` | `middleware.timeout.seconds`（同时把该项打开） |
| `--cache-enabled` | `cache.enabled` |
| `--cfg KEY=VALUE` | 自定义配置项，可重复 |
| `--migrate` | 执行未应用的迁移后退出 |
| `--migrate-down` | 回滚最近一个有 down 脚本的迁移后退出 |

校验与失败表现：

- `strict: true` 时未知键直接报错 `LC_E_CONFIG_INVALID`，进程退出码 2，并打印**字段路径 + 期望类型**；`strict: false` 只告警。
- `host` 必须是 `127.0.0.1` / `localhost` / `::1` 或明确的对外地址；`port` 1024–65535。
- `cors.credentials: true` 与 `origins: ["*"]` 同时出现 → 拒绝启动（浏览器规范不允许）。
- 数据库与缓存的取值校验：`driver` 只能是 `sqlite / mysql / postgres`；URL scheme 只能是 `sqlite:// / mysql:// / postgres:// / postgresql://`；`port` 0 或 1–65535；`sslMode` 只能是 `disable / require`；`maxOpenConns` 1–100；`connectTimeoutSeconds` 1–60；`cache.driver` 只能是 `none / memory / redis`，`cache.fallback` 只能是 `memory / none`，`ttlSeconds` 1–86400。越界即 `LC_E_CONFIG_INVALID`，退出码 2。
- 中间件校验：`bodyLimit.maxBytes` 1024–268435456；`timeout.seconds` 1–600；`concurrency.maxInFlight` 1–10000；`rateLimit.rps` 1–10000；`compression.minBytes` 0–1048576；`staticCache.maxAgeSeconds` / `immutableMaxAgeSeconds` 非负；`health.readinessRequires*` 必须是布尔。
- 内置组校验：`middleware.builtin.<组>` 只接受 `enabled` 与 `config`；数据库组 `postgres / mysql / sqlite` 最多同时启用一个；启用组的字段按预设类型校验，未知字段在 `strict` 下报错。关闭的组完全不加载，导出产物里也不会出现该组键。
- 自定义配置项校验：`configCenter.definitions` 每项只接受 `key / type / enum / default / secret / description`，`type` 只能是 `string / number / bool / enum`；`values` 里的键必须在 `definitions` 中声明（未声明时按推断类型注入并告警）。
- 密钥规则：`secret: true` 的键与内置组口令**只从环境变量读取**，配置文件里的值被忽略（只提示不打印值）；缺失时启动失败并给出「哪个组/字段、需要设置哪个环境变量」的人话提示，不会用空字符串去连库。
- **配置里的密钥类环境变量（如数据库密码）不得打进日志与 `/api/meta`**；报错只显示字段路径，不显示值。

### 8.1 数据库、迁移与缓存（三套同一套字段）

- `database.url` 非空时优先，scheme 决定实际驱动（`postgresql://` 等价 `postgres://`）；与 `driver` 冲突时以 URL 为准并打印一条 warn。URL 为空时用 `host / port / name / user / password` 组装。
- 连接失败、连接超时、认证失败、库不存在统一映射为 `LC_E_DB_UNAVAILABLE`：启动阶段打印中文原因 + 排查提示并以退出码 1 结束；运行阶段 `/api/ready` 返回 503（`/api/health` 仍返回 200，只把探测结果写进 `databaseReachable`）。日志与错误只显示 `host:port/库名`，**不含账号密码**。
- 迁移目录：`migrations/generated/`（平台生成，重生成会替换）、`migrations/custom/`（用户，从 `0003_` 起编号）、`migrations/down/`（回滚脚本，文件名与迁移版本一致）。记录表 `schema_migrations` 保证**重复执行不报错**；启动时自动执行未应用迁移。
- 命令：`--migrate` 执行 up，`--migrate-down` 回滚最近一个有 down 脚本的版本；Node 另有 `npm run migrate` / `npm run migrate:down`。MySQL 的 DDL 隐式提交，回滚只覆盖 DML，失败后需人工核对再重跑。
- 缓存：`none` 关闭；`memory` 进程内；`redis` 用 `redis://`（**不支持 `rediss://` TLS**）。Redis 连不上 / 超时 / 协议不支持时 **warn 并降级 `memory`**，服务照常启动。`/api/health` 返回实际生效的 `cache` 与 `cacheFallback`。
- `cache.enabled: false` 时按 `cache.fallback` 回退：`memory` 继续用进程内存，`none` 直读数据库；启动日志写明「缓存已关闭，已回退为 …」。依赖缓存的读接口不会静默返回空数据。

### 8.2 中间件开关（服务自身能力）

这些是后端自身能力，不属于用户可自定义的业务配置。每一项都能在 `middleware` 下开关；关闭后的默认行为写在表里，启动日志会打印清单、影响范围与恢复提示。

| 项 | 配置键 | 默认 | 关闭后的默认行为 | 受影响接口 |
| --- | --- | --- | --- | --- |
| 请求 ID | `middleware.requestId` | 开 | 不生成 `x-request-id`；日志无法串起同一次请求 | 全部接口 |
| 访问日志 | `middleware.logging` | 开 | 只保留启动/错误日志，进程不会崩；排障时看不到耗时与状态码 | 全部接口 |
| 请求体限制 | `middleware.bodyLimit.enabled` | 开（1 MB） | 不限制请求体大小，内存/磁盘风险上升 | 写接口（超限时 413） |
| 超时 | `middleware.timeout.enabled` | 开（30 s） | 慢请求长期占用连接与数据库池 | 全部接口（超时 503 `LC_E_TIMEOUT`） |
| 并发上限 | `middleware.concurrency.enabled` | 关（64） | 不限制在途请求数（默认策略：不限并发） | 全部接口（开启后超限 503 `LC_E_CONCURRENCY_LIMITED`） |
| 限流 | `middleware.rateLimit.enabled` | 关（20 rps） | 不做 IP 级限流（默认策略：完全不限流） | 全部接口（开启后超限 429 `LC_E_RATE_LIMITED`） |
| CORS | `cors.enabled` | 开（`origins: []`） | 不返回任何 CORS 头；浏览器拦截跨域，服务端不报错 | 浏览器跨域调用 `/api/*` |
| 压缩 | `middleware.compression.enabled` | 开（gzip + br） | 响应不压缩，可交给 nginx 代压 | JSON 接口、静态资源 |
| 静态缓存头 | `middleware.staticCache.enabled` | 开 | 不主动设置 `Cache-Control`，浏览器/nginx 自行决定 | 静态资源 |
| 健康检查 | `middleware.health.enabled` | 开 | `/api/health` 与 `/api/ready` 返回 503 `LC_E_MIDDLEWARE_DISABLED` 并给出恢复键，不会静默 404 | 两个探活路径、部署脚本 |
| 安全头 | `middleware.securityHeaders.enabled` | 开 | 不返回 HSTS / nosniff / Referrer-Policy 等（默认策略：不加固） | 全部响应 |
| 缓存 | `cache.enabled` | 开 | 按 `cache.fallback` 回退 memory 或 none，日志写明已回退 | 依赖缓存的读接口 |

安全头默认值（每项都可在 `middleware.securityHeaders` 下单独改）：

| 头 | 默认 | 说明 |
| --- | --- | --- |
| `Strict-Transport-Security` | **关闭**（`hsts.enabled: false`） | 纯 HTTP 部署开启会把浏览器锁死；HTTPS 站点再开，`maxAgeSeconds: 31536000`、`includeSubdomains: true`、`preload: false` |
| `X-Content-Type-Options` | `nosniff` | 留空 = 不发送该头 |
| `X-Frame-Options` | `SAMEORIGIN` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | |
| `Cross-Origin-Opener-Policy` | `same-origin` | |

启动期影响报告：

- 启动日志先打印 `[中间件] 本次生效清单：x/y 项开启`，再逐项列出 `✓/✗ 名称 当前行为`。
- 关闭且仍有接口依赖的项，会打印 `[中间件][影响]`（受影响接口 + 关闭后的默认行为）与 `[中间件][建议]`（恢复键）。
- 默认关闭的限流/并发属于正常配置，只在清单里标 `info`，不当作故障告警。
- 关闭后无法降级的接口（如健康检查）直接返回 `LC_E_MIDDLEWARE_DISABLED`，不等请求时 500。

### 8.3 内置中间件预设组与自定义配置中心

配置中心由两套并存：

**A. 内置中间件预设组**（`middleware.builtin.<组>`，每组有预设字段与默认值）

| 组 | 默认 | 开启后 | 关闭后 |
| --- | --- | --- | --- |
| `postgres` / `mysql` / `sqlite` | sqlite 开，其余关 | 接管 `database`（连接池、迁移、CRUD 都用它） | 完全不加载；不读字段、不连接；导出产物不出现该组键 |
| `redis` | 关 | 接管 `cache`（TTL、keyPrefix、连接） | 按 `cache.fallback` 回退并写明 |
| `objectStorage` | 关 | 配置注入给用户代码（本模板不内置厂商 SDK） | 完全不加载 |
| `messageQueue` | 关 | 配置注入给用户代码 | 完全不加载 |
| `search` | 关 | 配置注入给用户代码 | 完全不加载 |
| `reverseProxy` | 关 | 供部署脚本渲染 nginx（upstream、请求体上限） | 完全不加载 |

- 数据库组三选一：`postgres / mysql / sqlite` 同时启用多个会直接报错；都不启用时退回顶层 `database`（兼容模式）。
- 关闭的组**完全不加载**：不连接、不读取字段，`config.generated.yaml` 里也不会出现该组的任何配置键。
- 内置组口令只走环境变量：`LC_CFG_POSTGRES_PASSWORD` / `LC_CFG_MYSQL_PASSWORD` / `LC_CFG_REDIS_PASSWORD` / `LC_CFG_OBJECT_STORAGE_ACCESS_KEY` / `LC_CFG_OBJECT_STORAGE_SECRET_KEY`；缺失时启动失败并提示环境变量名。

**B. 自定义配置项**（`configCenter.definitions` + `configCenter.values`）

- `definitions`：平台侧「统一配置中心」生成的键名、类型、默认值、是否密钥、枚举值。骨架只做类型转换（`string / number / bool / enum`）与缺失时的默认值，不做业务判断。
- `values`：用户文件里写值；密钥项在文件里留空。
- 用户代码通过配置中心读取任意键，例如 Node 的 `configCenter.get('APP_MODE')`、Rust 的 `config_center.get("APP_MODE")`、Go 的 `configCenter.Get("APP_MODE")`；具体接口形态见各语言 README。
- 来源追踪：`/api/meta` 的 `configCenter.custom[].source` 与 `middlewareBuiltin[].fields[].source` 标明每个键最终来自 `default / generated / user / env / cli`，供排查用；**不打印密钥值**。
- 启动参数 `--cfg KEY=VALUE` 与 `--cache-enabled` / `--body-limit-bytes` / `--timeout-seconds` 属于最高优先级层。
- 启动日志用 `[中间件][内置]` 与 `[中间件][自定义]` 区分来源；密钥值统一显示为 `***`。

YAML 支持的子集（三套模板共用一个手写解析器，避免引入未登记依赖）：

- 二级映射、`- ` 列表、行内列表 `[a, b]`、单/双引号字符串、布尔、整数、`null`、`#` 注释。
- 不支持锚点、多行字符串、多文档、制表符缩进、行内映射。需要复杂结构时改用 JSON（`{"..."}` 开头会被按 JSON 解析）。

## 9. 各档能力对照

| 能力 | Rust | Node | Go |
| --- | --- | --- | --- |
| 健康检查 / CRUD | 是 | 是 | 是 |
| CORS（含预检 204） | 是 | 是 | 是 |
| 请求 ID / 访问日志 | 是 | 是 | 是 |
| 请求体限制 / 超时 / 并发上限 | 是 | 是 | 是 |
| gzip 压缩 | 是 | 是 | 是 |
| brotli（br）压缩 | 是 | 是 | 否（仅 gzip） |
| 限流 | 是 | 是 | 是 |
| 静态资源缓存头 | 是 | 是 | 是 |
| 存活 / 就绪检查分离 | 是 | 是 | 是 |
| 中间件开关清单 + 启动期影响报告 | 是 | 是 | 是 |
| 内置中间件预设组（8 组） | 是 | 是 | 是 |
| 自定义配置中心（类型 / 来源 / 密钥） | 是 | 是 | 是 |
| 安全响应头 | 是 | 是 | 是 |
| 数据库 | SQLite / MySQL / PostgreSQL（sqlx AnyPool） | SQLite / MySQL / PostgreSQL（`node:sqlite` + mysql2 + pg） | SQLite / MySQL / PostgreSQL（`database/sql`） |
| 迁移（up / down / 可重复执行） | 是 | 是（`npm run migrate`） | 是 |
| 认证中心（JWT + 可配置 session） | 是 | 是 | 是 |
| 最小 RBAC（角色 / 权限点 / 接口守卫） | 是 | 是 | 是 |
| 集合数据接口（自动 CRUD / 字段校验 / 分页 / 权限） | 是（完整） | 是（完整） | 是（完整） |
| 缓存 none / memory / redis | 是 | 是 | 是 |
| 优雅退出 | 是 | 是 | 是 |

## 10. 秘密红线

- 模板里**没有任何私钥、证书、密码**；`certs/` 由部署时生成或用户导入。
- 日志、错误响应、`/api/meta` 不得出现数据库密码、私钥内容；错误信息只给字段路径与类别。
- 数据库 URL 若带账号密码（如 `postgres://user:pass@host/db`），日志、错误信息、`/api/meta`、`/api/health` 只输出脱敏后的 `host:port/库名`；密码应只放 `LC_DB_PASSWORD` 环境变量。
- 生成的私钥文件权限必须收紧：Unix `chmod 600`，Windows 用 `icacls` 移除继承；见 `templates/deploy/scripts/gen-test-cert.*` 与 `import-cert.*`。
- 私钥文件与 `certs/` 不得进入导出包或版本库，`.gitignore` 条目见 `templates/deploy/README.md`。

## 11. 部署形态

| 形态 | 组成 | 后端配置 | 适合 |
| --- | --- | --- | --- |
| 后端 + nginx（推荐） | nginx 终止 TLS、发静态资源、gzip/缓存/上传大小/限流；后端只监听 `127.0.0.1:8080` | `static.enabled: false` | 公网、生产、需要 HTTPS |
| 只跑后端（无 nginx） | 后端同进程发静态文件与 API | `static.enabled: true`，`static.root: "../web"` | 本机演示、内网小工具、单机部署 |

两者接口与配置结构完全相同，只差 `static.enabled`。无 nginx 形态没有 TLS 与边缘缓存，不建议直接暴露公网。nginx 配置、证书生成/导入、两种形态的步骤与验证见 [templates/deploy/README.md](../deploy/README.md)。

导出包根目录带 `deploy/scripts/`，安装、迁移、启动、探活、停止各有 sh 与 ps1 两份同名脚本，行为一致；首次运行缺配置时交互式生成 `deploy/backend/config.yaml`，CI 用 `LC_DEPLOY_NONINTERACTIVE=1` 加环境变量。三条路径（仅后端 / 后端 + nginx / 后端 + nginx + 证书）都通过脚本参数切换，nginx 的 `upstream` 与证书路径由脚本按配置渲染，不需要手改多处。各语言 README 的「一键部署」小节有命令表。

## 12. 本机验证情况

| 语言 | 验证内容 | 结果 |
| --- | --- | --- |
| Node | `npm install`、启动、health/CRUD/404/400/413、配置五层覆盖、SQLite/MySQL/PostgreSQL 迁移与回滚、Redis 读写与降级、check-user、manifest | 已在本机实测（SQLite、真实 PostgreSQL 18、自建隔离 MariaDB 11.4.5 上的 MySQL 协议迁移与 CRUD、自建完全隔离 Redis 上的读写/TTL/keyPrefix），见 `node/README.md` |
| Rust | `cargo build/check`、启动、health/CRUD、配置覆盖、数据库与迁移、Redis 读写与降级 | 已在本机实测（SQLite、真实 PostgreSQL 18、自建隔离 MariaDB 上的 MySQL 协议迁移与 CRUD、自建完全隔离 Redis），见 `rust/README.md` |
| Go | `go build`、启动、health/CRUD、配置覆盖、数据库与迁移、Redis 读写与降级 | 已在本机实测（SQLite、真实 PostgreSQL 18、自建隔离 MariaDB 上的 MySQL 协议迁移与 CRUD、自建完全隔离 Redis），见 `go/README.md` |
| Node | 集合数据接口：CRUD、字段级校验、唯一冲突、读/写权限、分页截断、迁移、停库错误 | 已在本机实测（SQLite、隔离 PostgreSQL 18、隔离 MariaDB 11.4.5，各 31 条断言；停库 503 可读提示），见 14.8 |
| Rust | 集合数据接口（同上） | 已在本机实测（SQLite、隔离 PostgreSQL 18、隔离 MariaDB 11.4.5，各 31 条断言；停库 503 可读提示，PG） |
| Go | 集合数据接口（同上） | 已在本机实测（SQLite、隔离 PostgreSQL 18、隔离 MariaDB 11.4.5，各 31 条断言；停库 503 可读提示，PG） |
| nginx | 语法校验、TLS、301、反代 health/CRUD、静态资源 | 已在本机实测（nginx 1.28.0），见 `templates/deploy/README.md` |
| 证书脚本 | 自签生成、导入、匹配/域名/有效期/链校验、ACL | 已在本机实测（OpenSSL 3.6.4），见 `templates/deploy/README.md` |

**真实实例 vs 推断**：MySQL 验证用的是本机**自建隔离**的 MariaDB 11.4.5 临时实例（独立端口 3308、
独立临时数据目录、只监听 `127.0.0.1`、验证后停止并删除），属 MySQL 协议兼容实现，**不是 Oracle MySQL 8 本体**；
Oracle MySQL 特有的 DDL 行为、常驻服务形态属于推断，不要把 MariaDB 的结果当成 Oracle MySQL 已验证。

Redis 验证用的是本机**自建完全隔离**的 Redis 5.0.14.1 临时实例：端口动态选取（各语言分别记录在各自 README）、
独立临时目录 `lc-tmp-redis-*`、一次性随机口令 + `requirepass`、只监听 `127.0.0.1`、跑完 `SHUTDOWN NOSAVE` 并删除目录；
全程未连接、未探测本机既有 Redis 实例。读写、`TTL=30`、`keyPrefix`、删除失效与降级路径均为真实实例结果；
集群、哨兵、TLS（`rediss://`）仍属未支持/推断。

未在某一语言目录 README 里写「已验证」的项，一律视为未验证，不要当成承诺。

## 13. 认证中心

三套模板共用同一套认证契约：注册、登录、刷新令牌、登出、当前用户、令牌方案查询，以及一个最小 RBAC 示例接口。接口路径、请求/响应字段、错误码一致，换语言不用换前端。

### 13.1 接口与返回

| 方法 | 路径 | 认证方式 | 成功 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | 无 | 201 | body `{ username, password, displayName? }`，注册后直接返回令牌 |
| POST | `/api/auth/login` | 无 | 200 / 401 / 429 | body `{ username, password }`；失败统一 401，锁定期 429 |
| POST | `/api/auth/refresh` | JWT 模式 body `{ refreshToken }`；session 模式 Bearer 会话令牌 | 200 / 401 | 刷新即轮换，旧令牌立即失效 |
| POST | `/api/auth/logout` | Bearer access 令牌 | 200 / 401 | JWT 模式可带 `{ refreshToken }`；不带则撤销该用户全部刷新令牌 |
| GET | `/api/auth/me` | Bearer access 令牌 | 200 / 401 | 返回用户、角色、权限点 |
| GET | `/api/auth/mode` | 无 | 200 | `{ tokenMode: "jwt" \| "session" }` |
| GET | `/api/admin/users` | Bearer + `users:read` | 200 / 401 / 403 | 最小 RBAC 示例 |

令牌响应（register / login / refresh 共用同一个 `data` 形状）：

```json
{
  "accessToken": "…",
  "refreshToken": "…",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshExpiresIn": 604800,
  "tokenMode": "jwt",
  "user": {
    "id": "…",
    "username": "alice",
    "displayName": "Alice",
    "status": "active",
    "roles": ["user"],
    "permissions": ["items:read", "items:write"]
  }
}
```

- session 模式没有 refresh token：`refreshToken` 为 `null`、`refreshExpiresIn` 为 `0`，`expiresIn` 是会话有效期。
- `/api/auth/me` 返回 `{ user, roles, permissions, tokenMode }`；`/api/admin/users` 返回 `{ items: [...] }`。
- 入参约束：用户名 3–32 位字母/数字/下划线/点/短横线；密码 8–128 位；`displayName` ≤ 64 字符。用户名查重不区分大小写。
- 错误码沿用第 7 节：400 参数不合法、401 未认证/令牌失效、403 缺权限、429 登录失败锁定。

### 13.2 令牌方案：默认 JWT，session 可配置

| 方案 | 工作方式 | 优点 | 代价 |
| --- | --- | --- | --- |
| `jwt`（默认） | 短时 access JWT（HS256，默认 900 秒）+ 数据库 refresh token（默认 7 天，轮换） | 常规请求不查库、横向扩展简单 | access token 在过期前无法单独撤销，撤销窗口 = `accessTokenTtlSeconds`；refresh token 可即时撤销 |
| `session` | 不透明会话令牌存库，每次请求查库校验 | 可即时撤销、可看在线会话 | 每个认证请求一次数据库查询，多实例依赖共享库 |

选择建议：面向公网、需要「立刻踢人」的用 `session`；一般站点用默认 `jwt`，把 access TTL 调短（如 300–900 秒），敏感操作前再校验一次。切换 `auth.tokenMode` 会让已签发的旧令牌全部失效。

### 13.3 配置与环境变量

```yaml
auth:
  tokenMode: jwt                  # jwt（默认）/ session
  jwtSecret: ""                   # 留空则启动时生成进程内随机密钥并 warn；生产必须显式配置
  accessTokenTtlSeconds: 900
  refreshTokenTtlSeconds: 604800
  sessionTtlSeconds: 28800
  maxLoginFailures: 5
  failureWindowSeconds: 300
  lockSeconds: 900
  bootstrap:
    username: ""                  # 首次启动自动创建的管理员；已存在则跳过
    password: ""
    role: admin
```

| 环境变量 | 对应字段 |
| --- | --- |
| `LC_AUTH_TOKEN_MODE` | `auth.tokenMode` |
| `LC_AUTH_JWT_SECRET` | `auth.jwtSecret`（推荐的生产注入方式） |
| `LC_AUTH_ACCESS_TTL_SECONDS` | `auth.accessTokenTtlSeconds` |
| `LC_AUTH_REFRESH_TTL_SECONDS` | `auth.refreshTokenTtlSeconds` |
| `LC_AUTH_SESSION_TTL_SECONDS` | `auth.sessionTtlSeconds` |
| `LC_AUTH_MAX_LOGIN_FAILURES` | `auth.maxLoginFailures` |
| `LC_AUTH_LOCK_SECONDS` | `auth.lockSeconds` |
| `LC_AUTH_BOOTSTRAP_USERNAME` / `LC_AUTH_BOOTSTRAP_PASSWORD` / `LC_AUTH_BOOTSTRAP_ROLE` | `auth.bootstrap.*` |

密钥只从配置文件或环境变量读取，模板里没有任何硬编码密钥；日志、`/api/meta`、`/api/health`、错误响应都不会输出密钥或连接串密码。

### 13.4 密码哈希对照表

**三套的哈希算法并不相同**，不能假设「同一密码在三套里行为一致」。下表是当前基线：

| 语言 | 算法 | 参数 | 内存量级 | 单次验证成本（量级参考） | 版本前缀 / 升级 |
| --- | --- | --- | --- | --- | --- |
| Node | `crypto.scrypt`（内置，无原生依赖） | N=32768、r=8、p=1、输出 64 字节、随机 16 字节盐 | 约 32 MB | 约 50–100 ms | `scrypt$1$N$r$p$salt$hash`；登录成功发现前缀或参数不符时自动重算 |
| Rust | Argon2id（`argon2` crate 默认参数） | m=19456 KiB、t=2、p=1、随机盐、PHC 字符串 | 约 19 MB | 约 20–50 ms | 校验成功后若参数不是当前基线则重算 |
| Go | Argon2id（`golang.org/x/crypto/argon2`） | m=19456 KiB、t=2、p=1、随机 16 字节盐、32 字节输出 | 约 19 MB | 约 20–50 ms | `argon2id$v=19$m=19456,t=2,p=1$salt$hash`；参数不符时重算 |

> 成本是「单核、无并发」的量级参考，不是精确基准；真实值随 CPU 与运行时预热变化。
> 三套的共同点是：哈希串自带算法与参数、验证时按前缀分发、不认识的算法前缀直接拒绝、登录成功时透明重算；
> 差异在于算法本身与参数，所以同一账号体系不要跨语言共享 `password_hash`。

### 13.5 安全底线

- **登录限流与失败计数**：按规范化用户名计数，窗口 `failureWindowSeconds` 内失败 `maxLoginFailures` 次即锁定 `lockSeconds`，锁定期返回 `429 LC_E_RATE_LIMITED`；成功登录清零。
- **不泄漏用户是否存在**：不存在的用户也执行一次等价成本的假哈希校验；登录失败统一返回 `401`「用户名或密码错误」，注册与登录的错误文案不区分「查无此人」与「密码错误」。
- **令牌过期与撤销**：access JWT 校验 `exp` 与签名；refresh token 只存 SHA-256 哈希、轮换使用，旧 token 重放返回 401；登出撤销 refresh / 会话；session 模式每次请求校验库中记录与 `revoked_at`。
- **密码不外泄**：任何响应只返回 `id/username/displayName/status/roles/permissions`；密码哈希不出现在 `/me`、用户列表或日志里。
- **密钥不硬编码**：见 13.3；未配置 JWT 密钥时只在开发态生成进程内一次性密钥并打印 warn。
- **错误信息最小化**：不把数据库错误、令牌解析细节、账号状态直接返回给客户端。

### 13.6 表结构与迁移

迁移 `migrations/generated/0003_auth.sql`，回滚 `migrations/down/0003_auth.sql`，靠 `schema_migrations` 记录保证可重复执行：

| 表 | 作用 | 关键列 |
| --- | --- | --- |
| `users` | 账号 | `id`、`username`（唯一）、`password_hash`、`display_name`、`status`、时间戳 |
| `roles` | 角色 | `id`、`name`（唯一）、`description` |
| `permissions` | 权限点 | `id`、`code`（唯一，如 `users:read`）、`description` |
| `user_roles` | 用户-角色 | `user_id`、`role_id`，联合主键 |
| `role_permissions` | 角色-权限 | `role_id`、`permission_id`，联合主键 |
| `auth_refresh_tokens` | JWT 模式的刷新令牌 | `token_hash`（唯一）、`user_id`、`family_id`、`expires_at`、`revoked_at` |
| `auth_sessions` | session 模式的会话 | `token_hash`（唯一）、`user_id`、`expires_at`、`revoked_at`、`user_agent` |
| `auth_login_attempts` | 登录失败计数 | `identifier`（唯一）、`failures`、`window_started_at`、`locked_until` |

种子数据：角色 `admin` / `user`；权限点 `items:read`、`items:write`、`users:read`、`auth:manage`；`admin` 拥有全部权限，`user` 拥有 `items:read` / `items:write`。迁移使用三库通用类型（`VARCHAR` 主键、ISO 字符串时间），不依赖数据库方言。

### 13.7 接入自己的接口

生成区已导出认证服务与守卫，用户区直接复用，不要复制一份鉴权逻辑：

```js
// Node：src/custom/routes.js
const context = await deps.auth.authenticate(request)
deps.auth.requirePermission(context, 'items:write')
```

```rust
// Rust：src/custom/routes.rs
let context = state.auth.authenticate(&headers).await?;
state.auth.require_permission(&context, "items:write")?;
```

Go 的等价入口见该目录 README。新接口需要「已登录」就只调 `authenticate`；需要具体权限点再调 `requirePermission`。

各语言的启动方式、默认令牌方案、实测与未测范围，见 `node/README.md`、`rust/README.md`、`go/README.md`。

### 13.8 认证中心能力对照表

**接口：三套完全一致，没有某套独有的认证接口。**

| 接口 | Node | Rust | Go |
| --- | --- | --- | --- |
| `POST /api/auth/register`（201；重名/参数 400） | 有 | 有 | 有 |
| `POST /api/auth/login`（失败 401、锁定 429） | 有 | 有 | 有 |
| `POST /api/auth/refresh`（轮换、旧 token 401） | 有 | 有 | 有 |
| `POST /api/auth/logout` | 有 | 有 | 有 |
| `GET /api/auth/me` | 有 | 有 | 有 |
| `GET /api/auth/mode` | 有 | 有 | 有 |
| `GET /api/admin/users`（需 `users:read`） | 有 | 有 | 有 |
| `auth.tokenMode: jwt / session` | 都支持 | 都支持 | 都支持 |

**实现与验证差异（重点看这里）：**

| 项 | Node | Rust | Go |
| --- | --- | --- | --- |
| 认证数据存储 | 数据库表（users / roles / 令牌 / 失败计数） | 同左 | 同左 |
| PostgreSQL 认证全流程 | 已实测 | 已实测 | 已实测 |
| MariaDB 认证全流程 | 已实测 | 已实测 | 已实测 |
| `0003_auth.sql` 迁移 | 已实测 up/幂等/down/up | 同左 | 同左 |
| 多实例共享用户 / 会话 | 是（同一数据库；无分布式锁） | 是 | 是 |
| 登录失败计数 | 按用户名，存库 | 按用户名，存库 | 按用户名，存库 |
| 按 IP 限流 | 否（可前置 nginx） | 否 | 否 |
| 密码哈希可透明升级 | 是 | 是 | 是 |
| 完整 RBAC 平台（管理后台 / 权限继承 / 资源级授权） | 否 | 否 | 否 |

**三套共有的边界：** 不做完整 RBAC 平台；失败计数按用户名而非 IP；JWT 模式下登出后已签发的 access 在到期前仍有效（无状态取舍），需要立即失效请用 `session` 模式。

## 14. 数据接口（集合 CRUD）

三套按集合定义自动生成 CRUD，路径与响应格式沿用平台前端的 `rowsPath` + 字段映射契约：前端把数据源地址指向本服务即可，不用改字段映射。集合定义来自 `dataApi.collectionsDir`（默认 `../web/data/collections`，目录不存在时回退 `./collections`）下的 `*.json`：

```json
{
  "id": "tasks",
  "name": "任务",
  "fields": [
    { "id": "title", "name": "标题", "type": "text", "required": true, "maxLength": 40 },
    { "id": "code", "name": "编号", "type": "text", "unique": true },
    { "id": "status", "name": "状态", "type": "enum", "enumValues": ["todo", "doing", "done"] }
  ],
  "indexes": [{ "id": "idx-status", "fields": ["status"], "unique": false }],
  "access": { "read": "public", "write": ["admin"] },
  "rows": []
}
```

全部字段：`id` / `name` / `fields` / `indexes` / `access` / `rows`。

### 14.1 接口

| 方法 | 路径 | 说明 | 成功 |
| --- | --- | --- | --- |
| GET | `/api/collections/{collectionId}/rows` | 列表（分页、筛选、排序、字段选择） | 200 |
| POST | `/api/collections/{collectionId}/rows` | 新建，body 为字段对象（未知字段拒绝） | 201 |
| GET | `/api/collections/{collectionId}/rows/{rowId}` | 单条 | 200 |
| PUT | `/api/collections/{collectionId}/rows/{rowId}` | 合并式更新（未传字段保持原值） | 200 |
| DELETE | `/api/collections/{collectionId}/rows/{rowId}` | 删除 | 200，`data.deleted: true` |

列表响应（`items` 与平台前端的行形状一致）：

```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": "row-…", "title": "写文档", "code": "A-1", "createdAt": "2026-11-08T…", "updatedAt": "2026-11-08T…" }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 3,
    "hasMore": false,
    "pageSizeCapped": false
  }
}
```

行 id 由服务端生成（`row-` + UUID），`createdAt` / `updatedAt` 为 ISO 字符串；创建、更新、单条读取都返回同样的行对象。

### 14.2 列表查询参数

| 参数 | 说明 | 默认 / 上限 |
| --- | --- | --- |
| `page` | 页码，≥ 1 的整数 | 1 |
| `pageSize` | 每页条数，≥ 1 的整数 | 20；硬上限 `dataApi.maxPageSize`（默认 100） |
| `filter` | URL 编码的 JSON 对象，按字段等值筛选，可多字段 | 无 |
| `q` | 关键词，对 `text` / `enum` / `reference` 字段做子串匹配 | 无 |
| `sort` | 逗号分隔字段；`-` 前缀表示降序 | `createdAt desc, id asc` |
| `fields` | 逗号分隔的返回字段；`id` 始终包含 | 全部字段 |

`pageSize` 超过上限时按上限返回，并在响应里说明原始请求值：

```json
{ "pageSize": 100, "pageSizeCapped": true, "pageSizeRequested": 500 }
```

### 14.3 字段校验

类型：`text` / `number` / `boolean` / `date` / `enum` / `reference` / `json`。字段 id 必须匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`。支持 `required`、`maxLength`（文本另有 20000 硬上限）、`enumValues`、单字段 `unique` 与 `indexes[].unique` 组合唯一。

校验失败返回 **字段级错误列表**，一次把能判定的错误都返回，不是一句 400：

```json
{
  "ok": false,
  "error": {
    "code": "LC_E_DATA_INVALID_ROW",
    "message": "字段校验失败",
    "detail": "",
    "field": "title",
    "fields": [
      { "field": "title", "code": "required", "message": "标题必须填写" },
      { "field": "title", "code": "length", "message": "标题超过 40 个字符" },
      { "field": "status", "code": "enum", "message": "状态只能是 todo / doing / done" },
      { "field": "priority", "code": "type", "message": "优先级必须是数字" },
      { "field": "unknown", "code": "unknown", "message": "未知字段" }
    ]
  }
}
```

唯一冲突单独用 `409 LC_E_DATA_ROW_CONFLICT`，同样带 `field` 与 `fields`，避免和「字段类型写错」混在一起。

### 14.4 权限挂接

读写都复用认证中间件，没有另写一套鉴权：

| 场景 | 规则 |
| --- | --- |
| 读 | 集合 `access.read: public` 或全局 `dataApi.publicRead: true` 时匿名可读；改为 `authenticated` 后未登录返回 401 |
| 写（集合配置了 `access.write` 角色） | 必须登录且拥有其中一个角色，否则 401 / 403 |
| 写（未配置角色，`writeRoles` 为空） | `dataApi.writeRequiresAuth: true`（默认）要求登录；改为 `false` 才允许匿名写 |
| 写（全局配置了 `dataApi.writeRoles`） | 集合未配置 `access.write` 时使用全局角色白名单，规则同上 |

### 14.5 错误码

沿用第 7 节的错误码体系，新增两个数据专用码：

| HTTP | 错误码 | 场景 |
| --- | --- | --- |
| 400 | `LC_E_INVALID_ARGUMENT` | `page` / `pageSize` / `filter` / `sort` / `fields` 不合法，`field` 指出参数名 |
| 401 | `LC_E_UNAUTHORIZED` | 未登录、令牌失效 |
| 403 | `LC_E_FORBIDDEN` | 已登录但角色不在写白名单 |
| 404 | `LC_E_NOT_FOUND` | 集合不存在、行不存在 |
| 409 | `LC_E_DATA_INVALID_ROW` | 字段校验失败，`fields` 给明细 |
| 409 | `LC_E_DATA_ROW_CONFLICT` | 唯一约束冲突，`field` 指出冲突字段 |
| 503 | `LC_E_DB_UNAVAILABLE` | 数据库不可用；响应只给「无法连接数据库（host:port/库名）」这类可读说明，不返回 SQL 与堆栈 |
| 500 | `LC_E_INTERNAL` | 其他未预期错误 |

`dataApi.enabled: false` 时数据路由不生效：Node / Rust / Go 返回 404。

### 14.6 存储与迁移

- Node / Rust / Go：行存在 `collection_rows (collection_id, id, data TEXT, created_at, updated_at)`，迁移 `migrations/generated/0004_collections.sql`，回滚 `migrations/down/0004_collections.sql`；启动时自动执行，可重复执行。

### 14.7 能力对照表

| 项 | Node | Rust | Go |
| --- | --- | --- | --- |
| 列表（分页 / 筛选 / 排序 / 字段选择） | 有 | 有 | 有 |
| 单条读取 | 有 | 有 | 有 |
| 新建（POST） | 有 | 有 | 有 |
| 更新（PUT，合并式） | 有 | 有 | 有 |
| 删除（DELETE） | 有 | 有 | 有 |
| 字段校验（类型 / 必填 / 长度 / 枚举 / 未知字段） | 写时校验，字段级列表 | 同左 | 同左 |
| 唯一约束 | 单字段 + 唯一索引 | 同左 | 同左 |
| 分页与 `total` / `hasMore` / 上限截断 | 有 | 有 | 有 |
| 读权限（public / authenticated） | 有 | 有 | 有 |
| 写权限（登录 + 角色） | 有 | 有 | 有 |
| 行持久化 | `collection_rows` 表 | 同左 | 同左 |
| `0004_collections` 迁移 | 有 | 有 | 有 |
| SQLite / PostgreSQL / MariaDB 实测 | 31 条断言 × 3 库 | 同左 | 同左 |

**实现差异（不影响契约，但会影响极端数据）：**

- 文本排序：Rust 按字节序，Go 按码点，Node 用本地化比较；同一批非 ASCII 数据的排序结果可能不同。
- `json` 字段的等值筛选 / 唯一比较：Go 先规范化排序再序列化，Node / Rust 直接比较序列化结果。
- 多字段错误的排列顺序：Go 按字段名排序，其余按字段定义顺序。

### 14.8 验证记录

数据接口的验证全部在本机**自建隔离**实例上完成：PostgreSQL 18 动态端口 28239（临时目录 `lc-tmp-pg-data-*`），MariaDB 11.4.5 动态端口 28240（临时目录 `lc-tmp-maria-data-*`）；一次性随机口令、只听 `127.0.0.1`、独立库 `lc_data_node` / `lc_data_rust` / `lc_data_go`；跑完停库并删除目录。全程未连接 3306 / 6379 / 5432，未接触任何既有实例或数据。

| 组合 | 结果 |
| --- | --- |
| Node × SQLite / 隔离 PostgreSQL / 隔离 MariaDB | 各 31 条断言通过：匿名写 401、必填/长度/枚举/类型/未知字段一次返回、创建 201、唯一冲突 409、filter / q / sort / fields、pageSize 截断 + hasMore、第二页、单条、合并更新、更新唯一冲突、受保护集合 401/200、未知集合 404、非法分页 400、删除与重复删除 404 |
| Rust × SQLite / 隔离 PostgreSQL / 隔离 MariaDB | 各 31 条断言通过（同上） |
| Go × SQLite / 隔离 PostgreSQL / 隔离 MariaDB | 各 31 条断言通过（同上） |
| `0004_collections` 迁移 | 三语言 × PG / MariaDB：`--migrate-down` 删表 → `--migrate` 建表 → 再次 `--migrate` 输出「无待执行迁移」，表存在性用数据库客户端核对 |
| 数据库不可用 | 停掉隔离库后调用列表：Node（PG / MariaDB）、Rust（PG）、Go（PG）均返回 503 `LC_E_DB_UNAVAILABLE` 与中文可读消息，无 SQL 与堆栈；Node 空闲连接池断开不再导致进程退出 |

未实测：高并发写入下的唯一约束竞态（当前唯一检查是「先查后写」，极端并发下应靠数据库唯一索引兜底，模板未建该索引）。

