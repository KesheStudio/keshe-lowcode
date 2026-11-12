# Node 后端模板（full 档）

Fastify 5 + SQLite / MySQL / PostgreSQL（按配置切换）+ 可选 Redis 缓存。和 Rust / Go 两套模板共用同一份配置结构、同一套接口形状、同一个健康检查路径。

> 运行基线：Node ≥ 22.5（推荐 24 LTS）。`node:sqlite` 在 22/24 仍标注 experimental，启动会打印一条 ExperimentalWarning，属正常现象，不影响功能。

## 1. 三类文件：哪些会被重新生成

| 类别 | 位置 | 重新生成时 | 说明 |
| --- | --- | --- | --- |
| 平台生成 | `src/generated/`、`src/main.js`、`migrations/generated/`、`scripts/`、`package.json`、`README.md` | **整块替换** | 每个文件头有 `[LC-GENERATED]` 标记，不要手改 |
| 用户自定义 | `src/custom/`、`migrations/custom/`、`deploy/backend/config.yaml` | **永不覆盖** | 文件头有 `[LC-CUSTOM]` 标记 |
| 运行产物 | `data/`（SQLite 文件）、`logs/`、`node_modules/`、`*.log` | 不参与生成，可删 | 不进仓库，已在 `.gitignore` 里 |

判断规则很简单：**要改业务找 `src/custom/`；看到 `[LC-GENERATED]` 就停手**。

## 2. 启动

```bash
npm ci --omit=dev
npm start
```

也可以用 `node src/main.js --port 8080 --log-level debug`。启动后访问 `http://127.0.0.1:8080/api/health`。

配置默认从 `../deploy/backend/config.yaml` 读；没有就找 `./config.yaml`；都没有则用内置默认值。完整字段见 [../config.example.yaml](../config.example.yaml)。

覆盖链：内置默认 < `config.generated.yaml` < `config.yaml` < 环境变量 < 启动参数。`config.yaml` 里写 `override: true` 可整体忽略生成底稿。环境变量与启动参数见上级 README。

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

迁移命令：

```bash
npm run migrate       # 建表 / 加字段；重复执行输出“无待执行迁移”并退出 0
npm run migrate:down  # 回滚最新一个有 down 脚本的迁移
```

启动时会自动执行未应用的迁移。

## 3. 数据库与缓存

三种库共用同一段配置，换库只改配置：

```yaml
database:
  driver: sqlite            # sqlite | mysql | postgres
  url: "sqlite://data/app.db"   # 非空时优先；scheme 决定 driver
  host: 127.0.0.1
  port: 0                   # 0 = 默认 3306 / 5432
  name: app
  user: ""
  password: ""              # 建议改用 LC_DB_PASSWORD
  sslMode: disable          # disable | require
  maxOpenConns: 10
  connectTimeoutSeconds: 5
cache:
  driver: memory            # none | memory | redis
  url: "redis://127.0.0.1:16379/0"
  ttlSeconds: 30
  keyPrefix: "lc:"
```

切库示例：

```yaml
# MySQL
database: { driver: mysql, url: "", host: 127.0.0.1, port: 3306, name: app, user: app, password: "" }
# PostgreSQL
database: { driver: postgres, url: "", host: 127.0.0.1, port: 5432, name: app, user: app, password: "" }
```

等价环境变量：`DATABASE_URL`（写全 DSN，优先级最高）、`LC_DB_DRIVER`、`LC_DB_HOST`、`LC_DB_PORT`、`LC_DB_NAME`、`LC_DB_USER`、`LC_DB_PASSWORD`、`LC_DB_SSL_MODE`、`LC_DB_MAX_OPEN_CONNS`、`LC_DB_CONNECT_TIMEOUT`、`LC_CACHE_DRIVER`、`REDIS_URL`、`LC_CACHE_TTL_SECONDS`。

