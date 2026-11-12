# Rust 后端模板（full 档）

axum 0.8 + sqlx 0.8 **AnyPool**（SQLite / MySQL / PostgreSQL 同一套代码），可选内存或 Redis 缓存。和 Node / Go 两套模板共用同一份配置结构、同一套接口形状、同一个健康检查路径。

> 运行基线：Rust ≥ 1.80 stable。首次构建需要联网拉 crate（或预先 `cargo vendor`）。

## 1. 三类文件：哪些会被重新生成

| 类别 | 位置 | 重新生成时 | 说明 |
| --- | --- | --- | --- |
| 平台生成 | `src/generated/`、`src/main.rs`、`migrations/generated/`、`scripts/`、`Cargo.toml`、`.env.example`、`README.md` | **整块替换** | 每个文件头有 `[LC-GENERATED]` 标记，不要手改 |
| 用户自定义 | `src/custom/`、`migrations/custom/`、`migrations/down/`、`deploy/backend/config.yaml` | **永不覆盖** | 文件头有 `[LC-CUSTOM]` 标记 |
| 运行产物 | `target/`、`data/`（SQLite 文件）、`logs/` | 不参与生成，可删 | 不进仓库，已在 `.gitignore` 里 |

判断规则很简单：**要改业务找 `src/custom/`；看到 `[LC-GENERATED]` 就停手**。

## 2. 启动

```bash
cargo build --release
./target/release/lowcode-server            # Windows: .\target\release\lowcode-server.exe
```

开发时直接 `cargo run -- --port 8080 --log-level debug`。启动后访问 `http://127.0.0.1:8080/api/health`。

必须在**本目录**启动：`migrations/` 和默认数据目录 `data/` 都相对于工作目录解析。

配置默认从 `../deploy/backend/config.yaml` 读（导出包里就是站点根下的 `deploy/backend/`）；没有就找 `./config.yaml`；都没有则用内置默认值。完整字段与注释见 [../config.example.yaml](../config.example.yaml)。

覆盖链：内置默认 < `config.generated.yaml` < `config.yaml` < 环境变量 < 启动参数。`config.yaml` 里写 `override: true` 可整体忽略生成底稿。`/api/meta` 的 `configSources` 会告诉你每一层实际生效了什么。

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

### 启动参数

| 参数 | 作用 |
| --- | --- |
| `--host` / `--port` / `--log-level` | 覆盖 `host` / `port` / `logLevel` |
| `--config` | 指定配置文件 |
| `--override` | 等价于 `override: true` |
| `--migrate` | 只执行待应用的 up 迁移，然后退出（不启动 HTTP） |
| `--migrate-down` | 只回滚「最新且有 down 脚本」的一个版本，然后退出 |

`--migrate` 重复执行是幂等的：没有待执行版本时输出 `无待执行迁移` 并退出码 `0`。`--migrate` 与 `--migrate-down` 不能同时使用。

### 环境变量

| 环境变量 | 对应配置 |
| --- | --- |
| `LC_HOST` / `LC_PORT` | `host` / `port` |
| `LC_LOG_LEVEL` | `logLevel`（debug/info/warn/error） |
| `LC_CORS_ORIGINS` | `cors.origins`（逗号分隔） |
| `DATABASE_URL` | `database.url`（优先级最高，scheme 决定驱动） |
| `LC_DB_DRIVER` | `database.driver` |
| `LC_DB_HOST` / `LC_DB_PORT` | `database.host` / `database.port` |
| `LC_DB_NAME` / `LC_DB_USER` / `LC_DB_PASSWORD` | `database.name` / `user` / `password` |
| `LC_DB_SSL_MODE` | `database.sslMode`（disable / require） |
| `LC_DB_MAX_OPEN_CONNS` | `database.maxOpenConns`（1-100） |
| `LC_DB_CONNECT_TIMEOUT` | `database.connectTimeoutSeconds`（1-60 秒） |
| `LC_CACHE_DRIVER` | `cache.driver`（none / memory / redis） |
| `REDIS_URL` | `cache.url` |
| `LC_CACHE_TTL_SECONDS` | `cache.ttlSeconds`（1-86400） |
| `LC_STATIC_ENABLED` | `static.enabled` |
| `LC_CONFIG_FILE` | 指定配置文件 |
| `LC_OVERRIDE` | 等价于 `override: true` |

