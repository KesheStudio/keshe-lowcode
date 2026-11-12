# 低代码平台需求清单 · 合理性分级

> 核查基准：**以当前代码为唯一事实来源**，设计文档只用于对照。设计文档中「33 类组件」「表单/表格均无」等描述已过时，本文按实际注册表统计为 39 类。
>
> 核查日期：2026-11-08（第二轮刷新）
>
> 口径：共 39 条需求编号。其中第 4 条拆成「已落地」与「已定口径」两半，因此结论条目共 40 条。

## 总体判断

**上一版标为「待做」的 15 条已在本轮逐条复核后全部关闭，清单里不再有「待做但其实做了」的条目。** 其中 12 条在上一版核查后已经落地（7、11、12、14、16、20、21、29、30、37、38、39），2 条（26、28）随旧入口 `index.html` 按第 18 条删除而失去对象、新界面样式本身已满足，1 条（34）本轮补成了真实回退。现在 39 条需求全部有结论：37 条合理且已落地、3 条已定口径、0 条待做、0 条建议砍。

**上一版对第 38 条「还处在半成品」的判断已过时。** 后端积木的编辑页 `backend-flow.html`、导出管线的 `backend-flow` 编译步骤、三语言构建、节点能力矩阵与「后端组件」模型（项目内 + 全局）都已落地，并有三语言积木切片验证。

**仍然成立的旧判断：同一块地基被反复改。** 存储（文件存储、Lite 模式推翻）、导出形态（Web/Tauri 双目标）、后端（Rust 默认 → 三档 → 积木按块翻译）三处底层反复重构，每改一次都连带重写导出、校验、迁移和文档。第 25–36 条属于同一轮 UI 回归补样式，说明界面验收缺少一次性基线。

## 一、合理且已落地（37 条）