- `DATABASE_URL` / `database.url` 的 scheme 决定实际驱动；`mysql://`、`postgres://`（或 `postgresql://`）、`sqlite://`。与 `driver` 冲突时以 URL 为准并打印一条 warn。
- 连接失败、超时、认证失败、库不存在都会打印中文原因 + 排查提示，退出码 1；运行中 `/api/ready` 探测失败返回 503（`LC_E_DB_UNAVAILABLE` / `LC_E_NOT_READY`），`/api/health` 仍返回 200 并把结果写进 `databaseReachable`。日志与错误只显示 `host:port/库名`，**不会输出账号密码**。
- 缓存默认 `memory`；`driver: redis` 但 Redis 连不上/超时/`rediss://` 不支持时，打印 warn 并降级进程内存，**服务照常启动**。健康检查里 `cache` 是实际生效值，`cacheFallback` 标记是否降级。
- `cache.enabled: false` 时按 `cache.fallback` 回退：`memory` 继续用进程内存，`none` 直读数据库；启动日志写明「缓存已关闭，已回退为 …」。
- 当前缓存用于 `GET /api/items/:id`，写操作会失效对应 key；可在此基础上扩展会话存储。

迁移文件：

- `migrations/generated/` 平台生成（0001 建表、0002 加 `owner` 字段），重新生成会替换。
- `migrations/custom/` 你的迁移，从 `0003_xxx.sql` 起编号，永不覆盖。
- `migrations/down/` 回滚脚本，文件名与对应迁移一致；`migrate:down` 只回滚最新一个有 down 脚本的版本。
- 记录表 `schema_migrations` 保证重复执行不报错。MySQL 的 DDL 会隐式提交，回滚只覆盖 DML，失败后请人工核对再重跑，README 末尾有说明。

## 4. 扩展点：只改一处，不动生成区

| 想做什么 | 只改这个文件 | 约定 |
| --- | --- | --- |
| 改 `/api/items` 的校验、返回结构 | `src/custom/handlers/items.js` | 导出 `list / get / create / update / remove`，参数是 `{ db, config, sources, startedAt, request, reply }` |
| 换 items 的存储实现 | `src/custom/services/items-store.js` | 保持 `listItems / getItem / createItem / updateItem / deleteItem` 五个函数签名 |
| 新增接口 | `src/custom/routes.js` | `registerCustomRoutes(app, deps)`，启动时自动调用 |
| 新增数据表 / 加字段 | `migrations/custom/0003_xxx.sql` | 按文件名排序，在生成迁移之后执行；回滚脚本放 `migrations/down/0003_xxx.sql` |

用户区可以引用生成区的公共接口（`src/generated/errors.js` 里的 `AppError / okBody / invalidArgument / notFound`），把它当稳定 API 用。反过来，生成区只依赖用户区的三个约定文件，不会依赖你新加的其他文件——所以你新增文件不会影响生成区。

## 5. 重新生成时会发生什么

生成区清单在 `GENERATED-MANIFEST.json`，记录每个生成文件的 SHA-256。平台重新生成前会执行：

```bash
node scripts/generated-manifest.mjs verify
```

- 输出 JSON：`{ ok, modified, missing, extra, hint }`，退出码 `0` 表示一致，`3` 表示有漂移，`4` 表示清单缺失/损坏。
- 有漂移时平台**不允许静默覆盖**，必须让你三选一：
  1. **覆盖**：丢弃你在生成区的改动，按新模板重写；
  2. **保留**：把改动过的生成文件另存到 `src/custom/legacy/` 并生成一份 `MIGRATION-NOTES.md`，同时**阻断导出**，等你把改动搬进扩展点；
  3. **取消**：本次不重新生成。
- 重新生成完成后，平台会执行 `node scripts/generated-manifest.mjs create` 刷新清单。
- `package-lock.json`、`go.sum`、`Cargo.lock` 这类依赖锁文件不进清单：它们是依赖解析产物，不是生成代码。

## 6. 导出前检查

```bash
npm run check          # 语法检查 + 秘密扫描
node scripts/check-user.mjs --strict-secrets   # 秘密告警也视为失败
```

- 语法检查：对 `src/custom/` 下所有 JS 文件跑 `node --check`；不通过退出码 `1`，**必须在导出前拦住**。
- 秘密扫描：检查 `src/custom/`、`migrations/custom/`、`config.yaml`、`.env`，命中私钥块、密码、token、带账号的连接串等会告警。**只报位置和类别，不打印命中的内容**。默认只告警（退出码 `0`）；`--strict-secrets` 时告警也失败。
- 本机没有 Node（几乎不可能，平台自身就依赖 Node）时退出码 `2`，标记 `BLOCKED`，不假装通过。