数据库密码建议只通过 `LC_DB_PASSWORD` 或 `DATABASE_URL` 注入，不要写进 `config.yaml`。**任何日志、错误信息、`/api/health`、`/api/meta` 都不会输出连接串里的账号密码**，只显示驱动名与 `host:port/库名`。

## 3. 数据库配置（三选一）

完整字段：

```yaml
database:
  driver: sqlite            # sqlite | mysql | postgres
  url: "sqlite://data/app.db"   # 非空时优先；scheme 决定实际驱动
  host: 127.0.0.1
  port: 0                   # 0 = 3306/5432；sqlite 忽略
  name: app                 # url 为空时使用；sqlite 下写 data/<name>.db
  user: ""
  password: ""              # 不推荐写在文件里
  sslMode: disable          # disable | require；sqlite 忽略
  maxOpenConns: 10
  connectTimeoutSeconds: 5
```

`url` 非空时以 scheme 为准（`postgresql://` 等价于 `postgres://`），`driver` 字段只作为兜底；两者不一致会打印告警并在 `/api/health` 显示实际驱动。

### SQLite（默认）

```yaml
database:
  driver: sqlite
  url: "sqlite://data/app.db"
```

- 自动创建 `data/` 目录与数据库文件（连接串会自动补 `?mode=rwc`，让 SQLite 允许新建文件）。
- 内存库写 `url: "sqlite::memory:"`（连接池上限自动降为 1）。
- 备份/清空直接操作 `data/app.db`；删除 `data/` 后下次启动会重新建库并跑迁移。

### MySQL

```yaml
database:
  driver: mysql
  url: ""
  host: 127.0.0.1
  port: 3306
  name: app
  user: app
  password: ""
  sslMode: disable
```

- 先建库：`CREATE DATABASE app CHARACTER SET utf8mb4;`，并确认账号有建表/ALTER 权限。
- 密码通过 `LC_DB_PASSWORD` 注入。
- 也可以直接写 URL：`mysql://app@db.example.com:13306/app?ssl-mode=disabled`（占位主机；密码放环境变量更安全）。
- `sslMode: require` 会生成 `ssl-mode=required`；服务端需已启用 TLS。

### PostgreSQL

```yaml
database:
  driver: postgres
  url: ""
  host: 127.0.0.1
  port: 5432
  name: app
  user: app
  password: ""
  sslMode: disable
```

- 先建库：`createdb app`。
- URL 形式：`postgres://app@db.example.com:15432/app?sslmode=disable`。
- 源码统一写 `?` 占位符；连接层会在 Postgres 上自动转成 `$1/$2`，用户区不用区分数据库。
- `sslMode: require` 对应 `sslmode=require`（加密但不校验证书）。

## 4. 迁移与回滚

- 迁移目录：平台生成的在 `migrations/generated/`，用户的在 `migrations/custom/`；执行顺序固定为 generated → custom，同目录内按文件名排序。
- 版本号取文件名（去掉 `.sql`），例如 `0002_add_items_owner`。记录表：

  ```sql
  CREATE TABLE schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at VARCHAR(32) NOT NULL
  );
  ```

- 每次启动会自动执行所有待应用的 up 迁移；已应用版本直接跳过。
- 每个迁移文件在一个事务里执行，语句按分号切分；**SQL 字符串字面量里不要出现分号**。
- 手工执行：

  ```bash
  ./target/release/lowcode-server --migrate          # 无待执行迁移时输出「无待执行迁移」，退出码 0
  ./target/release/lowcode-server --migrate-down     # 回滚最新一个有 down 文件的已应用版本
  ```

- 回滚脚本放 `migrations/down/<version>.sql`，文件名必须与版本号一致（如 `migrations/down/0002_add_items_owner.sql`）。`--migrate-down` 每次只回滚一个版本，并删除 `schema_migrations` 对应记录；没有可回滚版本时输出提示并退出码 `0`。
- 已执行过的迁移文件不要改内容，要改就新增一个版本。`generated/` 与 `custom/` 的版本号必须全局唯一。

