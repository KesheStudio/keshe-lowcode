# 通用低代码平台升级 · 技术方案 v2（待确认）

> 本文件只描述架构、存储、导出、迁移与验证，不包含代码改动，也不执行目录搬移。
>
> **v2 主要变更**：主存储从 IndexedDB 改为本地文件系统；编辑器必须由本地 Node 服务提供；导出目标拆为 Web / Tauri；后端扩为 Rust / Node / Go 三档并支持 nginx 与证书。
>
> 配套：[MODULE-DESIGN.md](file:///c:/project/docs/lowcode/MODULE-DESIGN.md)（模块与批次）、[CONTRACTS-v1.md](file:///c:/project/docs/lowcode/CONTRACTS-v1.md)（内容 v2.0.0）、[design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md)、[DEPENDENCIES.md](file:///c:/project/docs/lowcode/DEPENDENCIES.md)。
>
> 现状入口：[app.js](file:///c:/project/docs/lowcode/assets/app.js)、[index.html](file:///c:/project/docs/lowcode/index.html)、[app.css](file:///c:/project/docs/lowcode/assets/app.css)。

---

## 0. 本轮变更摘要

| 项 | v1 | v2 |
| --- | --- | --- |
| 主存储 | IndexedDB（Lite）+ 可选工作区 | **服务端文件系统**（唯一主存储） |
| 启动方式 | 可双击静态打开 | **必须先起本地服务**，否则只能看诊断页 |
| 存储抽象 | 未定义 | `StorageAdapter`（读/写/删/列举/事务/版本戳） |
| 写盘一致性 | 无 | 原子写 + 站点锁 + 事务清单 + 崩溃恢复 |
| 迁移 | 后期再做 | **批次 1**，一次性 IDB → 文件，可重试 |
| 导出 | 单一静态站 / 后续全栈 | **用户选**：Web 静态包 或 Tauri 桌面包 |
| 后端 | Rust 默认 + Node 轻量 | Rust / Node / Go 三档，成熟度分级 |
| 部署 | 未细化 | 可选 nginx 反向代理 + HTTPS 证书（测试/导入） |
| 产物完整性 | 离线检查 | 额外捆绑编辑器实际使用的第三方库 |
| 契约版本 | 1.0.0 | **2.0.0** |

---

## 1. 目标与边界

**目标**：本地单机搭建器。用区块搭页面，数据落盘，一键导出可离线运行的 Web 站或桌面应用，可选生成后端与部署配置。

**不做**：账号、多用户、权限、协作、公网加固、在线市场、托管用户正式服务。

---

## 2. 架构与启动

```
浏览器编辑器（服务提供，不可脱离服务）
        │ 127.0.0.1 + token
本地 Node 服务
  · 启动/配置/诊断
  · StorageAdapter → 文件系统
  · 站点仓库 / 版本 / 备份 / 构建记录
  · 渲染 / 导出 / 三语言生成 / nginx / 证书
        │
<数据根>/sites/<siteId>/（可直接 git 管理）
        │
单 zip 产物：web-static 或 tauri-desktop
```

启动顺序：读配置 → 校验路径 → 恢复事务与清理 → 校验站点元信息 → 监听 127.0.0.1 → 打开浏览器。

失败表现（不得白屏）：

| 情况 | 表现 |
| --- | --- |
| 后端未启动 | 打开 `diagnostics.html`，显示未运行、启动命令、端口 |
| 配置损坏 | 进程退出码 2，打印字段路径；诊断页读 `logs/boot-error.json` |
| 磁盘不可写 | 服务进入只读模式，编辑器常驻只读横幅，保存禁用 |
| 端口占用 | 明确报错，不自动换端口 |
| 站点损坏 | 该站点 `needs-repair`，只读浏览 + 备份恢复 |

---

## 3. 存储（文件系统）

### 3.1 抽象

`StorageAdapter`：`read / write / delete / list / stat / move / transaction / rev`。默认 `FsStorageAdapter`；`MemoryStorageAdapter` 仅测试；IndexedDB 仅作**可选草稿缓存**（默认关闭，不参与保存、构建、迁移）。

### 3.2 站点目录

```
<数据根>/sites/<siteId>/
├─ site.json                 必需 · 站点元信息
├─ project.json              必需 · 配置 v5
├─ pages/ articles/ components/ themes/
├─ data/  sources / collections / originals / files(派生) / mocks
├─ assets/ images / fonts / icons
├─ certs/                    敏感 · gitignore
├─ deploy/ nginx / backend / scripts
├─ builds/                   派生 · 构建记录与产物
├─ versions/                 派生 · diff + 周期快照
├─ backups/                  派生
└─ .lowcode/                 运行时 · 锁 / 临时 / 事务
```

逐文件用途、必需性、可重建性见 CONTRACTS 第 3 节。

### 3.3 写盘语义

- 原子写：临时文件 + `fsync` + `rename`（跨卷退化并记录）。
- 站点锁：进程内 Mutex + 跨进程 `site.lock`，心跳 10s，60s 陈旧可回收；冲突返回 `423`。
- 事务：先写 temp，提交时统一 rename；`txn` 清单记录状态；启动前滚/回滚。
- 损坏恢复：坏 JSON 进 `.corrupt/`，从最近备份恢复；无备份则只读。
- 备份：危险操作前自动备份；保留 10 份 / 30 天 / 2 GB。
- 版本：JSON Patch + 每 20 个版本或 24h 全量快照；保留 100 条 / 30 天。
- 构建记录：每 target 保留最近 10 次 + 最近一次成功；站点产物总量 5 GB；永不删每目标最新成功包。

### 3.4 与 git 的关系

站点目录可直接 `git init`；`.gitignore` 只排除 `builds/`、`backups/`、`certs/`、`.lowcode/`、`data/files/`。源文件与 `deploy/` 默认提交。

---

## 4. 编辑器能力（沿 v1，存储位置变化）

| 能力 | 要点 | 存储位置 |
| --- | --- | --- |
| 自由布局 | `layout.mode: free` + `pos`，8px 吸附，窄屏纵向降级 | 页面文件 |
| 模板抽象 | docs / landing / dashboard / 认证中心；切换只改 templateId | `project.json` + `templates/` |
| 多主题 | 颜色 + 圆角 + 边框 + 字号 + 字体栈；导出全部变量 | `themes/` |
| 图标 / 统计 / 图表 | 内置 24 个 SVG；四类图表纯 SVG | 代码注册表 + 页面数据 |
| 数据源 | 静态 JSON / 集合 / 文件 / HTTP / 模拟接口 | `data/` |
| 集合与文件 | 5 MB / 2 万行 / 5 万条；原文件与解析结果分开 | `data/originals` + `data/files` |
| 外壳组件 | `siteNav` / `siteFooter` / `breadcrumb`，构建时高亮 | `components/` |
| 组件库 / 模板库 | 独立板块、搜索筛选标签、单文件导入导出 | `components/`、`templates/` |
| 表单 / 表格 / 逻辑 | 校验、分页排序、动作与条件显示 | 页面数据 + 运行时脚本 |

「站点设置」已删除：站点名/Logo/版权/语言进全局变量，域名/部署进导出配置，分类留内容页。

---

## 5. 导出目标

导出第一步选择目标，两套配置互不覆盖：

### 5.1 Web 静态包（`web-static`）

- 交付形态：`static` / `backend` / `backend+nginx`。
- 默认：静态站 + 无后端 + 无 nginx。
- 可改：域名、basePath、cleanUrls、后端语言、nginx 开关与配置。

### 5.2 Tauri 桌面包（`tauri-desktop`）

默认给一套**可直接跑**的配置，全部字段可改：

| 字段 | 默认 | 可改 |
| --- | --- | --- |
| 应用名 / 标识符 / 版本 | `Example App` / `com.example.app` / `0.1.0` | 是 |
| 窗口 | 1024×720，最小 800×600，可缩放 | 是 |
| 图标 | 内置占位，可替换 ≥512×512 | 是 |
| 协议 | https（自签测试证书） | http / https |
| HTTPS | 生成测试证书 / 导入自有证书 | 是 |
| 更新源 | 关闭；开启需 endpoint + pubkey | 是 |
| 打包目标 | msi / nsis / appimage / apk / aab；生成更新产物 | 是 |

证书：平台可生成测试证书（自签，需手动信任）或导入自有证书；**私钥不进 zip**，导出包带 `gen-test-cert.sh` 与路径配置。

---

## 6. 后端分档

| 语言 | 成熟度 | 框架 | 能力 |
| --- | --- | --- | --- |
| Rust | `full` | axum + sqlx | CRUD、迁移、鉴权、中间件、模块、compose |
| Node | `full` | Fastify + 内置 SQLite | CRUD、seed、轻量部署 |
| Go | `usable` | 标准库 net/http + database/sql | 基础 CRUD、SQLite/Postgres、配置 |

- 所有后端可配：端口、host、CORS、环境变量、中间件（请求 id / 日志 / 压缩 / 限流 / 安全头）。
- 自定义配置文件：`deploy/backend/config.yaml`，`override: true` 时整体替换生成配置。
- 覆盖链：平台默认 < 生成配置 < 用户文件 < 环境变量 < 启动参数。
- 校验：schema 严格模式；端口冲突、CORS 通配 + 凭证、重复 env、数据库指向平台目录等直接阻断导出；错误带文件与行号。

---

## 7. nginx 与证书

平台生成推荐 `deploy/nginx/nginx.conf`，用户可改，保存后标记「已自定义」，重新生成时询问覆盖或保留。

默认值（逐项可改）：

| 项 | 默认 |
| --- | --- |
| 监听 | 80 / 443 |
| HTTP 跳转 | 开启 |
| TLS | TLSv1.2 + TLSv1.3 |
| 反代上游 | `127.0.0.1:8080` |
| 静态根 | `web` |
| gzip | 开，≥1024 字节 |
| 静态缓存 | 1 年 + immutable（内容哈希文件） |
| HTML 缓存 | no-cache |
| 安全头 | nosniff / SAMEORIGIN / strict-origin-when-cross-origin |
| 上传上限 | 10m |
| 日志 | `logs/access.log` / `logs/error.log` |

证书：

- 测试证书：平台生成自签；导出包只带生成脚本，部署时执行。
- 导入自有：校验有效期、域名匹配、链完整、私钥配对；私钥只存站点 `certs/`（0600），不进 zip。
- 缺证书但启用 HTTPS：导出可完成，`deploy.tls.status = blocked` 并在 README 顶部标注。

---

## 8. 产物完整性

1. 构建扫描编辑器实际加载的第三方文件（`index.html` 的 script/link + 运行时加载）。
2. 去重后放 `vendor/editor/<name>/`，附版本与许可证，生成 `THIRD-PARTY-NOTICES.md`。
3. 小于 4 KB 且首屏必需的 CSS 内联；大库保持外链文件。
4. 提供「不打包编辑器库」开关，默认开；产物 > 50 MB 提示裁剪。
5. manifest 记录 `editorLibraries[]` 与体积分类，界面展示「产物体积 / 第三方占比」。

体积代价：编辑器库捆绑通常 +0.5–3 MB；内联小 CSS +10–60 KB；重复文件由构建去重。

---

## 9. 破坏性改动与迁移

### 9.1 破坏性改动

1. 主存储改为文件系统，IndexedDB 不再是主存储（可选草稿缓存，默认关）。
2. 编辑器必须由本地服务提供，不能双击打开。
3. 配置 v4 → v5；项目 v1 → v2；存储布局 v2；manifest v3 → v4。
4. 导出目标二选一；不再支持旧包导入（旧版兼容已取消）。
5. 新增后端四档、nginx、证书、自定义配置字段。
6. 构建记录、版本、备份成为磁盘目录的一部分，有新保留策略。
7. 密钥红线扩展到证书私钥。

### 9.2 旧版数据迁移（已取消）

- **结论**：已取消。用户旧平台没有产生任何站点数据，IndexedDB 迁移端点、旧包解析与演练页均已删除。
- **原因**：兼容链路没有实际使用场景，只会让新代码绕路并增加长期维护成本。
- **替代**：换机器 / 换目录时用 `migrate.cmd <站点目录>` 导入同版本站点目录。

### 9.3 旧产物导入（已取消）

- **结论**：已取消。manifest v1–v3、旧静态导出 zip、旧单组件/单页面/单模板文件都不再作为导入来源。
- **替代**：只接受当前格式站点目录；需要保留的内容先迁成当前格式，再走站点搬家脚本。

---

## 10. 分期路线

| 期 | 交付 | 完成后能做什么 |
| --- | --- | --- |
| 1 | 服务化地基：F0 启动/诊断、ST1 存储内核、F1 契约、ST2 站点仓库、B1a API、M1 迁移 | 起服务、建站点、落盘、迁移旧数据、原子保存不丢 |
| 2 | 编辑器与导出：F2 渲染、F3 导出、批次 1 能力 | 搭页面、主题/组件/数据可用、导出静态 zip |
| 3 | Web 全栈：G1（Rust/Node）、N1（nginx/证书）、B2 | 生成可运行后端、配置反向代理与 HTTPS、产物冒烟 |
| 4 | 桌面：S1 Tauri 默认配置、签名、更新 | 出桌面应用；未配置签名时明确缺项而非假按钮 |
| 5 | 移动与多语言：Tauri 移动、G1（Go）、T2 模板/认证中心 | Android 签名包、Go 可用档 |
| 6 | 质量收口：CL1/TL1/U1/I1 全量验收 | 组件库/模板库/可用性/回归基线全部通过 |

每期结束给可运行产物与验证记录；阶段内顺序见 MODULE-DESIGN 第 5–7 节。

---

## 11. 验收

1. 冷启动：`npm start` → 打开编辑器；断网无外部请求。
2. 存储：强杀进程后重启，无半截文件；双进程写同站点，后者 423。
3. 迁移：旧 IDB 数据条数一致、可重试、旧数据只读保留。
4. 导出 Web：静态包断网可开；含后端时可起服务并 CRUD；nginx 配置可校验。
5. 导出 Tauri：默认配置可构建；字段改动生效；HTTPS 两种来源都能生成/导入。
6. 后端：Rust `cargo check`、Node `npm start`、Go `go build` 各自通过。
7. 证书与密钥：zip、日志、响应、界面中检索不到私钥/密码。
8. 产物完整性：编辑器库清单齐全、去重、许可完整、体积统计正确。
9. 失败路径：三种启动失败、构建失败、配置冲突均有可见原因与下一步。

---

## 12. 平台与文档站边界

- 两者无调用、无资源共享、无共享端口；平台不引用文档站 `server.js` / `site.css` / `site.js` / `favicon.svg`。
- `vendor/site.*` 替换为 `vendor/platform.*`；JSZip 只从 `node_modules` 复制。
- 路径一律相对工程根；端口、目录、限额只在 `platform.config.json`。
- 独立性自检：无盘符、无文档站引用、断网可启动、整体改名可启动、两边构建互不影响。

---

## 13. 手工迁移清单（由用户执行）

| 步骤 | 操作 | 注意 |
| --- | --- | --- |
| 1 | 选定独立于文档站的平台目录 | 不放进文档站发布目录 |
| 2 | 复制 `index.html`、`assets/`、`vendor/jszip.min.js`、设计文档 | 不复制 `vendor/site.*` 与文档站 favicon |
| 3 | 新建 `package.json`、`package-lock.json`、`platform.config.json`、`diagnostics.html` | 路径全为相对值 |
| 4 | 放入平台自有 `vendor/platform.css`、`platform.js`、`favicon.svg` | 替换三个文档站文件 |
| 5 | 配置端口、数据根、导出根、限额 | 只改 `platform.config.json` |
| 6 | 本机 npm 安装依赖并提交锁文件 | 禁用 CDN 回退 |
| 7 | 启动服务，打开编辑器 | **不再双击 HTML**；起不来先看 `diagnostics.html` |
| 8 | 用迁移入口把旧 IndexedDB 数据搬到文件存储 | 先备份旧数据；迁移后可重试；确认前旧库只读保留 |
| 9 | 跑独立性自检与一次 Web 导出 | 断网打开产物 |
| 10 | 确认无误后再处理旧 `lowcode/` 目录与书签 | 先备份；删除旧目录由用户操作 |

完成标准：第 12 节五条自检全过，迁移条数一致，导出一个可离线打开的 zip。

---

## 14. 能力边界

- 不托管用户正式服务；只生成代码、配置与产物。
- Rust/Node/Go 生成是骨架，复杂业务需写模块。
- 数据库不内置（SQLite 文件除外）；PG/MySQL/Redis 需实例或 Docker。
- Tauri 首次构建需要工具链与 Gradle 缓存，不承诺全离线。
- Android 测试签名用脚本生成 keystore；上架需自己的上传密钥并提交 AAB。
- 密钥与证书私钥永不进入任何产物、日志、响应。
- 编辑器不是安全沙箱；组件 JS 为约定式隔离，只导入可信组件。

---

## 15. 取舍与历史说明

- v1 的「7 个全栈取舍」中，Builder 形态、Rust 默认、前端无构建、Node 轻量、Tauri 内嵌 SQLite、服务器模式后置仍有效。
- 已推翻：Lite 纯浏览器模式、IndexedDB 作为主存储（见 design-decisions D-03 / D-14）。
- 修订：单 zip 改为按目标二选一；密钥红线扩展到证书私钥。
- 新增：三语言分档、nginx/证书、自定义配置、产物库捆绑、启动诊断页。

确认后按第 10 节顺序推进，每期结束给可运行产物与验证记录；本轮只交付设计稿，不开始实现。
