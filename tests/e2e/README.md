# 低代码平台端到端回归（E2E）

本目录是一套自包含的 Playwright 回归框架。用例与支撑文件只落在 `tests/e2e/**`；
为让导出产物在 http 部署下真正带交互运行时、并让更新开关的显隐校验成立，上一批对
`server/src/export/pipeline.js`（按页内联运行时）与 `assets/css/lc-wizard.css`（`[hidden]` 生效）
做了最小修复，其余产品代码未改动。

设计前提：**不连接数据库、不读写 `data/sites` 下的任何已有站点**。所有用例都在一个临时隔离的
平台根目录里跑，用例自己创建 `lc-e2e-` 前缀的临时站点，跑完自动删除，服务退出时整个隔离目录一并清理。

## 首次安装

在工程根目录 `c:\project\docs\lowcode` 执行：

```powershell
npm install
```

`@playwright/test` 已列入 `devDependencies`，一次 `npm install` 即可。

浏览器二进制：

- 默认使用**本机已安装的 Microsoft Edge**（`channel: msedge`），不需要下载任何浏览器二进制；
  找不到 Edge 时自动尝试本机 Chrome（`channel: chrome`）。
- 如果本机没有 Edge/Chrome，可以只装一次 Playwright 自带 Chromium（仍然走 npm 本地缓存，不访问 CDN）：

  ```powershell
  npx playwright install chromium
  ```

- 想强制指定浏览器，用环境变量覆盖（不落配置、不改代码）：

  ```powershell
  $env:LC_E2E_CHANNEL = "msedge"     # 或 chrome / chromium
  ```

安装完成后可先跑一键预检：

```powershell
npm run e2e:doctor
```

预检会逐项检查 Node 版本、`@playwright/test`、可用浏览器、`platform.config.json`、`templates/`、
`node_modules/`、隔离目录可写性、测试端口空闲。**缺依赖时只输出中文修复建议，不抛调用栈**，
退出码非 0 便于 CI 判断。

## 命令

| 命令 | 说明 |
| --- | --- |
| `npm run e2e` | 预检 + 无头运行全部用例（默认） |
| `npm run e2e:headed` | 预检 + 有头运行，便于观察浏览器操作 |
| `npm run e2e:parallel` | 同时起两轮完整测试，验证并发互不干扰（可追加文件/参数，如 `npm run e2e:parallel -- tests/e2e/specs/ui-audit.spec.mjs`） |
| `npm run e2e:report` | 打开上一次的 HTML 报告 |
| `npm run e2e:doctor` | 只跑环境预检，不执行用例 |
| `npm run e2e -- --grep 导出` | 只跑标题匹配关键字的用例，改完一处只验一处 |

其他可用环境变量：

- `LC_E2E_PORT`：测试服务端口，**默认不设置**——每轮自动分配一个空闲端口，同一台机器上并行跑多轮不会互抢。
  只有需要固定端口时才显式设置（此时预检会检查是否被占用，占用则给出明确提示与处理办法）。
- `LC_E2E_RUN_ID` / `LC_E2E_RUN_ROOT`：本轮运行标识与隔离平台根目录，一般由脚本自动生成并下发给子进程，不需要手填。
- `LC_E2E_REPORT_DIR` / `LC_E2E_ARTIFACTS_DIR`：报告与失败产物目录，并行跑多轮时各写各的，默认 `tests/e2e/.report` 与 `tests/e2e/.artifacts`。
- `LC_E2E_BASE_URL`：直连一个已经启动的测试服务（一般不需要）。
- `LC_E2E_CHANNEL`：浏览器通道，见上一节。

## 并发跑多轮（为什么不共享状态文件）

每轮测试自带一份**互不干扰的运行环境**：

- **端口**：`support/config.mjs` 监听 `0` 让系统分配一个空闲端口，拿到即释放；两个轮次同时启动时端口天然不同。
- **运行根目录**：目录名带本轮运行标识（`lc-e2e-platform-<YYYYMMDD-HHmmss-随机>/`），代码副本、`data/`、`exports/`、`logs/` 都在里面。
- **无全局状态文件**：早期版本用 `.current-root.json` 这类共享文件记当前根目录，一方 teardown 删掉它，另一方 `/builder.html` 就全 404。
  现在这套机制已彻底移除：没有任何跨轮次共享的可写文件，配置通过进程环境变量（`LC_E2E_RUN_ID` / `LC_E2E_RUN_ROOT`）直接下发给测试服务。
- **清理只清自己**：`serve.mjs` 退出与 `globalTeardown` 都只删 `LC_E2E_RUN_ROOT`；残留目录按目录内 `.e2e-owner.json` 的进程号判断，
  归属进程还活着就跳过，没有归属文件且创建不到 60 秒的目录也跳过（避免误删另一轮正在初始化的目录）。
- **报告与产物**：`LC_E2E_REPORT_DIR` / `LC_E2E_ARTIFACTS_DIR` 各自独立，两轮互不覆盖。

直接开两个终端各跑一次 `npm run e2e` 即可并行；也可以用 `npm run e2e:parallel` 一次性验证：