## 5. 缓存（可选）

```yaml
cache:
  driver: memory            # none | memory | redis
  url: "redis://127.0.0.1:16379/0"
  ttlSeconds: 30
  keyPrefix: "lc:"
```

- `none`：不缓存，每次直读数据库。
- `memory`：进程内缓存，带 TTL；多实例不共享，重启清零。
- `redis`：启动时用最小 RESP2 客户端（`PING` / `GET` / `SETEX` / `DEL`，仅 tokio TcpStream）握手。
  - 支持 `redis://[:password@]host:port/db` 与 `redis://user:password@host:port/db`。
  - **连不上、超时、配置非法、`rediss://`（TLS）不支持时只打印 warn 并降级为 memory，服务照常启动**；`/api/health` 的 `cache` 显示实际生效的 `memory`，`cacheFallback` 为 `true`。
  - 运行期 Redis 出错按「缓存未命中 / 写入忽略」处理，不会把 5xx 抛给业务。
- 缓存键：`keyPrefix + "items:" + id`，值为 JSON。`GET /api/items/{id}` 先读缓存，更新/删除后失效；列表不缓存。
- `/api/health` 与 `/api/meta` 都返回 `cache`（none/memory/redis）与 `cacheFallback`（布尔）。

## 6. 扩展点：只改一处，不动生成区

| 想做什么 | 只改这个文件 | 约定 |
| --- | --- | --- |
| 改 `/api/items` 的校验、返回结构 | `src/custom/items.rs` | `list / get_one / create / update / remove` 五个 handler，签名用 `State<SharedState>` + axum 提取器 |
| 换 items 的存储实现 | `src/custom/store.rs` | 保持 `list_items / get_item / create_item / update_item / delete_item` 五个函数语义，参数用 `&sqlx::AnyPool` |
| 新增接口 | `src/custom/routes.rs` | `register(router) -> router`，启动时自动调用 |
| 新增数据表 | `migrations/custom/0003_xxx.sql` | 版本号连续且全局唯一，在生成迁移之后执行 |
| 新增回滚 | `migrations/down/0003_xxx.sql` | 文件名与版本号一致 |

用户区可以引用生成区的公共接口（`src/generated/error.rs` 的 `AppError / bad / ok`、`src/generated/models.rs` 的 `Item`、`src/generated/db.rs` 的 `adapt_sql`），把它当稳定 API 用。

`src/custom/routes.rs` 里带了一个 `/api/custom/example` 示例，删掉或照着写都行。

## 7. 错误排查

启动或运行时的数据库问题统一映射为 `LC_E_DB_UNAVAILABLE`：

- **启动阶段**：打印中文原因 + 5 条排查提示，退出码 `1`。覆盖连接被拒、连接超时、认证失败（MySQL 1045 / PostgreSQL 28P01）、库不存在（MySQL 1049 / PostgreSQL 3D000）、TLS 握手失败、连接串非法。
- **运行阶段**：`/api/health` 探测失败返回 `503`，响应只写「数据库不可用」，不带连接串或密码；CRUD 遇到连接类错误同样返回 `503`。
- 日志只输出 `driver host:port/库名` 与错误类别，例如 `mysql db.example.com:13306/app`，不会出现账号密码。

常见排查顺序：

1. 服务是否启动（MySQL / PostgreSQL 进程或容器）。
2. `host` / `port` 是否正确（容器部署看端口映射）。
3. 账号密码是否匹配（优先用环境变量注入）。
4. 目标库是否已创建（`CREATE DATABASE` / `createdb`）；SQLite 会自动建。
5. 防火墙/安全组是否放行；`sslMode: require` 时服务端是否启用 TLS。

配置错误（未知键、类型错误、非法 driver/端口）退出码 `2`，错误码 `LC_E_CONFIG_INVALID`，只打印字段路径与期望类型。

## 8. 重新生成时会发生什么

生成区清单在 `GENERATED-MANIFEST.json`，记录每个生成文件的 SHA-256。平台重新生成前会执行：

