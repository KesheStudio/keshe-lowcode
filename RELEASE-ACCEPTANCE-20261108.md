# 低代码平台 · 发布闸门总验收（2026-11-08，按当前代码重跑）

验收对象：`c:\project\docs\lowcode`
验收方式：导出/后端探活使用临时站点（`lc-e2e-gate-*`），结束后删除；e2e 使用隔离平台根；未改写 `data/sites` 下既有站点。
核对基准：[REQUIREMENTS-REVIEW.md](file:///c:/project/docs/lowcode/REQUIREMENTS-REVIEW.md)

## 一、结论

**可以发布。**

单测、渲染自检、三语言积木与探活、导出矩阵（5 种产物）、Tauri Windows 实际打包、e2e 全量单轮（71/71）、e2e 并行两轮（各自 71/71、端口与根目录互不冲突）、UI 双档点检、9780 两个演示站实开：**全部通过，零失败**。

本轮发现并修复 1 个真实产品缺陷：**Rust 后端导出被前置校验误拦（`LC_E_EXPORT_CHECKS`）**，详见 §六。修复后 `npm test` 与 Rust 导出复跑均通过。

## 二、逐项结果表

| # | 项目 | 命令 / 方式 | 结果 | 实测数字 |
| --- | --- | --- | --- | --- |
| 1 | 单元测试 | `npm test` | 通过 69/69 | 16.9 s |
| 2 | 渲染自检 | `node src/render/samples/verify.cjs` | 通过 584/584 | 0.6 s |
| 3 | 积木三语言 · Node | `node scripts/flow-slice.mjs node` | 通过（EXIT=0） | 65.4 s |
| 4 | 积木三语言 · Go | `node scripts/flow-slice.mjs go` | 通过（EXIT=0） | 40.2 s |
| 5 | 积木三语言 · Rust | `node scripts/flow-slice.mjs rust` | 通过（EXIT=0） | 111.7 s（含 cargo 编译） |
| 6 | 三语言探活 | 各语言真实起服务 + 积木接口 | 通过 | `/api/items` 均 200、3 行；`POST /api/coverage` 均 200 |
| 7 | 导出 · 纯静态 Web | `exportSite(target=web-static, backend=none)` | 成功，checks 0 失败 | 123 ms，10 文件 |
| 8 | 导出 · Web + Node | `backend=node` | 成功，checks 0 失败 | 27,477 ms，77 文件 |
| 9 | 导出 · Web + Go | `backend=go` | 成功，checks 0 失败 | 597 ms，80 文件 |
| 10 | 导出 · Web + Rust | `backend=rust` | 成功，checks 0 失败 | 53,864 ms，82 文件 |
| 11 | 导出 · Tauri 桌面 | `target=tauri-desktop` | 成功，checks 0 失败 | 262 ms，66 文件 |
| 12 | 产物清单一致性 | 解包后比对 `artifact-manifest.json` | 5/5 全部一致 | missing 0 / extra 0 / size 0 差异 / sha256 0 差异 |
| 13 | 入口页可打开 | 解包后本地 http 打开 `web/index.html` | 5/5 通过（200 + HTML） | static/node/go/rust 17,525 B；tauri 17,567 B |
| 14 | 后端真启动 · Node | `npm ci` + `node src/main.js --port` | 通过 | 构建 11.9 s；health/ready/meta 均 200；`/api/items?pageSize=2` 200，total=3 |
| 15 | 后端真启动 · Go | `go build` + `--port` | 通过 | 构建 5.3 s；health/ready/meta 均 200；同上接口 200，total=3 |
| 16 | 后端真启动 · Rust | `cargo build --release` + `--port` | 通过 | 构建 146.8 s（冷编译）；health/ready/meta 均 200；同上接口 200，total=3 |
| 17 | e2e 全量（单轮） | `npm run e2e` | **71/71 通过** | 0 failed / 0 flaky / 0 skipped，373.7 s（wall 377 s） |
| 18 | e2e 并行两轮 | `npm run e2e:parallel` | **两轮各 71/71，互不干扰** | run-1 606.8 s / 端口 37786；run-2 614.3 s / 端口 37788；根目录互不共用 |
| 19 | UI 双档点检 | `tests/e2e/specs/ui-audit.spec.mjs` | 32/32 通过 | 13 页 × 1280/390 + 3 个静态门闩 × 2；横向溢出 0；console error 0 |
| 20 | 9780 工单站 | Edge 实开首页 | 通过 | KPI 8 单 / 3 单 / 2 单 / 2 单；表格 5 行；首行「共享盘权限申请 何静 账号 P3 待处理 — 2026-11-07」 |
| 21 | 9780 Nimbus 站 | Edge 逐页点击 3 页 | 通过 | 三页正文 1454 / 1454 / 877 字符；无横向溢出、无控制台错误 |
| 22 | Tauri Windows 打包 | `build-app.mjs --targets msi,nsis` | **成功** | MSI 2,531,328 B；NSIS 1,876,613 B；518.3 s；preflight 0 阻塞项 |

导出告警（非失败）：static 1 条（第三方运行时体积提示 `LC_W_ASSET_BYTES`），node/go/rust 各 2 条，tauri 6 条（签名资料等提示）。

## 三、e2e 并发说明

- 单轮：71 例全绿，耗时 373.7 s，无跳过、无重试。
- 并行两轮：由 `tests/e2e/support/parallel-check.mjs` 同时启动两套完整流程（预检 + playwright test），每轮自带运行根与自动分配端口。
  - 结果：`run-1：端口 37786 | 根目录 lc-e2e-platform-…-ve7yzy | 71 通过 / 0 失败`；`run-2：端口 37788 | 根目录 lc-e2e-platform-…-2a29ne | 71 通过 / 0 失败`。
  - 判定：端口互不冲突、运行根互不共用、无全局状态文件，**两轮互不干扰，全部通过**。
  - 说明：并行当次同时在做 Tauri cargo 冷编译，单轮耗时升至约 607–614 s（未超 12 min 上限）；单独跑为 373.7 s。

## 四、UI 点检范围

13 个页面 × 2 档（1280 / 390）：首页、builder、页面列表、组件库、模板库、页面导入、数据源（含「上传目标」）、中间件、配置中心、后端积木、构建记录、导出向导、主题编辑器；另有 3 个静态门闩页面 × 2 档，合计 32 例。检查项：横向溢出、控件可点、滚动、弹窗、返回入口；全局 console error / pageerror 守卫在所有 e2e 用例中生效，实测 0 条。

## 五、9780 演示站实测

- 工单站 `ticket-ops-1108`：KPI 四项有真实数据（8 / 3 / 2 / 2），表格渲染 5 行，字段与数据完整。
- 文档站 `nimbus-docs-demo-1108`：三页均可浏览，切换后画布正文实际变化，无溢出、无控制台错误。
- 数据目录仅剩 `nimbus-docs-demo-1108`、`ticket-ops-1108` 与另一会话的 `redis-toggle-repro`；本轮的临时站点已全部删除。

## 六、本轮修复（产品缺陷）

**问题**：Rust 后端导出在前置语法校验阶段返回 422 `LC_E_EXPORT_CHECKS`，`cargo check` 报「could not find Cargo.toml」。原因是模板源文件以 `Buffer` 进入构建文件表，而 `checkRustFiles` 只接受 `string`，导致 `server/Cargo.toml` 等模板文件没有写入临时目录。

**修复**：[pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js#L1297-L1305) — 落盘时接受 `string` 或 `Buffer`，二进制内容原样写入。

**影响面**：修复前所有 Rust 后端导出都会被该校验误拦（属于发布阻断级缺陷）；修复后 Rust 导出 `checksFail=0`、耗时 53.8 s，且 `npm test` 69/69 无回归。

## 七、已知限制（非本轮阻断项）

| # | 条目 | 影响 |
| --- | --- | --- |
| 1 | 沙箱禁止写 `%LOCALAPPDATA%\tauri`（EPERM） | 仅构建机环境限制。本轮将 `LOCALAPPDATA` 重定向到可写目录并复用既有 WiX/NSIS 缓存，预检 0 阻塞、打包成功；与产品无关 |
| 2 | Tauri 产物未签名 | 只影响正式分发（SmartScreen 提示），不影响功能与本地安装 |
| 3 | Tauri CLI 2.12.4 与 crate 2.12.5 补丁版不同 | 上游发布节奏差异，不导致打包失败；预检以 WARN 记录 |
| 4 | 导出包第三方运行时约 5.5 MB（主要为 mermaid） | 离线可用换来的固定体积；仅体积提示 `LC_W_ASSET_BYTES` |
| 5 | 站点未保存后端流程时导出只带模板自带接口（`LC_W_FLOW_EMPTY`） | 预期提示，非缺陷 |
| 6 | 需求 34 回退只在「相对拖拽前新出现溢出」时触发 | 原本就存在的滚动条不触发回退，属设计取舍 |
| 7 | 冷编译耗时偏高（Rust 导出校验 53.8 s、Rust 后端 146.8 s、Tauri 打包 518.3 s） | 发布/CI 时间成本；增量构建会显著下降 |

## 八、隔离与清理

- 导出/探活站点：临时站点 `lc-e2e-gate-*`，导出后经 API 删除。
- e2e：使用 `tests/e2e/support/temp-root.mjs` 的隔离平台根，未触碰 `data/sites`。
- 临时构建缓存与安装包副本：`.tmp/acceptance`（含 `pkgs/`、zip、构建缓存、重定向的 `LOCALAPPDATA`），报告产出后整体删除。
- 未改动：`data/sites` 下既有站点、另一会话的 `redis-toggle-repro` 与其运行数据。
