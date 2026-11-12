# Go 后端模板（usable 档）

标准库 `net/http` + `database/sql`，数据库支持 SQLite（`modernc.org/sqlite`，纯 Go 免 cgo）、MySQL（`github.com/go-sql-driver/mysql`）、PostgreSQL（`github.com/lib/pq`），并可选用 Redis 缓存。和 Rust / Node 两套模板共用同一份配置结构、同一套接口形状、同一个健康检查路径。

> 定位是**够用**：路由、CRUD、CRUD 之上的最小认证中心（注册 / 登录 / 刷新 / 登出 / 最小 RBAC）、配置、CORS、限流、gzip、静态资源、数据库迁移、可选缓存都齐全；但不做复杂 ORM、不做完整 RBAC 平台、不做模块热插拔。需要企业级结构请用 Rust / Node 那两套。
>
> 运行基线：Go ≥ 1.22（用到 `GET /path/{id}` 这种带方法的路由模式）。依赖版本由 `go.mod` / `go.sum` 锁定。

## 1. 三类文件：哪些会被重新生成

| 类别 | 位置 | 重新生成时 | 说明 |
| --- | --- | --- | --- |
| 平台生成 | `main.go`、`internal/generated/`、`migrations/generated/`、`scripts/`、`go.mod`、`README.md`、`.env.example`、`.gitignore` | **整块替换** | 文件头有 `[LC-GENERATED]` 标记，不要手改 |
| 用户自定义 | `internal/custom/`、`migrations/custom/`、`deploy/backend/config.yaml` | **永不覆盖** | 文件头有 `[LC-CUSTOM]` 标记 |
| 运行产物 | 编译出的 `lowcode-server(.exe)`、`data/`（SQLite 文件）、`logs/` | 不参与生成，可删 | 已在 `.gitignore` 里 |

判断规则：**要改业务找 `internal/custom/`；看到 `[LC-GENERATED]` 就停手**。

## 2. 启动

```bash
go build -o lowcode-server .
./lowcode-server --port 8080
# Windows: go build -o lowcode-server.exe . ; .\lowcode-server.exe
```

必须在**本目录**启动：`migrations/` 和默认 `data/` 都相对于工作目录解析。启动后访问 `http://127.0.0.1:8080/api/health`。

配置默认从 `../deploy/backend/config.yaml` 读；没有就找 `./config.yaml`；都没有则用内置默认值。完整字段见 [../config.example.yaml](../config.example.yaml)。

覆盖链：内置默认 < `config.generated.yaml` < `config.yaml` < 环境变量 < 启动参数。`config.yaml` 里写 `override: true` 可整体忽略生成底稿。`/api/meta` 的 `configSources` 会显示每一层的实际来源。

### 一键部署（导出包）

导出包根目录带 `deploy/scripts/`，按下面的顺序执行即可，不需要额外读文档：

| 步骤 | Linux | Windows PowerShell |
| --- | --- | --- |
| 安装依赖并编译 | `sh deploy/scripts/install.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\install.ps1` |
| 建表 / 升级（幂等） | `sh deploy/scripts/migrate.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\migrate.ps1` |
| 后台启动 + 自动冒烟 | `sh deploy/scripts/start-bg.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\start-bg.ps1` |
| 探活 + 配置摘要（口令打码） | `sh deploy/scripts/health.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\health.ps1` |
| 停止并清理 pid | `sh deploy/scripts/stop.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\stop.ps1` |

首次运行缺配置时会交互式询问端口、数据库地址、是否启用缓存并生成 `deploy/backend/config.yaml`；CI 用 `LC_DEPLOY_NONINTERACTIVE=1` 加环境变量。仅后端 / 后端 + nginx / 后端 + nginx + 证书三条部署路径与排障见 [deploy/README.md](../deploy/README.md)。