```bash
node scripts/generated-manifest.mjs verify
```

- 输出 JSON：`{ ok, modified, missing, extra, hint }`，退出码 `0` 表示一致，`3` 表示有漂移，`4` 表示清单缺失/损坏。
- 有漂移时平台**不允许静默覆盖**，必须让你三选一：
  1. **覆盖**：丢弃你在生成区的改动，按新模板重写；
  2. **保留**：把改动过的生成文件另存到 `src/custom/legacy/` 并生成 `MIGRATION-NOTES.md`，同时**阻断导出**，等你把改动搬进扩展点；
  3. **取消**：本次不重新生成。
- 重新生成完成后执行 `node scripts/generated-manifest.mjs create` 刷新清单。
- `Cargo.lock` 不进清单：它是依赖解析产物，不是生成代码，重新生成时不该被改写。

## 9. 导出前检查

```bash
node scripts/check-user.mjs                    # cargo check + 秘密扫描
node scripts/check-user.mjs --strict-secrets   # 秘密告警也视为失败
```

- 编译检查：在模板根跑 `cargo check`，覆盖 `src/custom/` 在内的整个 crate；不通过退出码 `1`，**必须在导出前拦住**。
- 秘密扫描：检查 `src/custom/`、`migrations/custom/`、`config.yaml`、`.env`，命中私钥块、密码、token、带账号的连接串会告警。**只报位置和类别，不打印命中的内容**。默认告警（退出码 `0`）；`--strict-secrets` 时告警即失败。
- 本机没有 cargo 时退出码 `2`，标记 `BLOCKED`，不假装通过。

## 10. 接口

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

响应统一为 `{ ok, data }` 或 `{ ok, error: { code, message, detail, field, fields? } }`，每个响应带 `x-request-id`。请求体超过 1 MiB 返回 `413`（`LC_E_PAYLOAD_TOO_LARGE`）。axum 0.8 的路径参数写法是 `{id}`，对外 URL 不变。

## 11. 本机验证记录（2026-11-08）

