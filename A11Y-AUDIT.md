# 无障碍批量审计（A11Y-AUDIT）

- 审计日期：2026-11-08
- 审计性质：**只读**。未修改任何被审页面、样式、脚本或数据；仅新增本报告与 `logs/a11y/` 下的扫描证据。
- 范围：`builder.html`、`export.html`、`data.html`、`index.html`、`diagnostics.html`、`src/render/demo.html`、`src/theme/editor.html`、`src/theme/switcher-demo.html`，以及导出产物示例站（`data/.fixtures` 中 `artifact.zip` 解出的 `web/index.html`，扫描时临时解压到 `%TEMP%\lc-a11y-export\web\index.html`）。
- 结论：**8 个页面 + 1 个导出站共发现 29 个违规节点**（含 `about:blank` 辅助 frame 的 4 条噪声与 builder 画布 iframe 的 1 条），去重后 **21 条问题**（严重 3、高 8、中 7、低 3）。渲染层组件与主题层演示页整体达标，问题集中在 **编辑器壳（弹窗焦点管理）** 和 **旧版 `assets/app.css` 调色板**。

---

## 一、扫描方法

### 1. 自动扫描

| 项 | 值 |
|---|---|
| 引擎 | `axe-core`（**本地 npm 安装**，未引任何 CDN） |
| 驱动 | `puppeteer-core` + 本机 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`，headless） |
| 规则集 | `wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`、`wcag22aa`、`best-practice` |
| 视口 | 1440 × 900，真实布局与颜色计算 |
| 服务 | 本地 Fastify `http://127.0.0.1:9780`（`node server/index.js --no-open`）；`src/**` 页面用 `file://` 直开（本地服务不提供 `src` 静态路径） |
| iframe | 递归扫描 `page.frames()`，跳过 `mainFrame`；覆盖 builder 的画布 `about:srcdoc` 与 index 的辅助 `about:blank` |
| 证据 | `logs/a11y/axe-results.json`（原始结果）、`logs/a11y/summary.txt`（逐页摘要）、`logs/a11y/manual.json`（手工键盘测试） |

复现：

```powershell
cd c:\project\docs\lowcode
npm install --no-save --package-lock=false axe-core puppeteer-core
node server/index.js --no-open          # 另一个终端
node logs/a11y/audit.mjs
node logs/a11y/manual.mjs
```

### 2. 手工核对

自动扫描不覆盖交互状态与焦点行为，以下六项用手工 + 脚本实测（`logs/a11y/manual.json`）：

1. 主流程能否只靠键盘走完；
2. Tab 顺序是否符合视觉顺序；
3. 弹层（modal / dialog / overlay）焦点陷阱；
4. Esc 能否关闭弹层；
5. 异步反馈是否需要 `aria-live`；
6. 表单错误能否被读屏关联到字段。

---

## 二、问题清单（按严重程度排序）

> 严重度映射：axe `critical` → **严重**；`serious` → **高**；`moderate` → **中**；`minor`/误报 → **低**。
> 影响维度：**键盘** = 只能用键盘操作的人；**读屏** = 屏幕阅读器用户；**低视力** = 需要更高对比度/更大字号的人。

### 严重（P0，必须先修）

#### B-01 编辑器页面属性输入框没有可访问名称

- **页面**：`builder.html`
- **选择器**：`input[data-page-field="title"]`、`input[data-page-field="slug"]`、`input[data-page-field="path"]`、`input[type="checkbox"][data-page-field="nav"]`
- **问题**：axe 规则 `label`（critical）。`<label class="lc-label"><span>页面标题</span></label>` 与 `<input>` 是**兄弟节点**，既没有 `for`/`id` 关联，输入框也没有被 `<label>` 包裹；导航复选框那一行还多出一个孤立的 `</label>`。
- **影响**：读屏——聚焦时只播报「编辑框」，无法区分标题 / Slug / 输出路径 / 是否进导航；低视力——无额外影响；键盘——可聚焦但语义缺失。
- **修复**：`assets/builder.js`
  - `fieldHtml()`（约 1499 行）改为生成唯一 id：`var fid = 'lc-field-' + key;`，`<label class="lc-label" for="'+fid+'">`，并给 `input` / `select` 加 `id="'+fid+'"`。
  - `renderInspector()` 页面字段（1518–1530 行）同样加 `id` + `for`：`lc-page-title`、`lc-page-slug`、`lc-page-path`、`lc-page-nav`、`lc-page-layout`。
  - 1524–1525 行把复选框移进 `<label class="lc-label">` 内，并删掉多余的 `</label>`。

#### B-02 页面布局下拉框没有可访问名称

- **页面**：`builder.html`
- **选择器**：`select[data-page-field="layout.mode"]`
- **问题**：axe 规则 `select-name`（critical）。`<label>` 只包住 `<span>页面布局</span>`，`<select>` 在其后，无 `for`/`id`/`aria-label`。
- **影响**：读屏——只播报「下拉框 流式」，不知道在改什么；键盘——可操作但语义缺失。
- **修复**：按 B-01 的 `id`/`for` 方案处理 `assets/builder.js:1526–1530`。

#### B-03 树节点按钮使用不允许的 `aria-selected`

