# 科设低代码平台

科设低代码平台（GitHub 仓库 `KesheStudio/keshe-lowcode`）是一套**单机自用**的低代码建站工具：本地跑一个 Node 服务负责存储、渲染与导出，浏览器里打开工作台和编辑器来写内容、拼页面、配主题、接数据、编后端流程，最后一键导出成 Web 静态站或 Tauri 桌面应用。

平台只通过 GitHub 仓库分发，**不发布到 npm**。`package.json` 里 `private: true`，没有 `publishConfig`，也没有任何 publish 脚本。

- 服务端：`server/index.js`，Fastify + 文件系统存储，默认只监听 `127.0.0.1`
- 数据：`data/sites/<站点ID>/` 下的普通文件（JSON / Markdown / 资源），不依赖数据库服务
- 编辑器：`home.html`（工作台）、`builder.html`（建站编辑器）以及组件库、模板库、数据源、中间件、配置中心、导出向导等独立页面

## 当前能力

### 项目与页面

- 创建时选择**纯静态**或**带后端**项目，内置四套起步模板：文档站、落地页作品集、后台仪表盘、认证中心。
- 页面由区块拼成，支持拖拽排序、嵌套容器、图层树、属性面板、撤销/重做、`Ctrl+S` 保存。
- 画布本身就是实时预览，可切三档视口；没有单独的「预览」按钮。
- 页面可设限宽、限高；单个组件实例可写自己的代码覆盖，不影响其他实例。

### 组件渲染引擎

- **11 类基础内容区块**：标题、段落、Markdown、HTML、提示块、卡片组、图片、分隔线、按钮、代码块、文章列表。
- **39 类内置 UI 组件**：表格、图片、表单、模态框、抽屉、标签页、轮播、时间线、代码、状态；文本框、验证码、上传、日期、滑块、自动补全、下拉、多选、单选组、复选组、开关、数字、多行文本、标签输入、级联、评分；折线图、柱状图、饼图、环形图、迷你趋势图；KPI、进度条、环形进度；站点导航、页脚、侧栏、面包屑、页头。
- 组件注册在 `src/render/registry.js`，内置组件清单在 `src/render/builtins.js`，基础区块定义在 `server/src/export/base-blocks.js`。

### 组件库与模板库

- 可以把一段结构存成自定义组件，模板里用 `{{字段名}}` 占位；组件的 CSS 自动加实例作用域，JS 每个实例独立执行，`root` 指向当前实例。
- 支持单个组件 / 单个页面的 JSON 导入导出，同名冲突时可替换或另存；也可以直接把文件拖进编辑器。

### 主题

- 内置 10 套主题：认证·净白、蓝图·琥珀、仪表盘·石青、文档·素白、纸墨·石墨、纸墨·松绿、纸墨·藏青、纸墨·赭石、夜航·高对比、作品集·赤霞。
- 主题只通过 CSS 变量注入，组件不写死颜色；支持亮色 / 暗色，可设置访客切换。
- Builder 顶栏的「主题」弹窗负责快速切换，「主题编辑器」（`theme/editor.html`）负责改令牌、调对比度、导入导出主题 JSON。

### 数据源与接口

- 集合字段类型：`text`、`number`、`boolean`、`date`、`enum`、`reference`、`json`。
- 可配置外部 HTTP 数据源，把返回结果映射到集合或组件；支持 GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS。
- 数据源密钥只写进站点目录的 `.lowcode/data-secrets.json`（权限 600），不随文件接口、导出包或日志外泄。
- 页面组件通过渲染层的数据绑定取数，可在「数据源」页直接调试接口。

### 后端积木

- 用节点流程搭后端：入口、校验、分支、循环、HTTP 请求、数据操作、返回等节点拖拽连线，编辑器做静态校验。
- 目标语言三种：Node、Go、Rust；同一份流程 IR 生成对应工程，可本地预览运行，也可随导出包一起发布。
- 前端组件可以绑定流程产出的接口事件。

### 中间件与配置中心