| 环境变量 | 对应配置 |
| --- | --- |
| `LC_HOST` / `LC_PORT` | `host` / `port` |
| `LC_LOG_LEVEL` | `logLevel` |
| `LC_CORS_ORIGINS` | `cors.origins`（逗号分隔） |
| `DATABASE_URL` | `database.url` |
| `LC_DB_DRIVER` / `LC_DB_HOST` / `LC_DB_PORT` / `LC_DB_NAME` | `database.driver` / `host` / `port` / `name` |
| `LC_DB_USER` / `LC_DB_PASSWORD` | `database.user` / `password`（密码建议只放环境变量） |
| `LC_DB_SSL_MODE` | `database.sslMode` |
| `LC_DB_MAX_OPEN_CONNS` / `LC_DB_CONNECT_TIMEOUT` | `database.maxOpenConns` / `connectTimeoutSeconds` |
| `LC_CACHE_DRIVER` / `REDIS_URL` / `LC_CACHE_TTL_SECONDS` | `cache.driver` / `cache.url` / `cache.ttlSeconds` |
| `LC_STATIC_ENABLED` | `static.enabled` |
| `LC_AUTH_TOKEN_MODE` | `auth.tokenMode`（`jwt` / `session`） |
| `LC_AUTH_JWT_SECRET` | `auth.jwtSecret`（生产必须注入） |
| `LC_AUTH_ACCESS_TTL_SECONDS` / `LC_AUTH_REFRESH_TTL_SECONDS` / `LC_AUTH_SESSION_TTL_SECONDS` | 令牌有效期 |
| `LC_AUTH_MAX_LOGIN_FAILURES` / `LC_AUTH_LOCK_SECONDS` | 失败次数上限 / 锁定时长 |
| `LC_AUTH_BOOTSTRAP_USERNAME` / `LC_AUTH_BOOTSTRAP_PASSWORD` / `LC_AUTH_BOOTSTRAP_ROLE` | 首次启动的引导管理员 |
| `LC_CONFIG_FILE` | 指定配置文件 |
| `LC_OVERRIDE` | 等价于 `override: true` |

启动参数：`--host`、`--port`、`--log-level`、`--config`、`--override`、`--migrate`、`--migrate-down`。配置非法（未知键、类型不对、端口越界）时退出码 `2`。

## 2.1 数据库、缓存与迁移

配置结构（三套后端统一）：

```yaml
database:
  driver: sqlite            # sqlite | mysql | postgres
  url: "sqlite://data/app.db"   # 非空优先；scheme 决定 driver（postgresql:// 等价 postgres://）
  host: 127.0.0.1
  port: 0                   # 0 = 默认 3306/5432；sqlite 忽略
  name: app
  user: ""
  password: ""              # 文件里不推荐写；优先环境变量
  sslMode: disable          # disable | require；sqlite 忽略
  maxOpenConns: 10
  connectTimeoutSeconds: 5
cache:
  driver: memory            # none | memory | redis
  url: "redis://127.0.0.1:16379/0"
  ttlSeconds: 30
  keyPrefix: "lc:"
auth:
  tokenMode: jwt            # jwt（默认）| session
  jwtSecret: ""             # 生产用 LC_AUTH_JWT_SECRET 注入
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
```

三种数据库示例（`database.url` 非空时以它的 scheme 为准；只写字段时 `url` 留空即可）：

```yaml
# SQLite：相对启动目录，二进制单机部署最简单
database:
  driver: sqlite
  url: "sqlite://data/app.db"

# MySQL：先在服务端 CREATE DATABASE app，并确认账号有权限
database:
  driver: mysql
  url: "mysql://app@db.example.com:13306/app"   # 密码用 LC_DB_PASSWORD 注入

# PostgreSQL：scheme 写 postgres:// 或 postgresql:// 均可
database:
  driver: postgres
  url: "postgres://app@db.example.com:15432/app?sslmode=disable"   # 密码用 LC_DB_PASSWORD 注入
```