- **页面**：`builder.html`
- **选择器**：`.lc-builder-page-item`、`button[data-path="0"]`、`button[data-path="0.0"]`、`button[data-path="0.1"]`、`button[data-path="1"]`、`button[data-path="2"]`（共 6 节点）
- **问题**：axe 规则 `aria-allowed-attr`（critical）。`aria-selected` 只允许出现在 `option` / `tab` / `gridcell` / `treeitem` 等角色上，原生 `<button>` 不合法。
- **影响**：读屏——属性被忽略或产生噪声，无法判断「当前选中」；键盘——无影响。
- **修复**：`assets/builder.js`
  - 914–915 行（层级树行）与 1821–1822 行（页面列表行）删除 `aria-selected`；选中态改用 `aria-current="true"`（无选中时移除该属性），视觉态继续用现有的 `.is-active`。
  - 若后续要做完整树语义，再补 `role="tree"` / `role="treeitem"` / `tabindex`（见 B-06），否则不要半套 ARIA。
  - 注意：`builder.html:95–98` 的 `role="tablist"` / `role="tab"` + `aria-selected` 是**合法**的，不要一起改。

### 高（P1，影响主流程可用性）

#### I-01 旧调色板主按钮在暗色下只有 2.1:1

- **页面**：`index.html`
- **选择器**：`.lc-sidebar-actions > .lc-btn-primary[data-new-article]`、`button[data-save-now]`、`.lc-empty-actions > .lc-btn-primary[data-new-article]`（3 节点）
- **问题**：axe `color-contrast`（serious）。前景 `#fdfbf4`、背景 `#8fb9a1`，对比度 **2.1:1**（要求 4.5:1）。
- **影响**：低视力——暗色模式下主按钮文字几乎读不出；读屏/键盘——无影响。
- **根因**：`index.html:13` 只引入旧版 `assets/app.css`，没有引入令牌层 `assets/css/lc-tokens.css`。`assets/app.css:37–60` 的暗色 `--accent:#8fb9a1` 是「强调文字色」，却被 `assets/app.css:663–664` 当作**按钮底色**，再写死 `color:#fdfbf4`。同一硬编码白字还出现在 `assets/app.css:470`、`:485`；`:544` 行是 `color:#fdfbf4; background: var(--ink)`，暗色下 `--ink` 变成浅色，同样翻转失败。
- **修复**（二选一，推荐 A）：
  - A. **主题层**：`index.html` 引入 `assets/css/lc-tokens.css`（放在 `assets/app.css` 之前）；`663–664`、`470`、`485` 改为 `background: var(--lc-color-accent-fill)` + `color: var(--lc-color-on-accent)`，`544` 改为 `color: var(--lc-color-on-accent)`（若底色仍为 `--ink`，则文字改用与 `--ink` 成对的反色变量）。
  - B. 若暂时不迁令牌：把暗色 `--accent` 改回深色（如 `#3e6a56`），白字可过；但这会同时改变链接与图标色，不推荐。
- **状态：已修复（2026-11-08，主题层批次）**。`index.html` 已引入 `assets/css/lc-tokens.css`；`assets/app.css` 的主按钮、步骤序号、拖拽徽标改用 `--lc-color-accent-fill` / `--lc-color-on-accent`；`assets/app.js` 的色板派生补上这三个正式令牌（亮色取近纸白文字、暗色取深色文字，4 套色板亮暗实测最低 5.27:1）。详见第七节。

#### I-02 主题切换按钮的可访问名称不含可见文字

- **页面**：`index.html`
- **选择器**：`.lc-theme[data-theme-toggle]`
- **问题**：axe `label-content-name-mismatch`（serious）。`aria-label="切换明暗模式"`，但可见文字是「跟随系统 / 亮色 / 暗色」，二者不一致，语音控制按可见文字点不到。
- **影响**：读屏——播报名与实际状态脱节；键盘——无影响；语音控制用户——无法用可见文字定位。
- **修复**：`assets/app.js:1697–1704` 的 `paintThemeLabel()` 在更新 `title` 的同一次调用里同步 `aria-label`：
  ```js
  toggle.setAttribute('aria-label', '切换明暗模式（当前：' + label.textContent + '）');
  ```
  同时把 `index.html:85` 的初始 `aria-label` 改成「切换明暗模式（当前：跟随系统）」。

#### B-04 拖拽导入区的可访问名称缺少可见说明

- **页面**：`builder.html`
- **选择器**：`div[data-drop-zone="page"]`（另两处同类：`data-drop-zone="component"`、`data-drop-zone="template"`）
- **问题**：axe `label-content-name-mismatch`（serious）。`aria-label="拖入页面文件导入"`，可见文字还包含「.json · 支持多文件 · 单个 ≤ 512 KB」。
- **影响**：语音控制——说可见文字无法命中；读屏——可识别但信息不完整。
- **修复**：`builder.html:104`、`129`、`152` 的 `aria-label` 补全为可见文字，例如「拖入页面文件，.json，支持多文件，单个不超过 512 KB」。

#### D-01 诊断页正文说明文字对比度 4.38:1