| 项 | 结果 |
| --- | --- |
| `cargo check` / `cargo build`（Rust 1.99，sqlx 0.8.6 AnyPool，axum 0.8.9） | 通过，无 warning |
| SQLite 启动 + `/api/health` / `/api/meta`（`database=sqlite`、`cache=memory`、`cacheFallback=false`） | 通过 |
| items CRUD（创建、列表分页、单条、更新、删除、404）与缓存读/写失效 | 通过 |
| `--migrate` 连续执行两次：首次应用 0001/0002，第二次输出「无待执行迁移」 | 通过 |
| `--migrate-down` → `--migrate` → 再次 `--migrate-down`；无 down 文件时输出提示 | 通过 |
| SQLite 自动创建 `data/` 与 `app.db`（无需手工建库） | 通过 |
| `--port`、`LC_CACHE_DRIVER`、`REDIS_URL` 覆盖，`configSources` 正确记录 | 通过 |
| `cache.driver=redis` 指向 `127.0.0.1:16379`（不存在）：warn + 正常启动 + health 显示 `memory/cacheFallback=true` | 通过 |
| 请求体 > 1 MiB 返回 413 | 通过 |
| 数据库不可用（MySQL 连接超时）：`LC_E_DB_UNAVAILABLE`、5 条中文提示、退出码 1、日志无密码 | 通过 |
| PostgreSQL 18 真实库（临时集群 18543）：`--migrate` 应用 0001/0002、重复执行幂等、`--migrate-down` → `--migrate` | 通过 |
| PostgreSQL CRUD（POST 201 / GET 200 / DELETE 200 / 404）、`sslmode=disable`、`?` → `$n` 改写 | 通过 |
| MySQL 协议真实库（自建隔离 MariaDB 11.4.5，`127.0.0.1:3308`、独立临时数据目录、验证后已停并删除）：`--migrate` 两次幂等、`--migrate-down` → `--migrate`、CRUD、health `database=mysql` | 通过（MariaDB，非 Oracle MySQL 本体） |
| MySQL 错误密码：退出码 1、`LC_E_DB_UNAVAILABLE`、日志无密码 | 通过 |
| 连接串带假密码：日志、`/api/health`、`/api/meta` 均未回显 | 通过 |
| 真实 Redis 读写 / TTL / keyPrefix（自建完全隔离临时实例：动态高位端口 54517、独立临时目录 `lc-tmp-redis-*`、一次性随机口令 + `requirepass`、仅 `127.0.0.1`、`SHUTDOWN NOSAVE` 后删除）：`cache=redis`、`cacheFallback=false`；key 为 `lc-t:xxxxxxxx:items:<id>`，`TTL=30`，值可读；31 秒后自动过期；`DELETE` 后 key 立即消失 | 通过（Redis 5.0.14.1；未接触本机既有实例） |
| 用户区 `cargo check`、生成区清单 create / verify | 通过 |
| 认证中心（JWT 模式，临时 SQLite）：注册 201、重复注册 400、错误密码与不存在用户均 401 且响应体一致、登录 200、`/me` 200、无 token 401、admin 列表 200、普通用户 403、refresh 200 且旧 refresh 重用 401、logout 后 refresh 401、连续 5 次失败后第 6 次 429 | 通过 |
| 认证中心（session 模式）：注册/me/refresh 轮换/旧会话失效/logout/登出后 me 401 | 通过 |
| 认证迁移 `0003_auth.sql`：`--migrate-down` → `--migrate` → 再次 `--migrate` 幂等 | 通过 |
| 认证全流程在**隔离 PostgreSQL**（动态端口 13709、临时目录 `lc-tmp-pg-auth-*`、一次性随机口令、仅 `127.0.0.1`、独立库 `lc_auth_rust`）：JWT + session 两种模式，注册/登录/me/401/403/refresh 轮换/旧 refresh 重放/logout/锁定 429 全部通过；迁移 up/幂等/down/up 通过 | 通过 |
| 认证全流程在**自建隔离 MariaDB 11.4.5**（动态端口 59848、临时目录 `lc-tmp-maria-auth-0ab03bdb`、一次性随机 root/app 口令、仅 `127.0.0.1`）：JWT + session 两种模式全部断言通过；迁移 up/幂等/down/up 通过；跑完 `SHUTDOWN_DONE` + `CLEANED=True` | 通过（MariaDB，非 Oracle MySQL 本体） |
| 集合数据接口（SQLite）：CRUD、字段级校验、唯一冲突、读写权限、分页截断、筛选/排序/字段选择 | 31 条断言通过 |
| 集合数据接口在**隔离 PostgreSQL 18**（动态端口 28239、临时目录 `lc-tmp-pg-data-*`、独立库 `lc_data_rust`）：同一套 31 条断言 | 通过 |
| 集合数据接口在**自建隔离 MariaDB 11.4.5**（动态端口 28240、临时目录 `lc-tmp-maria-data-*`、独立库 `lc_data_rust`）：同一套 31 条断言 | 通过 |
| `0004_collections` 迁移：隔离 PG / MariaDB 上 down → up → 再次 up 幂等 | 通过 |
| 停掉隔离 PG 后调用列表：`503 LC_E_DB_UNAVAILABLE` + 「数据库不可用」，无 SQL / 堆栈 | 通过 |

**验证中发现并修复**：

- `applied_at` 与 items 时间戳原用 `chrono::to_rfc3339()`（纳秒精度，35 字符），PostgreSQL 的
  `VARCHAR(32)` 直接报 `22001`。已改为秒级 `%Y-%m-%dT%H:%M:%SZ`，三库都放得下。
- sqlx 的 MySQL 驱动把 `TEXT` 识别为 `BLOB`，按 `String` 解码报
  `String is not compatible with SQL type BLOB`（GET / LIST 500）。已在 `src/custom/store.rs` 按驱动分支：
  MySQL 先取字节再转 UTF-8，SQLite / PostgreSQL 直接按 `String` 解码。

