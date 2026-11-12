# 依赖与离线策略（v2）

> 原则：**不用 CDN、版本锁死、产物能离线跑**。新增依赖必须在本文件登记（用途、版本、许可证、所在层）。
>
> 决策见 [design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md) 的 D-26 / D-27 / D-28 / D-37 / D-41；契约见 [CONTRACTS-v1.md](file:///c:/project/docs/lowcode/CONTRACTS-v1.md)（内容 v2.0.0）。

---

## 1. 依赖分层

| 层 | 含义 | 是否进导出 zip |
| --- | --- | --- |
| 平台运行时 | 本地服务与编辑器前端 | 否 |
| 平台开发 | 测试、脚本、校验 | 否 |
| 产物运行时 | 导出站/应用运行所需 | 是 |
| 编辑器库捆绑 | 编辑器实际加载的第三方库（可关） | 是（`vendor/editor/`） |
| 构建工具链 | Rust / Go / JDK（仅 Android 签名用 keytool）/ Docker / nginx / Android SDK | 否（构建前检测） |

---

## 2. 运行时版本基线

| 项 | 要求 | 检测时机 | 缺失时 |
| --- | --- | --- | --- |
| Node.js | ≥ 22.11（推荐 24 LTS） | 服务启动 | 打印版本要求并退出 |
| npm | ≥ 10 | 构建 Node 产物 | 阻断 |
| Rust（rustc / cargo） | ≥ 1.80 stable | 生成 Rust 产物 | 阻断该语言，其它目标不受影响 |
| Go | ≥ 1.22 | 生成 Go 产物 | 阻断该语言 |
| nginx | 任意可用版本 | 生成/校验部署配置 | 仅跳过 `nginx -t`，改用结构校验 |
| Docker | 任意可用版本 | compose / PG / MySQL / Redis | 仅警告 |
| Android SDK / NDK | build-tools + platform + NDK 27 | Tauri Android 构建 | 阻断 Android |
| Rust Android 目标 | `aarch64-linux-android` / `x86_64-linux-android` 等 | 交叉编译 | 阻断 Android |

- 检测结果写入 `GET /api/runtime`、构建预检与 manifest，不自动下载、不修改 PATH。

---

## 3. 平台运行依赖（npm）

版本以 `package-lock.json` 为准；下表为设计基线。

| 包 | 基线 | 用途 | 许可证 | 层 |
| --- | --- | --- | --- | --- |
| `fastify` | 5.x | 本地服务 | MIT | 平台运行时 |
| `@fastify/static` | 8.x | 编辑器静态文件 | MIT | 平台运行时 |
| `jszip` | 3.10.x | 打包/解包 zip（浏览器与 Node 共用） | MIT（双许可取 MIT） | 平台运行时 + 产物 |
| `mermaid` | 12.3.0（锁定） | Markdown 内 mermaid 图渲染；按需进产物 | MIT | 平台构建 + 产物运行时 |
| `ajv` | 8.x | 平台/站点/后端配置 schema 校验 | MIT | 平台运行时 |
| `yaml` | 2.x | 用户自定义 YAML 配置解析 | ISC | 平台运行时 |
| `selfsigned` | 2.x | 生成自签测试证书（HTTPS 测试路径） | MIT | 平台运行时 |
| `keytar` | 7.x | OS 钥匙串（可选安装） | MIT | 平台运行时（optional） |

说明：

- `jszip` 浏览器端从 `vendor/jszip.min.js` 加载，由 `scripts/vendor-sync.mjs` 从 `node_modules` 复制；**删除任何 CDN 回退**。
- `mermaid` 同样只从 `node_modules` 复制出 `vendor/mermaid.min.js`（本地副本，离线可用）；**只有导出产物确实含 mermaid 块时才把它打进 zip 的 `assets/js/mermaid.min.js`**，没有就完全不塞（D-48）。
- `keytar` 为原生模块，`optionalDependencies`；安装失败自动降级为加密主密钥文件并提示。
- `selfsigned` 仅在生成测试证书时调用；私钥只写站点 `certs/`，不进 zip（D-37）。
- 不引入数据库驱动到平台本身；数据库由生成的目标工程访问。

### 3.1 开发依赖

| 包 | 用途 | 许可证 |
| --- | --- | --- |
| `playwright` / `@playwright/test` | E2E、截图回归 | Apache-2.0 |

单元测试与契约测试用 Node 内置 `node:test`，不引入 Jest/Vitest。

---

## 4. 前端 vendor 映射

| 源 | 目标 | 说明 |
| --- | --- | --- |
| `jszip/dist/jszip.min.js` | `vendor/jszip.min.js` | 唯一常驻的第三方前端运行时库 |
| `mermaid/dist/mermaid.min.js` | `vendor/mermaid.min.js` | 导出源；仅当产物含 mermaid 围栏时复制进 zip 的 `assets/js/mermaid.min.js` |

- `vendor/site.css`、`vendor/site.js`、`vendor/favicon.svg` 来自文档站，**替换为平台自有** `vendor/platform.css`、`vendor/platform.js`、`vendor/favicon.svg`。
- 每个 vendor 文件头注释由脚本生成：`/* vendored: <包>@<版本> · <许可证> · 来源 node_modules */`，不手改。
- 构建预检与 `npm run doctor` 的「产物无外链」检查扫描 `exports/**`、站点 `builds/**` 与 `vendor/**` 里的外链脚本、外链样式、外链字体，命中即失败。

---

## 5. 目标工程依赖

### 5.1 Node 档（`full`）

| 包 | 用途 | 许可证 | 打包 |
| --- | --- | --- | --- |
| `fastify` | HTTP 服务 | MIT | 生产 `node_modules` 随 zip |
| `@fastify/static` | 静态资源 | MIT | 同上 |

- 数据库用 Node 内置 SQLite，不引入原生驱动（D-19）。
- zip 含 `package.json`、`package-lock.json`、生产 `node_modules/`，附 `npm ci --offline` 说明。

### 5.2 Rust 档（`full`）—— crates 白名单

| crate | 基线 | 用途 | 许可证 |
| --- | --- | --- | --- |
| `axum` | 0.8.x | HTTP | MIT |
| `tokio` | 1.x | 运行时 | MIT |
| `serde` / `serde_json` | 1.x | 序列化 | MIT / Apache-2.0 |
| `sqlx` | 0.8.x | 数据库（单驱动 feature） | MIT / Apache-2.0 |
| `tower-http` | 0.6.x | CORS / trace / 限制 | MIT |
| `tracing` / `tracing-subscriber` | 0.1 / 0.3 | 日志 | MIT |
| `dotenvy` | 0.15.x | `.env` | MIT |
| `thiserror` / `anyhow` | 2.x / 1.x | 错误 | MIT / Apache-2.0 |
| `uuid` / `chrono` | 1.x / 0.4.x | 主键 / 时间 | MIT 系 |
| `jsonwebtoken` / `argon2` | 9.x / 0.5.x | 鉴权 | MIT |
| `tower` / `http` | 0.5.x / 1.x | 中间件与类型 | MIT |

### 5.3 Go 档（`usable`）

| 模块 | 用途 | 许可证 | 说明 |
| --- | --- | --- | --- |
| 标准库 `net/http`、`database/sql` | 服务与数据库 | BSD-3-Clause（Go） | 不引框架 |
| `modernc.org/sqlite` | 纯 Go SQLite 驱动 | BSD-3-Clause | 避免 cgo，便于跨平台 |
| `github.com/lib/pq` | PostgreSQL | MIT | 可选 |
| `github.com/go-sql-driver/mysql` | MySQL | MPL-2.0 | 仅限 Go 档，按要求附许可证说明 |

- Go 档不生成鉴权与模块扩展；仅基础 CRUD 与配置。

### 5.4 Tauri 档

| 项 | 说明 |
| --- | --- |
| `tauri` / `tauri-build` | 版本随生成工程锁定 |
| 前端资源 | 复用同一静态产物 |
| 测试证书 | 平台生成；私钥只在站点 `certs/` 或目标机，不进 zip |
| 首次构建 | 需要工具链与 Gradle 缓存，**不承诺首次全离线** |

---

## 6. 系统工具矩阵

| 能力 | 工具 | 缺失时 |
| --- | --- | --- |
| Rust 生成 / `cargo check` | `rustc`、`cargo` | 阻断 Rust 档 |
| Go 生成 / `go build` | `go` | 阻断 Go 档 |
| 容器数据库 | `docker`、`docker compose` | 警告，仍生成 compose 与 SQLite 方案 |
| nginx 校验 | `nginx` | 降级为结构校验 |
| Android 签名 / 构建 | `keytool`、`apksigner`、SDK/NDK | 阻断签名或移动产物 |
| Windows 签名 | `signtool` | 阻断签名，允许未签名包 |

---

## 7. 离线策略

| 对象 | 策略 |
| --- | --- |
| 编辑器 | 启动零外部请求；资源全来自 `assets/` 与 `vendor/` |
| 静态产物 | JS/CSS/字体/图标/图片内联或本地；预检扫描外链 |
| Node 产物 | 生产 `node_modules` 随 zip + lock |
| Rust 产物 | `cargo vendor` + `.cargo/config.toml` |
| Go 产物 | `go mod vendor` + `GOFLAGS=-mod=vendor` |
| Tauri 产物 | 运行期离线；首次构建需工具链与 Gradle 缓存（明确告知） |
| 编辑器库捆绑 | 从本地 `vendor/` 复制，不远程拉取 |

预检项：

1. `offline-external`：产物文本无外链（用户显式配置的外链导航进白名单）。
2. `path-safety`：路径相对且不越界。
3. `secrets-scan`：无密钥、密码、证书私钥、Profile。
4. `lockfile-present`：有 `package.json` 必须有锁文件。
5. `vendor-sync`：`vendor/` 与 `node_modules` 版本一致。
6. `backend-config-valid`：自定义配置通过 schema 与冲突校验。
7. `nginx-valid`：`nginx -t` 或结构校验。
8. `cert-pair`：证书与私钥配对、未过期。

---

## 8. 许可证与合规

- 允许：MIT / Apache-2.0 / BSD / ISC；MPL-2.0 仅限 Go 档 MySQL 驱动，需在 notices 标明。
- GPL 类仅接受双许可中的宽松项（JSZip 即此情况）。
- 产物 zip 附 `THIRD-PARTY-NOTICES.md`，含目标工程依赖与编辑器库捆绑清单；链接仅作文本，运行期不请求。
- 图标为自绘 SVG，不引图标库。

---

## 9. 升级与审计

- 只通过锁文件升级：改 `package.json` → `npm install` → 提交 lock → 更新本文件。
- 每季度（或大版本前）跑 `npm audit`、`cargo audit`、`govulncheck`。
- 禁止带 `postinstall` 远程下载的依赖；发现即替换。

---

## 10. 禁止清单

1. 任何 CDN、远程字体、远程图标、远程脚本。
2. 未锁版本、未登记的依赖。
3. 密钥、证书私钥、Profile 进入 `vendor/`、`assets/` 或产物。
4. 平台代码引用文档站文件（`../server.js`、文档站 `assets/`、`vendor/site.*`）。
5. 原生模块进入跨平台产物 zip（Node 档按 D-19 只用内置 SQLite）。
6. 自动下载工具链或修改系统环境。
7. 把编辑器库默认全量塞进站点运行目录（只进 `vendor/editor/`，可关）。