- 也可以把 `url` 留空，用 `host` / `port` / `name` / `user` / `password` / `sslMode` 组装。`port: 0` 表示 MySQL 3306、PostgreSQL 5432。
- URL 里不写密码时，可用环境变量 `LC_DB_PASSWORD` 注入；URL 里写了账号密码则以 URL 为准，且任何日志/错误都不会回显。
- Go 代码里的 SQL 统一写 `?` 占位符；PostgreSQL 由模板按顺序改写为 `$1..$n`，用户区不用自己区分方言。
- 连接池上限用 `maxOpenConns`；连接/探活超时用 `connectTimeoutSeconds`（Redis 连接与读写超时也复用它）。

迁移：

```bash
# 启动服务会自动执行 up；也可以只跑迁移后退出
./lowcode-server --migrate
# 回滚最新一个有 down 文件的已应用版本
./lowcode-server --migrate-down
```

- 执行顺序：`migrations/generated/` → `migrations/custom/`，同目录内按文件名排序。
- 版本记录在 `schema_migrations(version VARCHAR(64) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)`；已应用的迁移会跳过，重复执行 `--migrate` 输出「无待执行迁移」并退出码 0。
- 回滚脚本放 `migrations/down/`，文件名与 up 文件同名（如 `migrations/down/0002_add_items_owner.sql`）。`--migrate-down` 只回滚“最新一个有对应 down 文件的已应用版本”，并删除记录；没有 down 文件的历史版本不会自动回滚。
- 每个迁移在一个事务中执行；MySQL 的 DDL 会隐式提交，属正常现象。语句按分号切分，SQL 字符串字面量里不要出现分号。

缓存：

- `cache.driver: none` 完全关闭；`memory` 为进程内 TTL 缓存；`redis` 通过 `redis://[:password@]host:port/db` 连接。
- Redis 连不上、读写超时、或使用暂不支持的 `rediss://` 时，启动只打印一条 warn 并降级为进程内存缓存，**服务照常启动**。`/api/health` 与 `/api/meta` 的 `cache` 显示实际生效值（`memory` / `redis` / `none`），`cacheFallback` 为 `true` 表示发生过降级。
- 缓存只用于 `GET /api/items/{id}`，key 为 `keyPrefix + "items:" + id`，值为 item 的 JSON；创建/更新/删除会失效对应 key。

数据库错误排查：

- 连接被拒绝、超时、认证失败、库不存在（MySQL 1049 / PostgreSQL 3D000）等统一映射为 `LC_E_DB_UNAVAILABLE`，启动打印中文原因和 4–5 条排查提示，退出码 `1`；运行时 `/api/health` 探活失败返回 503。
- 排查顺序：服务是否启动 → host/port 与防火墙 → 账号密码/权限 → 目标库是否已创建 → 是否需要 SSL（`sslMode: require`）。
- 连接串里的账号密码不会出现在任何日志、错误、接口响应里；启动失败提示只显示 `driver` 与 `host:port/name`。

## 3. 扩展点：只改一处，不动生成区

| 想做什么 | 只改这个文件 | 约定 |
| --- | --- | --- |
| 改 `/api/items` 的校验、返回结构 | `internal/custom/items.go` | `ListItems / GetItem / CreateItem / UpdateItem / DeleteItem`，签名 `(w, r, deps)` |
| 换 items 的存储实现 | `internal/custom/store.go` | 保持五个函数签名；`deps.DB` 是 `*db.Handle`，查询/执行会自动按方言改写 `?` 占位符 |
| 新增接口 | `internal/custom/routes.go` | `Register(mux, deps)`，启动时自动调用 |
| 新增数据表 | `migrations/custom/0002_xxx.sql` | 按编号排序，在生成迁移之后执行；需要回滚时在 `migrations/down/` 放同名文件 |

用户区可以引用生成区的公共接口：`internal/generated/app.Deps`（配置 / 数据库 / 缓存 / 启动时间）、`internal/generated/httpx`（`WriteOK / WriteError / DecodeJSON / 错误码`）、`internal/generated/models.Item`。把它们当稳定 API 用。

`internal/custom/routes.go` 带了一个 `/api/custom/example` 示例，删掉或照着写都行。

## 4. 重新生成时会发生什么

生成区清单在 `GENERATED-MANIFEST.json`，记录每个生成文件的 SHA-256。平台重新生成前会执行：