- 内置中间件目录（SQLite 等）带默认值与参数校验，可直接开关和改参数。
- 支持自定义中间件；配置按层生效，环境变量用 `LC_CFG_<GROUP>_<FIELD>` / `LC_CFG_<KEY>` 覆盖，自定义中间件字段用 `MW_<MID>_<FIELD>`。
- 浏览器与服务端共用 `shared/middleware-catalog.js`，保证界面、生成代码和运行时字段一致。

### 导出

- `web-static`：导出纯静态站，输出 `web/index.html`、页面、`assets/`、`data/`、`sitemap.xml`、`robots.txt` 等。
- `tauri-desktop`：导出 Tauri 2 桌面工程，桌面平台支持 Windows（`msi` / `nsis`）、Linux（`appimage` / `deb` / `rpm`）、Android（`apk` / `aab`）。
- 导出前会跑校验（空标题、重复 slug、路径冲突、缺少入口等），构建产物落在 `data/sites/<站点ID>/builds/<构建ID>/artifact.zip`。
- 导出配置包含站点域名、路径前缀、TLS 模式、反向代理与后端语言，Web 与桌面共用一套站点数据。

### 备份、版本与迁移

- 站点备份、历史版本记录、按版本回滚，保留策略可在 `platform.config.json` 调整。
- `npm run migrate` 支持把旧格式站点目录迁移成当前 v2 站点目录，按内容指纹保证幂等。
- `npm run doctor` 检查 Node 版本、依赖、数据目录可写性与端口占用；启动失败写 `logs/boot-error.json`，端口回退写 `logs/start-port.json`。

## 怎么跑起来

需要 Node.js 20.11 及以上。克隆仓库后本地启动：

```bash
git clone https://github.com/KesheStudio/keshe-lowcode.git
cd keshe-lowcode
npm install
npm start
```

`npm start` 会先检查 Node 版本、补齐依赖、校验 `platform.config.json`，再启动服务并自动打开浏览器。默认地址是 `http://127.0.0.1:9780/`；端口被占用时会自动向上找一个可用端口。Windows 也可以直接双击 `start.cmd`。

其他常用命令：

```bash
npm run dev        # 直接起服务，不自动打开浏览器
npm run doctor     # 启动诊断
npm test           # Node 单元 / 集成测试
npm run e2e        # Playwright 端到端测试（会先跑 preflight）
npm run export     # 命令行导出
npm run migrate    # 站点目录迁移
npm run vendor:sync # 同步 vendor/ 下的自托管静态资源
```

## 目录结构

```text
lowcode/
├─ package.json / package-lock.json     项目依赖与脚本
├─ platform.config.json                 端口、数据目录、日志目录、保留策略
├─ start.cmd / migrate.cmd              Windows 启动与迁移入口
├─ home.html                            工作台（服务根路径 /）
├─ builder.html                         建站编辑器
├─ components.html / templates.html     组件库 / 模板库
├─ data.html                            数据源管理
├─ backend-flow.html                    后端积木编排
├─ middleware.html / config-center.html 中间件 / 配置中心
├─ export.html / builds.html            导出向导 / 构建记录
├─ diagnostics.html                     启动诊断
├─ assets/                              工作台前端脚本与样式
├─ server/
│  ├─ index.js                          服务入口
│  └─ src/
│     ├─ routes/                        sites、builder、data、flow、export、themes 等 HTTP 路由
│     ├─ flow/                          后端积木：节点、校验、IR、代码生成（node / go / rust）
│     ├─ export/                        导出管线、基础区块、站点地址
│     ├─ data/                          集合、字段、外部数据源、导入
│     ├─ components/  templates/        组件与起步模板的服务端逻辑
│     └─ code/                          代码校验
├─ src/
│  ├─ render/                            渲染引擎、39 类内置组件、基础区块、Markdown、搜索运行时
│  ├─ search/                            站内搜索索引与分词
│  ├─ storage/                           文件存储：原子写、锁、事务、版本、备份、恢复
│  └─ theme/                             主题令牌、内置主题、主题编辑器
├─ shared/                               浏览器与服务端共享的导出/中间件目录
├─ templates/
│  ├─ backend/                           后端工程模板（node / go / rust）
│  ├─ deploy/                            nginx、证书生成与导入、部署脚本
│  ├─ signing/                           Android / Windows 签名策略与脚本
│  └─ tauri/                             Tauri 2 桌面工程模板
├─ vendor/                               自托管静态资源（site.css、site.js、jszip、mermaid、favicon）
├─ docs/manual/                          操作手册
├─ tests/                                单元 / 集成测试与 Playwright E2E
├─ dist/                                 预打包安装包（Android apk、桌面 exe/msi）
├─ data/                                 运行数据（站点、构建、备份；.fixtures 为回归样本）
├─ exports/                              导出产物
├─ logs/                                 运行日志与启动诊断
└─ certs/                                HTTPS 证书目录（本地生成，不随仓库分发）
```