```
──────── 并发验证结果 ────────
  run-1：端口 52431  |  根目录 lc-e2e-platform-20261108-201530-a1b2c3  |  用例 32，通过 32，失败 0  |  退出码 0
  run-2：端口 52432  |  根目录 lc-e2e-platform-20261108-201530-d4e5f6  |  用例 32，通过 32，失败 0  |  退出码 0
  端口互不冲突：是
  运行根目录互不共用：是
  全局状态文件：无（每轮按运行标识建目录，清理只删自己的目录）
  结论：两轮互不干扰，全部通过
```

任一轮非全绿、或两轮取到相同端口 / 根目录，脚本直接判定并发验证不通过（退出码非 0）。

**端口被占用时会怎样**：

- 自动分配模式：正常情况不会撞端口；万一启动瞬间端口被别的程序抢走，`serve.mjs` 会立刻打印
  `[E2E] 端口 <n> 已被占用，本轮无法启动测试服务。` 并给出两条处理办法（去掉 `LC_E2E_PORT` 让每轮自动分配，或换一个端口），退出码非 0。
- 显式 `LC_E2E_PORT` 模式：预检阶段就会检查占用，直接给出 `LC_E2E_PORT=9888` 这类可执行的替换建议，不会静默失败。

## 用例覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `specs/health.spec.mjs` | 启动服务 → `/api/health` 正常 → 打开工作台，标题、保存状态、页面列表正常，无控制台报错 |
| `specs/main-flow.spec.mjs` | 新建临时站点 → 套用模板新建页面 → 插入组件区块 → 改字段 → 等待自动保存 → 重新加载后内容仍在 |
| `specs/theme.spec.mjs` | 安装第二套主题 + 亮/暗两档渲染，画布注入 `srcdoc` 后校验 `data-lc-mode` 与主题 CSS 变量，页面无报错 |
| `specs/export.spec.mjs` | 走导出向导导出 Web 静态包 → 用 JSZip 解压 → 校验关键文件、manifest 检查项、无外链资源、无密钥明文 |
| `specs/canvas.spec.mjs` | 画布 desktop/tablet/phone 三档切换、图层树选中联动画布高亮、图层拖拽排序并自动保存 |
| `specs/import.spec.mjs` | 页面 / 组件 / 模板三个板块的拖拽导入（真实 DataTransfer + File 事件），并校验列表出现与模板可套用 |
| `specs/export-targets.spec.mjs` | Tauri 桌面工程产物结构、`desktop.json` / `tauri.conf.json` / 运行时配置、自签证书提示与更新开关校验；选定页面导出与入口跳转页 |
| `specs/datasource.spec.mjs` | 新建接口、密钥遮蔽（列表接口只返回 `hasSecret`）、连接测试成功/失败各一条、集合字段映射 |
| `specs/forms.spec.mjs` | 表单组件在 `src/render/demo.html` 验收页里逐状态交互：浮动标签、字符计数、错误文案、验证码粘贴分格、日期范围、滑块、自动补全 |
| `specs/article.spec.mjs` | 文章页右侧目录、章节定位、滚动高亮、上下篇、站内检索（http 部署方式） |
| `specs/offline.spec.mjs` | 导出包起本地静态服务，用 http 打开首页、文章页与图表页，校验样式/交互运行时/图表；反向断言 `file://` 打开时能看到“这个包需要通过 http 访问”的说明 |

## 发布前自检

跑完终端会输出一段人话摘要（由 `support/reporter.mjs` 生成），例如：

```
──────── 发布前自检 ────────
用例总数：12    通过：12    失败：0
耗时：79.9 秒
结论：可以发布（全部用例通过）
报告：tests/e2e/.report/index.html
──────────────────────────
```

有失败时会列出失败用例名、所在 spec 文件和首行原因，结论直接写“不能发布”。
如果没有 `--grep` 匹配到任何用例，会明确提示“未执行，不能据此判断可以发布”。

全局守卫：每个用例结束时会检查页面是否出现控制台 error 或未捕获异常，有则直接判定失败，
并在原因里区分 **产品自身报错** 与 **测试脚本报错**（按错误来源 URL / 堆栈判断）。
用例自带的断言失败则按普通测试失败处理。

> 已知噪声：守卫在 `afterEach` 中抛错时，Playwright 1.56 退出前可能额外打印一行
> `Internal error: step id not found: fixture@N`。这是框架内部的步骤记账噪声，
> 不影响用例判定、摘要结论和退出码；普通断言失败不会出现这行。

## 失败时能看到什么

每个用例都挂了自动 fixture（`support/fixtures.mjs`），失败时会：

- 截图：`tests/e2e/.artifacts/<用例名>/failure.png`，同时以“失败页面截图”附件
  直接附到 HTML 报告里，打开报告即可看到页面当时的样子
- 上下文：`failure.json` 与报告附件“失败上下文（步骤与错误）”，含断言错误堆栈、
  当时页面 URL、控制台 error/warning、未捕获异常、失败请求列表（URL、method、失败原因）、
  HTTP >= 400 的响应，以及守卫对产品 / 测试脚本报错的分类