- **页面**：`diagnostics.html`
- **选择器**：`.lead`
- **问题**：axe `color-contrast`（serious）。`#6b7076` on `#f4f0e6` = **4.38:1**，差 0.12。
- **影响**：低视力——15px 正文略吃力。
- **修复**：`diagnostics.html:10` 的 `--muted` 从 `#6b7076` 改为令牌层同款 `#5f656b`（`assets/css/lc-tokens.css:106`），即可稳定过 4.5:1；同文件 27、31、40 行的次要文字会一起受益。

#### R-01 渲染验收页 8 处对比度不足，含一个「幽灵令牌」

- **页面**：`src/render/demo.html`
- **选择器与实测值**：

| 选择器 | 前景 / 背景 | 对比度 |
|---|---|---|
| `.demo-btn-primary`（「切换横幅状态」） | `#0f1512` / `#151a18` | **1.04:1** |
| `#stats`（`.demo-toolbar-note`） | `#7f8982` / `#1d2421` | 4.37:1 |
| `.demo-stat-hint` | `#7f8982` / `#1d2421` | 4.37:1 |
| `.demo-article-meta` ×3 | `#7f8982` / `#1d2421` | 4.37:1 |
| `.lc-shell-footer-title` ×2 | `#7f8982` / `#232b27` | 4.01:1 |

- **问题**：axe `color-contrast`（serious）。
  - `1.04:1` 的根因是 **`--lc-color-accent-fill` 未定义**：`src/render/samples/sample.css:41` 用该变量做背景，而 `src/render/samples/site.data.js` 的主题里只写了 `--lc-color-accent` / `--lc-color-on-accent`，没有 `accent-fill`。背景声明失效后回落到页面底色 `#151a18`，而文字仍是给填充色准备的 `#0f1512`（`site.data.js:59`）。
  - `4.37:1` / `4.01:1` 来自暗色 `--lc-color-muted-2: #7f8982`（`site.data.js:55`）。
- **影响**：低视力——主按钮近乎不可读，元信息与页脚标题勉强可读；读屏/键盘——无影响。
- **修复**：
  - **渲染层（示例数据）**：`src/render/samples/site.data.js` 每套主题补 `--lc-color-accent-fill` / `--lc-color-accent-fill-hover`（浅色可用 `accent` 加深值，暗色用更深的绿，例如 `#2f5545`），并保证与 `--lc-color-on-accent` ≥ 4.5:1；这是 `src/theme/NOTES.md:161` 已经写明的规则。
  - **渲染层（示例数据）**：暗色 `--lc-color-muted-2` 提到 `#8b9590` 左右（`#1d2421` 上 ≥ 4.5）；页脚标题若继续用 `muted-2`，需在 `#232b27` 上复算。
  - **主题层**：`sample.css` 不改写死值，继续保持「只引用令牌」的正确方向。
- **状态**：**令牌派生部分已修复**。`src/theme/runtime.mjs` 已为每套主题派生 `accent-fill` / `on-accent`，`check.mjs` 逐套核对 66 个令牌齐全且对比度达标（10 套主题亮暗 20 组全绿）；**示例数据部分（`samples/site.data.js` 未写 `accent-fill`）仍归渲染层**，见第四节 B 组。

#### E-01 编辑器确认弹窗没有焦点陷阱，关闭后焦点不归还

- **页面**：`index.html`（弹窗由 `assets/app.js` 驱动）
- **选择器**：`.lc-modal[data-modal]` → `.lc-modal-box[role="dialog"]`
- **问题**：手工实测（`logs/a11y/manual.json` → `editorModal`）：
  - Tab 第 6 次即离开弹窗，落到 `BODY` / 背景标签页（`escaped: true`）；
  - Esc 可以关闭（`closed: true`），但关闭后焦点落在背景的 `.lc-tab`「导出」，**没有回到打开弹窗的按钮**；
  - 弹窗外背景未 `inert` / 未 `aria-hidden`，读屏仍可浏览背景内容。
- **影响**：键盘——弹窗打开后会「走丢」到背景，删除/覆盖等确认操作容易误触；读屏——模态上下文不成立，会继续读到背景；低视力——无影响。
- **修复**：`assets/app.js`
  - `showModal()`（587–606 行）记录 `state.modalReturnFocus = document.activeElement`；给 `.lc-modal-box` 加 `tabindex="-1"` 并 `focus()`；
  - 新增 `keydown` 监听：`Tab` / `Shift+Tab` 在 `.lc-modal-box` 内循环（可复用渲染层 `components/common.js` 的 `focusables()` 思路），`Escape` 关闭；
  - 打开时对背景 `document.querySelector('.lc-shell')` 加 `inert`（不支持时加 `aria-hidden="true"`），关闭时移除；
  - `hideModal()`（579–585 行）把焦点还给 `state.modalReturnFocus`，再清空该引用。

#### B-05 保存冲突对话框没有焦点管理

- **页面**：`builder.html`
- **选择器**：`.lc-dialog-backdrop[data-conflict]` → `.lc-dialog[role="dialog"][aria-modal="true"]`
- **问题**：手工核对源码（`assets/builder.js:1911–1956`）：
  - 打开后不聚焦对话框内任何控件，焦点留在原来的属性面板；
  - 无 `Tab` 焦点陷阱；
  - 无 `Escape` 关闭（全局 `onKeydown` 也不处理 Escape）；
  - `closeConflictDialog()`（1953–1956 行）直接 `remove()`，不归还焦点。