```bash
node scripts/generated-manifest.mjs verify
```

- 输出 JSON：`{ ok, modified, missing, extra, hint }`；退出码 `0` 一致、`3` 有漂移、`4` 清单缺失或损坏。
- 有漂移时**不允许静默覆盖**，必须让你三选一：
  1. **覆盖**：丢弃你在生成区的改动；
  2. **保留**：把改动过的生成文件另存到 `internal/custom/legacy/` 并生成 `MIGRATION-NOTES.md`，同时**阻断导出**，等你把改动搬进扩展点；
  3. **取消**：本次不重新生成。
- 重新生成完成后执行 `node scripts/generated-manifest.mjs create` 刷新清单。
- `go.sum` 不进清单：它是依赖解析产物。

## 5. 导出前检查

```bash
node scripts/check-user.mjs                    # go vet + 秘密扫描
node scripts/check-user.mjs --strict-secrets   # 秘密告警也视为失败
```

- 编译检查：在模板根跑 `go vet ./...`；不通过退出码 `1`，**必须在导出前拦住**。
- 秘密扫描：检查 `internal/custom/`、`migrations/custom/`、`config.yaml`、`.env`；命中私钥块、密码、token、带账号的连接串会告警，**只报类别和位置，不打印内容**。默认告警（退出码 `0`），`--strict-secrets` 时告警即失败。
- 本机没有 go 时退出码 `2`（`BLOCKED`），不假装通过。
- 说明：两个脚本本身是 Node 脚本（平台自带 Node），被检查的工程仍是纯 Go。

## 6. 接口

与其它三套一致：

| 方法 | 路径 |
| --- | --- |
| GET | `/api/health` |
| GET | `/api/meta` |
| GET / POST | `/api/items` |
| GET / PUT / DELETE | `/api/items/{id}` |
| GET / POST | `/api/collections/{collectionId}/rows` |
| GET / PUT / DELETE | `/api/collections/{collectionId}/rows/{rowId}` |
| POST | `/api/auth/register`、`/api/auth/login`、`/api/auth/refresh`、`/api/auth/logout` |
| GET | `/api/auth/me`、`/api/auth/mode`、`/api/admin/users`（需 `users:read`） |

响应统一为 `{ ok, data }` 或 `{ ok, error: { code, message, detail, field, fields? } }`，每个响应带 `X-Request-Id`。Go 1.22 的路由模式 `GET /api/items/{id}` 对外 URL 与其它三套完全一致。

`/api/health` 额外返回 `database`（实际 driver：`sqlite` / `mysql` / `postgres`）、`cache`（实际生效：`memory` / `redis` / `none`）、`cacheFallback`（是否发生过 Redis 降级）；`/api/meta` 同样返回 `cache` 与 `cacheFallback`。存储探活失败返回 503，响应里不含连接串或密码。

## 7. 本机验证记录（2026-11-08）

