# 低代码平台 · 模块设计与拆分（v2，存储优先）

> 本文件只定义模块边界、文件归属、依赖顺序与验收标准，不含实现代码，也不执行目录搬移。
>
> 本轮为地基级改动：存储从 IndexedDB 改为服务端文件系统，导出目标拆为 Web / Tauri，后端扩到三语言并支持 nginx。相关模块**重排**，不是在原表上追加。
>
> 关联：架构背景见 [UPGRADE-PLAN.md](file:///c:/project/docs/lowcode/UPGRADE-PLAN.md)，数据与接口见 [CONTRACTS-v1.md](file:///c:/project/docs/lowcode/CONTRACTS-v1.md)（内容版本 2.0.0），决策见 [design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md)，依赖见 [DEPENDENCIES.md](file:///c:/project/docs/lowcode/DEPENDENCIES.md)。

---

## 0. 前置约束

1. 平台必须由 Node 服务启动；编辑器由服务端提供，**不再支持双击打开**。
2. 主存储是服务端文件系统；IndexedDB 只允许作为可选的未保存草稿缓存，默认关闭，不得成为关键路径。
3. 导出目标由用户选择：`web-static` 或 `tauri-desktop`，两套默认模板全部字段可改。
4. 后端可为 `none` / `rust` / `node` / `go`；Rust 为默认。
5. 无 CDN、依赖锁死、产物离线可运行；私钥与证书私钥不进导出包。
6. 本轮只写设计稿：不写实现、不搬目录。

---

## 1. 架构

```
┌─────────────────────────────────────────────┐
│ 浏览器编辑器（静态文件，由本地服务提供）      │
│ 画布 / 属性面板 / 视图 / 注册表               │
└───────────────┬─────────────────────────────┘
                │ HTTP 127.0.0.1 + 一次性 token
┌───────────────▼─────────────────────────────┐
│ 本地 Node 服务（Builder + Core）             │
│  · 启动 / 配置 / 诊断                        │
│  · StorageAdapter（文件系统）                │
│  · 站点仓库 / 版本 / 备份 / 构建记录          │
│  · 渲染与导出 / 生成器 / nginx / 证书         │
└───────────────┬─────────────────────────────┘
                │ 原子写入 <数据根>/sites/<siteId>/
┌───────────────▼─────────────────────────────┐
│ 磁盘：站点目录（可直接 git 管理）             │
└───────────────┬─────────────────────────────┘
                │ 构建
┌───────────────▼─────────────────────────────┐
│ 产物：单 zip                                 │
│  web-static（可选后端 + nginx）               │
│  tauri-desktop（可选 sidecar）               │
└─────────────────────────────────────────────┘
```

与文档站仍然零共享：不引用文档站任何文件、端口、脚本与样式。

---

## 2. 启动策略

| 阶段 | 行为 | 失败表现 |
| --- | --- | --- |
| 解析配置 | 读 `platform.config.json` | 字段路径 + 期望类型；退出码 2，写 `logs/boot-error.json` |
| 校验路径 | 创建/检查数据根、站点根、日志、临时区 | 不可写 → 只读模式，`/api/runtime.readOnly = true` |
| 恢复 | 扫描 `.lowcode/txn`、清理过期 temp、校验站点元信息 | 单站点标 `needs-repair`，其余站点不受影响 |
| 监听 | 绑定 `127.0.0.1:<port>` | 端口占用 → 明确报错，不自动换端口 |
| 打开浏览器 | 可配置 | 失败只提示 URL，不阻断服务 |

- 后端未启动时，用户打开 `diagnostics.html` 自检页：探测 `/api/health`、显示启动命令、端口、最近一次启动错误。
- 编辑器内置看门狗：连续 3 次拿不到 `/api/runtime` → 全屏错误卡（原因 / 重试 / 诊断页），不白屏。
- 磁盘只读：编辑器顶部常驻只读横幅，保存按钮禁用并解释原因。

---

## 3. 目录（详见 CONTRACTS 第 3 节）

```
<平台根>/  package.json · platform.config.json · index.html · diagnostics.html
           assets/ · vendor/ · server/ · src/ · shared/ · scripts/ · tests/ · docs/
<数据根>/sites/<siteId>/  site.json · project.json · pages/ · articles/ · components/
                          themes/ · data/ · assets/ · certs/ · deploy/ · builds/
                          versions/ · backups/ · .lowcode/
```

- 站点目录只含站点自己的源文件与派生目录，可直接 `git init`。
- 路径规则：相对平台根 / 相对站点根；禁止盘符、绝对路径、越界 `..`。

---

## 4. 模块总表

### 4.1 一览

| ID | 模块 | 职责 | 依赖 | 工作量 | 批次 |
| --- | --- | --- | --- | --- | --- |
| F0 | 平台外壳与服务启动 | 配置、启动、诊断页、视图/样式注册、编辑器壳 | — | M | 串行 0 |
| ST1 | 存储内核 | StorageAdapter、原子写、站点锁、事务、恢复、rev | F0 | XL | 串行 1 |
| F1 | Schema 与校验 | 契约落地、config v5、迁移函数、错误码 | F0, ST1（接口） | L | 串行 2 |
| ST2 | 站点仓库 | 布局、备份、版本、占用统计、构建记录存储 | ST1, F1 | L | 串行 3 |
| B1a | Builder API | 站点/文件/批量/构建/迁移/密钥路由 | F0, ST1, F1, ST2 | L | 串行 4 |
| F2 | 渲染核心 | 区块/页面/外壳/自由/Markdown 渲染 | F1 | L | 串行 5 |
| F3 | 导出核心 | 产物组装、zip、manifest v4、离线检查 | F2, ST2 | L | 串行 6 |
| M1 | IDB 迁移 | 浏览器读取 → 上传 → 落盘 → 校验 → 只读保留 | B1a, F1, ST2 | M | 并行 1 |
| D1 | 数据层 | 数据源、集合、文件解析、字段映射 | F1, F2, ST2 | L | 并行 1 |
| C1 | 图标/统计/图表 | 内置 SVG、统计形态、四类纯 SVG 图表 | F2 | M | 并行 1 |
| T1 | 主题 | token、亮暗派生、主题编辑与导出变量 | F1, F2 | M | 并行 1 |
| E1 | 编辑器效率 | 历史、结构树、拖拽、属性面板、快捷键 | F1, F2, B1a | L | 并行 1 |
| SH1 | 外壳组件化 | 导航/页脚/面包屑、路由模型、构建时高亮 | F2, F3 | L | 并行 1 |
| PT1 | 产物完整性 | 编辑器库扫描、捆绑、去重、许可证清单 | F3 | M | 并行 1 |
| C2 | 表单与表格 | 校验、表格、分页排序、提交运行时 | F2, E1 | L | 并行 2 |
| L1 | 逻辑编排 | 动作、条件显示、联动 | F2, E1 | M | 并行 2 |
| E2 | 自由布局交互 | Pointer 拖拽、吸附、层级、窄屏降级 | F2, E1 | L | 并行 2 |
| B2 | 构建诊断 | 预检、日志、产物 diff、失败恢复 | B1a, F3 | M | 并行 2 |
| G1 | 后端生成器 | Rust / Node / Go 三档模板与配置 | B1a, F3 | XL | 并行 2（Rust/Node）→ 并行 3（Go） |
| N1 | nginx 与证书 | 推荐配置生成、证书生成/导入、校验 | F3 | L | 并行 2 |
| CL1 | 组件库 | 注册表合并、搜索筛选标签、单组件 I/O | F1, ST2 | L | 并行 2 |
| S1 | Tauri 与签名 | 桌面工程、默认配置、签名、更新、Android 目标 | F3, B1a | XL | 并行 3 |
| T2 | 内置模板与认证中心 | docs/landing/dashboard + 认证中心 Rust 预设 | F2, F3, G1 | L | 并行 3 |
| TL1 | 模板库 | 页面/整站模板、预览、套用、冲突 | CL1, ST2 | L | 并行 3 |
| U1 | 可用性 | 反馈、空态、错误、确认、无障碍、假按钮治理 | 各模块 | M | 并行 3 |
| I1 | 集成验收 | 契约测试、E2E、产物冒烟、迁移回归 | 全部 | L | 批次 4 |

工作量口径：S ≤ 0.5 天，M ≈ 1–2 天，L ≈ 3–5 天，XL ≈ 1–2 周（单人估算，仅用于排期）。

### 4.2 文件归属（独占，禁止跨界）

| ID | 独占文件 / 目录 |
| --- | --- |
| F0 | `package.json`、`package-lock.json`、`platform.config.json`、`index.html`、`diagnostics.html`、`assets/app.js`、`assets/css/base.css`、`server/index.js`、`server/src/config.js`、`server/src/bootstrap.js`、`server/src/http.js`、`server/src/routes/runtime.js`、`scripts/start.mjs`、`scripts/doctor.mjs`、`scripts/vendor-sync.mjs`、`start.cmd` |
| ST1 | `src/storage/types.js`、`src/storage/adapter.js`、`src/storage/fs-adapter.js`、`src/storage/atomic.js`、`src/storage/locks.js`、`src/storage/txn.js`、`src/storage/recovery.js`、`src/storage/rev.js`、`src/storage/index.js` |
| F1 | `shared/schema.js`、`shared/validate.js`、`shared/config-v5.js` |
| ST2 | `builder/src/sites/repository.js`、`builder/src/sites/layout.js`、`builder/src/sites/backups.js`、`builder/src/sites/versions.js`、`builder/src/sites/usage.js`、`builder/src/sites/records.js` |
| B1a | `builder/src/routes/sites.js`、`builder/src/routes/files.js`、`builder/src/routes/batch.js`、`builder/src/routes/builds.js`、`builder/src/routes/runtime.js`、`builder/src/secrets.js` |
| F2 | `assets/render/registry.js`、`assets/render/blocks.js`、`assets/render/pages.js`、`assets/render/free.js`、`assets/render/shell.js`、`assets/render/markdown.js` |
| F3 | `shared/export-bundle.js`、`builder/src/export/zip.js`、`builder/src/export/manifest.js`、`builder/src/export/offline.js`、`builder/src/export/targets.js` |
| M1 | 已取消（旧版兼容）：原 `builder/src/migrate/idb.js`、`shared/import-legacy.js`、`assets/views/migrate.js`、`assets/css/migrate.css` 不再实现 |
| D1 | `assets/data/**`、`assets/views/data.js`、`assets/css/data.css`、`shared/data-spec.js` |
| C1 | `assets/blocks/icon.js`、`assets/blocks/stat.js`、`assets/blocks/chart.js`、`assets/icons/registry.js`、`assets/charts/svg.js`、`assets/css/charts.css` |
| T1 | `assets/theme/**`、`assets/views/theme.js`、`assets/css/theme.css` |
| E1 | `assets/editor/history.js`、`assets/editor/dnd.js`、`assets/editor/tree.js`、`assets/editor/inspector.js`、`assets/editor/shortcuts.js`、`assets/views/editor.js`、`assets/css/editor.css` |
| SH1 | `assets/blocks/shell-nav.js`、`assets/blocks/shell-footer.js`、`assets/blocks/breadcrumb.js`、`assets/routes/model.js`、`assets/views/variables.js`、`assets/css/shell.css` |
| PT1 | `builder/src/package/editor-libs.js`、`builder/src/package/notices.js`、`shared/lib-manifest.js` |
| C2 | `assets/blocks/form.js`、`assets/blocks/table.js`、`assets/runtime/form-runtime.js`、`shared/form-spec.js`、`assets/css/form.css` |
| L1 | `assets/logic/actions.js`、`assets/logic/conditions.js`、`assets/runtime/actions.js`、`assets/views/logic.js`、`assets/css/logic.css` |
| E2 | `assets/editor/free-drag.js`、`assets/editor/snapping.js`、`assets/views/layout-panel.js`、`assets/css/free.css` |
| B2 | `builder/src/preflight.js`、`builder/src/build-log.js`、`builder/src/diff.js`、`assets/views/builds.js`、`assets/css/builds.css` |
| G1 | `builder/src/generators/rust/**`、`builder/src/generators/node/**`、`builder/src/generators/go/**`、`builder/src/generators/shared/**` |
| N1 | `builder/src/deploy/nginx.js`、`builder/src/deploy/certs.js`、`builder/src/deploy/validate.js`、`assets/views/deploy.js`、`assets/css/deploy.css` |
| CL1 | `assets/components/registry.js`、`assets/components/io.js`、`assets/views/library.js`、`assets/css/library.css` |
| S1 | `builder/src/generators/tauri/**`、`builder/src/signing/**`、`assets/views/release.js`、`assets/views/platform-status.js`、`assets/css/release.css` |
| T2 | `assets/templates/docs/**`、`assets/templates/landing/**`、`assets/templates/dashboard/**`、`assets/templates/auth-center/**`、`builder/src/generators/rust/presets/auth-center/**` |
| TL1 | `assets/templates/registry.js`、`assets/templates/io.js`、`assets/views/templates.js`、`assets/css/templates.css` |
| U1 | `assets/ui/**`、`assets/css/ui.css` |
| I1 | `tests/**` |

规则：

- 不得修改他人独占文件；需要改契约先改 `CONTRACTS-v1.md`（内容 v2）。
- `assets/app.js`、`index.html`、`base.css` 归 F0；其他模块只通过注册 API 挂载。
- 模块样式各自一个 CSS 文件，注册时 `LC.styles()` 注入，不改 `index.html` 的 link 列表。
- G1 的四个语言子目录互相独立，可分别并行。

---

## 5. 串行地基（详细）

### 5.1 F0 平台外壳与服务启动

- **输入**：旧 `index.html` / `app.js` 可用部分；`platform.config.json`。
- **输出**：`npm start` 启动服务；视图注册 `LC.Views.register`；样式注册 `LC.styles`；`diagnostics.html`；启动看门狗。
- **验收**：
  1. 配置端口改动只改 JSON 即生效。
  2. 工程整体改名/移位后仍可启动。
  3. 后端未起时打开诊断页有明确原因与启动命令。
  4. 端口占用、配置损坏、磁盘只读三种情况均不白屏。

### 5.2 ST1 存储内核

- **输入**：CONTRACTS 第 2–4 节。
- **输出**：`StorageAdapter` 接口 + Fs 实现、原子写、站点锁、事务清单、启动恢复、rev 与 hash。
- **验收**：
  1. 写入被强制中断（kill 进程）后重启，文件要么是旧内容要么是新内容，无半截 JSON。
  2. 两个进程同时写同一站点，后者得到 `423`，不产生脏写。
  3. 事务中途失败全部回滚，`versions` 与 `rev` 不前进。
  4. 陈旧锁 60s 后可回收，回收有日志。
  5. 越界路径、盘符路径一律拒绝。

### 5.3 F1 Schema 与校验

- **输入**：CONTRACTS 全部 schema。
- **输出**：版本常量、config v5 规范化、错误码、迁移函数（v4→v5、project v1→v2、manifest v3→v4）。
- **验收**：
  1. 每种非法输入有稳定错误码与字段路径。
  2. 旧配置迁移后视觉与内容不变，仅存储结构变化。
  3. 校验可在 Node 与浏览器共用（UMD）。

### 5.4 ST2 站点仓库

- **输入**：ST1、F1。
- **输出**：站点创建/列举/删除（回收站）、布局解析、备份、版本 diff/快照、占用统计、构建记录写入。
- **验收**：
  1. 新建站点生成完整最小目录，`git init` 后 `git status` 只看到源文件。
  2. 删除页面/套用模板前自动备份，可从备份单文件恢复。
  3. 版本保留策略生效：超 100 条或 30 天自动裁剪，回滚仍可用。
  4. 占用统计五类（源 / 构建 / 版本 / 备份 / 缓存）数值与磁盘一致。

### 5.5 B1a Builder API

- **输入**：ST1/ST2/F1。
- **输出**：站点、文件、批量、构建、迁移、运行状态路由；token 与 Origin 校验；密钥存储。
- **验收**：
  1. 缺失 token 或非本机来源的 `/api/*` 返回 403。
  2. 单文件写支持 `expectedRev`，冲突返回 409 且不覆盖。
  3. 批量写走事务，失败无可部分写入。
  4. `/api/runtime` 暴露磁盘只读、工具链状态，但不泄漏密钥路径。
  5. 日志与响应中检索不到密钥、密码、私钥。

### 5.6 F2 渲染核心

- 沿用 v1 设计：注册表、纯函数、自由渲染、三种上下文一致。
- **新增验收**：渲染不读存储、不发请求；导出上下文的 `nonce` 用于内联脚本 CSP 兼容。

### 5.7 F3 导出核心

- **输入**：F2、ST2、目标配置。
- **输出**：`buildBundle(project, target, options)`、zip 写入、manifest v4、离线检查、target 模板选择。
- **验收**：
  1. `web-static` 与 `tauri-desktop` 各出一个可打开/可构建的 zip。
  2. 产物断网无外链、无 404。
  3. zip 不含密钥、证书私钥、临时文件、绝对路径。
  4. 同输入两次构建 manifest 除时间戳外一致。
  5. 构建失败清理临时目录，错误含文件与原因。

---

## 6. 并行批次

### 批次 1

| 模块 | 关键交付 | 验收 |
| --- | --- | --- |
| M1 | IDB → 文件迁移入口与进度重试 | 条数一致；失败可重试；旧数据只读保留 |
| D1 | 五类数据源 + 集合 + 文件解析 | 各解析通；超限提示；导出快照稳定 |
| C1 | 图标/统计/图表 | 断网可见；无障碍标签；窄屏不溢出 |
| T1 | 主题引擎 | 亮暗即时；全部主题进导出 |
| E1 | 编辑器交互基座 | 撤销 50 步；拖拽准确；面板不丢焦点 |
| SH1 | 外壳组件 + 路由高亮 | 每页正确高亮；面包屑正确 |
| PT1 | 编辑器库捆绑与许可 | 去重；体积统计；可关闭 |

### 批次 2

| 模块 | 关键交付 | 验收 |
| --- | --- | --- |
| C2 | 表单/表格/分页/校验 | 导出站可提交；排序分页可用 |
| L1 | 动作与条件 | 预览与导出行为一致 |
| E2 | 自由布局交互 | 拖拽流畅；窄屏降级；可撤销 |
| B2 | 预检/日志/diff | 预检覆盖端口/路径/工具链/证书；日志脱敏 |
| G1（Rust/Node） | 两档后端生成器 | `cargo check` / `npm start` 通过；CRUD 通 |
| N1 | nginx 配置 + 证书 | 生成可读；测试证书可生成；导入校验通过 |
| CL1 | 组件库 | 搜索筛选组合可用；CSS/JS 隔离 |

### 批次 3

| 模块 | 关键交付 | 验收 |
| --- | --- | --- |
| G1（Go） | Go 可用档 | Go CRUD 通 |
| S1 | Tauri 默认配置 + 签名 + 更新 + Android 目标 | 默认配置可跑；字段全可改；密钥零泄漏 |
| T2 | 三套内置模板 + 认证中心 | 切换不丢数据；认证中心标注参考实现 |
| TL1 | 模板库 | 预览隔离；合并不覆盖；冲突逐项选择 |
| U1 | 可用性治理 | 无假按钮；错误可定位；AA 对比度 |

### 批次 4

| 模块 | 验收 |
| --- | --- |
| I1 | 一条命令跑契约 + E2E + 迁移回归；四种产物各冒烟一次 |

---

## 7. 因存储变更必须重排的项

| 变化 | 旧 | 新 | 原因 |
| --- | --- | --- | --- |
| Schema 与存储拆开 | F1（schema + IndexedDB 存储） | ST1 存储内核 + F1 schema + ST2 站点仓库 | 文件存储的原子性/锁/事务比 schema 复杂得多，必须单独立项 |
| Builder 提前 | B1a 在 F3 之后 | B1a 在 ST2 之后、F2 之前 | 编辑器读写全部走后端 API，没有 API 无法联调任何视图 |
| 迁移提前 | M1 在批次 3 | M1 在批次 1 | 主存储已取消 IDB，老用户第一步就是迁移 |
| 后端生成合并 | R1（Rust）+ B1b（Node） | G1（Rust/Node/Go） | 三种语言共用骨架、配置、预检，拆成两个模块会重复 |
| 部署独立 | 无 | N1（nginx/证书） | 后端与反向代理是两条独立配置链，且证书涉及安全红线 |
| Tauri 拆分 | S1 含工程 + 签名 + 更新 | S1 保留；部署与证书归 N1 | 避免一个模块同时碰 Tauri 与 nginx |
| 新增产物完整性 | 无 | PT1 | 用户要求把编辑器实际使用的库打进产物，需要扫描与去重 |
| 串行长度 | F0→F1→F2→F3→B1a | F0→ST1→F1→ST2→B1a→F2→F3 | 存储与 API 成为前置 |

批次整体后移：原批次 1 顺延为「新批次 1 的下半部分」，原批次 2/3 各后移一位；I1 仍最后。

---

## 8. 串行 / 并行边界

**必须串行**：

1. F0 → ST1 → F1 → ST2 → B1a：存储与 API 是全部视图的前提。
2. B1a → E1 / D1 / CL1：视图读写都依赖真实接口。
3. F2 → F3 → SH1 / PT1 / G1 / S1：产物树与 manifest 是所有导出物的共同底座。
4. G1（Rust 核心）→ T2 认证中心预设。
5. G1（Rust）→ G1（Go）：共用配置与迁移结构，先定骨架再扩语言。
6. N1 证书与 nginx 配置 → S1 桌面 HTTPS 选项（复用校验逻辑）。
7. CL1 → TL1：模板引用组件 id 与版本。
8. M1 → I1：验收必须跑迁移后的数据。

**可并行**：

- 批次 1 七项互不写同一文件。
- 批次 2 中 G1（Rust/Node）与 N1 可并行（一个写生成器，一个写部署配置），接口在 CONTRACTS 第 12–13 节固定。
- 批次 3 中 G1（Go）、S1、T2、TL1、U1 可并行。
- U1 只改 `assets/ui/**`，可与任何批次并行。

**禁止伪并行**：

- 同时改 `app.js`、`index.html`、`base.css`。
- 同时改 `builder/src/storage/**` 与任何依赖它的路由（接口未冻结前）。
- 两个模块各自定义同名 `target`、`backend.language`、`nginx` 字段。
- 未进契约先加字段。

---

## 9. 横向机制（沿 v1，补存储相关）

| 注册点 | 签名 | 归属 |
| --- | --- | --- |
| 视图 | `LC.Views.register({ id, label, order, mount, unmount })` | F0 |
| 区块 | `LC.Blocks.register({ type, meta, defaultData, render, inspector })` | F2 |
| 数据源 | `LC.Data.register(kind, { resolve, validate, describe })` | D1 |
| 导出目标 | `LC.Export.registerTarget(target, { defaults, schema, build })` | F3 |
| 后端语言 | `LC.Backend.registerLanguage(lang, { maturity, defaults, build })` | G1 |
| 部署 | `LC.Deploy.register(kind, { defaults, validate, generate })` | N1 |
| 模板 / 组件 / 动作 | 同 v1 | TL1 / CL1 / L1 |

存储访问唯一入口：`LC.Store`（前端）与 `StorageAdapter`（服务端）；任何模块不得直接 `fs.readFile`。

事件补充：`storage:readonly`、`site:locked`、`site:repaired`、`build:queued`、`config:conflict`。

---

## 10. 完成定义（DoD）

1. 独占文件落地，未改他人文件；契约变更已合入。
2. 契约测试与模块验收逐条可复现。
3. 无外链、无硬编码盘符、无密钥泄漏。
4. 失败路径可见可恢复：存储错误有错误码与下一步，构建失败有日志，启动失败有诊断页。
5. 交付说明 ≤ 10 行：输入、输出、验证方式、已知限制。

---

## 11. 本轮不做

- 不写实现代码、不搬目录、不改文档站。
- 不做多用户、账号、权限、协作、公网加固。
- 不做在线组件/模板市场。
- 不托管用户正式服务；平台只生成与构建。