- **影响**：键盘——冲突是保存阻塞态，键盘用户无法快速在「稍后处理 / 放弃 / 覆盖」之间安全选择；读屏——弹窗出现无提示、无模态上下文。
- **修复**：`assets/builder.js`
  - 打开后 `dialog.querySelector('[data-conflict-later]').focus()`（或先聚焦 `h2`）；
  - 在 backdrop 上监听 `keydown`：`Escape` → 等同「稍后处理」；`Tab` 在三个按钮内循环；
  - 记录触发前的 `document.activeElement`，关闭时归还；
  - 背景加 `inert`，关闭移除。

#### E-02 导出 / 数据页的异步状态没有 `aria-live`

- **页面**：`export.html`、`data.html`
- **选择器**：`span[data-status-text]`（`export.html:486`、`builder.html:224`）、`div.lc-toast`（`assets/data.js:174–180`）、`span[data-editor-state]`（`data.html:68`）
- **问题**：手工核对代码：
  - `assets/export.js:160–169` 的 `setStatus()` 只改 `textContent` 和颜色；状态栏没有 `role="status"` / `aria-live`，导出进度、成功、失败都不会被播报；
  - `assets/data.js:174–180` 的 `toast()` 动态创建 `div` 后直接 `appendChild`，没有 `role="status"` 或 `aria-live`，错误提示对读屏不可见；
  - `data.html:68` 的 `[data-editor-state]` 同样只是视觉徽标。
- **影响**：读屏——导出是长任务，完成后没有任何可听反馈，用户会反复重试；错误提示只有颜色和 3.6 秒自动消失的浮层；键盘/低视力——无影响。
- **修复**：
  - `export.js` 的 `setStatus()` 末尾给 `refs.statusText` 补 `role="status"` + `aria-live="polite"`（错误态用 `assertive`，并在 `aria-live` 切换前先清空再写入，确保重复文案也能播报）。
  - `data.js` 的 `toast()` 创建节点后设置 `role="status"`、`aria-live="polite"`（`kind === 'error'` 时 `role="alert"`），再 `appendChild`；移除前不要立即清空文字。
  - `data.html:68` 的徽标补 `role="status"`。
  - 参考已达标的 `assets/builder.js:156–163`（toast 已带 `role="status"`）与 `index.html:532`（`.lc-toast` 自带 `role="status" aria-live="polite"`）。

### 中（P2，结构性 / 一致性）

#### H-01 页面缺少一级标题（5 个页面 + 导出站）

- **页面与选择器**：

| 页面 | 现状 |
|---|---|
| `builder.html` | `html` 全局无 `<h1>`（`page-has-heading-one`） |
| `export.html` | 同上 |
| `data.html` | 同上 |
| `index.html` | `<h1>` 只存在于隐藏视图（`index.html:193/250/300/355/459`），当前激活的「内容」视图没有 |
| `src/render/demo.html` | `html` 无 `<h1>`（验收页本身） |
| 导出站 `web/index.html` | 无 `<h1>`（`page-has-heading-one`） |
| `builder.html` 画布 iframe | `about:srcdoc` 无 `<h1>`（见 S-02，按画布性质从轻处理） |

- **影响**：读屏——缺少页面级标题，`H` 键导航无落点，页面大纲从二级标题开始；键盘/低视力——无直接影响。
- **修复**：
  - `builder.html`：在顶栏品牌区加视觉隐藏的 `<h1 class="lc-sr-only">Builder · 低代码建站器</h1>`（若没有 `.lc-sr-only`，用 `assets/css/lc-a11y.css` 的 skip-link 隐藏写法）。
  - `export.html` / `data.html`：同上，标题为「导出向导」「数据源管理」。
  - `index.html`：在「内容」视图（`#view-articles`）的列表上方加一个可见或视觉隐藏的 `<h1>内容</h1>`；其余视图已有 h1，保持。
  - 导出站：见 R-04。

#### R-02 验收页出现两个 banner 地标且不可区分

- **页面**：`src/render/demo.html`
- **选择器**：`.demo-toolbar`（`header`）× 站点外壳 `header`
- **问题**：axe `landmark-no-duplicate-banner` + `landmark-unique`（moderate）。验收工具栏和外壳头部都是 `<header>`，且都没有可区分的名称。
- **影响**：读屏——地标列表出现两个「横幅」，无法快速跳转；键盘/低视力——无影响。
- **修复**：`src/render/demo.html:55` 把 `.demo-toolbar` 从 `<header>` 改为 `<div role="region" aria-label="验收工具栏">`（或者保留 `<header>` 但移出 `<main>`/给外壳 header 加不同 `aria-label`，二者只留一个 banner）。

#### R-03 验收报告不在任何地标内