| 项 | 结果 |
| --- | --- |
| `go build ./...`、`go vet ./...`（Go 1.27，三个数据库驱动） | 通过 |
| SQLite 启动 + `/api/health` / `/api/meta`（含 database/cache/cacheFallback） | 通过 |
| items CRUD（创建 201、列表分页、单条、更新、删除、404；缓存命中与失效） | 通过 |
| 参数校验（空 title 400、1 MB+ 请求体 413、未知接口 JSON 404） | 通过 |
| `--migrate` 连跑两次（第二次输出「无待执行迁移」并退出码 0） | 通过 |
| `--migrate-down` 回滚 0002 后再 `--migrate` 重新应用 | 通过 |
| 配置覆盖（环境变量 `LC_PORT` < 启动参数 `--port`；`DATABASE_URL` 生效） | 通过 |
| PostgreSQL 真实库（临时集群 18543）：`--migrate` 两次、`--migrate-down` → `--migrate`、CRUD | 通过，见下方说明 |
| `cache.driver=redis` 指向未监听端口：warn + 服务正常 + health 显示 memory / fallback=true | 通过 |
| PostgreSQL 未监听端口启动：`LC_E_DB_UNAVAILABLE` + 排查提示 + 退出码 1 | 通过 |
| 未知配置键 / `port: abc` 类型错误，退出码 2 | 通过 |
| CORS 白名单 / 预检 204 / 非白名单不带 CORS 头 | 通过 |
| 限流 429（rps=3 连发 4 次）、gzip（>1 KB JSON）、安全响应头 | 通过 |
| 静态模式首页 200、`/api` 仍返回 JSON 404 | 通过 |
| `go vet` 检查、秘密扫描告警（含 `--strict-secrets` 退出码 1） | 通过 |
| 生成区清单 create / verify | 通过 |
| MySQL 协议真实库（自建隔离 MariaDB 11.4.5，`127.0.0.1:3308`、独立临时数据目录、验证后已停并删除）：`--migrate` 两次幂等、`--migrate-down` → `--migrate`、CRUD、health `database=mysql` | 通过（MariaDB，非 Oracle MySQL 本体） |
| MySQL 错误密码：退出码 1、`LC_E_DB_UNAVAILABLE`、输出无密码 | 通过 |
| 真实 Redis 读写 / TTL / keyPrefix（自建完全隔离临时实例：动态高位端口 60594、独立临时目录 `lc-tmp-redis-*`、一次性随机口令 + `requirepass`、仅 `127.0.0.1`、`SHUTDOWN NOSAVE` 后删除）：`cache=redis`、`cacheFallback=false`；key 为 `lc-t:xxxxxxxx:items:<id>`，`TTL=30`，值可读；31 秒后自动过期；`DELETE` 后 key 立即消失 | 通过（Redis 5.0.14.1；未接触本机既有实例） |
| 认证全流程（PostgreSQL 隔离临时集群：动态端口 13709、临时目录 `lc-tmp-pg-auth-*`、一次性随机口令、仅 `127.0.0.1`）：注册 201 / 重名 400 / 登录 200 / me 200 / 无令牌 401 / 篡改 401 / 普通用户 admin 403 / refresh 轮换 / 旧 refresh 重放 401 / 登出后 refresh 401 / 5 次失败后锁定 429 / 管理员 list users 200；JWT 与 session 两种模式各跑一遍 | 通过 |
| 认证全流程（自建隔离 MariaDB 11.4.5：动态端口 5546、临时目录 `lc-tmp-maria-auth-14e634bb`、一次性随机 root/app 口令、仅 `127.0.0.1`）：与 PostgreSQL 相同的全部断言，JWT + session 两种模式；跑完 `SHUTDOWN_DONE` + `CLEANED=True` | 通过（MariaDB，非 Oracle MySQL 本体） |
| 认证迁移 `0003_auth.sql`（PostgreSQL 与 MariaDB）：首次应用、幂等、`--migrate-down` 回滚后再应用 | 通过 |
| 集合数据接口（SQLite）：CRUD、字段级校验、唯一冲突、读写权限、分页截断、筛选/排序/字段选择 | 31 条断言通过 |
| 集合数据接口在**隔离 PostgreSQL 18**（动态端口 28239、临时目录 `lc-tmp-pg-data-*`、独立库 `lc_data_go`）：同一套 31 条断言 | 通过 |
| 集合数据接口在**自建隔离 MariaDB 11.4.5**（动态端口 28240、临时目录 `lc-tmp-maria-data-*`、独立库 `lc_data_go`）：同一套 31 条断言 | 通过 |
| `0004_collections` 迁移：隔离 PG / MariaDB 上 down → up → 再次 up 幂等 | 通过 |
| 停掉隔离 PG 后调用列表：`503 LC_E_DB_UNAVAILABLE` + 中文可读消息，无 SQL / 堆栈 | 通过 |

## 8. 认证中心

### 8.1 启动、密钥与引导管理员

```bash
export LC_AUTH_JWT_SECRET="$(openssl rand -hex 48)"   # 生产必须注入；留空只生成进程内一次性密钥并 warn
export LC_AUTH_BOOTSTRAP_USERNAME=admin
export LC_AUTH_BOOTSTRAP_PASSWORD='<一次性强口令>'
./lowcode-server --port 8080
```