- Playwright 自带 trace（`retain-on-failure`）与报告附件

HTML 报告默认输出到 `tests/e2e/.report/index.html`，JSON 结果在
`tests/e2e/.report/results.json`。

## 隔离机制（为什么不碰已有数据）

`support/temp-root.mjs` 会在 `tests/e2e/.runtime/lc-e2e-platform-<运行标识>/` 下建一个临时平台根：

- 复制 `server/`、`src/`、`shared/`、`assets/`、`vendor/`、`templates/` 与根目录 HTML、`package.json`；
- `templates/` 里自带的 `node_modules/` 不复制（35MB 且导出流程用不到），其余模板照常复制，导出用例才拿得到 `templates/tauri/config/desktop.json`；
- `data/`、`exports/`、`logs/` 全部落在临时根里，与真实 `data/sites` 完全隔离；
- 改写临时根的 `platform.config.json`（端口、`openBrowser: false`）；
- 写入 `.e2e-owner.json` 记录运行标识与进程号，测试服务退出时同步删除该目录。

依赖不复制 `node_modules`，靠 Node 从子目录向上查找到真实工程的 `lowcode/node_modules`。
这样既没有外链下载，也不会因为 junction/symlink 让 ESM 解析失败。

预检与 globalTeardown 会清理 `lc-e2e-platform-` 前缀且归属进程已退出的残留目录；
归属进程仍在运行、或刚创建不到 60 秒的目录一律跳过（并行跑多轮时不会互相删）。

## 无法完全自动化的流程（及原因）

以下流程在产品当前 UI 里没有入口，或天然无法在浏览器里断言，因此用例改用官方 API
或“渲染结果 + DOM 注入”的方式覆盖。它们仍属于回归范围，只是入口不同：

1. **新建站点**：工作台没有“新建站点”按钮。用例通过官方 `POST /api/sites` 创建临时站点，
   后续步骤全部走真实 UI。
2. **独立“新建页面”**：工作台没有单独的空白页创建入口，只有模板套用和页面导入。
   用例用模板套用 / 页面导入创建页面，再在 UI 里继续编辑。
3. **主题切换与亮暗切换**：工作台没有主题选择器和亮暗切换控件。用例先通过站点主题文件接口
   安装第二套主题，再调用 `POST /builder/render` 得到亮/暗两份文档，最后把文档注入画布的
   `srcdoc`，断言 `data-lc-mode` 与 `.lc-page` 上的主题 CSS 变量。这一步验证的是渲染层与
   主题变量链路，不是某个还不存在的按钮。
4. **“密钥明文不进入导出包”的完整链路**：导出向导确实会收集数据库密码，但用例不能假设
   用户本机有可用数据库。用例只填入唯一标记字符串作为密码，导出完成后扫描压缩包内所有文本
   文件，确认标记与 PEM 私钥头都没有出现；不发起任何数据库连接。
5. **导出包下载到磁盘后的解压**：Playwright 会把下载落到临时目录，用例直接用 JSZip 在内存
   里解压校验，不依赖本机解压软件，也不写进工程目录。
6. **真实数据兼容性**：按任务约束不触碰 `data/sites` 已有站点，所以“老站点升级后仍可打开”
   这类跨版本兼容回归不在本套用例范围内；需要另建只读副本的升级测试。

## 目录结构

```
tests/e2e/
├─ README.md
├─ .gitignore
├─ fixtures/                 # 页面 / 组件 / 模板的导入样例
├─ specs/                    # 十二个用例（含 Tauri、数据源、表单、文章、http 部署）
└─ support/
   ├─ api.mjs                # 取工作台令牌、调官方 API、临时站点创建/删除
   ├─ config.mjs             # 端口、平台根、浏览器探测
   ├─ drag.mjs               # DataTransfer 拖拽工具
   ├─ export.mjs             # 导出向导操作、产物解压、file:// 打开
   ├─ fixtures.mjs           # 失败产物 fixture + 临时站点 fixture
   ├─ preflight.mjs          # 一键环境预检（人话提示，不抛栈）
   ├─ reporter.mjs           # 发布前自检摘要：总数 / 通过 / 失败 / 失败原因
   ├─ serve.mjs              # 建隔离根并启动测试服务
   ├─ site-data.mjs          # 文章/图表页等用例数据准备
   ├─ static-server.mjs      # 本地静态服务，按 http 部署方式验证导出产物
   ├─ teardown.mjs           # 退出后清理残留隔离目录
   └─ temp-root.mjs          # 隔离平台根的创建与清理
```

## 关于 `file://` 与 http

Web 产物按部署方式使用（nginx / `npx serve web` / 本地静态服务），不再承诺双击 `file://`
可直接运行。用例用本地静态服务验证首页、文章页与图表页；同时反向断言 `file://` 打开时
能看到 `#lc-http-required` 的明确说明（提示改用 http 或导出 Tauri 桌面工程），而不是白屏。
Tauri 用例只检查产物结构与配置，不执行 `tauri build`；数据源连接测试只打本机
`/api/health` 与一个关闭的端口，不连数据库。