## 7. 接口

与其它两套一致：

| 方法 | 路径 |
| --- | --- |
| GET | `/api/health`（存活检查，始终 200） |
| GET | `/api/ready`（就绪检查，依赖不可用 503） |
| GET | `/api/meta` |
| GET / POST | `/api/items` |
| GET / PUT / DELETE | `/api/items/:id` |
| GET / POST | `/api/collections/:collectionId/rows` |
| GET / PUT / DELETE | `/api/collections/:collectionId/rows/:rowId` |
| POST | `/api/auth/register`、`/api/auth/login`、`/api/auth/refresh`、`/api/auth/logout` |
| GET | `/api/auth/me`、`/api/auth/mode`、`/api/admin/users`（需 `users:read`） |

响应统一为 `{ ok, data }` 或 `{ ok, error: { code, message, detail, field, fields? } }`；开启 `middleware.requestId` 时每个响应带 `x-request-id`。

### 7.1 中间件开关与配置中心

服务自身能力（请求体限制、超时、并发、限流、CORS、压缩、静态缓存头、日志/请求 ID、健康检查、安全头、缓存）都在 `middleware` / `cors` / `cache` 下开关，默认值与关闭后的行为见 [上级 README 第 8.2 节](../README.md#82-中间件开关服务自身能力)。启动日志示例：

```text
[中间件] 本次生效清单：8/12 项开启
  ✓ requestId  生成 x-request-id，日志与响应共用
  ✗ rateLimit  已关闭（默认策略：不限流）
[中间件][影响] rateLimit 已关闭：全部接口不再按 IP 限流
[中间件][建议] 需要限流时设置 middleware.rateLimit.enabled: true
```

配置中心分两套并存：

- **内置组**：`middleware.builtin.postgres|mysql|sqlite|redis|objectStorage|messageQueue|search|reverseProxy`。`sqlite` 默认开启并接管数据库；组关闭后完全不加载，`config.generated.yaml` 里也不会出现该组键。数据库组三选一，同时开多个直接报错。组内字段可用 `LC_CFG_<GROUP>_<FIELD>`（如 `LC_CFG_POSTGRES_HOST`）覆盖，密钥字段只读环境变量。
- **自定义键值**：`configCenter.definitions` + `configCenter.values`，支持 `string / number / bool / enum`，`secret: true` 只从 `LC_CFG_<KEY>` 读取。

用户区通过 `deps.configCenter` 读取（`registerCustomRoutes(app, deps)`）：

```js
export async function registerCustomRoutes(app, deps) {
  const mode = deps.configCenter.get('APP_MODE', 'standard')
  const paymentKey = deps.configCenter.get('PAYMENT_API_KEY')   // 只来自环境变量
  app.get('/api/custom/mode', async () => okBody({
    mode,
    source: deps.configCenter.source('APP_MODE')                // default | generated | user | env | cli
  }))
}
```

`deps.configCenter` 还提供 `group(name)`、`snapshot()`、`printSummary(logger)`；密钥值不会被打印，`/api/meta` 的 `configCenter.custom[]` 与 `middlewareBuiltin[].fields[]` 只暴露来源与类型。

启动日志会用 `[中间件][内置]` / `[中间件][自定义]` 标注来源；内置组密钥缺失时启动失败并提示环境变量名。

## 8. 本机验证记录（2026-11-08）

| 项 | 结果 |
| --- | --- |
| `npm install`（fastify 5.12.8 / @fastify/static 8.3.0） | 通过 |
| 启动 + `/api/health` / `/api/meta` | 通过 |
| items CRUD（创建 201、列表分页、单条、更新、删除、404） | 通过 |
| 参数校验（空 title 400、limit 越界 400） | 通过 |
| 配置覆盖链（默认 < 生成 < 用户 < 环境变量 < 启动参数）与 `override: true` | 通过 |
| 未知配置键 strict 退出码 2 | 通过 |
| CORS 白名单 / 预检 204 / 非白名单不带 CORS 头 | 通过 |
| 限流 429、gzip（>1 KB JSON）、安全响应头开关 | 通过 |
| 静态模式（`static.enabled: true`）首页与 404 | 通过 |
| 中间件生效清单 + 关闭项影响报告（启动日志 `[中间件]` / `[影响]` / `[建议]`） | 通过 |
| `/api/health` 存活 200（含 `databaseReachable`）与 `/api/ready` 依赖不可用 503 | 通过 |
| 关闭 `middleware.health`：两个探活路径返回 503 `LC_E_MIDDLEWARE_DISABLED` 并给恢复键 | 通过 |
| `bodyLimit` 超限 413 `LC_E_PAYLOAD_TOO_LARGE` | 通过 |
| 压缩 br / gzip（按 `Accept-Encoding` 协商） | 通过 |
| 安全头逐项输出（HSTS 默认关闭） | 通过 |
| `cache.enabled: false` → 按 fallback 回退 memory / none 并打印「已回退」 | 通过 |
| 内置 sqlite 组接管数据库；redis 组关闭 → 缓存关闭 | 通过 |
| 自定义 `configCenter` 来源追踪（default / user / env）与 `/api/meta` 不输出密钥值 | 通过 |
| 密钥缺失（`LC_CFG_*` 未设置）启动失败、退出码非 0、提示环境变量名 | 通过 |
| 用户区语法检查、秘密扫描告警（含 `--strict-secrets`） | 通过 |
| 生成区清单 create / verify（含漂移检测 exit 3） | 通过 |
| SQLite 迁移 `--migrate` 连跑两次、`--migrate-down`、再 `--migrate` | 通过 |
| SQLite CRUD + `/api/health`（`database: sqlite`） | 通过 |
| Redis 指向不可达端口：warn + 正常启动 + `cache: memory`、`cacheFallback: true` | 通过（仅降级路径） |
| MySQL 连接拒绝：`LC_E_DB_UNAVAILABLE` + 排查提示，输出无账号密码 | 通过（仅错误路径） |
| MySQL 协议真实库（自建隔离 MariaDB 11.4.5，`127.0.0.1:3308`、独立临时数据目录、验证后已停并删除）：`--migrate` 两次幂等、`--migrate-down` → `--migrate`、CRUD、health `database: mysql` | 通过（MariaDB，非 Oracle MySQL 本体） |
| MySQL 错误密码：退出码 1、`LC_E_DB_UNAVAILABLE`、输出无密码 | 通过 |
| PostgreSQL（本机临时 18 实例，端口 18543）：迁移三次 + 回滚 + CRUD + health | 通过 |
| 真实 Redis 读写 / TTL / keyPrefix（自建完全隔离临时实例：动态高位端口 56165、独立临时目录 `lc-tmp-redis-*`、一次性随机口令 + `requirepass`、仅 `127.0.0.1`、`SHUTDOWN NOSAVE` 后删除）：`cache=redis`、`cacheFallback=false`；key 为 `lc-t:xxxxxxxx:items:<id>`，`TTL=30`，值可读；31 秒后自动过期；`DELETE` 后 key 立即消失 | 通过（Redis 5.0.14.1；未接触本机既有实例） |
| 认证中心（JWT 模式，临时 SQLite）：注册 201、重复注册 400、登录 200、`/me` 200、无 token 401、admin 列表 200、普通用户 403、refresh 200 且旧 refresh 重用 401、logout 后 refresh 401、连续 5 次失败后第 6 次 429 | 通过 |
| 认证中心（session 模式）：注册/me/refresh 轮换/旧会话失效/logout/登出后 me 401 | 通过 |
| 认证迁移 `0003_auth.sql`：`--migrate-down` → `--migrate` → 再次 `--migrate` 幂等 | 通过 |
| 认证全流程在**隔离 PostgreSQL**（动态端口 13709、临时目录 `lc-tmp-pg-auth-*`、一次性随机口令、仅 `127.0.0.1`、独立库 `lc_auth_node`）：JWT + session 两种模式，注册/登录/me/401/403/refresh 轮换/旧 refresh 重放/logout/锁定 429 全部通过；迁移 up/幂等/down/up 通过 | 通过 |
| 认证全流程在**自建隔离 MariaDB 11.4.5**（动态端口 59848、临时目录 `lc-tmp-maria-auth-0ab03bdb`、一次性随机 root/app 口令、仅 `127.0.0.1`）：JWT + session 两种模式全部断言通过；迁移 up/幂等/down/up 通过；跑完 `SHUTDOWN_DONE` + `CLEANED=True` | 通过（MariaDB，非 Oracle MySQL 本体） |
| 集合数据接口（SQLite）：CRUD、字段级校验、唯一冲突、读写权限、分页截断、筛选/排序/字段选择 | 31 条断言通过 |
| 集合数据接口在**隔离 PostgreSQL 18**（动态端口 28239、临时目录 `lc-tmp-pg-data-*`、独立库 `lc_data_node`）：同一套 31 条断言 | 通过 |
| 集合数据接口在**自建隔离 MariaDB 11.4.5**（动态端口 28240、临时目录 `lc-tmp-maria-data-*`、独立库 `lc_data_node`）：同一套 31 条断言 | 通过 |
| `0004_collections` 迁移：隔离 PG / MariaDB 上 down → up → 再次 up 幂等 | 通过 |
| 停掉隔离库后调用列表：`503 LC_E_DB_UNAVAILABLE` + 中文可读消息，无 SQL / 堆栈 | 通过（PG、MariaDB） |

## 9. 认证中心

默认令牌方案是 **JWT**：HS256 短时 access token（默认 900 秒）+ 存库的 refresh token（默认 7 天，刷新即轮换，可撤销）。`auth.tokenMode: session` 可切换为服务端会话（每次请求查库、可即时撤销）。完整的接口、字段、安全约定见 [上级 README 第 13 节](../README.md#13-认证中心)。

### 启动与初始化

```bash
# 1) 建表（启动时也会自动跑；重复执行输出「无待执行迁移」）
npm run migrate

# 2) 生产必须提供 JWT 密钥；只从环境变量/配置读，模板里没有硬编码
$env:LC_AUTH_JWT_SECRET = "<至少 32 字节的随机串>"

# 3) 首次启动可自动建管理员；已存在则跳过
$env:LC_AUTH_BOOTSTRAP_USERNAME = "admin"
$env:LC_AUTH_BOOTSTRAP_PASSWORD = "<一次性强密码>"
$env:LC_AUTH_BOOTSTRAP_ROLE = "admin"

npm start
```

`jwtSecret` 留空时会在启动时生成进程内一次性密钥并打印 warn：进程重启后所有已签发令牌失效。这只适合本地调试，**生产必须显式注入**。

### 接入自己的接口

生成区导出了认证服务与守卫，用户区不要另写一套：

```js
// src/custom/routes.js
import { guard } from '../generated/routes/auth.js'
import { okBody } from '../generated/errors.js'

export async function registerCustomRoutes(app, deps) {
  const requireLogin = guard(deps.auth)
  const requireWrite = guard(deps.auth, 'items:write')

  app.get('/api/custom/me', async (request) => {
    const context = await requireLogin(request)
    return okBody({ username: context.user.username, roles: context.roles })
  })

  app.post('/api/custom/orders', async (request) => {
    await requireWrite(request)
    // …
  })
}
```

需要「已登录」用 `guard(auth)`；需要具体权限点用 `guard(auth, 'items:write')`；服务层方法 `authenticate / requirePermission / register / login / refresh / logout` 也可直接调用。

### 密码哈希

`crypto.scrypt`（Node 内置，无原生依赖），N=32768 / r=8 / p=1 / 64 字节输出 / 16 字节随机盐，存储格式 `scrypt$1$N$r$p$salt$hash`。解析时按前缀分发，参数不是当前基线时在登录成功那一次透明重算。改用 Argon2id 时新增一个前缀分支即可，旧哈希继续可验证。

### 实测与未测

| 项 | 状态 |
| --- | --- |
| JWT 模式全流程（注册/登录/刷新/登出/me/admin 403/失败锁定 429） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| session 模式全流程（会话轮换、撤销、登出后失效） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| 迁移幂等与回滚（`0003_auth`） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| MySQL / PostgreSQL 上的认证表 | 已实测（隔离 PostgreSQL 18 与 MariaDB 11.4.5，JWT + session 两种模式） |
| 引导管理员（`LC_AUTH_BOOTSTRAP_*`） | 已实测（SQLite、隔离 PostgreSQL、隔离 MariaDB） |
| 多实例共享失败计数 / 撤销 | 未实测（计数与撤销记录存库，多实例读同一库即可；本项目未做分布式锁） |

## 10. 数据接口（集合 CRUD）

按集合 JSON 自动生成列表、单条、新建、更新、删除；完整契约（字段类型、权限规则、错误码、三套对照）见 [上级 README 第 14 节](../README.md#14-数据接口集合-crud)。

```bash
# 集合目录：默认 ../web/data/collections，目录不存在时回退 ./collections
$env:LC_DATA_COLLECTIONS_DIR = "../web/data/collections"
$env:LC_DATA_MAX_PAGE_SIZE = "100"
$env:LC_DATA_PUBLIC_READ = "true"       # 读默认公开
$env:LC_DATA_WRITE_REQUIRES_AUTH = "true"  # 写默认要登录
npm start
```

启动时自动执行 `0004_collections`；行存在 `collection_rows (collection_id, id, data TEXT, created_at, updated_at)`，文本列存 JSON，三库通用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/collections/:collectionId/rows` | 列表，query 见下 |
| POST | `/api/collections/:collectionId/rows` | 新建，201；写默认要求登录 |
| GET | `/api/collections/:collectionId/rows/:rowId` | 单条 |
| PUT | `/api/collections/:collectionId/rows/:rowId` | 合并式更新 |
| DELETE | `/api/collections/:collectionId/rows/:rowId` | 删除，`data.deleted: true` |

列表 query：`page`（默认 1）、`pageSize`（默认 20，上限 `dataApi.maxPageSize`）、`filter`（URL 编码 JSON 等值筛选）、`q`（关键词）、`sort`（`-` 前缀降序，默认 `createdAt desc, id asc`）、`fields`（逗号分隔，`id` 始终包含）。超过上限时返回上限值，并带 `pageSizeCapped: true` 与 `pageSizeRequested`。

校验失败返回字段级列表（`error.fields[]`），唯一冲突单独返回 `LC_E_DATA_ROW_CONFLICT`；数据库不可用返回 `503 LC_E_DB_UNAVAILABLE`，给可读说明而不是 SQL 或堆栈。

### 实测与未测

| 项 | 状态 |
| --- | --- |
| SQLite 上 CRUD、校验、权限、分页 | 已实测（31 条断言） |
| 隔离 PostgreSQL 18 / 隔离 MariaDB 11.4.5 上同一套断言 | 已实测（各 31 条） |
| `0004_collections` up / 幂等 / down / up | 已实测（SQLite、隔离 PG、隔离 MariaDB） |
| 停库后列表返回 503 可读提示 | 已实测（隔离 PG、隔离 MariaDB） |
| 高并发下的唯一约束竞态 | 未实测：唯一检查是先查后写，极端并发应再加数据库唯一索引 |

## 11. 已知限制

- `node:sqlite` 是实验特性；跨版本升级 Node 时先跑一遍 CRUD 验证。
- gzip / brotli 作用于进程内生成的可压缩响应（JSON、文本、SVG、JS、CSS）；大静态文件建议交给 nginx 代压。
- 限流与并发计数都在进程内，重启清零；多进程部署时不共享计数。
- 请求体上限由 `middleware.bodyLimit.maxBytes` 控制（默认 1 MB，关闭后不限）；静态上传大小仍由 nginx 的 `client_max_body_size` 控制。
- MySQL / PostgreSQL 驱动 `mysql2`、`pg` 已锁定版本并写进 `package.json`；两者均已在自建隔离临时实例（PostgreSQL 18 / MariaDB 11.4.5）上实测迁移、CRUD 与认证全流程；真实 Redis 读写已在自建完全隔离临时实例上验证（见第 8 节）。
- MySQL 8 的 DDL 隐式提交，迁移失败时部分结构可能已写入；跑回滚前先人工核对 `schema_migrations` 与表结构。
- Redis 只支持 `redis://`（不支持 `rediss://` TLS）；连接失败自动降级内存，不阻断启动。
- 认证是内置能力，不做完整 RBAC 平台：只有角色、权限点与接口守卫三个概念，没有权限继承、条件权限、管理后台。复杂授权仍在 `src/custom/` 里扩展。
- 登录失败计数按用户名而不是 IP；同一用户名被恶意锁定时会影响该账号的正常登录，必要时调小 `lockSeconds` 或在前置 nginx 上加 IP 限流。