`data/`、`exports/`、`logs/`、`certs/` 都是运行产物，已在 `.gitignore` 中排除；`data/.fixtures/` 是回归测试样本，单独保留。`dist/` 里要随版本发布的安装包会正常入库。

## HTTPS 证书

仓库**不提供**任何证书或私钥，`certs/site.crt` 与 `certs/site.key` 需要自己生成或导入。仓库里的 `templates/deploy/scripts/`（导出后位于包的 `deploy/scripts/`）自带生成与导入脚本：

- 自签测试证书：`gen-test-cert.ps1` / `gen-test-cert.sh`
- 导入自有证书：`import-cert.ps1` / `import-cert.sh`
- Tauri 桌面工程：`npm run gen:cert`

生成后的证书只放在导出包或本机 `certs/`，不要提交到仓库。

## 操作手册

完整的分步教程在 [docs/manual/README.md](docs/manual/README.md)，建议按顺序阅读：

1. [01 快速开始](docs/manual/01-quick-start.md)
2. [02 新建项目](docs/manual/02-new-project.md)
3. [03 页面与组件](docs/manual/03-pages-and-components.md)
4. [04 组件库与模板库](docs/manual/04-components-and-templates.md)
5. [05 主题](docs/manual/05-theme.md)
6. [06 数据源与接口](docs/manual/06-data-sources.md)
7. [07 后端积木](docs/manual/07-backend-flow.md)
8. [08 中间件与配置中心](docs/manual/08-middleware-and-config.md)
9. [09 导出](docs/manual/09-export.md)
10. [10 部署](docs/manual/10-deployment.md)
11. [11 备份、版本与迁移](docs/manual/11-backup-and-migration.md)
12. [12 常见问题与排错](docs/manual/12-troubleshooting.md)

## 使用边界

- **单机自用**：没有登录、没有云端账号，数据只在本机 `data/` 目录；默认只监听 `127.0.0.1`，局域网其他电脑访问不到。
- **项目类型创建后不能一键切换**：纯静态与带后端在新建时确定，选错通常只能新建项目，或改导出配置后重新导出。
- **静态导出需要 HTTP 访问**：`file://` 下受 `fetch`、模块脚本等限制，本地预览请起静态服务；桌面端用 Tauri 导出。
- **导出前先填站点域名**：否则 canonical、sitemap 会使用占位域名。

## 开发文档

- [CONTRACTS-v1.md](CONTRACTS-v1.md)：接口与数据契约
- [design-decisions.md](design-decisions.md)：关键取舍
- [MODULE-DESIGN.md](MODULE-DESIGN.md)：模块设计
- [DEPENDENCIES.md](DEPENDENCIES.md)：依赖说明
- [UPGRADE-PLAN.md](UPGRADE-PLAN.md)：升级计划
- 审计与验收记录：`A11Y-AUDIT.md`、`CONSISTENCY-AUDIT.md`、`GAP-ANALYSIS.md`、`REQUIREMENTS-REVIEW.md`、`bug-sweep-20261108.md`