- **页面**：`src/render/demo.html`
- **选择器**：`#report`
- **问题**：axe `region`（moderate）。`.demo-report` 位于 `<main>` 之外，也不在任何 landmark 中。
- **影响**：读屏——地标跳转无法覆盖到报告区；键盘/低视力——无影响。
- **修复**：`src/render/demo.html:72` 的 `#report` 移入 `<main>`（例如放进 `#app` 内的主内容容器），或给它加 `role="status"` 并放进已有地标。

#### B-06 层级树的折叠开关键盘不可达

- **页面**：`builder.html`
- **选择器**：`span.lc-tree-toggle[data-collapse-id]`（`role="button"`）
- **问题**：手工核对源码：`assets/builder.js:919–921` 生成 `<span role="button" aria-label="折叠/展开">`，但**没有 `tabindex="0"`**，也没有 `keydown` 处理；点击处理在 1326–1333 行，仅响应 `click`。它还被嵌套在父级 `<button>` 内，形成嵌套交互。
- **影响**：键盘——无法折叠/展开树分支，层级深的页面只能看当前展开状态；读屏——会播报一个「按钮」，但键盘无法触达，属于「说有却做不到」。
- **修复**：`assets/builder.js:919` 把折叠控件改成**独立 sibling 按钮**（不要嵌在父 `<button>` 内）： `<button type="button" class="lc-tree-toggle" data-collapse-id="…" aria-expanded="true|false" aria-label="展开/折叠 …">`，并保留 `click` 逻辑；这样原生按钮自带键盘与语义，同时消除嵌套交互。

#### B-07 保存状态变化对读屏静默

- **页面**：`builder.html`
- **选择器**：`span[data-save-state]`
- **问题**：`builder.html:82` 的「已保存 / 保存中 / 保存失败」徽标没有 `role="status"` / `aria-live`；`updateSaveState()` 只改文本与 class。对比之下 `assets/builder.js:156–163` 的 toast 已带 `role="status"`。
- **影响**：读屏——自动保存结果不可知，用户无法确认改动是否落盘；键盘/低视力——无影响。
- **修复**：`builder.html:82` 加 `role="status" aria-live="polite"`；失败态需要更及时时，在 `updateSaveState()` 里把 `aria-live` 切到 `assertive`。

#### I-03 编辑器视图标签没有暴露当前项

- **页面**：`index.html`
- **选择器**：`.lc-tab[data-view]`
- **问题**：`index.html:71–76` 是一组普通按钮，只有 `.is-active` 视觉态，没有 `aria-current` / `aria-selected`；`switchView()`（`assets/app.js:1706–1715`）也只切 class。
- **影响**：读屏——无法知道当前在「内容 / 组件库 / 颜色方案 / …」哪一屏；键盘——可切换但没有状态反馈。
- **修复**：`assets/app.js:1706–1715` 在切换时给激活项设 `aria-current="page"`、其余移除；按钮本身无需改成 tab 角色（避免和 builder 的 tablist 混淆）。

#### E-03 编辑器表单错误没有和字段关联

- **页面**：`index.html`（文章编辑、站点设置等弹窗表单）
- **选择器**：`.lc-field > span` + `select[data-doc-field]`（`assets/app.js:2361–2364`）、弹窗内错误段落 `.lc-modal-body > p`
- **问题**：手工核对：字段用 `<div class="lc-field"><span>主题</span><select …></div>`，`span` 不是 `<label>`，`select` 无 `id`/`aria-label`；保存失败时错误以文本段落或 toast 呈现，没有 `aria-invalid`、`aria-describedby`、`role="alert"`。
- **影响**：读屏——不知道哪个字段错了，也读不到具体原因；键盘——无影响；低视力——只能靠颜色。
- **修复**：`assets/app.js`
  - 动态表单统一生成 `<label class="lc-label" for="…">` + `id`（或 `aria-label`）；
  - 校验失败时给控件加 `aria-invalid="true"`、`aria-describedby="<错误节点 id>"`；
  - 错误节点用 `role="alert"`，或在弹窗内放一个常驻 `aria-live="assertive"` 区域；
  - 可参考渲染层已达标的写法：`src/render/components/form.js:333–334、366、482–485`。

### 低（P3，可暂缓）

#### S-01 index 的 `about:blank` 辅助 iframe 报 4 条

- **页面**：`index.html`
- **选择器**：`iframe` → `about:blank`（`document-title`、`html-has-lang`、`landmark-one-main`、`page-has-heading-one`）
- **问题**：该空白 iframe 是运行时辅助容器（导出/预览用），不是可访问内容。
- **影响**：无实际用户影响。
- **修复**：无需改 HTML。若要消除噪声，在 `audit.mjs` 里跳过 `about:blank`，或在容器上保持 `aria-hidden="true"` / `tabindex="-1"`。

#### S-02 builder 画布 iframe 缺 h1

- **页面**：`builder.html`
- **选择器**：`iframe[data-canvas]` → `html[data-lc-builder="1"]`
- **问题**：`page-has-heading-one`。画布是用户页面的预览，标题层级由页面内容决定。
- **影响**：画布内的读屏用户会少一个页面标题；但它本身是编辑画布，优先级低。
- **修复**：由渲染层/页面内容决定（同 R-04）；不建议在画布注入假 h1。

#### S-03 `frame-tested` 规则为 incomplete