`Bootstrap` 每次启动都会执行，用户已存在则跳过；创建失败只 warn，不影响服务启动。
认证表由 `migrations/generated/0003_auth.sql` 建立（用户 / 角色 / 权限 / 刷新令牌 / 会话 / 登录失败计数），
启动时自动迁移，也可 `--migrate` / `--migrate-down` 单独执行。

### 8.2 令牌方案

默认 `auth.tokenMode: jwt`：HS256 短时 access（默认 900 秒，载荷含 `sub/name/roles/mode/iat/exp/jti`）
+ 数据库刷新令牌（默认 7 天，刷新时轮换、旧令牌重放 401）；登出撤销刷新令牌，已签发 access 到期前仍有效。
`session` 模式：登录返回不透明会话令牌，每次请求查库，刷新即轮换，登出立即失效。

### 8.3 接入自定义接口

```go
// internal/custom/items.go 里
ctx, err := deps.Auth.Authenticate(r.Context(), r)
if err != nil {
    httpx.WriteError(w, r, err)
    return
}
if err := deps.Auth.RequirePermission(ctx, "items:write"); err != nil {
    httpx.WriteError(w, r, err)
    return
}
```

`RequirePermission` 失败返回 403 `LC_E_FORBIDDEN`；未认证返回 401 `LC_E_UNAUTHORIZED`。
默认角色：`admin`（全部权限）、`user`（`items:read` / `items:write`）；注册用户默认 `user`。

### 8.4 密码哈希

- 算法：Argon2id（`golang.org/x/crypto/argon2`）。
- 参数：内存 19456 KiB、迭代 2、并行度 1、盐 16 字节、输出 32 字节；存储格式
  `argon2id$v=19$m=19456,t=2,p=1$salt$hash`（PHC 风格）。
- 升级路径：参数写在哈希前缀里，校验按前缀取值；以后提高参数不会让旧密码失效，登录成功后可重算写回。

### 8.5 安全底线

- 登录失败按用户名计数：窗口 300 秒、5 次锁 900 秒，锁定期返回 429 `LC_E_RATE_LIMITED`。
- 用户不存在与密码错误返回同一 401 文案；不存在时仍做一次同成本 Argon2id，避免时间侧信道。
- 密钥只从配置 / 环境变量读取；错误响应不包含 SQL、连接串或账号信息。

### 8.6 实测边界

PostgreSQL 与 MariaDB 上，JWT 与 session 两种模式的全部流程均已实测（见第 7 节）；
SQLite 上也跑过同一套流程。登录失败计数是**按用户名**而不是按 IP，多实例之间也不共享计数。

## 9. 数据接口（集合 CRUD）

