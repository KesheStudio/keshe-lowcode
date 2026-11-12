# 共享契约 v2（CONTRACTS 2.0.0）

> 文件名沿用 `CONTRACTS-v1.md` 以保持已有链接有效；**内容版本为 2.0.0**，因为本轮存储模型与导出模型是破坏性变更。
>
> 配套：[MODULE-DESIGN.md](file:///c:/project/docs/lowcode/MODULE-DESIGN.md)（模块与批次）、[design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md)（决策与推翻记录）、[DEPENDENCIES.md](file:///c:/project/docs/lowcode/DEPENDENCIES.md)（依赖）。
>
> 当前状态：设计已冻结，**实现已开工**。第一阶段（F0 脚手架 + ST1 存储内核 + 启动/迁移脚本）按本契约落地。

---

## 0. 版本总表

| 常量 | 旧值 | 新值 | 说明 |
| --- | --- | --- | --- |
| `CONTRACTS_VERSION` | 1.0.0 | **2.0.0** | 存储与导出破坏性变更 |
| `CONFIG_SCHEMA_VERSION` | 4 | **5** | 新增存储、导出目标、后端、nginx、证书 |
| `PROJECT_SCHEMA_VERSION` | 1 | **2** | 工作区项目 → 站点仓库 |
| `STORAGE_LAYOUT_VERSION` | — | **2** | 站点目录布局 |
| `PAGE_SCHEMA_VERSION` | 2 | 2 | 不变 |
| `BLOCK_SCHEMA_VERSION` | 1 | 1 | 不变 |
| `COMPONENT_SCHEMA_VERSION` | 1 | 1 | 不变 |
| `TEMPLATE_SCHEMA_VERSION` | 1 | 1 | 不变 |
| `DS_SCHEMA_VERSION` | 1 | 1 | 存储位置变化，字段不变 |
| `MODULE_SCHEMA_VERSION` | 1 | 1 | 不变 |
| `EXPORT_MANIFEST_VERSION` | 3 | **4** | 新增 target / backend / deploy / 第三方库 |
| `BUILD_RECORD_VERSION` | — | **1** | 构建记录 |
| `EXPORT_TARGET_SCHEMA_VERSION` | — | **1** | Web / Tauri 导出配置 |
| `BACKEND_CONFIG_VERSION` | — | **1** | 三语言后端配置 |
| `NGINX_CONFIG_VERSION` | — | **1** | 反向代理配置 |
| `CERT_SCHEMA_VERSION` | — | **1** | 证书配置 |
| `INDEXEDDB_VERSION` | 2 | **移除（主存储）** | 仅保留可选草稿缓存 `DRAFT_CACHE_VERSION = 1` |

规则：

1. 只增可选字段 → 升次版本；删字段/改语义 → 升主版本并附迁移。
2. 导入端至少支持「当前 + 前一个主版本」。
3. 迁移函数只增不改。
4. 本轮所有破坏性变更集中列在第 18 节。

---

## 1. 路径与根

- **平台根**：`package.json`、`platform.config.json` 所在目录，由入口文件位置推导。
- **数据根**：`platform.config.json → paths.dataDir`（默认 `data`）。
- **站点根**：`<数据根>/sites/<siteId>/`，一个站点一个目录，可独立 git 管理。
- 所有代码路径相对平台根；所有站点内引用相对站点根。
- 站点内页面路径不带前导 `/`，例如 `about.html`。
- 禁止盘符、绝对路径、`..` 越出站点根；违规返回 `LC_E_PATH_UNSAFE`。

---

## 2. StorageAdapter（存储抽象）

### 2.1 接口

```ts
interface StorageAdapter {
  read(path: string, opts?: { encoding?: 'utf8' | 'buffer' }): Promise<string | Buffer>
  stat(path: string): Promise<FileStat>
  list(dir: string, opts?: { recursive?: boolean; depth?: number }): Promise<FileEntry[]>
  write(path: string, data: string | Buffer, opts?: { atomic?: boolean; expectedRev?: number }): Promise<WriteResult>
  delete(path: string, opts?: { recursive?: boolean }): Promise<void>
  move(from: string, to: string): Promise<void>
  transaction<T>(siteId: string, fn: (tx: StorageTx) => Promise<T>): Promise<T>
  rev(siteId: string): Promise<number>
}
```

```ts
type FileStat = { path: string; size: number; mtime: string; hash: string; exists: boolean }
type FileEntry = { path: string; kind: 'file' | 'dir'; size: number; mtime: string }
type WriteResult = { path: string; rev: number; hash: string; bytes: number }
```

约束：

- `path` 必须是相对站点根（或相对数据根的明确前缀 `sites/<id>/`），由适配器做越界检查。
- `write` 默认 `atomic: true`，必须走临时文件 + rename。
- `transaction` 内的写入先写临时区，提交时统一 rename；失败全部回滚。
- `rev` 为站点级单调递增整数，每次成功提交 +1；同时维护文件内容 `hash`（sha256）。
- 乐观并发：带 `expectedRev` 的写在 rev 不匹配时返回 `409` + 当前 rev，不覆盖。

### 2.2 实现

| 实现 | 用途 | 默认 | 关键路径 |
| --- | --- | --- | --- |
| `FsStorageAdapter` | 本地文件系统（Node） | 开启 | 是 |
| `MemoryStorageAdapter` | 测试 | 仅测试 | 否 |
| `IndexedDbDraftAdapter` | 浏览器未保存草稿缓存 | **关闭** | **否** |

草稿缓存的边界：

- 只缓存「当前打开页面的未提交编辑」，容量上限 1 MB，页面刷新后用于恢复。
- 后端不可用时，编辑器进入**只读 + 禁止保存**，不得把草稿缓存当成可用存储。
- 草稿不得包含密钥、证书、上传原文件。

---

## 3. 磁盘布局（`STORAGE_LAYOUT_VERSION = 2`）

### 3.1 平台根

```
<平台根>/
├─ package.json / package-lock.json
├─ platform.config.json
├─ index.html / assets/ / vendor/
├─ server/                     # HTTP 入口与路由（server/index.js、server/src/**）
├─ src/storage/                # 存储内核（StorageAdapter、原子写、锁、事务、恢复）
├─ shared/
├─ diagnostics.html            # 无后端时的自检页（无外部资源）
├─ data/                       # 数据根（默认，gitignore）
├─ exports/                    # 手动下载副本（gitignore）
├─ logs/
├─ scripts/
├─ tests/
└─ docs/                       # 本目录设计稿
```

### 3.2 站点目录

```
<数据根>/sites/<siteId>/
├─ site.json                        必需 · 源
├─ project.json                     必需 · 源（config v5）
├─ .gitignore                       必需 · 生成
├─ pages/<pageId>.json              必需 · 源
├─ articles/<articleId>.json        条件 · 源（文档模板需要）
├─ components/<componentId>.json    可选 · 源
├─ themes/<themeId>.json            可选 · 源
├─ templates/<templateId>.json      可选 · 源（页面/站点模板）
├─ trash/
│  ├─ components/<trashId>.json     可选 · 回收站（删除的组件）
│  └─ templates/<trashId>.json      可选 · 回收站（删除的模板）
├─ data/
│  ├─ sources.json                  可选 · 源
│  ├─ collections/<id>.json         可选 · 源
│  ├─ originals/<fileId>.<ext>      可选 · 源（上传原文件）
│  ├─ files/<fileId>.json           派生 · 可重建（解析结果）
│  └─ mocks/<id>.json               可选 · 源
├─ assets/
│  ├─ images/<sha256>.<ext>         可选 · 源
│  ├─ fonts/<sha256>.<ext>          可选 · 源
│  └─ icons/<name>.svg              可选 · 源
├─ certs/                           可选 · 源（含私钥，禁止提交）
├─ deploy/
│  ├─ nginx/nginx.conf              派生 + 可覆盖
│  ├─ backend/config.<ext>          派生 + 可覆盖
│  └─ scripts/gen-test-cert.sh      派生
├─ builds/<buildId>/                派生 · 可清理
│  ├─ build.json
│  ├─ artifact.zip
│  ├─ log.txt
│  └─ diff.json
├─ versions/                        派生 · 历史
│  ├─ index.json
│  └─ <rev>.json                    diff 或 snapshot
├─ backups/<timestamp>/             派生 · 可清理
└─ .lowcode/                        运行时 · 忽略
   ├─ locks/site.lock
   ├─ tmp/
   └─ txn/<txnId>.json
```

### 3.3 逐文件说明

| 文件 | 必需 | 源/派生 | 用途 | 缺失时 |
| --- | --- | --- | --- | --- |
| `site.json` | 是 | 源 | 站点标识、名称、slug、创建时间、布局版本 | 阻断打开，提示修复/恢复 |
| `project.json` | 是 | 源 | 全局变量、模板、主题引用、导航/页脚引用、导出配置、后端配置 | 阻断打开，可从备份恢复 |
| `.gitignore` | 是 | 生成 | 排除派生与敏感目录 | 自动重建 |
| `pages/<id>.json` | 是（≥1） | 源 | 页面与区块树 | 缺失即页面不存在；全缺则报空站点 |
| `articles/<id>.json` | 条件 | 源 | 文章正文与分类 | 文档模板下为空则列表空态 |
| `components/<id>.json` | 否 | 源 | 自定义组件（含 CSS/JS） | 页面引用缺失 → 占位 + 错误码 |
| `themes/<id>.json` | 否 | 源 | 自定义主题 | 缺失回退内置主题 |
| `templates/<id>.json` | 否 | 源 | 页面模板 / 站点模板 | 缺失不影响站点；套用时 404 |
| `data/sources.json` | 否 | 源 | 数据源定义 | 组件绑定失效 → 占位 |
| `data/collections/<id>.json` | 否 | 源 | 集合与记录 | 缺失 → 空集合提示 |
| `data/originals/*` | 否 | 源 | 上传的 CSV/JSON 原文件 | 解析结果仍在则可读 |
| `data/files/<id>.json` | 否 | 派生 | 解析后的列与行 | 可由 originals 重建 |
| `data/mocks/<id>.json` | 否 | 源 | 模拟接口定义 | 绑定失效 → 占位 |
| `assets/images/*` | 否 | 源 | 图片，按内容哈希命名 | 页面占位并提示重新上传 |
| `assets/fonts/*` | 否 | 源 | 本地字体 | 回退系统字体栈 |
| `assets/icons/*` | 否 | 源 | 自定义 SVG 图标 | 回退内置图标 |
| `certs/*` | 否 | 源（敏感） | 证书与私钥 | nginx HTTPS 不可启用，状态 `blocked` |
| `deploy/nginx/nginx.conf` | 否 | 派生/可覆盖 | 推荐反向代理配置 | 自动重建；用户改后保留 |
| `deploy/backend/config.*` | 否 | 派生/可覆盖 | 后端自定义配置底稿 | 用平台默认值 |
| `builds/*` | 否 | 派生 | 构建记录、产物、日志、diff | 不影响编辑；可重构建 |
| `versions/*` | 否 | 派生 | 变更历史 | 不影响编辑；失去回滚 |
| `.lowcode/*` | 否 | 运行时 | 锁、临时区、事务日志 | 启动时重建 |

### 3.4 `.gitignore`（站点级，生成内容）

```
.lowcode/
builds/
backups/
certs/
versions/
data/files/
*.tmp
*.corrupt
```

- `deploy/`、`versions/` 是否提交由用户决定，默认提交 `deploy/` 的最终配置、忽略 `versions/`。
- 站点目录可 `git init` 后直接管理；不含平台代码、不含密钥（`certs/` 已忽略）。

### 3.5 平台根配置 `platform.config.json`（`PLATFORM_CONFIG_SCHEMA_VERSION = 1`）

平台自身的端口、目录、限额只在这里配置；环境变量与命令行**不得**改端口或目录（唯一例外是 `scripts/start.mjs` 在端口被占用时的自动回退，见 17.2）。

```json
{
  "schemaVersion": 1,
  "platform": { "name": "低代码工作台", "host": "127.0.0.1", "port": 9780, "openBrowser": true },
  "paths": { "dataDir": "data", "exportsDir": "exports", "logsDir": "logs" },
  "server": { "bodyLimitBytes": 67108864, "requestTimeoutMs": 30000, "tokenTtlHours": 24 },
  "storage": {
    "backupKeepCount": 10, "backupKeepDays": 30,
    "versionKeepCount": 100, "versionKeepDays": 30,
    "buildKeepPerTarget": 10, "siteQuotaBytes": 5368709120,
    "lockStaleMs": 60000, "tmpMaxAgeMs": 3600000
  },
  "draftCache": { "enabled": false },
  "logging": { "level": "info" }
}
```

校验规则（失败一律 `LC_E_CONFIG_INVALID`，退出码 2，写 `logs/boot-error.json`）：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 必须为 `1` |
| `platform.host` | 仅允许 `127.0.0.1` / `localhost` / `::1`，不对外监听 |
| `platform.port` | 整数 1024–65535 |
| `paths.*` | 相对平台根的目录名；禁止盘符、绝对路径、`..`、Windows 保留字符 |
| `server.bodyLimitBytes` | 1 MB–256 MB |
| `storage.*` | 正整数且在上限内；`lockStaleMs` ≥ 30s |
| 未知键 | 警告并保留，不阻断启动 |

---

## 4. 写盘语义

### 4.1 原子写

1. 在目标目录创建 `.<name>.<uuid>.tmp`。
2. 写入内容并 `fsync` 文件。
3. `rename(tmp, target)`；同卷 rename 视为原子；跨卷时退化为「复制到临时 + rename」并在日志记录。
4. 尽力 `fsync` 目录（Windows 为 best-effort）。
5. 更新 rev 索引（同样原子写）。

失败时保留 temp 不超过 1 小时，供排查；启动时清理更早的 temp。

### 4.2 站点互斥

- 进程内：`Map<siteId, Mutex>` 串行化同一站点写入。
- 跨进程：`<site>/.lowcode/locks/site.lock` 内容 `{ pid, host, token, acquiredAt, heartbeatAt }`。
- 心跳 10s；超过 60s 无心跳视为陈旧锁，可回收并记录警告。
- 获取失败：HTTP `423 Locked`，响应含持有者 pid 与开始时间；前端展示「另一个窗口正在写这个站点」。
- 只读操作不加锁；`rev` 读取走快照。

### 4.3 事务与崩溃恢复

- `transaction` 开始时创建 `.lowcode/txn/<txnId>.json`：
  ```json
  { "txnId": "", "siteId": "", "state": "prepared|committing|done", "startedAt": "",
    "files": [ { "target": "pages/page-1.json", "temp": ".pages/page-1.json.<uuid>.tmp", "hash": "" } ] }
  ```
- 写入全部 temp 后置 `committing`，逐个 rename；全部成功后置 `done` 并删除清单。
- 启动恢复：扫描清单——`prepared` 全部回滚；`committing` 若所有目标 hash 匹配则前滚补 rename，否则回滚；`done` 清理。
- 单文件 JSON 解析失败 → 移入 `.corrupt/<timestamp>/`，尝试从 `backups/` 最近副本恢复；无副本则站点置为「需修复」，禁止写入但允许只读导出。

### 4.4 备份

- 触发：批量替换、模板套用、迁移、删除页面、危险配置变更前。
- 内容：受影响源文件 + 一个 `manifest.json`（时间、原因、文件清单、hash）。
- 保留：最近 10 份或 30 天，单站点上限 2 GB；超限删最旧。
- 恢复：按文件选择恢复，不整站覆盖；恢复前再备份当前状态。

### 4.5 版本与构建记录

| 类型 | 存储 | 内容 | 保留 |
| --- | --- | --- | --- |
| 版本 | `versions/<rev>.json` | 变更文件全量副本（UTF-8 文本或 base64 二进制），含路径、内容、hash | 100 条 / 30 天 |
| 版本索引 | `versions/index.json` | rev、parent、at、涉及文件、字节数 | 随版本 |
| 构建记录 | `builds/<buildId>/build.json` | 状态、target、runtime、起止时间、sourceRev、manifest 摘要、产物大小/hash、警告 | 每 target 保留最近 10 次 + 最近一次成功 |
| 构建日志 | `builds/<buildId>/log.txt` | 分级日志，脱敏 | 同上 |
| 构建差异 | `builds/<buildId>/diff.json` | 与同 target 上次产物的文件级增删改 | 同上 |
| 产物 | `builds/<buildId>/artifact.zip` | 单 zip | 同上，总量上限 5 GB（站点） |

清理：

- 自动：超保留数或超容量时，从最旧的非置顶记录开始删；**永不删除每个 target 的最新成功产物**。
- 手动：构建页支持「置顶 / 删除 / 清理全部失败记录」。
- 磁盘占用在「设置 → 工作区」展示：源文件、构建、版本、备份、缓存五类分开统计。

---

## 5. 站点元信息 `site.json`

```json
{
  "schemaVersion": 2,
  "storageLayoutVersion": 2,
  "id": "site-7d1a2c",
  "slug": "example-site",
  "name": "示例站点",
  "createdAt": "2026-11-08T10:00:00.000Z",
  "updatedAt": "2026-11-08T10:30:00.000Z",
  "rev": 42,
  "status": "ready",
  "templateId": "docs",
  "counts": { "pages": 6, "articles": 2, "components": 3, "collections": 1 }
}
```

`status`: `ready` / `needs-repair` / `migrating` / `read-only`。

---

## 6. 项目配置 `project.json`（`CONFIG_SCHEMA_VERSION = 5`）

```json
{
  "schemaVersion": 5,
  "globalVars": {
    "site": {
      "name": "示例站点",
      "tagline": "",
      "description": "",
      "logo": { "kind": "icon", "value": "layers", "alt": "站点图标" },
      "copyright": "© 2026",
      "language": "zh-CN"
    }
  },
  "template": { "id": "docs", "version": 1 },
  "theme": { "defaultThemeId": "ink-green", "mode": "auto" },
  "navigation": { "blockId": "b-nav-primary" },
  "footer": { "blockId": "b-footer-main" },
  "directions": [],
  "series": [],
  "topics": [],
  "dataSources": [],
  "upload": {
    "enabled": false,
    "targetType": "relative",
    "target": "/api/upload",
    "method": "POST",
    "fileField": "file",
    "headers": {},
    "fields": {},
    "maxBytes": 33554432
  },
  "export": {
    "target": "web-static",
    "web": {
      "delivery": "static",
      "domain": "",
      "basePath": "/",
      "cleanUrls": false,
      "nginx": { "enabled": false, "configId": "nginx-default" }
    },
    "tauri": {
      "productName": "Example App",
      "identifier": "com.example.app",
      "version": "0.1.0",
      "window": { "width": 1024, "height": 720, "minWidth": 800, "minHeight": 600, "resizable": true, "fullscreen": false, "title": "Example App" },
      "icon": { "source": "builtin", "path": "" },
      "protocol": "https",
      "https": { "mode": "generated", "host": "localhost", "port": 1420 },
      "update": { "active": false, "endpoint": "", "pubkey": "", "channel": "stable" },
      "bundle": { "targets": ["msi", "nsis", "appimage", "apk", "aab"], "createUpdaterArtifacts": true }
    },
    "backend": {
      "language": "none",
      "port": 8080,
      "host": "127.0.0.1",
      "cors": {
        "enabled": true,
        "origins": ["http://localhost:8310"],
        "methods": ["GET", "POST", "PUT", "DELETE"],
        "headers": ["content-type", "authorization"],
        "credentials": false,
        "maxAge": 600
      },
      "env": [ { "key": "DATABASE_URL", "required": true, "default": "" } ],
      "database": { "driver": "sqlite", "url": "sqlite://data/app.db" },
      "middleware": {
        "requestId": true,
        "logging": true,
        "compression": true,
        "rateLimit": { "enabled": false, "rps": 20 },
        "securityHeaders": true
      },
      "configFile": { "path": "deploy/backend/config.yaml", "override": false, "strict": true }
    }
  }
}
```

规则：

- `export.target` 只允许 `web-static` / `tauri-desktop`；切换只改这一个值，另一套配置保留。
- `export.backend.language`: `none` / `rust` / `node` / `go`。
- `export.web.delivery`: `static` / `backend` / `backend+nginx`。
- `export.tauri.*` 全部可编辑，默认值必须能直接跑通（见第 13 节）。
- 站点名只来自 `globalVars.site.name`；不再有第二份。
- 目录名、端口不写进站点配置，走 `platform.config.json`；这里只写「站点/产物相关」的值。
- `upload.targetType`: `relative` / `absolute`；`relative` 的 `target` 必须以 `/` 开头，`absolute` 必须 `http(s)://`。
- `upload.headers` 与 `upload.fields` 为字符串键值对，随 `lowcode-project.json` 带进产物；证书私钥类字段仍被剔除；含鉴权类请求头时构建记 `LC_W_UPLOAD_HEADERS` 警告。
- 上传目标属于站点配置，不得只存在界面状态；重新生成、模板升级、再次导出都不能丢。

---

## 7. 页面、区块、组件、外壳、模板、主题

本轮**不改结构**，沿用 v1 契约，仅存储位置变化：

| 对象 | 版本 | 位置 | 说明 |
| --- | --- | --- | --- |
| 页面 | 2 | `pages/<id>.json` | `layout.mode`、`shell`、`nav`、`seo` 不变 |
| 区块 | 1 | 页面内 `blocks[]` | 保留键、`pos`、`visible`、`actions` 不变 |
| 组件 | 1 | `components/<id>.json` | 模板、字段、CSS/JS、作用域规则不变 |
| 外壳 | 1 | `components/` 内的 `siteNav` / `siteFooter` / `breadcrumb` | 构建时高亮算法不变 |
| 模板 | 1 | 内置 + `templates/`（用户模板目录） | 页面/整站两种，冲突处理不变 |
| 主题 | 2 | `themes/<id>.json` 或内置 `src/theme/themes/` | 正式字段见下方「主题 JSON」 |

### 模板 JSON（v1.0.0 正式字段）

模板保存在 `templates/<id>.json`，删除先进 `trash/templates/<trashId>.json`，可恢复。导出信封：

```json
{
  "format": "lowcode-template",
  "schemaVersion": 1,
  "exportedAt": "2026-11-08T00:00:00.000Z",
  "template": {
    "id": "marketing-home",
    "name": "营销首页",
    "kind": "page",
    "category": "landing",
    "tags": ["营销", "首页"],
    "description": "带英雄区与促销卡片的首屏",
    "source": { "siteId": "demo", "siteName": "示例站", "pageId": "home", "pageTitle": "首页", "savedAt": "2026-11-08T00:00:00.000Z" },
    "createdAt": "2026-11-08T00:00:00.000Z",
    "updatedAt": "2026-11-08T00:00:00.000Z",
    "page": { "schemaVersion": 2, "id": "home", "title": "首页", "slug": "home", "path": "index.html", "nav": true, "layout": { "mode": "flow" }, "blocks": [] },
    "components": []
  }
}
```

- `kind` 只有 `page` / `site` 两种；`site` 模板用 `pages[]`（每个页面同 `page` 结构）而不是 `page`，并额外带 `config`：
  `config = { site, navigation, footer, theme: { activeId }, themes[] }`。
- `components` 是模板引用到的自定义组件快照（`builtin:` 开头的内置组件不收）；套用时只补齐缺失 id，绝不覆盖已有同名组件。
- **边界**：模板只带走内容层。`data/`（集合与数据源）、`.lowcode/data-secrets.json`、导出配置、上传目标、后端与中间件配置一律不进模板；站点模板的 `config` 也只保留站点名称/语言、导航、页脚与主题。
- **套用**：`apply` 支持 `mode: "new"`（新建页面，单页模板可用 `title/slug/path` 覆盖命名）与 `mode: "overwrite"`（仅页面模板，必须带 `pageId` 且二次确认；服务端先 `createBackup` 再替换区块与布局，页面 id/路径保持不变）。站点模板只支持新建，可选 `applyConfig` 把导航与页脚映射到新页面并写入 `project.json`。
- **分类**：`landing`（落地页）、`content`（内容页）、`form`（表单页）、`dashboard`（数据展示）、`other`（其他）。
- 导入接受本平台导出的信封；id/名称冲突时自动追加后缀，不覆盖已有模板。


### 主题 JSON（v2.0.0 正式字段）

```json
{
  "schemaVersion": 2,
  "id": "ink-green",
  "name": "纸墨 · 松绿",
  "tone": "温润",
  "description": "主站默认配色",
  "modes": {
    "light": { "seeds": { "accent": "#3e6a56", "bg": "#f4f0e6", "surface": "#fffcf5", "ink": "#20242a", "muted": "#6b7076", "line": "#ded6c5", "codeBg": "#efeade" }, "overrides": {} },
    "dark": { "seeds": { "accent": "#8fb9a1", "bg": "#141a1f", "surface": "#1a2229", "ink": "#e6e2d8", "muted": "#98a0a6", "line": "#2a343c", "codeBg": "#151d23" }, "overrides": {} }
  },
  "shared": { "tokens": {} }
}
```

- `seeds` 只放主色；派生色由 `src/theme/tokens.mjs` 计算，组件样式禁止写死色值。
- `overrides` 只覆盖派生后的 CSS 变量；`shared.tokens` 在 light/dark 两模式下都生效。
- 加载、旧格式归一化与变量注入归**接口层** `server/src/themes.js`；渲染层只接收解析后的变量，不读文件、不读系统偏好。
- 明暗模式属性统一为 `data-lc-mode="light|dark"`；`auto` 由外壳层解析成实际值后再写入，渲染层不处理 `auto`。
- 外壳偏好记在 `data-lc-mode-pref="light|dark|auto"`，持久化键为 `localStorage.lowcode-mode`；旧键 `lowcode-theme` 只作一次性回退读取，不再写入。

### Mermaid 渲染分工（v2.0.0）

- 渲染层不依赖 mermaid 包：`markdown.js` 把 ```mermaid / ```mmd 输出为占位结构
  `.lc-mermaid[data-lc-mermaid-status="pending"]`，源码在 `[data-lc-mermaid-source]`、画布在
  `[data-lc-mermaid-canvas]`、错误在 `[data-lc-mermaid-error]`。同步直出 SVG 仍走
  `markdownToHtml(md, { mermaid: fn })` 与 `createMermaidRegistry().use(renderer)` 的既有接口。
- 平台实现 `shared/mermaid.js`：`isFenceLang`、`renderCode`（生成同构占位）、`codeRenderers`、
  `hasMermaidInSite`、`hasMermaidMarkup`、`bootstrap()`。预览与导出加载本地
  `vendor/mermaid.min.js` 后由 `bootstrap()` 异步出图，失败逐块降级为源码。
  官方 `mermaid.render` 是 Promise，**不塞进同步 `registry.render` 钩子**；需要渲染期直出时
  使用渲染层内置的同步 `renderMermaidBuiltin`。
- 图表范围只保证六类常见图：流程图、时序图、类图、状态图、甘特图、饼图；不追求全图型。
  统一使用官方 `vendor/mermaid.min.js`（12.3.0，自托管），编辑器预览、独立页面预览与导出产物同源。
  该文件原始体积约 5.5 MB、gzip 后约 1.6 MB；官方未提供只含部分图型的 UMD 构建，拆 ESM
  chunk 会破坏 `file://` 单文件与断网可用性，因此不裁剪，只保证按需打包（未用图表则不进产物）。
- 禁止 CDN：不再提供「不打包图表库」模式，也不存在缺失时回退 CDN 的逻辑；有图表块就打包本地库。
- 主题令牌继续生效：`bootstrap()` 读取 `--lc-mermaid-node-fill`、`--lc-mermaid-node-stroke`、
  `--lc-mermaid-line`、`--lc-mermaid-label`、`--lc-mermaid-note-fill`、`--lc-mermaid-label-bg`，
  映射到官方 `themeVariables`（节点、连线、文字、注释、边标签背景、饼图分区等），亮暗两套各自生效。
  页面 `data-lc-mode` / `data-lc-theme` 变化时重新初始化并重绘。
- 失败可见：库缺失、源码为空、解析失败都保留源码块，并在图块下方输出一行
  「图表渲染失败：…」或「图表库未加载，已保留源码。」；画布清空，不出现白屏。
- 产物按实际引用打包：只有导出 HTML 命中 `data-lc-mermaid`（或旧的 `class="mermaid"`）时，
  才把 `vendor/mermaid.min.js` 复制为产物 `assets/js/mermaid.min.js`；未命中则产物里没有该文件。
  其它第三方运行时同样按引用裁剪，不整包乱塞。
- 打包信息写入产物 `manifest.json` 的 `bundledAssets[]`（`path`、`package`、`license`、`bytes`）与构建记录；额外运行时总量超过 4 MB 时提示用户。
- `npm run doctor` 的「产物无外链」检查覆盖 `exports/**`、`data/sites/*/builds/**`、`vendor/**` 中的外链脚本、外链样式与外链字体。

### 前端元素事件绑定（运行时 v2.0.0）

元素（区块根节点）上挂：

```json
"bindings": [
  { "event": "click", "route": "/api/demo/rows", "method": "GET",
    "target": "tbl-orders", "handler": "auto", "script": "" }
]
```

- 字段固定：`event` 取 `click | submit | change`（兼容 `input/dblclick/keydown/keyup/focus/blur/mouseenter`），
  `route` 是后端积木产出的接口路径，`method` 取 `GET|POST|PUT|PATCH|DELETE`，`target` 是接收数据的组件 id
  （区块 `data-lc-block` 或实例 `data-lc-instance`，可为空），`handler` 取 `auto | custom`，`script` 是自定义脚本源码。
- 可选扩展（builder 不传则用默认文案）：`loadingText`、`errorText`、`successText`。
- 运行时统一扫描 `[data-lc-bindings]`（值为规范化后的 JSON 数组），整页只注入一次，不按块重复绑定。
- 触发：`submit` 会 `preventDefault`；`change` 带上 `name/value`；`submit` 带上表单 `values`（同名多值转数组）。
  `GET/HEAD` 把 `event`、`value` 与 `values` 拼到 query；其余方法发送 JSON
  `{ event, values?, name?, value? }`，`content-type: application/json`，`credentials: same-origin`。
- 加载态：元素 `data-lc-binding-state="loading"` + `aria-busy="true"`，并在元素尾部显示一行
  `loadingText`（默认「正在加载…」）。
- 成功：`auto` 写入 target 的数据槽并派发 `lc:instance-data`、`lc:binding-complete`；状态改为 `ready`。
  `custom` 调用 `new Function("payload","event","root","data","target", script)`，脚本抛错被捕获，
  仅当前绑定进入失败态并派发 `lc:binding-script-error`，不影响页面其它部分。
- 失败：HTTP 非 2xx、网络错误、数据无法写入目标组件都会把状态改为 `error`，显示
  `errorText` 或 `请求失败（HTTP n），请稍后重试。`/目标组件错误说明，并派发 `lc:binding-error`；
  源码块与页面其它区块不受影响。
- 防抖与取消：同一绑定 200 ms 内重复触发忽略；再次触发或元素从 DOM 移除时 `AbortController.abort()` 旧请求，
  响应回来时若元素已销毁则丢弃结果。
- `auto` 数据槽契约：
  - 表格：`数组` 或 `{ rows: [] }`；优先 `el.__lcTable.setRows(rows)`（保留列定义、排序与分页，重置到第一页），
    无运行时 API 时按表头 `th[data-lc-col]` 直接重绘 `[data-lc-tbody]`。
  - 列表：target 内 `[data-lc-list]` 容器，数据 `数组` 或 `{ items/list: [] }`，按 `ul/ol/div` 重绘条目。
  - 图表：response 原样交给异步图表运行时（数组、`{labels,series}` 等既有契约一致），
    通过 `window.__LC_PAINT_ASYNC__` 复用 `runtime.js` 的绘制函数，不另写一套图元。
  - 文本：优先 `[data-lc-value]` / `[data-lc-text]`，其次 `.lc-ui-kpi-number` / `.lc-ui-stat-number`；
    文本类区块（`text/heading/paragraph/markdown`）写首个标题或段落节点。
  - 自定义组件可实现 `el.__lcData = { setData(data, meta) }`，运行时优先调用，列表/图表等自定义形态走此扩展。
- 返回值信封：对象含 `data` 字段时自动解包（`{ ok, data }` 与 `{ data }` 均可）；其余原样作为数据。

补充两条存储相关规则：

1. `components/` 只存用户组件；内置组件在代码注册表里，不落盘。
2. 页面内嵌图片一律在构建时复制到 `assets/images/` 并改为内容哈希路径；`page.json` 里不长期保存 data URL。

### 内置组件实例覆盖与数据源（v1.0.0）

**实例覆盖**：内置 `ui-*` 实例与自定义组件实例共用同一套 `block.overrides = { html, css, js }`，
不需要先「另存为组件」：

- `html` 整段替换该实例渲染出的默认模板；`css` 追加并作用域到
  `[data-lc-instance="<blockId>"]`；`js` 追加为独立 IIFE，只能通过该实例根节点取 DOM。
- 只影响当前实例：同类型其它实例继续走默认模板与默认样式；组件库原件（代码注册表）不修改。
- 渲染标记：仅被覆盖实例带 `data-lc-instance` 与 `data-lc-overridden="true"`。
- 恢复默认：删除 `overrides` 三个字段即回到默认结构；Builder 面板显示「已覆盖」徽标与「恢复默认」按钮。
- 覆盖内容随页面 JSON 保存，渲染、预览、导出共用同一条链路；重新生成页面或导出产物不会丢失。
- 覆盖源码的语法检查与页面级覆盖一致（`checkHtml/checkCss/checkJs`，错误码 `OVERRIDE_SOURCE_INVALID`）。

**滑块数据源**：`ui-slider` 除 `min/max/step/marks` 外支持：

```json
{ "datasource": "demo-range", "sourceMode": "range" }
```

- `sourceMode: "range"`：从数据源取区间，回调 `range(context)` 返回
  `{ min, max, step?, marks? }`；组件据此更新两个手柄边界、步长与刻度。
- `sourceMode: "stops"`：从数据源取候选值，回调 `stops(context)` 返回
  `Array<{ value, label } | value>`（也接受 `{ stops|values|items: [] }`）；
  组件内部用候选下标驱动原生 range，读数与刻度显示 `label`，数字输入与拖动都吸附到最近候选值，
  `lc:slider-change` 派发**实际候选值**而不是下标。
- 数据源可以只提供通用接口：`search('', context)` 或 `load(context)`；`context = { signal, limit }`。
  平台侧统一用 `LC.Render.registerDataSource(name, source)` 注册，组件只通过
  `R.resolveDataSource(name)` 取源，自身不发请求。
- 加载状态写入实例 `data-lc-state`：`loading | ready | empty | error`；提示行
  `[data-lc-slider-source-note]` 使用可配置文案 `sourceLoadingText / sourceEmptyText /
  sourceErrorText / sourceUnconfiguredText`，未注册数据源时保留静态 `min/max` 可用。
- 事件：取值变化派发 `lc:slider-change`；数据源加载完成派发 `lc:slider-source`
  （`detail = { name, mode, min, max, step, stops }`）。
- 预览与导出页面按页面实际用到的内置类型注入浏览器运行时包（含 `dom.js`、`datasource.js`、
  组件 `enhance`）；数据源注册脚本需在该包之前执行，例如导出的 `site.js`/页面脚本之前。

（完整字段见本文件 v1 历史版本第 4–9 节，本轮未改动；为避免重复，这里只列差异。）

---

## 8. 数据层（位置变化，字段不变）

- 数据源、集合、模拟接口定义：`data/sources.json`、`data/collections/`、`data/mocks/`。
- 上传原文件：`data/originals/<fileId>.<ext>`（源）；解析结果 `data/files/<fileId>.json`（派生）。
- 集合限额不变：5 MB / 2 万行 / 5 万条。
- 导出仍生成快照，不实时请求；`runtime: true` 规则不变。
- 构建时若 `data/files/` 缺失，由 `originals/` 重建；重建失败则用导出快照并给警告。

---

## 9. 表单、逻辑、后端模块

- 表单规格 `FORM_SPEC_VERSION = 1` 不变。
- 动作类型不变；导出运行时 `assets/runtime/actions.js` 仍为平台自研。
- 后端模块 `MODULE_SCHEMA_VERSION = 1` 不变；新增 `language` 约束：
  - Rust：白名单 crates；
  - Node：白名单 npm；
  - Go：标准库 + 白名单模块。

---

## 10. 构建记录 `build.json`（`BUILD_RECORD_VERSION = 1`）

```json
{
  "buildRecordVersion": 1,
  "buildId": "site-20261108-1201",
  "status": "success|failed",
  "target": "web-static",
  "runtime": "static",
  "version": "v1.0.0",
  "sourceRev": 42,
  "startedAt": "",
  "endedAt": "",
  "artifact": { "path": "artifact.zip", "bytes": 0, "sha256": "" },
  "sizing": {
    "zipBytes": 0,
    "unpackedBytes": 0,
    "libraries": [ { "package": "mermaid@12.3.0", "bytes": 0, "readable": "5.5 MB", "share": 80 } ],
    "code": {
      "before": { "html": 0, "css": 0, "js": 0, "total": 0 },
      "after": { "html": 0, "css": 0, "js": 0, "total": 0 }
    },
    "lines": [ "zip 1.7 MB，解压后 7.0 MB", "其中 5.5 MB 是图表库 mermaid（约占解压后的 80%）" ]
  },
  "manifest": {
    "formatVersion": 4,
    "artifactId": "",
    "createdAt": "",
    "fileCount": 0,
    "size": {},
    "checks": [ { "id": "offline-external", "status": "pass", "message": "" } ],
    "warnings": [ { "code": "", "message": "" } ],
    "ownership": { "platform": [], "user": [], "merged": [] },
    "bundledAssets": [],
    "deploy": {}
  },
  "minify": {
    "enabled": true,
    "html": false,
    "applied": true,
    "before": 0,
    "after": 0,
    "saved": 0,
    "byKind": {
      "html": { "count": 0, "before": 0, "after": 0, "saved": 0 },
      "css": { "count": 0, "before": 0, "after": 0, "saved": 0 },
      "js": { "count": 0, "before": 0, "after": 0, "saved": 0 }
    },
    "skipped": []
  }
}
```

- `artifact.zip` 内包含 `artifact-manifest.json`；`build.json` 只存清单摘要，避免重复大文件。
- `sizing` 是给人看的体积账：zip 体积、解压后总体积、第三方运行时（如 mermaid 图表库）占多少、站点 HTML/CSS/JS 压缩前后各自多大；`lines` 可直接展示在构建报告界面。
- `minify.html` 表示 HTML 是否参与压缩；默认 `false`（原因见 15.5）。
- 同目录另有 `log.txt`（分级、脱敏，不含密钥与证书内容）。
- 构建失败时不生成 zip，`status = failed`，`manifest.checks` 里标明失败项。
- 同一站点同一时刻只允许一个构建运行；第二个请求返回 `409` 并附当前 buildId。

---

## 11. 导出目标与模板

### 11.1 两个目标

| target | 默认模板 | 产物根 | 说明 |
| --- | --- | --- | --- |
| `web-static` | Web 默认模板 | `web/` | 静态站；可选后端与 nginx |
| `tauri-desktop` | Tauri 默认模板 | `desktop/` + `web/` | 桌面应用；可选内嵌后端/sidecar |

- 目标选择在导出页第一步，切换不删另一套配置。
- 两套模板的所有字段可见、可改；「恢复默认值」按字段级提供。
- **`web-static` 必须通过 http(s) 访问**：产物不能直接双击 `web/index.html` 使用。界面目标卡片要写明这一点，并指引想要双击即用的用户改选 `tauri-desktop`；不使用警告弹窗。
- `file://` 下 `fetch`、模块脚本与部分浏览器 API 受限，平台不再为双击场景做兼容补偿（不强制内联大体积数据、不禁止 `type="module"`、不禁止 `fetch`）。这些手段可以按正常 Web 实现使用，前提是不影响部署到 nginx 后的访问。

### 11.2 Web 默认模板

```json
{
  "target": "web-static",
  "delivery": "static",
  "domain": "",
  "basePath": "/",
  "cleanUrls": false,
  "backend": { "language": "none" },
  "nginx": { "enabled": false }
}
```

### 11.3 Tauri 默认模板（必须开箱可跑）

```json
{
  "target": "tauri-desktop",
  "productName": "Example App",
  "identifier": "com.example.app",
  "version": "0.1.0",
  "window": {
    "width": 1024, "height": 720,
    "minWidth": 800, "minHeight": 600,
    "resizable": true, "fullscreen": false,
    "title": "Example App"
  },
  "icon": { "source": "builtin", "path": "" },
  "protocol": "https",
  "https": { "mode": "generated", "host": "localhost", "port": 1420 },
  "update": { "active": false, "endpoint": "", "pubkey": "", "channel": "stable" },
  "bundle": { "targets": ["msi", "nsis", "appimage", "apk", "aab"], "createUpdaterArtifacts": true },
  "dev": { "url": "http://127.0.0.1:1420", "beforeDevCommand": "", "beforeBuildCommand": "" }
}
```

校验：

- `identifier` 必须反向域名格式，且不含空格与下划线。
- `version` 必须 semver。
- `window` 最小 320×240；`minWidth/minHeight` 不得大于默认宽高。
- `protocol`: `http` / `https`；`https.mode`: `generated` / `imported` / `none`。
- `update.active: true` 时 `endpoint` 与 `pubkey` 必填，且 `bundle.createUpdaterArtifacts` 必须为真。
- `icon.path` 必须存在且为 PNG/ICO，尺寸 ≥ 512×512。

### 11.4 协议与证书

- `http`：本地开发/内网使用，界面标注「不加密」。
- `https` + `generated`：构建时生成测试证书（自签，仅测试），并在说明里写明浏览器/系统需要手动信任。
- `https` + `imported`：用户提供证书与私钥路径，平台校验有效期、域名匹配、链完整；私钥只存站点 `certs/`，权限 0600。
- **任何情况下私钥不进入导出 zip**；zip 只带配置与 `scripts/gen-test-cert.sh`（见第 14 节）。
- 指纹写入 manifest，便于核对。

---

## 12. 后端分档与配置

### 12.1 成熟度

| 语言 | 成熟度 | 说明 |
| --- | --- | --- |
| Rust | `full` | axum + sqlx，默认推荐 |
| Node | `full` | Fastify + SQLite，轻量路线 |
| Go | `usable` | 标准库 net/http + database/sql；SQLite/Postgres |

规则：

- `delivery: backend+nginx` 时，Rust / Node / Go 均可；`static` 时后端为 `none`。

### 12.2 配置字段

```json
{
  "language": "rust",
  "maturity": "full",
  "host": "127.0.0.1",
  "port": 8080,
  "cors": { "enabled": true, "origins": [], "methods": [], "headers": [], "credentials": false, "maxAge": 600 },
  "env": [ { "key": "", "required": false, "default": "" } ],
  "middleware": { "requestId": true, "logging": true, "compression": true, "rateLimit": { "enabled": false, "rps": 20 }, "securityHeaders": true },
  "database": { "driver": "sqlite", "url": "sqlite://data/app.db" },
  "configFile": { "path": "deploy/backend/config.yaml", "override": false, "strict": true }
}
```

### 12.3 自定义配置文件：覆盖与校验

覆盖链（后者覆盖前者）：

```
平台默认值 < 生成配置 < 用户配置文件 < 环境变量 < 启动参数
```

- 用户文件默认 `deploy/backend/config.yaml`；`override: true` 时**整体替换**生成配置，而不是逐键合并（用户要求「整体覆盖」）。
- `strict: true`：未知键直接报错；`strict: false`：未知键警告并保留。
- 冲突检测（任一命中即阻断导出）：
  1. 后端端口与平台端口相同。
  2. `cors.credentials: true` 且 `origins` 含 `*`。
  3. `env` 出现重复 key，或必填项无默认值且未在用户文件/env 中提供。
  4. 数据库 URL 指向平台自己的 `data/` 目录。
  5. 用户文件声明的 `language` 与项目选择不一致。
- 校验结果分「错误 / 警告 / 提示」三级，带文件路径与行号（YAML 可定位时）。
- 提供「恢复默认配置」与「查看最终生效配置」（合并后、脱敏），便于排查。

---

## 13. nginx 与证书

### 13.1 配置模型（`NGINX_CONFIG_VERSION = 1`）

```json
{
  "enabled": true,
  "serverName": "example.com",
  "listen": { "http": 80, "https": 443 },
  "redirectHttp": true,
  "tls": {
    "cert": "certs/site.crt",
    "key": "certs/site.key",
    "protocols": ["TLSv1.2", "TLSv1.3"],
    "ciphers": "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256"
  },
  "proxy": { "upstream": "127.0.0.1:8080", "timeoutSeconds": 60, "websocket": false },
  "static": { "root": "web", "tryFiles": "$uri $uri/ =404" },
  "gzip": { "enabled": true, "minLength": 1024, "types": ["text/css", "application/javascript", "application/json", "image/svg+xml"] },
  "cache": { "assets": "1y", "assetsImmutable": true, "html": "no-cache" },
  "security": { "headers": { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "strict-origin-when-cross-origin" } },
  "clientMaxBodySize": "10m",
  "logs": { "access": "logs/access.log", "error": "logs/error.log" }
}
```

### 13.2 默认值逐项

| 项 | 默认 | 理由 | 可改 |
| --- | --- | --- | --- |
| `listen.http` / `listen.https` | 80 / 443 | 常规部署 | 是 |
| `redirectHttp` | `true` | 统一 HTTPS | 是 |
| TLS 协议 | TLSv1.2 + TLSv1.3 | 兼容与安全平衡 | 是 |
| `proxy.upstream` | `127.0.0.1:8080` | 与后端默认端口一致 | 是 |
| `proxy.timeoutSeconds` | 60 | 常规 API | 是 |
| `static.root` | `web` | 产物目录 | 是 |
| gzip | 开，≥1024 字节 | 省带宽不压小文件 | 是 |
| 静态资源缓存 | 1 年 + immutable（带 hash 文件） | 内容哈希已变即换 URL | 是 |
| HTML 缓存 | `no-cache` | 保证更新可见 | 是 |
| 安全响应头 | 三项基础头 | 低风险默认加固 | 是 |
| `clientMaxBodySize` | `10m` | 覆盖常规上传 | 是 |
| 访问日志 | `logs/access.log` | 便于排查 | 是 |

### 13.3 证书来源

| 来源 | 生成方式 | 适用范围 | 是否进 zip |
| --- | --- | --- | --- |
| 测试证书 | 平台生成自签（`selfsigned`），域名取 `serverName` 与 `127.0.0.1` | 本地/内网测试 | 否；zip 带 `gen-test-cert.sh`，部署时生成 |
| 导入自有 | 用户提供 cert + key | 正式环境 | 否；zip 只带路径配置与说明 |

校验：有效期 ≥ 30 天、域名匹配、链完整、私钥与证书配对；失败给 `LC_E_CERT_INVALID` 并定位字段。
启用 HTTPS 但证书缺失 → 导出仍可完成，`signing/deploy.tls.status = blocked` 并在 README 顶部标注。

### 13.4 nginx 校验

- 本机有 `nginx` → 执行 `nginx -t -c <临时配置>`；无 → 做结构校验（必填项、端口范围、路径存在、指令拼写白名单）。
- 用户改配置后保存到 `deploy/nginx/nginx.conf`，并记录「已自定义」；重新生成时提示「覆盖 / 保留」。

---

## 14. 产物完整性（第三方库捆绑）

### 14.1 规则

1. 构建时扫描编辑器实际加载的 `assets/` 与 `vendor/`（`index.html` 的 script/link + 运行时动态加载），收集第三方文件。
2. 每个库在产物内保留一份，路径 `vendor/editor/<name>/<file>`，附许可证与版本。
3. 生成 `THIRD-PARTY-NOTICES.md` 与 manifest `editorLibraries[]`。
4. 以下必须内联：小于 4 KB 且首屏必需的 CSS；运行时必需的小段初始化脚本。大库保持外链文件以便缓存。
5. 可裁剪：仅编辑器使用、导出站不用的库（如打包用的 JSZip）默认**不放进站点运行目录**，但放进 `vendor/editor/` 供用户在产物里复用编辑器能力；界面提供「不打包编辑器库」开关，默认开。

### 14.2 体积代价

| 项 | 估算 | 说明 |
| --- | --- | --- |
| 编辑器库捆绑 | +0.5–3 MB | 取决于库数量；JSZip 约 100 KB |
| 重复进 `vendor/` 与 `vendor/editor/` | 可能翻倍 | 同一库只保留一份，构建时去重 |
| 内联小 CSS | +10–60 KB | 减少请求数 |

界面上显示「产物体积 / 其中第三方库占比」，并在超过 50 MB 时提示裁剪。

---

## 15. 导出 zip 与 `artifact-manifest.json`（v4）

### 15.1 `web-static`

```
<artifact>.zip
├─ artifact-manifest.json
├─ README.md
├─ README.txt                # 纯文本运行说明：必须通过 http 访问
├─ THIRD-PARTY-NOTICES.md
├─ lowcode-project.json
├─ web/                      # 静态站（index.html、assets/、vendor/、data/）
├─ server/                   # 可选后端（rust/node/go）
├─ deploy/
│  ├─ nginx/nginx.conf
│  ├─ backend/config.yaml    # 若启用后端
│  └─ scripts/gen-test-cert.sh
├─ data/                     # 数据快照
└─ vendor/                   # 产物第三方依赖
```

### 15.2 `tauri-desktop`

```
<artifact>.zip
├─ artifact-manifest.json
├─ README.md
├─ THIRD-PARTY-NOTICES.md
├─ lowcode-project.json
├─ desktop/                  # Tauri v2 工程（src-tauri、配置、图标）
├─ web/                      # 前端产物
├─ server/                   # 可选 sidecar 后端
├─ deploy/                   # 可选（外置部署说明）
└─ vendor/
```

### 15.3 manifest

```json
{
  "formatVersion": 4,
  "artifactId": "site-20261108-1201",
  "createdAt": "2026-11-08T12:01:00.000Z",
  "platform": { "name": "lowcode", "version": "1.0.0", "contractsVersion": "2.0.0" },
  "project": { "id": "proj-7d1a", "name": "示例站点", "configSchemaVersion": 5, "projectSchemaVersion": 2, "storageLayoutVersion": 2 },
  "target": "web-static",
  "runtime": "static|node|rust|go|tauri-desktop",
  "backend": { "language": "none", "maturity": "n/a", "database": "none", "middleware": [] },
  "modules": [],
  "template": { "id": "docs", "version": 1 },
  "entry": "web/index.html",
  "files": [ { "path": "web/index.html", "size": 1834, "sha256": "…" } ],
  "editorLibraries": [ { "name": "jszip", "version": "3.10.1", "license": "MIT", "path": "vendor/editor/jszip/jszip.min.js", "sha256": "", "inlined": false } ],
  "bundledAssets": [ { "path": "web/assets/js/mermaid.min.js", "package": "mermaid@12.3.0", "license": "MIT", "bytes": 1048576, "sha256": "…" } ],
  "deploy": {
    "nginx": { "enabled": true, "path": "deploy/nginx/nginx.conf", "customized": false },
    "tls": { "enabled": true, "source": "generated", "privateKeyIncluded": false, "status": "configured|blocked" },
    "certs": { "domain": "example.com", "expiresAt": "", "fingerprint": "sha256:…" },
    "backend": { "configPath": "deploy/backend/config.yaml", "generatedPath": "deploy/backend/config.generated.yaml" }
  },
  "signing": {
    "status": "unsigned|signed|blocked",
    "android": { "status": "none", "certFingerprint": "" },
    "desktop": { "windows": { "status": "none" } }
  },
  "ownership": { "platform": [ "server/src/main.js" ], "user": [ "server/src/custom/handlers/items.js" ], "merged": [] },
  "checks": [ { "id": "offline-external", "status": "pass", "message": "" } ],
  "size": { "total": 0, "byCategory": {} },
  "warnings": [],
  "secrets": { "included": false, "note": "密钥与证书私钥不随产物分发" }
}
```

规则：

- `files` 稳定排序（按 path 字典序）；路径相对 zip 根；**不包含 `artifact-manifest.json` 自身**（无法自哈希），其余元文件与产物文件均在列。
- `checks` 至少：`offline-external`、`path-safety`、`secrets-scan`、`entry-exists`、`lockfile-present`、`vendor-sync`、`backend-config-valid`、`nginx-valid`、`cert-pair`、`template-integrity`。
- `ownership` 固定三组：`platform`（可被重新生成替换）、`user`（用户代码/配置，重新生成必须保留）、`merged`（平台与用户合并产物，重新生成需按合并接口重算）；路径相对 zip 根。
- `checks[]` 每项固定为 `{ id, status, message }`，`status` 取 `pass` / `fail` / `skip`；`skip` 表示该目标未启用对应能力（如未启用后端/nginx/TLS），不是“通过”。
- `secrets.included` 必须永远为 `false`；检测到违规即构建失败并 `LC_E_SECRET_LEAK`。
- `bundledAssets` 复用站点清单里的同名结构与 `CONDITIONAL_ASSETS` 表：`path`、`package`（`name@version`）、`license`、`bytes`、`sha256`；只有产物实际引用时才出现。
- `size.byCategory` 固定键：`meta`、`web`、`desktop`、`server`、`deploy`、`data`、`vendor`、`other`；`size.total` 为 `files` 各 `size` 之和。
- `README.md`、`THIRD-PARTY-NOTICES.md`、`lowcode-project.json` 由导出核心生成；后两者若调用方已提供则保留，不覆盖。
- `web-static` 额外生成根目录 `README.txt`（纯文本，双击可读），写清必须通过 http 访问、本地启动命令、nginx 部署方式与 Tauri 替代方案；`tauri-desktop` 不生成该文件。
- Web 页面在 `file://` 下会显示一条内联提示「这个包需要通过 http 访问」，避免双击时出现白屏或半残页面；提示只依赖内联样式与脚本，不引入产物内资源。正常 http 访问时不显示。
- `lowcode-project.json` 固定为 `{ format: "lowcode-project", formatVersion: 1, artifactId, target, project: { id, name, configSchemaVersion, projectSchemaVersion, storageLayoutVersion, config } }`；写入前剔除私钥、密码、密钥、访问令牌等字段，但保留主题设计令牌。

### 15.4 清单生成实现（F3 第①步）

- 唯一实现：`shared/export-bundle.js`（UMD，浏览器挂 `LC.ExportBundle`，Node 直接 `require`）。
- 浏览器导出与服务端导出都必须调用 `assemble(input)`，禁止任一侧自行拼装 `artifact-manifest.json`；服务端在第③步接入，第①步先以 Node 单测验证。
- `assemble` 只接收“已渲染好的文件 + 构建元信息”，不读存储、不跑渲染、不写 zip；资源复制在第②步、模板装配在第③步。
- 同输入两次组装，`manifest` 除调用方传入的 `createdAt` 外应逐字节一致；测试覆盖在 `tests/export-bundle.test.mjs`。

### 15.5 压缩与构建记录（F3 第④步）

- 唯一实现：`shared/export-minify.js`（UMD，浏览器挂 `LC.ExportMinify`，Node 直接 `require`）。
- **CSS / JS 默认压缩**；界面开关 `data-export-minify` 与 CLI `--no-minify` 可整体关闭。
- **HTML 压缩默认关闭**，独立开关 `data-export-minify-html` / CLI `--minify-html`。原因：30 页真实样本实测，HTML 压缩后源码少 1,230 字节，但 zip 反而大 1,249 字节——页面文本早被 DEFLATE 吃掉，压缩只增加格式化开销。界面必须写明“压缩后 zip 更大”，不能默认推荐一个负收益选项。
- HTML 压缩开启时会递归压内联 `<style>` 与 `<script>`（跳过 `src`、`module` 与非 JS 类型；压缩后 `new Function` 解析失败则保留原块）。
- 压缩后逐文件做等价校验：
  - HTML：标签闭合、`<script>` / `<style>` / `id` 数量不变、DOCTYPE 仍在；
  - CSS：花括号与引号闭合、规则块数量不变；
  - JS：`new Function` 语法解析通过、`"use strict"` 与 `function` 数量不变。
- 任一文件校验失败 → 该文件恢复未压缩内容，记 `LC_W_MINIFY_FALLBACK`，构建继续。
- 每个压缩文件保留**一行以内**的最短头部注释 `产物名|构建时间|版本`（HTML 默认不压缩，因此不加）；`/*!`、`@license`、`Copyright`、许可证字样注释不删除。
- 跳过：`vendor/`、`*.min.js|css`、以及 `manifest.bundledAssets` 里列出的第三方运行时。
- 构建记录 `minify` 记录是否压缩、HTML 是否参与、逐文件压缩前后体积与节省量，并用 `byKind` 汇总 HTML/CSS/JS；小文件加注释后总体积可能变大，`saved` 可为负。
- 构建记录另含 `sizing.lines`：把「zip 多大、解压后多大、其中图表库占多少」写成可直接展示的句子，不用用户自己读百分比。
- 用户实例级覆盖代码由渲染层 `mergeInstanceOverrides` 合并后进入 `web/`，压缩只作用于合并结果，不读取编辑器内部字段。

### 15.6 服务端导出入口（F3 第⑤步）

- 实现：`server/src/export/pipeline.js` 的 `exportSite()`；`shared/export-*.js` 提供同一套清单、资源、模板与压缩逻辑。
- 顺序：读站点 → `src/render/node.cjs` 渲染（注册内置组件）→ 生成 `web/` 页面与站点 CSS/JS → 条件资源 → 模板装配 → 资源拷贝/内联 → 压缩 → `assemble` → zip → `builds/<buildId>/`。
- 渲染失败按 `LC_W_RENDER` 记警告，不静默产空页面；检查失败不生成 zip。
- 构建并发：构建期间持有 `.lowcode/locks/builds/site.lock`，第二个导出返回 `423`，不并发写产物。
- 导出前语法检查（`user-code-syntax`）：Node 用户代码逐文件 `node --check` 解析（按文件内容判断 ESM/CJS）；Rust 后端在临时副本上 `cargo check --offline`，依赖未缓存时标记 `skip` 而不是误报失败。失败列出 `文件：错误` 并阻断产物。
- 组件脚本检查（`component-scripts`）：保存与预览扫描模板内联 `<script>`（跳过 `src` / `module` / 数据脚本，`{{field}}` 按 `null` 占位）；预览 iframe 通过 `postMessage` 上报首屏 `error` / `unhandledrejection` 与组件 JS 异常，父页显示组件级「脚本错误」标记并写控制台。导出对页面实际引用的组件再查一次，失败写入 `manifest.warnings[LC_W_COMPONENT_SCRIPT]`（含 `componentId`）、`checks` 的 `component-scripts=fail` 与构建日志并阻断产物；未被引用的组件只记警告。
- 预览 / 画布 iframe 固定 `sandbox="allow-scripts allow-forms …"`，不恢复 `allow-same-origin`；拖拽、自动滚动与表单控件只需 `allow-scripts` / `allow-forms`，父子数据一律走 `postMessage`。
- CLI：`npm run export -- <siteId> [--target=web-static] [--no-minify] [--minify-html] [--version=v1.0.0]`；输出直接打印 `record.sizing.lines`（如「zip 1.7 MB，解压后 7.0 MB」「其中 5.5 MB 是图表库 mermaid」）。

### 15.7 代码覆盖（页面 / 实例 / 后端用户区）

覆盖分三层，存储位置固定，重新生成时都不会被清掉：

| 层级 | 存储 | 作用范围 | 生效顺序 |
| --- | --- | --- | --- |
| 页面级 HTML / CSS / JS | 页面 JSON `page.overrides = { html, css, js }` | 当前页面 | 页面 CSS 作用域到 `[data-lc-page="<id>"]`，JS 随页面脚本执行 |
| 页面级接口覆盖 | 页面 JSON `page.apiOverrides[]` | 当前页面（浏览器端 fetch 拦截） | 先于实例与站点后端，见下方优先级 |
| 实例级 HTML / CSS / JS / 数据 | 页面 JSON `block.overrides = { html, css, js, data }` | 单个组件实例 | 只作用于该实例 |
| 后端用户区代码 | `data/sites/<siteId>/backend/<language>/<server 相对路径>` | 整站、按导出语言 | 导出时覆盖模板同名用户区文件 |

- 页面级覆盖三字段与实例覆盖共用 `src/render/overrides.js` 的 `checkHtml` / `checkCss` / `checkJs`；渲染时坏字段逐项降级并记 `OVERRIDE_SOURCE_INVALID`，不阻断整页。
- 实例数据覆盖 `data = { mode: "inherit|custom", url, method, transform }`：`custom` 时渲染层给实例加 `data-lc-data-mode/url/method`，并注入拉取脚本；结果派发 `lc:instance-data`，`data-lc-data-state` 取值 `loading|ready|error`，`transform(payload, root)` 的返回值作为实例数据。
- 页面级接口覆盖每条为 `{ id, method, path, code, note, updatedAt }`；`code` 是拦截器函数体，入参 `request`（`input/init/url/method/pathname`）与 `context`（`page/entry/originalFetch`），返回值当作 `Response`。`path` 允许末尾 `*` 通配。
- **优先级（同一 METHOD + 路径）**：页面级接口覆盖 > 站点后端用户区实现 > 模板默认实现。同一页面内出现多条同 METHOD + 路径时，`updatedAt` 最新的一条生效，其余标记「被覆盖」；Builder 属性面板与页面渲染都会写出最终生效段数与被覆盖段数（`data-lc-api-overrides` / `data-lc-api-shadowed`）。
- 后端用户区只允许写白名单前缀：Node `src/custom/`、Rust `src/custom/`、Go `internal/custom/`，以及各自的 `migrations/custom/`；生成区（`generated/`、`main.*`、manifest）一律拒绝。
- 导出时在最终文件集合上覆盖 `server/<相对路径>`，并写入 `ownership.user`；压缩不处理后端用户区文件。
- 检查接口 `POST /api/sites/:siteId/code/check` 入参 `{ language, code, run }`，返回 `{ ok, language, checks[] }`：HTML / CSS / JS 复用渲染层检查器，JS 额外在 `vm` 内以假 `root`/`fetch` 做最小运行（禁止 `require`、`process`）；Rust / Go 只做括号/引号/注释结构检查并明确标记「未编译」，真实编译由导出阶段拦截。

---

## 16. Builder HTTP API（存储与构建）

鉴权不变：仅 `127.0.0.1`，一次性 token + Origin 校验；`/api/health` 免 token。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活探测 |
| GET | `/api/runtime` | 版本、模式、端口、磁盘状态、工具链概览 |
| GET | `/api/sites` | 站点列表（读 site.json 汇总） |
| POST | `/api/sites` | 新建站点（写 site.json + 默认 project.json） |
| GET | `/api/sites/:id` | 站点详情 |
| PATCH | `/api/sites/:id` | 改名、改 slug |
| DELETE | `/api/sites/:id` | 移入回收站（不直接删） |
| GET | `/api/sites/:id/tree` | 文件树（页面/组件/主题/数据/构建） |
| GET | `/api/sites/:id/file?path=` | 读单文件（含 rev/hash） |
| PUT | `/api/sites/:id/file?path=` | 写单文件（`expectedRev` 可选） |
| DELETE | `/api/sites/:id/file?path=` | 删单文件（先备份） |
| POST | `/api/sites/:id/batch` | 批量事务写入 |
| GET | `/api/sites/:id/versions` | 版本列表 |
| POST | `/api/sites/:id/versions/:rev/restore` | 回滚（先备份） |
| POST | `/api/sites/:id/export` | 发起构建（body: `target`、`minify`、`version`） |
| GET | `/api/sites/:id/builds` | 构建记录 |
| GET | `/api/sites/:id/builds/:buildId/artifact.zip` | 下载产物 zip |
| POST | `/api/sites/:id/backup` | 手动备份 |
| GET | `/api/sites/:id/usage` | 五类占用统计 |
| GET | `/api/sites/:id/code/backend?language=` | 列出该语言模板用户区文件与站点已覆盖内容 |
| PUT | `/api/sites/:id/code/backend` | 保存用户区覆盖（body: `language`、`path`、`code`） |
| DELETE | `/api/sites/:id/code/backend` | 删除站点覆盖，回到模板默认（body: `language`、`path`） |
| POST | `/api/sites/:id/code/check` | 语法检查 + 最小运行（body: `language`、`code`、`run`） |

响应统一：`{ ok, data }` / `{ ok:false, error:{ code, message, detail, field } }`。
`423` 站点锁、`409` 版本冲突或构建占用、`503` 磁盘只读/配置损坏。

---

## 17. 启动顺序与失败表现

### 17.1 启动顺序

1. 入口解析平台根 → 读 `platform.config.json`。
2. 校验配置（结构、端口范围、路径可写）。
3. 创建/校验数据目录与站点根。
4. 恢复事务与清理临时文件。
5. 校验站点 `site.json` / `project.json`（仅校验不加载全量）。
6. 启动 HTTP，绑定 `127.0.0.1`。
7. 打开浏览器（可配置关闭）。

> 一键启动：`start.cmd`（Windows 双击）或 `npm start` → `scripts/start.mjs`。脚本负责 Node 版本检查、依赖缺失时自动 `npm install`、端口回退、打印访问地址、打开浏览器，并把失败原因翻译成人话；服务本体仍只读 `platform.config.json`。

### 17.2 失败矩阵

| 情况 | 表现 | 能否继续 |
| --- | --- | --- |
| 后端未启动 | 浏览器无法打开编辑器；打开平台根的 `diagnostics.html`，显示「后端未运行」、启动命令、端口 | 否；诊断页可反复重试 |
| 配置缺失/JSON 损坏 | 进程打印字段路径与期望类型，退出码 2；`diagnostics.html` 读 `logs/boot-error.json` 展示同信息 | 否；按提示修复 |
| 磁盘不可写 | 服务可启动但进入只读模式：`/api/runtime` 返回 `readOnly: true`；编辑器顶部常驻只读横幅，保存按钮禁用并说明原因 | 只读浏览 |
| 端口被占用 | **直接运行 `server/index.js`**：明确报错并退出，不自动换端口；**通过 `start.cmd` / `npm start`**：自动向上找一个可用端口（最多 20 次），打印「原端口被占用，改用 N」，并写 `logs/start-port.json` | 是（脚本路径） |
| 站点文件损坏 | 该站点 `status: needs-repair`；只允许只读浏览与导出，写入禁用；提供从备份恢复 | 单站点受限 |
| 工具链缺失（Rust/Go/Node/Android SDK） | 只在构建预检提示，不影响编辑与静态导出 | 是 |

### 17.3 编辑器兜底

- `index.html` 带启动看门狗：`/api/runtime` 连续 3 次失败 → 全屏错误卡（原因、重试、打开诊断页），不出现白屏。
- `<noscript>` 提示需要启用 JS。
- 所有静态资源本地相对路径，缺失时显示明确 404 资源名，而不是整页空白。

---

## 18. 站点搬家与旧版兼容

### 18.0 站点搬家脚本（`migrate.cmd` / `npm run migrate`）

| 项 | 约定 |
| --- | --- |
| 入口 | `migrate.cmd <站点目录>`；`npm run migrate -- --from <站点目录>` |
| 用途 | 换机器、换数据目录时搬运同版本站点；只导入 v2 站点目录（`site.json` + `project.json` + 各内容目录） |
| 流程 | 扫描 → 打印清单 → 询问确认 → 备份 → 写入 → 条数与关键字段校验 → 摘要 |
| 参数 | `--dry-run` 只扫描不写；`--force` 覆盖同源冲突；`--yes` 跳过交互确认 |
| 幂等 | 目标 `site.json → migration.fingerprint`；同源同指纹重复执行 → 跳过并提示已导入 |
| 失败 | 指出站点名、文件、字段；整体回滚本次写入；已完成的站点保留 |
| 安全 | 不打印配置中的密钥/密码；证书目录不随站点导入 |

### 18.1 旧版兼容（已取消）

用户旧平台没有产生任何站点数据，兼容链路没有实际使用场景，只会让新代码绕路，因此整体取消。

| 项 | 结论 | 说明 |
| --- | --- | --- |
| IndexedDB → 文件存储迁移 | 已取消 | `server/src/routes/migrate.js`、`POST /api/migrate/idb`、`GET /api/migrate/:migrationId` 已删除 |
| 旧版导出 zip / `manifest.json`（`format: "lowcode-site"`）导入 | 已取消 | `server/src/legacy.js` 与 `scripts/migrate.mjs` 的旧包解析分支已删除 |
| 配置 v4 → v5、项目 v1 → v2、manifest v3 → v4 转换 | 已取消 | 没有旧站点需要转换；当前只接受同版本站点目录 |
| 旧静态导出 zip 导入 | 已取消 | 不再作为站点来源；搬家时直接复制同版本站点目录 |

### 18.2 基础区块

基础区块（`heading` / `paragraph` / `cards` / `note` / `image` / `button` / `code` / `articleList` 等）在渲染引擎里没有内置实现，由 `server/src/export/base-blocks.js` 通过注册表公开接口注册。导出管线与 Builder 属性面板共用同一份 schema；页面出现未注册区块时，导出清单会以渲染错误提示，而不是静默空白。

---

## 19. 限额、错误码、命名

限额沿用 v1，并新增：

| 项 | 限额 |
| --- | --- |
| 单站点源文件总量 | 1 GB 软限 |
| 单站点构建产物 | 5 GB，超出按第 4.5 节清理 |
| 单站点版本历史 | 100 条 / 30 天 |
| 单站点备份 | 10 份 / 30 天 / 2 GB |
| 用户配置文件 | 512 KB |
| 编辑器库捆绑 | 默认开启；产物 > 50 MB 提示裁剪 |

新增错误码：

| 码 | 场景 |
| --- | --- |
| `LC_E_STORAGE_READONLY` | 磁盘不可写 |
| `LC_E_STORAGE_LOCKED` | 站点被另一进程锁定 |
| `LC_E_TXN_RECOVER` | 事务恢复失败 |
| `LC_E_FILE_CORRUPT` | JSON 解析失败 |
| `LC_E_CONFIG_INVALID` | 平台/站点配置不合法 |
| `LC_E_CONFIG_CONFLICT` | 自定义配置与平台冲突 |
| `LC_E_TARGET_INVALID` | 导出目标或字段不合法 |
| `LC_E_BACKEND_TIER` | 使用超出该语言成熟度的能力 |
| `LC_E_NGINX_INVALID` | nginx 配置校验失败 |
| `LC_E_CERT_INVALID` | 证书/私钥无效或不匹配 |
| `LC_E_BUILD_BUSY` | 同站点已有构建在跑 |

命名规则沿用 v1；新增：构建 id `b-<yyyymmdd>-<hhmm>-<4 hex>`。

---

## 20. 本机数据库安全红线（强制）

本机已存在的 MySQL / PostgreSQL / Redis 等实例可能承载用户真实业务数据，**一律不准连接、不准读写、不准建库建表、不准启停、不准改配置**。

- 需要验证数据库功能时，只允许自建完全隔离的一次性实例：独立端口（不得使用 3306 / 3307 / 5432 / 6379 等默认端口）、独立临时数据目录、独立空库、一次性密码、只监听 `127.0.0.1`；用完立即停止并删除。
- 做不到完全隔离就不做，并在结果中明确写「本机无法安全验证」，不得用「只读」「试一下」绕过。
- 本项目脚本、测试、e2e、诊断页、模板与示例配置不得把默认端口当作可试连目标；示例使用占位主机或非默认端口，并标注仅用于隔离实例。
- 唯一例外：用户在本轮明确提供隔离实例的连接信息并要求连接。该信息不得写入仓库、模板或文档。
- 生成的站点后端默认使用 SQLite 与 memory 缓存，不自动连接外部数据库。

---

## 21. 后端实例级代码覆盖（页面级 / 代码节点级）

用户区文件（永不随生成改写）：

- 页面级（Node 目标）：`data/sites/<siteId>/backend/node/src/custom/flows/<flowId>.js`。
- 代码节点级：`data/sites/<siteId>/backend/node/src/custom/handlers/<flowId>.<nodeId>.js`。

生成区行为：

- 页面级文件存在时，生成区只 `import { run as runPageOverride }` 并在入口处理器里调用；入口路由、参数校验、CORS/鉴权/限流/日志等中间件仍由生成区提供。
- 页面级 `run(ctx)` 返回 `{ status?, headers?, body }` 或直接返回 body；返回 `undefined` 时视为用户已自行处理响应。
- 文件不存在（或点「恢复原样」删除后）生成区回到默认 IR 执行，`manifest.pageOverride` 为 `false`。
- 生成区只写 `src/generated/**`（Node）等生成目录，构建时把用户区文件覆盖到构建副本；站点源码用户区不出现生成目录。
- 页面级覆盖当前只对 Node 目标开放；Rust/Go 在界面明确标注「未开放」，不静默生成半成品。

界面标记：

- 页面级卡片、代码节点树行、节点属性面板都显示「已覆盖 / 跟随生成」，并提供「恢复原样」；恢复即删除用户区文件。
- 节点库与属性面板逐项显示 Node / Go / Rust 支持状态（已实现 / 设计支持未实现 / 不支持）；切到不支持的目标时，检查结果列出具体积木及可替换的同类积木。