- **页面**：`builder.html`
- **问题**：axe 提示 iframe 未跑完整测试（`incomplete`），原因是跨文档扫描需要显式注入。
- **影响**：无用户影响，属于扫描覆盖说明。
- **修复**：`audit.mjs` 已对 `about:srcdoc` 注入 axe；保留该实现即可，报告中将 `incomplete` 视为「已覆盖」。

---

## 三、手工核对结果

| 核对项 | 结论 | 证据 / 说明 |
|---|---|---|
| 键盘能否走完主流程 | **部分通过** | index：Tab 可到「内容 → 组件库 → … → 导出 → 新建文章 → 筛选 → 文章树」；builder：可到页面字段与页面树；export：可到站点选择 → 4 个步骤 → 下一步；data：可到集合操作。**阻塞点**：编辑器弹窗无法在内部循环（E-01）、builder 冲突弹窗无初始焦点（B-05）、树折叠开关键盘不可达（B-06）。 |
| 焦点顺序是否合理 | **通过** | 各页面 Tab 序列与 DOM/视觉顺序一致（顶栏 → 侧栏 → 内容 → 页脚）。序列末尾出现 `BODY` 是浏览器把焦点交给浏览器 UI，属正常。 |
| 弹层焦点陷阱 | **失败（编辑器）/ 通过（渲染层）** | `index.html` 的 `.lc-modal` 第 6 次 Tab 逃逸；`builder.js` 冲突框无陷阱；渲染层 `src/render/components/overlay.js:235–254` 有 Tab/Shift+Tab 循环、`openStack` 只让栈顶响应，**源码判定通过**。demo 示例页当前没有 `.lc-ui-overlay-trigger`，无法动态复核，已在 R-01 相关说明中标注。 |
| Esc 关闭 | **部分通过** | 编辑器弹窗 Esc 可关（`app.js:1650–1655`），但焦点不归还；builder 冲突框 Esc 无效；渲染层 overlay 支持 `closeOnEsc` 且仅栈顶响应 `overlay.js:246–250`。 |
| `aria-live` 是否该有 | **部分通过** | 已有：`index.html:532`（toast，`role=status aria-live=polite`）、`builder.js:156–163`（toast，`role=status`）。缺失：`export.html` 状态栏（E-02）、`data.js` toast（E-02）、`data.html` 编辑徽标、`builder.html` 保存徽标（B-07）。 |
| 表单错误能否被读屏读到 | **失败（编辑器）/ 通过（渲染层）** | 编辑器动态表单无 `aria-invalid` / `aria-describedby` / `role=alert`（E-03）；渲染组件 `form.js`、`textfield.js`、`otp.js`、`upload.js`、`date.js`、`autocomplete.js` 均已实现字段级错误关联（见通过项）。 |

---

## 四、按模块分派

### A. 主题层（`src/theme/**`、`assets/css/lc-*.css`、令牌）

| 项 | 文件 | 要改什么 |
|---|---|---|
| I-01 | `index.html:13` + `assets/app.css:663–664、470、485、544` | 引入 `assets/css/lc-tokens.css`；主按钮改用 `--lc-color-accent-fill` / `--lc-color-on-accent` |
| R-01（令牌部分） | `src/theme/NOTES.md`（规则已存在）+ 示例数据 | 确保每套主题都派生 `accent-fill`，与 `on-accent` ≥ 4.5:1 |
| 通过项维护 | `assets/css/lc-a11y.css`、`assets/css/lc-tokens.css` | 保持 skip link、focus-visible、forced-colors、reduced-motion 与令牌对比度校验 |

> 注：`src/theme/editor.html`、`src/theme/switcher-demo.html` 自动扫描 **0 violation**，主题层自身无需返工。

### B. 渲染层（`src/render/**`）

| 项 | 文件 | 要改什么 |
|---|---|---|
| R-01 | `src/render/samples/site.data.js:29–63` 等主题 | 补 `--lc-color-accent-fill` / `-hover`；暗色 `--lc-color-muted-2` 由 `#7f8982` 提到约 `#8b9590` |
| R-02 | `src/render/demo.html:55` | `.demo-toolbar` 改 `div[role="region"]` 或保证仅一个 banner |
| R-03 | `src/render/demo.html:72` | `#report` 移入 `<main>` |
| R-04（导出站 h1） | 导出模板 / 外壳（`src/render/shell.js` 或预设页） | 导出首页应有唯一 `<h1>`（站点名或首块标题） |
| 通过项维护 | `overlay.js`、`form.js`、`textfield.js`、`otp.js`、`upload.js`、`date.js`、`autocomplete.js`、`common.js` | 不改；`overlay.js` 的陷阱与归还焦点作为编辑器弹窗的参考实现 |

### C. 编辑器层（页面 HTML + `assets/app.js` / `assets/builder.js` / `assets/data.js` / `assets/export.js` / `assets/app.css` 旧壳）