按集合 JSON 自动生成列表、单条、新建、更新、删除；完整契约（字段类型、权限规则、错误码、三套对照）见 [上级 README 第 14 节](../README.md#14-数据接口集合-crud)。

```bash
# 集合目录：默认 ../web/data/collections，目录不存在时回退 ./collections
export LC_DATA_COLLECTIONS_DIR=../web/data/collections
export LC_DATA_MAX_PAGE_SIZE=100
export LC_DATA_PUBLIC_READ=true
export LC_DATA_WRITE_REQUIRES_AUTH=true
go run ./main.go
```

启动时自动执行 `0004_collections`；行存在 `collection_rows (collection_id, id, data TEXT, created_at, updated_at)`，三库通用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/collections/{collectionId}/rows` | 列表，query 见下 |
| POST | `/api/collections/{collectionId}/rows` | 新建，201；写默认要求登录 |
| GET | `/api/collections/{collectionId}/rows/{rowId}` | 单条 |
| PUT | `/api/collections/{collectionId}/rows/{rowId}` | 合并式更新 |
| DELETE | `/api/collections/{collectionId}/rows/{rowId}` | 删除，`data.deleted: true` |

列表 query：`page`（默认 1）、`pageSize`（默认 20，上限 `dataApi.maxPageSize`）、`filter`（URL 编码 JSON 等值筛选）、`q`（关键词）、`sort`（`-` 前缀降序，默认 `createdAt desc, id asc`）、`fields`（逗号分隔，`id` 始终包含）。超过上限时返回上限值，并带 `pageSizeCapped: true` 与 `pageSizeRequested`。

校验失败返回字段级列表（`error.fields[]`），唯一冲突单独返回 `LC_E_DATA_ROW_CONFLICT`；数据库不可用返回 `503 LC_E_DB_UNAVAILABLE` 与可读说明，不返回 SQL 或堆栈。

### 实测与未测

| 项 | 状态 |
| --- | --- |
| SQLite 上 CRUD、校验、权限、分页 | 已实测（31 条断言） |
| 隔离 PostgreSQL 18 / 隔离 MariaDB 11.4.5 上同一套断言 | 已实测（各 31 条） |
| `0004_collections` up / 幂等 / down / up | 已实测（SQLite、隔离 PG、隔离 MariaDB） |
| 停库后列表返回 503 可读提示 | 已实测（隔离 PG） |
| 高并发下的唯一约束竞态 | 未实测：唯一检查是先查后写，极端并发应再加数据库唯一索引 |

实现差异：非 ASCII 文本排序按码点；`json` 字段等值/唯一比较先规范化再序列化；多字段错误按字段名排序。

## 10. 已知限制

- PostgreSQL 用临时 PostgreSQL 18 集群（`127.0.0.1:18543`、trust 认证）补测：`--migrate` 两次幂等、`--migrate-down` → `--migrate`、CRUD、`?`→`$n` 占位符改写均通过；配置里的假密码未出现在日志、health、meta 中。
- MySQL 真实连通已在本机**自建隔离** MariaDB 11.4.5 临时实例（`127.0.0.1:3308`、独立临时数据目录、验证后已停并删除）上验证：`--migrate` 两次幂等、`--migrate-down` → `--migrate`、CRUD、health `database=mysql` 通过。是 MariaDB（MySQL 协议兼容），不是 Oracle MySQL 本体。验证中发现 MySQL 不允许 `TEXT` 做主键，已将 `migrations/generated/0001_init.sql` 改为 `VARCHAR(64)` 主键。
- 真实 Redis 读写 / TTL / keyPrefix 已在**自建完全隔离**的临时实例上验证（动态高位端口 60594、独立临时目录
  `lc-tmp-redis-*`、一次性随机口令 + `requirepass`、仅 `127.0.0.1`、`SHUTDOWN NOSAVE` 后删除）：`cache=redis`、
  `cacheFallback=false`；key 为 `lc-t:xxxxxxxx:items:<id>`，`TTL=30`，31 秒后自动过期，`DELETE` 后 key 立即消失；
  未接触本机既有 Redis 实例。Redis 实现覆盖 PING/GET/SETEX/SET/DEL，未覆盖集群、哨兵、TLS（`rediss://` 明确不支持并降级）。
- `internal/generated/config` 只解析约定的 YAML 子集（映射、`- ` 列表、行内 `[a,b]`、引号、布尔/整数/null、`#` 注释），以 `{` 开头的文件按 JSON 解析。复杂 YAML（锚点、多行字符串）不支持。
- 迁移按分号切分，SQL 字符串字面量里不能出现分号；MySQL 的 DDL 隐式提交无法做到严格意义上的整迁移原子性。
- gzip 中间件只在响应体 ≥ 1 KB 且类型是 JSON/文本/JS 时压缩；超过 1 KB 上限的响应改为流式不压缩。
- 限流是进程内固定窗口，重启清零；多实例不共享计数。
- 静态文件服务器是 `http.FileServer`，没有 SPA 回退到 `index.html`；需要的话在 `main.go` 的 `staticHandler` 里加，但那属于生成区改动。
- 认证是内置的最小实现，不是完整 RBAC 平台：没有用户管理后台、没有角色继承、没有按资源实例授权。
- 登录失败计数按用户名、进程内数据库表，不按 IP；多实例会各算各的。