| 编号 | 需求 | 结论与实现位置 |
| --- | --- | --- |
| 1 | 存储改为文件存储，配置走 platform.config.json | 主链路已是服务端文件存储，配置集中读取；旧 `/index.html` 入口已按第 18 条删除。[fs-adapter.js](file:///c:/project/docs/lowcode/src/storage/fs-adapter.js#L29) · [config.js](file:///c:/project/docs/lowcode/server/src/config.js#L7) · [storage/index.js](file:///c:/project/docs/lowcode/src/storage/index.js#L17) |
| 2 | 资源平台自有、全面禁 CDN、编辑器库自托管 | 导出强制校验外链，编辑器库与运行库都只从 `node_modules` 复制到本地 `vendor/`，不保留 CDN 回退，也不塞进站点产物。[export-bundle.js](file:///c:/project/docs/lowcode/shared/export-bundle.js#L500-L511) · [vendor-sync.mjs](file:///c:/project/docs/lowcode/scripts/vendor-sync.mjs#L6-L13) |
| 3 | 导出可选 Web 或 Tauri，Tauri 默认配置可改 | 两目标注册、字段合并、自签证书与导入证书两条路径均已实现。[pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js#L200) · [desktop.json](file:///c:/project/docs/lowcode/templates/tauri/config/desktop.json) |
| 4a | Rust / Node / Go 后端 + nginx + HTTPS + CORS + 自定义配置 | 三语言模板齐全，nginx、CORS、自定义配置文件生成均可用；Java 已决定不做，见「已定口径」。[export-config.js](file:///c:/project/docs/lowcode/server/src/routes/export-config.js#L8) · [nginx.conf](file:///c:/project/docs/lowcode/templates/deploy/nginx/nginx.conf) · [pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js#L338-L525) |
| 5 | 一键启动脚本、一键迁移脚本 | `start.cmd` 起服务；`migrate.cmd` 接收站点目录路径直接导入同版本数据，不解析旧格式。[start.cmd](file:///c:/project/docs/lowcode/start.cmd#L5) · [migrate.cmd](file:///c:/project/docs/lowcode/migrate.cmd#L12) · [migrate.mjs](file:///c:/project/docs/lowcode/scripts/migrate.mjs#L11-L17) |
| 7 | 单页面内单个组件改代码 | 实例级覆盖不再区分自定义/内置：渲染引擎对每个区块读取 `block.overrides` 并校验后再套用，内置 `ui-*` 直接可改；e2e `ui-override` 用例在 `ui-slider` 实例上验证覆盖与默认实例并存。[engine.js](file:///c:/project/docs/lowcode/src/render/engine.js#L456-L458) · [builtin-instance-slider.spec.mjs](file:///c:/project/docs/lowcode/tests/e2e/specs/builtin-instance-slider.spec.mjs#L14-L21) |
| 8 | 源码导出默认压缩，可选不压缩 | CSS/JS 默认压缩、HTML 默认关闭但可单独开；关闭 HTML 是因为 zip 已压缩、再压反而更大，属合理默认。[export-minify.js](file:///c:/project/docs/lowcode/shared/export-minify.js#L283-L330) |
| 9 | 后端组件支持单独修改 | 用户区 `custom/` 为白名单可读写，生成区只读；界面有后端代码对话框与语言切换。[zones.js](file:///c:/project/docs/lowcode/server/src/code/zones.js#L3-L25) · [code.js](file:///c:/project/docs/lowcode/server/src/routes/code.js#L120-L150) |
| 10 | 文本框浮动标签/普通占位符；验证码逐格粘贴 | `floating` 开关切换两种标签；验证码粘贴按字符逐格分配，不补齐、不溢出。[textfield.js](file:///c:/project/docs/lowcode/src/render/components/textfield.js#L131-L147) · [otp.js](file:///c:/project/docs/lowcode/src/render/components/otp.js#L37-L68) |
| 11 | 拖拽上传、上传地址用户自配 | 组件级 endpoint/headers 可配且支持拖拽；站点级「上传目标」已有界面（数据页右栏面板，带校验与保存），上传组件默认继承站点配置。[data.html](file:///c:/project/docs/lowcode/data.html#L354-L401) · [data.html](file:///c:/project/docs/lowcode/data.html#L67) |
| 12 | 页面/组件/整站模板拖拽导入，分三个独立页 | 页面导入独立为 `page-import.html`（`data-drop-zone`，拖入高亮、路径冲突自动加后缀）；组件与模板在 builder 侧栏两个 drop zone 拖入后即时进列表，模板可一键套用成页面。实现形式与上一版「三个 drop zone 都在 builder」的描述不同，但三个入口确实各自独立。[page-import.html](file:///c:/project/docs/lowcode/page-import.html#L79) · [builder.js](file:///c:/project/docs/lowcode/assets/builder.js#L2073) · [import.spec.mjs](file:///c:/project/docs/lowcode/tests/e2e/specs/import.spec.mjs) |
| 13 | 日期组件单日期与双日期 | `mode: single / range`，双日期含起止输入与范围自动纠正。[date.js](file:///c:/project/docs/lowcode/src/render/components/date.js#L87) · [date.js](file:///c:/project/docs/lowcode/src/render/components/date.js#L122-L147) |
| 14 | 滑块与自动补全可配数据源 | 自动补全已接 `datasource`；滑块新增「数据源名称 + 取值方式（区间 min/max 或刻度 stops）」，运行时按注册表解析。产物自检里 `data-source-mode="range"` 的滑块实测能拿到 10/90 区间。[slider.js](file:///c:/project/docs/lowcode/src/render/components/slider.js#L56-L60) · [slider.js](file:///c:/project/docs/lowcode/src/render/components/slider.js#L90-L91) |
| 15 | 常用表单组件齐备 | 实际注册 39 类 `ui-*`，已覆盖表单、表格、弹窗、上传、日期、滑块等；「33 类」口径过时。[builtins.js](file:///c:/project/docs/lowcode/src/render/builtins.js#L52-L87) |
| 16 | Mermaid 语法必须兼容 | 导出时若页面用到 Mermaid，直接内联完整 `mermaid.min.js`（条件资源，含启动脚本），不再回退 CDN；产物自检确认无外链、运行时 `data-lc-mermaid-status=ready` 并产出 SVG。[pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js#L1541-L1559) · [export-bundle.js](file:///c:/project/docs/lowcode/shared/export-bundle.js) |
| 17 | 不动用户既有数据库订单数据 | D-55 立为项目红线：禁止任何试连真实库，平台只生成配置、不连接、不探测。[design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md#L422-L428) |
| 18 | 不考虑旧版兼容，旧版直接删 | 旧 IDB 迁移端点、旧包解析与旧入口 `index.html` 均已删除，迁移只接受当前格式站点目录。[design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md#L234-L239) · [migrate.mjs](file:///c:/project/docs/lowcode/scripts/migrate.mjs#L11-L17) |
| 19 | 首页项目创建与管理，区分静态/后端，后端也能打 Tauri | 首页建项目时选类型与后端语言；后端与 Tauri 是独立分支，不互斥。[home.html](file:///c:/project/docs/lowcode/home.html#L63-L87) · [sites.js](file:///c:/project/docs/lowcode/server/src/routes/sites.js#L26-L31) |
| 20 | 中间件可选择、配置、增删、独立页、导入导出 | 独立中间件页：内置项开关、自定义中间件新增/删除、JSON 导入导出；配置写进导出后端 `database / cache / middlewareGroups`，自定义项落 `customMiddleware`，密钥单独存放。[middleware.html](file:///c:/project/docs/lowcode/middleware.html#L53-L60) · [middleware.html](file:///c:/project/docs/lowcode/middleware.html#L104) |
| 21 | 统一配置中心，内置中间件带预设 | 平台侧已有配置中心页：按「内置默认 → 平台生成 → 站点覆盖 → 环境变量 → 启动参数」五层解析，表格给出最后命中的来源层。[config-center.html](file:///c:/project/docs/lowcode/config-center.html#L95) |
| 22 | 不强兼容 file:// | 交付前提明确为 http(s)，双击运行交给 Tauri 桌面目标。[design-decisions.md](file:///c:/project/docs/lowcode/design-decisions.md#L430-L436) |
| 23 | 不做苹果生态、安卓必须有、不要求 Linux 低端口、平台不做用户系统 | 桌面目标仅 win32/linux/android，无 darwin/ios；安卓产出 APK/AAB；平台服务固定高位端口 9780，不需要 80/443 权限；平台无账号体系。[pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js#L201-L206) · [platform.config.json](file:///c:/project/docs/lowcode/platform.config.json) · [android](file:///c:/project/docs/lowcode/templates/signing/android) |
| 24 | Windows 安装包给到具体位置由用户自测 | 构建参数 `--out` 指定输出目录，返回 JSON 给出 artifacts 与日志绝对路径。[build-app.md](file:///c:/project/docs/lowcode/templates/tauri/docs/build-app.md#L16) · [build-app.md](file:///c:/project/docs/lowcode/templates/tauri/docs/build-app.md#L57-L77) |
| 25 | 导出向导排版塌陷、右侧大片空白 | 卡片改为自适应宽度，选项网格自动填充，说明文字不再被挤成一列；观感仍需截图终验。[lc-wizard.css](file:///c:/project/docs/lowcode/assets/css/lc-wizard.css#L122-L132) · [lc-wizard.css](file:///c:/project/docs/lowcode/assets/css/lc-wizard.css#L465-L470) |
| 26 | 输入框过宽、遮挡其他元素 | 上一版指的旧 `index.html` 入口已删除，全仓 HTML 不再引用旧 `assets/app.css`；新界面输入类控件走 `lc-editor.css` 限宽（如 `max-width: 280px`）。[lc-editor.css](file:///c:/project/docs/lowcode/assets/css/lc-editor.css#L276) |
| 28 | 滚动条样式不统一、属性面板横向滚动 | 新界面统一由 `lc-controls.css` 的全局滚动条规则覆盖（含 track/thumb/corner/button），旧样式随旧入口一起退场。[lc-controls.css](file:///c:/project/docs/lowcode/assets/css/lc-controls.css#L21-L43) |
| 29 | 创建项目后无法回到首页 | builder 顶栏品牌区是回工作台的链接（`href="home.html"`，带 title/aria-label）。[builder.html](file:///c:/project/docs/lowcode/builder.html#L178) |
| 30 | 页面板块无「新建页面」，组件库/模板库为空 | 页面面板有「新建页面」按钮；组件库/模板库同样有新建与导入入口。[builder.html](file:///c:/project/docs/lowcode/builder.html#L253) |
| 31 | 后端代码面板没有新建文件入口 | 已加「新建文件」按钮与文件树，支持新建、导入、检查、保存、恢复模板。[builder.html](file:///c:/project/docs/lowcode/builder.html#L312) · [builder.js](file:///c:/project/docs/lowcode/assets/builder.js) |
| 32 | 预览 iframe 同时开 allow-scripts 与 allow-same-origin | 已移除 `allow-same-origin`，画布与预览均为 `allow-scripts allow-forms allow-popups`。[builder.html](file:///c:/project/docs/lowcode/builder.html#L241) |
| 33 | 首页卡片互相遮盖；纯静态仍显示后端语言 | 卡片网格化并统一 `min-width:0 / overflow:hidden`；类型标签纯静态只显示「纯静态」。[lc-home.css](file:///c:/project/docs/lowcode/assets/css/lc-home.css#L44-L76) · [home.js](file:///c:/project/docs/lowcode/assets/home.js#L64-L68) |
| 34 | 拖拽撑出滚动条、远处不自动滚动 | 边缘自动滚动本已实现；本轮把「撑出滚动条」补成**真实回退**：拖拽开始留快照，落位重渲染后由画布上报文档真实溢出（`overflowX/Y`，每次 `ready` 都上报，作为拖拽前基线），只有相对基线**新出现**的溢出才回退；回退时截掉这次移动压出的历史点、恢复拖拽前快照并自动保存，撤销栈不留坏状态。长页面自有滚动条不会被误判。[builder.js](file:///c:/project/docs/lowcode/assets/builder.js#L884-L892) · [builder.js](file:///c:/project/docs/lowcode/assets/builder.js#L1299-L1311) · [builder.js](file:///c:/project/docs/lowcode/assets/builder.js#L1545-L1590) |
| 35 | 页面限高限宽，支持 px / vh / vw | 尺寸校验接受 `px / vh / vw / % / rem`，渲染输出 `max-width / max-height / overflow:auto`。[page-size.js](file:///c:/project/docs/lowcode/src/render/page-size.js#L16) · [page-size.js](file:///c:/project/docs/lowcode/src/render/page-size.js#L40-L51) |
| 36 | 背景默认黑色，应取主题配色 | 画布、页面与 iframe 背景统一取主题令牌，令牌中无纯黑默认值。[engine.js](file:///c:/project/docs/lowcode/src/render/engine.js#L39-L47) · [lc-editor.css](file:///c:/project/docs/lowcode/assets/css/lc-editor.css#L616-L624) |
| 37 | 站点配置要有域名，接口默认用域名 + 路径 | 域名与 basePath 归一化后注入产物 `window.LC_PUBLIC_BASE_URL`，运行时 `resolveUrl` 统一消费（区块 endpoint、绑定数据源都走它）。产物自检实测请求为 `https://example.test/docs/api/items?event=click`。[runtime.js](file:///c:/project/docs/lowcode/src/render/runtime.js#L135) · [runtime.js](file:///c:/project/docs/lowcode/src/render/runtime.js#L147) · [runtime.js](file:///c:/project/docs/lowcode/src/render/runtime.js#L1186) |
| 38 | 后端积木搭建，可翻译成积木块自身支持的一种/两种/三种语言；自定义块归为「后端组件」 | 编辑页、导出接入、能力矩阵、后端组件模型都已在：`backend-flow.html` 是编辑器；导出管线新增 `backend-flow` 步骤（`buildFlowProject` 按目标语言编译）；节点注册表带语言能力矩阵与校验；后端组件分项目内/全局两层、可复用。三语言切片 `scripts/flow-slice.mjs node|go|rust` 全通过。[pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js#L1616-L1627) · [backend-flow.html](file:///c:/project/docs/lowcode/backend-flow.html) · [components.js](file:///c:/project/docs/lowcode/server/src/flow/components.js) · [validation.js](file:///c:/project/docs/lowcode/server/src/flow/validation.js#L415) |
| 39 | 配置中心与中间件设置面板 | 与第 20、21 条合并落地为两个独立页：`middleware.html`（中间件增删/配置/导入导出）与 `config-center.html`（五层覆盖解析与来源列）。[middleware.html](file:///c:/project/docs/lowcode/middleware.html) · [config-center.html](file:///c:/project/docs/lowcode/config-center.html) |

## 二、合理但待做（0 条）

上一版列出的 15 条已全部关闭，复核结论如下（证据见上表对应行）：

| 编号 | 上一版结论 | 本轮结论 |
| --- | --- | --- |
| 7 | 内置组件不能实例级改码 | 已落地：`engine.js` 对所有区块套 `overrides`，`ui-*` 实例可直接改 |
| 11 | 站点级上传目标只有契约无界面 | 已落地：数据页「上传目标」面板 |
| 12 | 页面导入仍混在 builder | 已落地，形式不同：页面导入独立页 + builder 侧栏组件/模板 drop zone |
| 14 | 滑块没有数据源 | 已落地：滑块 `datasource` + 区间/刻度两种取值 |
| 16 | Mermaid 仅 4 类图、存在 CDN 回退 | 已落地：条件内联完整 `mermaid.min.js`，无 CDN |
| 20 | 中间件写死、无界面 | 已落地：`middleware.html` + 导出配置接入 |
| 21 | 平台侧没有配置中心页面 | 已落地：`config-center.html` 五层覆盖 |
| 26 | 旧 `index.html` 输入框过宽 | 已消解：旧入口已删除，新界面限宽 |
| 28 | 滚动条样式不统一 | 已消解：`lc-controls.css` 全局覆盖，旧样式无入口引用 |
| 29 | builder 顶栏没有回首页 | 已落地：品牌链接指向 `home.html` |
| 30 | 页面面板没有新建页面 | 已落地：`data-new-page` 按钮 |
| 34 | 撑出滚动条只提示不回滚 | 本轮补成真实回退（快照 + 基线溢出判定 + 截断历史点） |
| 37 | 运行时仍原样用区块 endpoint | 已落地：`resolveUrl` 消费 `LC_PUBLIC_BASE_URL`，产物实测带域名与 basePath |
| 38 | 编辑页/导出接入/能力矩阵/后端组件都缺 | 已落地：四项均已具备（上一版判断过时） |
| 39 | 配置中心与中间件面板 | 已落地：两个独立页 |

## 三、已定口径（3 条）

### 4b. Java 后端已决定不做

- **结论**：Java 早已排除，无需再议；后端固定 Rust / Node / Go 三档，不再开第四个分叉。
- **落地口径**：语言枚举与导出向导只保留 `none / rust / node / go`，任何清单与文档都不再把 Java 列为候选。[export-config.js](file:///c:/project/docs/lowcode/server/src/routes/export-config.js#L8)

### 6. 多任务并行指开发流程并行

- **结论**：指开发阶段多开几条任务并行推进、加快落地，与产品运行时的并发行为无关。
- **边界**：平台不做同站点并发写，`site.lock` 保持；同一站点的第二个写入方仍返回 423。[locks.js](file:///c:/project/docs/lowcode/src/storage/locks.js) · [MODULE-DESIGN.md](file:///c:/project/docs/lowcode/MODULE-DESIGN.md#L88-L114)

### 27. 集合 ID 保持不可变

- **结论**：不提供改 ID，也不做别名；界面注明「创建后固定，避免破坏引用」即可。
- **理由**：ID 是数据、路由、导出和前端绑定的共同主键，改动要全量重写，收益不匹配风险。[data.html](file:///c:/project/docs/lowcode/data.html#L95)

## 四、不建议做（0 条）

本轮没有建议砍掉的需求，也没有需要撤回的旧结论。

## 汇总与回报

- **数量**：合理且已落地 37 条；合理但待做 0 条；已定口径 3 条；不建议做 0 条。合计 40 条结论，覆盖 39 个需求编号（第 4 条拆两半）。
- **本轮改动**：第 34 条从「只提示」改为真实回退（拖拽前快照 + 渲染后溢出基线比较 + 截断历史点 + 自动保存回退结果），说明同步更新到 [03-pages-and-components.md](file:///c:/project/docs/lowcode/docs/manual/03-pages-and-components.md#L158)。
- **剩余风险（非待做项，发布前需知情）**：
  1. 第 34 条的回退只在「相对拖拽前新出现溢出」时触发；页面原本就有的滚动条不会触发，属于设计取舍。
  2. 第 38 条在站点未保存后端流程时，导出只带模板自带接口（导出记录提示 `LC_W_FLOW_EMPTY`），属预期提示而非缺陷。
  3. 第 26/28 条的关闭依赖「旧入口已删除」这一事实；若将来重新引入旧入口，需要重新评估。