| 项 | 文件 | 要改什么 |
|---|---|---|
| B-01 / B-02 | `assets/builder.js:1499、1518–1530` | 字段 id + `for`；修掉多余 `</label>` |
| B-03 | `assets/builder.js:914–915、1821–1822` | 删除 `aria-selected`，改用 `aria-current` |
| B-04 | `builder.html:104、129、152` | `aria-label` 对齐可见文字 |
| B-05 | `assets/builder.js:1911–1956` | 初始焦点、Tab 陷阱、Esc、归还焦点、背景 inert |
| B-06 | `assets/builder.js:919` | 折叠控件改为独立 `<button aria-expanded>` |
| B-07 | `builder.html:82` | `role="status" aria-live="polite"` |
| I-02 | `assets/app.js:1697–1704`、`index.html:85` | 同步 `aria-label` |
| I-03 | `assets/app.js:1706–1715` | 激活标签 `aria-current="page"` |
| E-01 | `assets/app.js:579–606`、`index.html:534–541` | 焦点陷阱、归还、背景 inert、`tabindex="-1"` |
| E-02 | `assets/export.js:160–169`、`assets/data.js:174–180`、`export.html:486`、`data.html:68` | `role="status"` / `aria-live`；错误用 `alert`/`assertive` |
| E-03 | `assets/app.js:2361–2364` 及动态表单 | label 关联 + `aria-invalid` + `aria-describedby` + `role=alert` |
| D-01 | `diagnostics.html:10` | `--muted` 改 `#5f656b` |
| H-01 | `builder.html`、`export.html`、`data.html`、`index.html` | 补页面级 `<h1>`（可视觉隐藏） |

**建议排序**：先做 B-01/B-02/B-03（一次改完 `fieldHtml`，覆盖页面字段与区块字段），再做 E-01/E-02（弹窗与异步反馈是键盘/读屏主流程），最后 I-01/R-01/D-01 对比度批处理，H-01/R-02/R-03 结构项可并行。

---

## 五、通过项清单（已达标，不用返工）

1. **主题层演示页**：`src/theme/editor.html`（49 项规则通过、0 violation）、`src/theme/switcher-demo.html`（41 项通过、0 violation）——含 `html-has-lang`、`document-title`、`landmark-one-main`、`color-contrast`、`heading-order`、`label`、`button-name`、`svg-img-alt` / `role-img-alt`。
2. **渲染层弹窗**：`src/render/components/overlay.js`
   - 打开时 `kit.focusFirst(panel)`（179 行）；
   - `Tab` / `Shift+Tab` 在面板内循环（235–254 行）；
   - `Escape` 关闭且只响应栈顶（246–250 行）；
   - 关闭时 `returnFocus.focus()` 归还焦点（185–196 行）；
   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`（面板属性）。
3. **渲染层表单**：`form.js`、`textfield.js`、`otp.js`、`upload.js`、`date.js`、`autocomplete.js` 均有 `aria-invalid`、`aria-describedby`、`role="status"` / `aria-live`，错误可被读屏关联。
4. **渲染层状态组件**：`common.js:136`（error 用 `assertive`）、`code.js:214`、`carousel.js:102`、`table.js:259/351` 的 live region 合理。
5. **键盘基础设施**：`assets/css/lc-a11y.css` 提供 skip link（12–32 行）、`:focus-visible` 2px 焦点环、`forced-colors` 兼容（83 行）、`prefers-reduced-motion`（114 行）、`aria-disabled` 仍可聚焦（75–77 行）。
6. **`common.js` 焦点工具**：`focusables()` 过滤 `hidden`、`aria-hidden="true"`、零布局元素（193–202 行），可作为编辑器弹窗的实现参考。
7. **builder 页签语义正确**：`builder.html:95–98` 使用 `role="tablist"` + `role="tab"` + `aria-selected`，axe `aria-required-parent` / `aria-required-children` / `aria-allowed-attr` 均通过。
8. **表单命名已达标处**：`export.html:28`、`data.html:28` 的站点选择有 `aria-label`；`export.html:388` 的 nginx 文本框有 `aria-label`；渲染组件字段均有 label。
9. **基础文档属性**：8 个页面 + 导出站全部通过 `html-has-lang`、`html-lang-valid`、`document-title`、`meta-viewport`、`meta-viewport-large`、`heading-order`（在已有标题的页面内）、`button-name`、`link-name`。
10. **地标结构**：除 demo 验收页外，其余页面均通过 `landmark-one-main`、`landmark-no-duplicate-main`、`landmark-unique`、`region`。
11. **目标尺寸**：全部页面通过 `target-size`（触控目标 ≥ 24×24）。
12. **导出示例站**：`web/index.html` 的 `lang`、`title`、`landmark-one-main`、`region` 通过；仅缺 h1（H-01/R-04）。
13. **index 的 toast**：`index.html:532` 已带 `role="status" aria-live="polite"`；错误态通过 `is-error` 视觉区分（建议再补 `assertive`，见 E-02）。
14. **builder 的 toast**：`assets/builder.js:156–163` 已带 `role="status"`，保存/导入等操作的可听反馈已有基础。

---

## 六、扫描局限与未覆盖项

1. **demo 的 overlay 动态行为未实测**：当前 `src/render/demo.html` 示例页没有 `.lc-ui-overlay-trigger`，只做了源码核对；后续在含 overlay 的示例页补一次 Tab/Esc/归还焦点实测即可闭环。
2. **导出站只抽 1 个示例**：样本来自 `data/.fixtures` 的 `artifact.zip`，只覆盖首页结构；导出多页时建议对 `articles/index.html`、`about.html`、`404.html` 抽查 h1 与地标。
3. **暗色 / 亮色只扫当前偏好**：`index.html` 扫描时 `data-lc-mode="dark"`；`data` / `export` / `builder` 为 light。对比度问题已按暗色实际值计算，切到另一模式后建议复跑一次。
4. **颜色对比度依赖真实渲染**：`file://` 页面（demo、theme 两页）已用 Edge 真实渲染；若 CI 环境无 Edge，需要用 `puppeteer` 自带 Chromium 替代，结论不受影响。
5. **未覆盖**：屏幕阅读器真机（NVDA / VoiceOver）、200% 缩放、纯键盘的完整业务流（新建 → 编辑 → 导出 → 下载）、数据表格的读屏表格语义。这些需要人工验收，不在本轮自动扫描范围。