**真实 Redis（自建隔离）**：本机自建完全隔离的 Redis 5.0.14.1 临时实例（动态高位端口 54517、独立临时目录
`lc-tmp-redis-*`、一次性随机口令 + `requirepass`、仅 `127.0.0.1`、`SHUTDOWN NOSAVE` 后删除）：`cache=redis`、
`cacheFallback=false`；key 为 `lc-t:xxxxxxxx:items:<id>`，`TTL=30`，31 秒后自动过期，`DELETE` 后 key 立即消失。
未接触本机既有 Redis 实例。

**未在本机验证**：

- **Oracle MySQL 8 本体**：MySQL 协议验证用的是本机自建隔离 MariaDB 11.4.5；Oracle MySQL 的 DDL 隐式提交、
  迁移中途失败可能留半张表等问题未单独验证（迁移已按三库通用类型写：`VARCHAR` 主键、`TEXT` 不设默认值）。
- `rediss://`（TLS）明确不支持，会 warn 并降级 memory。

## 12. 认证中心

默认令牌方案是 **JWT**：HS256 短时 access token（默认 900 秒）+ 存库的 refresh token（默认 7 天，刷新即轮换，可撤销）。`auth.tokenMode: session` 可切换为服务端会话（每次请求查库、可即时撤销）。完整接口与安全约定见 [上级 README 第 13 节](../README.md#13-认证中心)。

### 启动与初始化

```bash
# 1) 建表（启动时也会自动跑；重复执行输出「无待执行迁移」）
cargo run --release -- --migrate

# 2) 生产必须提供 JWT 密钥；只从环境变量 / 配置读，模板里没有硬编码
$env:LC_AUTH_JWT_SECRET = "<至少 32 字节的随机串>"

# 3) 首次启动可自动建管理员；已存在则跳过
$env:LC_AUTH_BOOTSTRAP_USERNAME = "admin"
$env:LC_AUTH_BOOTSTRAP_PASSWORD = "<一次性强密码>"
$env:LC_AUTH_BOOTSTRAP_ROLE = "admin"

cargo run --release
```

`jwtSecret` 留空时会在启动时生成进程内一次性密钥并打印 warn：进程重启后所有已签发令牌失效。这只适合本地调试，**生产必须显式注入**。

### 接入自己的接口

`AppState` 已带 `auth: Arc<AuthService>`，用户区直接复用：

```rust
// src/custom/routes.rs
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use serde_json::{json, Value};
use crate::generated::error::{ok, AppError};
use crate::generated::state::SharedState;

async fn me_protected(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let context = state.auth.authenticate(&headers).await?;
    Ok(ok(json!({
        "username": context.username,
        "roles": context.roles,
    })))
}

async fn orders_protected(
    State(state): State<crate::generated::state::SharedState>,
    headers: axum::http::HeaderMap,
) -> Result<axum::Json<serde_json::Value>, AppError> {
    let context = state.auth.authenticate(&headers).await?;
    state.auth.require_permission(&context, "items:write")?;
    // …
}
```

只要「已登录」就调 `authenticate`；需要具体权限点再调 `require_permission`。`authenticate` 失败返回 `401 LC_E_UNAUTHORIZED`，缺权限返回 `403 LC_E_FORBIDDEN`，和其它接口的错误形状一致。

### 密码哈希

`argon2` crate 的 Argon2id 默认参数：内存 19456 KiB、迭代 2、并行度 1，随机 16 字节盐，输出 PHC 字符串（自带 `$argon2id$v=19$m=…,t=…,p=…` 参数）。验证时解析 PHC 参数，若与当前基线不一致，在登录成功那一次用新参数重算并写回；不认识的算法直接拒绝，不做降级猜测。

### 实测与未测

| 项 | 状态 |
| --- | --- |
| JWT 模式全流程（注册/登录/刷新/登出/me/admin 403/失败锁定 429） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| session 模式全流程（会话轮换、撤销、登出后失效） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| 迁移幂等与回滚（`0003_auth`） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| MySQL / PostgreSQL 上的认证表 | 已实测（隔离 PostgreSQL 18 与 MariaDB 11.4.5，JWT + session 两种模式） |
| 引导管理员（`LC_AUTH_BOOTSTRAP_*`） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| 多实例共享失败计数 / 撤销 | 未实测（记录存库，多实例读同一库即可；未做分布式锁） |

## 13. 数据接口（集合 CRUD）

按集合 JSON 自动生成列表、单条、新建、更新、删除；完整契约（字段类型、权限规则、错误码、三套对照）见 [上级 README 第 14 节](../README.md#14-数据接口集合-crud)。

```bash
# 集合目录：默认 ../web/data/collections，目录不存在时回退 ./collections
$env:LC_DATA_COLLECTIONS_DIR = "../web/data/collections"
$env:LC_DATA_MAX_PAGE_SIZE = "100"
$env:LC_DATA_PUBLIC_READ = "true"
$env:LC_DATA_WRITE_REQUIRES_AUTH = "true"
cargo run --release
```

启动时自动执行 `0004_collections`；行存在 `collection_rows (collection_id, id, data TEXT, created_at, updated_at)`，行数据以 JSON 文本存储，SQLite / MySQL / PostgreSQL 通用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/collections/{collectionId}/rows` | 列表，query 见下 |
| POST | `/api/collections/{collectionId}/rows` | 新建，201；写默认要求登录 |
| GET | `/api/collections/{collectionId}/rows/{rowId}` | 单条 |
| PUT | `/api/collections/{collectionId}/rows/{rowId}` | 合并式更新 |
| DELETE | `/api/collections/{collectionId}/rows/{rowId}` | 删除，`data.deleted: true` |

列表 query：`page`（默认 1）、`pageSize`（默认 20，上限 `dataApi.maxPageSize`）、`filter`（URL 编码 JSON 等值筛选）、`q`（关键词）、`sort`（`-` 前缀降序，默认 `createdAt desc, id asc`）、`fields`（逗号分隔，`id` 始终包含）。超过上限时返回上限值，并带 `pageSizeCapped: true` 与 `pageSizeRequested`。

校验失败返回字段级列表（`error.fields[]`），唯一冲突单独返回 `LC_E_DATA_ROW_CONFLICT`；数据库不可用返回 `503 LC_E_DB_UNAVAILABLE` 与「数据库不可用」，细节只进日志。

### 实测与未测

| 项 | 状态 |
| --- | --- |
| SQLite 上 CRUD、校验、权限、分页 | 已实测（31 条断言） |
| 隔离 PostgreSQL 18 / 隔离 MariaDB 11.4.5 上同一套断言 | 已实测（各 31 条） |
| `0004_collections` up / 幂等 / down / up | 已实测（SQLite、隔离 PG、隔离 MariaDB） |
| 停库后列表返回 503 可读提示 | 已实测（隔离 PG） |
| 高并发下的唯一约束竞态 | 未实测：唯一检查是先查后写，极端并发应再加数据库唯一索引 |

实现差异：文本排序按字节序（非 ASCII 数据与 Node 的本地化排序结果可能不同）；日期校验用 chrono 的 ISO 解析；`dataApi.enabled=false` 时路由仍注册但返回 404。

## 14. 已知限制

- 迁移按分号切分执行，SQL 字符串字面量里不要出现分号；每个迁移文件在事务里执行（MySQL DDL 隐式提交）。
- 限流是进程内固定窗口计数，重启清零；多实例部署时不共享计数。
- 内存缓存与限流都是进程级，多实例不共享；需要跨实例一致性请用 `cache.driver=redis`。
- 请求体上限固定 1 MiB（`DefaultBodyLimit`），与 nginx 的 `client_max_body_size` 对齐。
- Redis 客户端只实现 RESP2 的 `PING/GET/SETEX/DEL`，不支持集群、TLS（`rediss://`）与 Lua。
- 认证是内置能力，不做完整 RBAC 平台：只有角色、权限点与接口守卫三个概念，没有权限继承、条件权限、管理后台。复杂授权仍在 `src/custom/routes.rs` 里扩展。
- 登录失败计数按用户名而不是 IP；同一用户名被恶意锁定时会影响该账号的正常登录，必要时调小 `lockSeconds` 或在前置 nginx 上加 IP 限流。
- 首次构建需要联网下载 crate；产物要完全离线，请执行 `cargo vendor` 并配置 `.cargo/config.toml`（模板不预置 vendor 目录）。