---

## 七、主题层修复记录（2026-11-08 追加）

本轮已把所有分给**主题层**的审计条目修完（含该层没有低优先级残留）。复验：`node src/theme/build.mjs` 与 `node src/theme/check.mjs` 均退出码 0，10 套主题亮暗 20 组全绿。

| 审计条目 | 原问题 | 实际改动 | 复验结果 |
|---|---|---|---|
| I-01 | 旧 `assets/app.css` 调色板在暗色下主按钮 2.1:1 | `index.html` 在 `app.css` 之前引入 `assets/css/lc-tokens.css`；`assets/app.css` 的 `.lc-btn-primary` / `.lc-btn-primary:hover` / `.blk-btn-primary` / `.step-index` / `.lc-drop-badge` 改用 `--lc-color-accent-fill` / `-hover` / `on-accent`；`assets/app.js` 的 `derivePalette()` 补派生 `--lc-color-accent-fill`、`--lc-color-accent-fill-hover`、`--lc-color-on-accent`（亮色近纸白、暗色近底色） | 4 套色板 × 亮暗：填充 5.27–7.59:1，悬停 6.62–8.86:1，均 ≥ 4.5:1 |
| R-01（令牌派生部分） | 示例主题缺 `accent-fill`，按钮背景回落到页面底色 | 主题运行时本就会派生 `accent-fill` / `on-accent`；本轮把这条写进 `check.mjs` 的 66 令牌完整性核对 | 10 套主题每套亮暗 66 个令牌齐全，`check.mjs` 通过 |
| 主题层低优先级 | 审计未单列主题层低优先级条目 | — | 无遗留 |

### 本轮同时落地的三条取舍

1. **打印单独一组固定令牌**：新增 `--lc-print-*` 共 25 个（`src/theme/tokens.mjs` 的 `PRINT_TOKENS`，含新增的 `--lc-print-decor`），值是固定浅色纸面，不跟随当前主题；`assets/css/lc-print.css` 只做「主题令牌 → 打印令牌」映射，已删除全部写死色值。`check.mjs` 新增：25 个令牌必须进基础 CSS、必须被 `lc-print.css` 引用、打印样式不得出现十六进制色值、纸面对比度正文 ≥ 4.5:1、线/焦点环/装饰色 ≥ 3:1。
2. **页面级尺寸不加变量**：**驳回**。本轮审计也**没有**提出「为页面尺寸加 `--lc-page-*` 变量」的建议，因此无条目需要据此驳回；规则本身已写进 `src/theme/NOTES.md`（「页面级尺寸：不新增变量」），后续同类建议按此直接驳回：页面宽度用容器 `max-width` + `padding` 与已有 `--lc-space-*` 解决。
3. **别名只保留一层**：`check.mjs` 新增「别名不得指向别名」校验，并新增 `checkFallbacks()` 扫描 `assets/css/*.css`、`assets/app.css` 与 `src/theme` 两个演示页，发现 `var(--正式, var(--别名, 字面量))` 三层兜底即报错并给出行号。当前扫描 19 个主题层样式文件，三层兜底 0 处。

> 说明：`checkFallbacks()` 只覆盖主题层拥有的样式文件。`src/render/**`、`samples/site.data.js` 等渲染层文件里仍存在三层兜底写法，属于渲染模块的收敛范围，本层不做越界修改。

## 八、证据文件

| 文件 | 内容 |
|---|---|
| `logs/a11y/audit.mjs` | 自动扫描脚本（axe-core + puppeteer-core + iframe 递归） |
| `logs/a11y/manual.mjs` | 手工键盘测试脚本（弹窗 Tab/Esc/焦点归还、逐页 Tab 序列） |
| `logs/a11y/axe-results.json` | axe 原始结果（violations / incomplete / passes / frames） |
| `logs/a11y/summary.txt` | 逐页紧凑清单（本报告数据来源） |
| `logs/a11y/manual.json` | 手工测试原始结果（`editorModal`、`tab_index`、`tab_builder` 等） |

> 本轮**未修改** `builder.html`、`export.html`、`data.html`、`index.html`、`diagnostics.html`、`src/render/**`、`src/theme/editor.html`、`src/theme/switcher-demo.html`、`assets/**` 中任何既有文件；未访问数据库或订单数据。
