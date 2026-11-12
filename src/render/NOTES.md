# 渲染核心 F2 · 实现说明与取舍

本目录只负责“把站点 JSON 数据渲染成节点树”，不读存储、不发请求、不依赖后端。
浏览器里输出真实 DOM，Node 里输出 HTML 字符串与节点树描述。

## 文件

| 文件 | 作用 |
| --- | --- |
| `dom.js` | 虚拟节点（`h/text/raw`）、`toHtml`、`toDom`、转义 |
| `errors.js` | 错误码与 `createReport`，单块失败可记录后继续 |
| `markdown.js` | 极简 Markdown（标题/段落/列表/表格/代码/引用/行内语法） |
| `scope.js` | 组件 CSS 作用域改写，`@media` 递归、`@import` 丢弃 |
| `theme.js` | 已解析主题 → CSS 变量规则，`data-lc-mode` 明暗覆盖 + `data-theme` 兼容 |
| `registry.js` | 区块渲染器、自定义组件、动作处理器的注册表 |
| `free.js` | `pos` 归一化、绝对定位样式、自由容器高度估算 |
| `shell.js` | 按 `project.navigation/footer.blockId` 解析外壳区块 |
| `article.js` | 文章页章节 id、右侧目录、上一篇/下一篇 |
| `interactions.js` | 外壳交互：目录滚动高亮、折叠、深链接偏移、正文检索、滚动容器识别 |
| `mermaid.js` | Mermaid 图块：注入式渲染器注册表、内置 SVG 渲染、懒加载、错误降级、SVG 消毒 |
| `engine.js` | 页面编排、容器/嵌套、组件挂载、脚本收集、动作绑定、`mount` |
| `index.js` | 入口与完整性检查 |
| `node.cjs` | Node 侧加载器（工程是 `"type": "module"`，渲染文件保持经典脚本） |
| `samples/` | 样例站点数据、样例业务区块、样例样式、Node 自检、独立 demo |

## 独立验收

- 浏览器：双击 `src/render/demo.html`，或起任意静态服务后打开。
  支持 `?page=page-free&theme=ink-ochre&mode=dark` 直达；文章页用
  `?page=page-article&theme=ink-green&mode=auto`，目录交互工具条会自动出现；
  图表页用 `?page=page-mermaid`，含流程图/时序图/甘特图/类图和一个故意写错的块。
- Node：`node src/render/samples/verify.cjs`（当前 566 项全部通过）。

## 契约里模糊或缺失的部分：我的解释

`CONTRACTS-v1.md` 第 7 节写明页面/区块/组件沿用 v1 的“第 4–9 节”，但仓库里没有 v1
详细字段。我以现有 `assets/app.js` 的真实数据模型为主、`UPGRADE-PLAN.md` 里明确提到的
`layout.mode: 'free'` 与 `pos` 为辅，确定输入形状如下。没有改动契约文档。

### 1. 页面

```json
{
  "id": "page-home",
  "slug": "home",
  "path": "index.html",
  "layout": { "mode": "flow" },
  "shell": { "header": true, "footer": true, "breadcrumb": false },
  "blocks": []
}
```

- `layout.mode` 缺省按 `flow`；只有显式 `free` 才启用页面级绝对定位。
- `shell.header/footer` 显式为 `false` 时不渲染对应外壳；缺省渲染。
- 面包屑只在 `shell.breadcrumb === true` 且 `project.breadcrumb.blockId` 存在时渲染。
  契约没有给出面包屑的字段结构，这里按“引用一个区块”处理。

### 2. 区块

```json
{ "id": "b1", "type": "container", "variant": "free", "pos": { "x": 0, "y": 0, "w": 320, "h": 180 }, "actions": [], "blocks": [] }
```

- `id` 缺失时生成临时 `lc-auto-N` 并记 warning；重复 `id` 也记 warning，但仍渲染。
- `visible === false` 的区块整棵子树跳过。
- 区块渲染器拿到的就是原始 block 对象；组件字段优先读 `block.fields`，兼容旧数据的
  `block.data.fields`。没有额外把字段摊平或改名。
- `container.variant` 支持 `card`（缺省）、`columns`、`accordion`、`free`。
  契约没有列全 variant，未知值按 `card` 处理，不报错。
- `container.blocks` 递归渲染，页面上任意层级的容器都走同一个函数。

### 3. 自由定位

- `pos` 同时接受 `{x,y,w,h}` 与 `{left,top,width,height}`，`z`/`zIndex` 可选。
- 数字按 px；字符串允许 `px/%/em/rem/vw/vh/vmin/vmax/ch/pt/...` 与 `calc()`。
- 自由容器本身需要高度：优先 `pos.height/pos.h`；如果没给，用子块
  `top + height` 的最大值算出 `min-height`。子块高度也没给时按 0 计算，可能重叠，
  这是作者数据问题，渲染层只给 warning，不臆造高度。
- 自由容器里缺 `pos` 的子块会按流式顺序向下摆放并记 `LC_R_POS_INVALID`，避免全部叠在原点。
- 页面级自由布局的根容器同样用子块最大底边算 `min-height`。
- “流式与自由混用”是天然支持的：自由容器只影响它的直接子块，容器内部仍可选择
  `card/columns/accordion`；页面流式区里的自由容器也不影响后续流式区块。

### 4. 组件与作用域

- 引擎不内置业务组件。`container` 与 `component` 是结构能力，其余 `type` 必须通过
  `registry.registerBlock(type, { render })` 接入。
- 自定义组件从 `site.components` 自动注册，也可以由调用方提前注册。
- 组件模板占位符只支持 `{{field}}`，值会 HTML 转义；模板本身按受信任 HTML 处理。
  这是和旧编辑器一致的边界：模板是作者写的，字段是数据。
- CSS 采用**组件级作用域**（沿用 v1 的 `data-comp-scope` 思路）：
  `[data-lc-comp="<componentId>"]`。同一组件的多个实例共享同一份样式（样式本来就相同），
  不同组件之间的同名类名不会互污染。
- JS 采用**实例级隔离**：每段脚本包在 IIFE 里，通过
  `[data-lc-instance="<blockId>"]` 只拿到自己的根节点。两个实例的计数互不影响。
- `@keyframes` 不改名。两个组件定义同名 keyframes 时后加载的会覆盖先加载的；
  这是已知限制，需要动画隔离时由组件作者自己加前缀。
- `@import` 直接丢弃并记 warning：渲染层不访问网络。
- 组件 CSS 里的 `:root` / `html` / `body` 会映射到组件作用域根，不会泄漏到整页。

### 5. 主题与模式

- 主题只通过 CSS 变量注入，渲染层不写死颜色。
- 渲染层**不读** `themes/<id>.json`，也不做调色板派生。它只接收接口层已经解析好的变量映射：
  `{ id, name, variables, light, dark, colorScheme }`。键名没有 `--` 前缀时自动补成 `--key`。
- 模式主路径是 `data-lc-mode="light|dark"`。主题规则同时输出：
  `[data-lc-theme="id"][data-lc-mode="light"]`、`[data-lc-theme="id"][data-lc-mode="dark"]`；
  没有 `mode` 时退回主题的 `colorScheme` 兜底。
- `data-theme="dark"` 仍输出一条兼容规则，但不再是主路径；显式 `data-lc-mode="light"`
  不会被它覆盖。
- **`auto` 由外壳层解析**：渲染层不读 `prefers-color-scheme`，也不判断系统偏好。
  收到未解析的 `auto` 时原样写 `data-lc-mode="auto"`，并记 `LC_R_MODE_UNRESOLVED` 提醒。
  demo 自己承担外壳职责：用 `matchMedia` 算出 `light/dark` 后再传给渲染器。
- 所有主题的变量规则都会输出，切换主题只需改 `data-lc-theme`，不必重新渲染。
  这样 demo 的主题切换是纯 CSS 行为，也方便后续导出静态站。
- 结构样式优先消费设计系统令牌（`--lc-color-*`、`--lc-font-*`、`--lc-text-*`、
  `--lc-space-*`、`--lc-radius-md`、`--lc-border-width`），旧变量名只作兜底。

### 6. 文章页（页面级能力）

- 页面写 `article: true` 或对象时启用；对象支持：
  `{ id, toc, tocTitle, prev, next, autoNav }`。
- 章节 id 在区块渲染完成后统一补：h2 → `section-N`，h3 → `section-<h2>-sub-N`。
  已有且不重复的 id 会保留；重复 id 记 `LC_R_DUPLICATE_HEADING_ID` 并生成新值。
- 同时处理两种输出：Markdown 生成的 raw HTML 字符串，以及 `heading` 区块产出的
  真实 `h2/h3` 节点。这样作者用哪种区块写标题都不影响目录。
- 右侧目录只列 h2 与 h3，h3 缩进；`toc: false` 关闭，`tocTitle` 改标题。
- 上下篇优先用 `article.prev` / `article.next`；没给就按 `site.articles` 顺序取前后。
  传 `false` 可关闭对应方向，`autoNav: false` 可整体关闭。
- 目录与上下篇都只是节点树的一部分，不发起请求、不注入额外脚本；静态导出可直接带走。
  滚动高亮、折叠、检索与深链接偏移由 `interactions.js` 提供，属于可选的运行时增强。

### 7. 错误策略

- 单块数据非法、类型未注册、渲染器抛错、组件缺失：**跳过该块**，写入错误报告，
  其余区块照常渲染。没有插入占位块，避免静态导出时留下调试 UI。
- 页面整体找不到或编排阶段抛错：输出一个最小错误页节点，避免白屏。
- 主题不存在只记 warning，页面仍用结构样式渲染。
- 外壳引用的区块不存在记 warning，不阻断页面。
- 嵌套超过 `maxDepth`（默认 20）停止该子树并记 error。

### 8. 动作与事件

- `actions` 挂在区块上，事件默认 `click`；引擎在 `mount` 时按
  `data-lc-block` 找到区块元素并绑定，这是“事件绑定的挂载点”。
- 内置动作只有 `link`、`toggle`、`scrollTo`；其余类型通过
  `registry.registerAction(type, handler)` 接入。
- 渲染阶段会检查未注册的动作类型并记 warning；运行阶段找不到处理器只 `console.warn`。
- Node 侧不执行动作，只输出 `actions` 列表与 HTML；导航类动作只在浏览器执行。

### 9. Markdown

- 覆盖站点实际用到的子集：`#` 标题、段落、无序/有序列表、表格、代码块、引用、
  分隔线、行内加粗/斜体/代码/链接。
- 不支持列表嵌套、图片、脚注、原始 HTML 透传；需要原始 HTML 时用 `html` 区块
  （它按作者受信任内容处理）。
- Markdown 会转义所有 HTML，链接只允许 `http/https/mailto/tel/#` 与相对路径，
  `javascript:` 等协议直接降级为纯文本。
- `markdownToHtml` 的标题 id 默认不生成；需要时显式传 `{ headingIds: true, idPrefix }`。
  文章页的 `section-*` id 由 `article.js` 在渲染后统一补，两套机制不冲突。

### 10. 工程形态

- 任务要求只写 `src/render/**`，因此实现放在这里；`MODULE-DESIGN.md` 里提到的
  `assets/render/*` 是早期目录约定，本模块未创建那些文件，避免和静态资源模块冲突。
- 工程 `package.json` 是 `"type": "module"`，而双击 `file://` 验收要求经典脚本。
  所以渲染源码保持 UMD 风格（浏览器挂 `LC.Render`，Node 走 `module.exports`），
  Node 入口额外提供 `node.cjs` 用 `vm` 以 CommonJS 包装加载同一批文件，不改 `package.json`。
- 没有新增 npm 依赖；只用原生 DOM / 原生字符串处理。

### 11. 外壳交互（interactions.js）

- 入口：`R.createInteractions(pageRoot, options)` / `R.enhanceInteractions(...)`，
  返回控制句柄（`refresh / update / getState / goToSection / search / nextHit /
  prevHit / clearSearch / setCollapsed / toggleCollapsed / destroy` 等）。
- **滚动容器**：优先 `options.scroller`；否则从 `pageRoot` 向上找最近一个
  `overflow-y: auto|scroll|overlay` 且确实可滚动的祖先，找不到就退回 `window`。
  所有位置换算都在“滚动内容坐标”里做，因此窗口滚动与容器内滚动是同一套逻辑。
  demo 的“限高容器滚动”就是给 `#stage` 加 `max-height + overflow-y: auto`。
- **目录高亮**：`IntersectionObserver` 触发重算（原生，无库），同时保留 scroll
  兜底；每次重算只选一个章节，激活线为 `scrollTop + offset`。滚动到底时强制取最后
  一节，避免最后一节永远点不亮，也不会出现两个链接同时 `is-active`。
  高亮同步写 `aria-current="location"`。
- **折叠**：在目录标题后注入 `<button class="lc-toc-toggle">`，按钮原生支持
  Tab/Enter/Space；`aria-expanded` 与 `aria-controls` 同步。状态存
  `localStorage`（默认 key `lc-article-toc-collapsed`，可传 `storageKey`），
  读取/写入都有 try/catch，隐私模式或 `file://` 下自动退回内存存储，不依赖后端。
- **深链接**：初始化时若有 `#section-xxx`，等一帧布局稳定后滚到该章节；
  hashchange 与目录链接点击也走同一路径。偏移优先用 `options.offset`（数字或函数），
  其次读 `--lc-anchor-offset`，缺省 80px；滚动值会夹在容器可滚动范围内。
- **正文检索**：搜索范围是 `article.lc-article-body`（可用 `searchRoot` 改），
  跳过目录、上下篇与 `[data-lc-search-skip]`。命中用 `<mark class="lc-search-hit">`
  只包裹文本节点，不改元素层级、id 与属性；清除时逐个还原为文本并 `normalize()`，
  目录高亮、深链接等能力不受影响。上一个/下一个循环跳转，计数由
  `searchState()` 返回 `{query,total,index,current}`。
- 样式随 `interactions.js` 注入一次（`<style data-lc-interactions>`），
  颜色全部走主题变量；静态导出把本文件一起带上即可，无需构建工具。

### 12. Mermaid 图块（mermaid.js）

- Markdown 的 ```mermaid 块不再走普通代码分支，`markdown.js` 输出占位结构：
  原始代码放在 `[data-lc-mermaid-source]`，画布放在 `[data-lc-mermaid-canvas]`，
  错误行放在 `[data-lc-mermaid-error]`。
- **注入式渲染**：`R.createMermaidRegistry()` 支持 `use(renderer)` / `setLoader(fn)`。
  渲染器签名 `render(code, context) → { ok, svg }` 或抛错；`context` 含
  `mode/theme/variables`（主题变量快照），方便外部实现换配色。未注册渲染器时保持
  原始代码并标记 `data-lc-mermaid-status="fallback"`。
- 渲染期直出：`markdownToHtml(md, { mermaid: fn })` 可让导出层在构建 HTML 时同步
  生成 SVG；Node 侧可直接用 `R.renderMermaidSvg(code, {renderer})`，与浏览器共用
  同一份渲染器逻辑。
- **懒加载**：`R.enhanceMermaid(root, {registry})` 先扫描 `[data-lc-mermaid]`，
  为 0 时直接返回，绝不调用 loader；有块时只调用一次 `registry.load()`（Promise
  记忆化），所有块共享同一次加载结果。
- **错误降级**：内置解析器抛出的语法错误带行号；`MERMAID_UNSUPPORTED` 指出不支持的
  类型；外部渲染器抛错也按块捕获。失败块保留原始代码并显示“第 N 行：原因”，
  其他块与页面其余内容继续渲染。
- 内置渲染器覆盖 `flowchart/graph`、`sequenceDiagram`、`gantt`、`classDiagram`，
  只输出 SVG 字符串（`viewBox` + 绝对尺寸），不依赖 mermaid 包。它是**轻量实现**：
  支持常用节点形状、带标签连线、参与者/消息、section/工期、类成员与关系；
  复杂语法（子图布局、主题指令、高级时序片段）会按语法错误降级，不会整页崩。
- **主题联动**：内置 SVG 的 `fill/stroke/font` 全部引用 CSS 变量
  （`--lc-mermaid-*`，逐级回落到 `--lc-color-*`），没有硬编码白底；暗色主题只改
  变量值即可换配色。外部渲染器可从 `context.variables` / `mode` 取同一套映射。
- **安全**：所有 SVG 都过 `R.sanitizeSvg`：只保留结构/图形/文本标签白名单，
  属性白名单 + 事件属性（`on*`）、脚本、`foreignObject`、`<style>`、
  非 `#` 的 `href/src`、`javascript:/data:` 协议与外部 `url()` 全部剔除。
- 样式随 `mermaid.js` 注入一次（`<style data-lc-mermaid>`），
  原始代码的 `pre/code` 在成功出图后隐藏，失败时保留可见。

#### 12.1 平台侧接入：官方 mermaid 12.3.0（自托管）

- 渲染层的内置渲染器只用于 Node 侧同步直出与降级兜底；浏览器里的预览与导出统一由
  `shared/mermaid.js` 的 `bootstrap()` 调用官方 `mermaid.render` 出图，两者输出同一套
  `.lc-mermaid` 占位结构，互不覆盖。
- **库与体积**：`vendor/mermaid.min.js` 是官方 12.3.0 UMD 全量包，5,537,899 bytes
  （gzip 约 1.6 MB）。官方没有只含六类图的 UMD 构建，拆 ESM chunk 会破坏 `file://`
  单文件与断网可用，所以不裁剪；换来的是断网、导出后都能直接出图。
  只在页面真有图块时加载/打包：导出命中 `data-lc-mermaid` 才复制为
  `assets/js/mermaid.min.js`，普通页面不背这 5.3 MB。
- **预览**：`server/src/routes/builder.js` 的 `mermaidTags()` 在画布预览文档末尾注入
  `<script src="/vendor/mermaid.min.js">` 与 `bootstrap()`，前提是 `hasMermaidMarkup()`
  命中；平台根 `/vendor/` 由服务端提供，预览资源路由不读平台目录，因此用绝对路径。
- **主题**：`bootstrap()` 每次渲染前 `initialize({ theme: "base", themeVariables: palette() })`，
  把六个 `--lc-mermaid-*` 令牌映射到节点填充/描边、连线、文字、注释、边标签背景与饼图分区；
  `MutationObserver` 监听 `data-lc-mode` / `data-lc-theme`，切换后 180 ms 重绘。
- **失败降级**：库缺失、空源码、语法不支持都在图块内保留源码并显示一行
  「图表渲染失败：…」；单块失败不影响同页其它图块。
- **踩坑**：`installCss()` 注入的 `<style data-lc-mermaid="">` 不能算图块，
  `run()` 的选择器固定为 `.lc-mermaid[data-lc-mermaid=true]`，否则第一块会被误判为空源码。
- 验收方式（临时站点，验收后已清理）：一个页面放六类图 + 一个 `foobarDiagram` 失败样例，
  在导出产物与画布预览、亮/暗两套下均为 6 块 ready + 1 块 error，失败块保留源码并显示可读提示。

### 13. 内置组件（第一轮九类）

- 组件源码集中在 `src/render/components/`，公共基座是 `common.js`；组件彼此不 require，
  只通过 `kit` 公共能力、公开 schema 与 `lc:*` 事件通信。
- 统一状态 `ready / loading / empty / error`：根节点写 `data-lc-state`，加载/空/错误都
  复用 `kit.renderStatus` 与骨架屏；组件缺字段时由 `kit.prop/num/bool/toArray` 兜底，
  不允许空值直接抛错。
- 九类分别是：表格（列定义/排序/分页/行选择/空数据）、表单（必填/长度/正则/数值范围、
  错误位于控件下方）、弹窗与抽屉（遮罩、焦点收进与归还、Esc、嵌套只关最上层）、
  标签页（切换/懒加载/方向键）、轮播（自动播放可关/指示点/循环/暂停）、时间线、
  代码块（着色/行号/复制/横向滚动）、加载与空状态（骨架屏/占位/错误重试）。
- 图标只复用 `assets/css/lc-icons.css` 里的既有 id（`lc-icon-close/copy/check/...`），
  没有新建图标集；focus-visible 样式统一走主题变量。
- **契约缺口**：`CONTRACTS-v1.md` 第 7 节引用了 v1 第 4–9 节，但仓库里没有这些内容。
  因此组件 schema 按契约的 `type/name/version/states/events/props` 结构补齐，未改动契约文件；
  含糊处（分页字段名、状态枚举、事件 payload）以本实现为准。

### 14. 实例级代码覆盖与导出配合

- 实例覆盖字段：`block.overrides = { html, css, js }`，字段名按契约“实例覆盖”语义补入。
- 优先级：组件默认 < 实例覆盖。合并规则是**替换 vs 追加**写明：
  - `html` 整段替换组件模板；
  - `css` 追加到组件样式之后，并强制包进 `[data-lc-instance="<blockId>"]`，裸声明也收进
    该实例作用域，`@import` 丢弃；
  - `js` 追加到实例脚本，每个实例包成独立 IIFE（`"use strict"` + `var root`），
    两个实例的变量不共享。
- 可逆：`resetInstanceOverrides` 直接移除 `overrides`；`saveAsComponent` 只输出新的
  组件数据（合并后的 template/css/js），不做 UI。
- 编辑器代码校验：`validateOverrideSource` 用原生解析返回 `{ ok, line, column, message }`，
  CSS/JS/HTML 语法错误都报位置，不静默失败；错误码 `OVERRIDE_SOURCE_INVALID`。
- 导出：`createExportBundle` 默认压缩，可传 `minify:false` 关闭。`minifyCss` 保守去注释与
  标点空白，`minifyJs` 去注释但保留换行（避免 ASI 语义变化），`compactHtml` 只去注释与
  标签间空白、不折叠正文空白，因此代码块缩进不被破坏；产物不包含编辑器内部字段
  （`data-lc-override-fields` 等），只保留实例标记与可安全合并的代码块标记。
- 内置组件同样适用：`engine.js` 对 `block.type !== 'component'` 且存在 `overrides` 的
  `ui-*` 实例走同一分支，不需要先另存为组件；同类型其它实例不受影响，组件注册表原件不变。
  Builder 侧 `canOverrideCode = isComponentBlock || /^ui-/.test(block.type)`，面板显示
  「已覆盖」徽标与「恢复默认」，恢复即删除三个覆盖字段。

### 15. 表单与上传（文本框 / 验证码 / 拖拽上传）

- **文本框** `ui-textfield`：`variant: 'floating' | 'placeholder'` 两种形态同一组件切换。
  floating 在 focus 或有值时标签上浮；placeholder 形态仍保留真实 `<label for>`，
  占位符只做提示、不承担标签职责。错误/禁用/只读/前后缀图标/字数计数都映射到
  `aria-invalid`、`aria-describedby`、`disabled`、`readonly`、`maxlength`。
- **验证码** `ui-otp`：位数夹在 4–8；每格一位，输入自动前进、方向键移动、退格回退。
  粘贴规则：始终从第 1 格开始覆盖，超长截断、不足**不自动补齐**（保留空格子），
  并按当前模式过滤字符；支持 `numeric` / `alphanumeric`；整串取值通过实例 API 读取。
  移动端用 `inputmode="numeric"`，不依赖 JS 数字键盘。
- **拖拽上传** `ui-upload`：`endpoint` 支持相对路径与绝对 URL，`headers` 兼容对象/数组，
  `fieldName` 可配；未配置时拖入文件只留在列表并标错，明确提示「尚未配置上传地址」，
  不发请求、不伪造成功。类型/大小/数量限制、进度、重试、取消、移除都在组件内完成。

### 16. 日期、滑块、自动补全、常用控件与数据源

- **日期** `ui-date`：`mode: 'single' | 'range'`。日历点选与手动键盘输入并存；格式校验
  给出人话提示；支持 `min/max/disabledDates` 与 `today/month/last7` 快捷项。
  范围纠正由纯函数 `correctRange` 完成：两端合法且开始晚于结束时交换并派发
  `corrected:true`；任一端非法时原样保留并报错，**不静默保存非法值**。
- **滑块** `ui-slider`：`range:true` 为双值；`normalizeValue` 保证两个手柄不交叉；
  支持 `step/marks/showInput/unit/percent`，方向键微调，数字框双向联动；
  `percent:true` 的语义是“值本身按百分数展示”（直接补 `%`，不额外乘 100）；
  增强后可通过实例 API `setFormat(fn)` 注入自定义格式化，纯展示不影响真实值。
  - 数据源两种取法：`sourceMode: 'range'` 调 `source.range(context)` 取 `{min,max,step,marks}`；
    `sourceMode: 'stops'` 调 `source.stops(context)` 取候选值，内部用下标映射到实际值，
    读数/刻度用 label，数字输入与拖动吸附到最近档位，事件派发实际值。两种模式都兼容
    只实现 `search('', context)` 或 `load(context)` 的数据源。
  - 状态与提示：`data-lc-state` 覆盖 `loading/ready/empty/error`；提示行文案可配
    （`sourceLoadingText/sourceEmptyText/sourceErrorText/sourceUnconfiguredText`）；
    未注册源保留静态 `min/max`；`AbortController` 取消上一笔请求并用 token 防竞态。
  - 事件：`lc:slider-change`（实际值）与 `lc:slider-source`（加载完成的来源摘要）。
  - 预览/导出可执行 `enhance`：`builtins.js` 的 `builtinRuntimeSource(types)` 按页面实际
    用到的类型拼 `dom.js + datasource.js + common.js + 组件`，`engine.js` 以
    `scripts: [{ global: true }]` 注入，`export.js` 的 `blockScript` 对 `global` 直接执行；
    数据源注册必须在这段全局包之前完成（导出页面可用前置 `<script>` 或站点引导脚本）。
- **数据源消费契约**（不自己写请求逻辑）：平台侧调用
  `R.registerDataSource(name, { search(query, { signal, limit }) → Promise<options[]> })`；
  组件只通过 `R.resolveDataSource(name)` 取用。没有任何 fetch/XHR 写在组件里。
  没配数据源时：自动补全退回静态 `options`（`data-mode="local-fallback"`）或禁用输入，
  并显示明确提示；不在界面上假装有数据。
- **自动补全** `ui-autocomplete`：`mode: 'local' | 'remote' | 'auto'`；远程有防抖、
  用 `AbortController` 取消上一笔请求、加载/无结果/错误态；键盘上下选择、回车选中、
  Esc 关闭；多选 chips、`maxSelected`、`labelField/valueField`、`maxItems/minChars` 可配。
- **常用控件**：`ui-select / ui-multiselect / ui-radio-group / ui-checkbox-group /
  ui-switch / ui-number / ui-textarea / ui-tags / ui-cascader / ui-rating`，统一
  `fieldShell` 字段外壳（label、必填星号、help、`role="alert"` 错误、`aria-describedby`）。
  校验纯函数 `numError/textError/choiceError/tagsError` 覆盖必填、长度、数值范围与选择数量；
  统一事件 `lc:field-change`（`type/name/value/valid/error`）。选项为空时组件自动进入
  `empty` 并显示「暂无可选项」，级联选项用完整选项树数据岛增强，不从 DOM 反推。

### 17. 图表与统计（手写 SVG，不引图表库）

- **组件清单**：`ui-chart-line / ui-chart-bar / ui-chart-pie / ui-chart-donut /
  ui-sparkline`（`components/charts.js`），`ui-kpi / ui-progress / ui-progress-ring`
  （`components/stats.js`）。全部复用 `kit.renderStatus` 与统一四态，可单独注册。
- **数据源消费**：图表与统计只通过 `R.resolveDataSource(name)` 取源，组件内没有
  fetch/XHR。取数优先级为 `load(options)` → `fetchData(options)` → `search('', options)`，
  都接受 `{ signal }`；增强层用自增 `requestId` + `AbortController` 取消过期请求。
  支持两种数据形状：`{ labels, series:[{name,values}] }` 与记录数组
  `[{label,value}]`（字段名由 `labelField/valueField` 配置）。
- **无源降级**：配置了 `datasource` 但 `resolveDataSource` 返回空时，直接进入
  `empty` 并显示「数据源「x」未注册，暂不绘制图表」，**不画假图、不补 0**。
  已注册数据源的 SSR 输出为 `loading`（`data-source-bound="true"`），由 `enhance`
  在浏览器替换为真实图形；返回空数组进入空态，抛错进入错误态并提供重试。
- **手写 SVG**：固定 `viewBox="0 0 640 H"`，`preserveAspectRatio="xMidYMid meet"`。
  折线用 Catmull-Rom 转三次贝塞尔，控制点纵向夹在相邻数据点之间，避免曲线冲出值域；
  柱状图负值从零线向下生长，零值保留 1px；饼图/环形用极坐标弧路径，单扇区用
  `<circle>` 特判。迷你走势图使用固定 viewBox + `preserveAspectRatio="none"` +
  `vector-effect="non-scaling-stroke"`，可放进表格单元格或卡片角。
- **主题**：网格/坐标轴/零线/文字全部引用 `--lc-color-*` 或 `--lc-chart-1..8`；
  趋势与进度色引用 `--lc-color-success/warn/danger/accent`。没有硬编码背景，
  亮暗与多套主题只改变量值即可跟随。
- **无障碍**：图表画布 `role="img"` + 自动生成的 `aria-label`（点数、最高/最低/最新，
  或饼图项数、合计、最大项占比），下方 `<details><summary>查看数据表</summary>` 提供
  等价文字替代，可用键盘展开。迷你走势图根节点承担 `role="img"` 与摘要，内部 SVG
  设为 `aria-hidden`，避免重复播报。
- **边界规则**：空数据 → 空态；单点折线强制画圆点；全正/全负值域自动包含 0，
  负值保留零线；极大值刻度按 `1/2/5×10^n` 取整并压缩为 `k/万/亿`；饼图忽略
  非正数，全部非正数时进入空态；KPI 缺失数值 → 空态，不显示 0；进度值夹在
  `0..max`，超限按上限显示，负数按下限显示；不确定进度不输出 `aria-valuenow`。
- **数据表格**：复用 `ui-table`（排序、分页、空态、行选择、`columns[].width`）。
  本轮修正了 `widthStyle` 只存在于数据岛、未落到 `th/td` 的问题，列宽现在真正生效。
- **演示与自检**：`page-charts` / `page-stats` 覆盖远程加载、空结果、未注册源、
  错误重试、负数、单点、极大值、KPI 正负向、进度夹取与迷你走势；自检新增
  值域/刻度/贝塞尔/柱状负值/饼图过滤/KPI 格式化与页面标记共 36 项。
  演示数据源全部为内存只读假数据，不接触任何业务库或订单数据。

### 18. 站点外壳与模板骨架

- **外壳组件化**：新增 `components/shell.js`，五类内置组件：
  `ui-site-nav`（品牌、多级菜单、移动端展开、右侧 CTA）、`ui-site-footer`
  （品牌说明、多列链接、版权/备案/底部链接）、`ui-sidebar`（多级目录、吸顶、
  底部说明）、`ui-breadcrumb`（显式 items 或按 `page.nav.trail` 自动生成）、
  `ui-page-header`（眉题、主标题、副标题、元信息、操作按钮）。每类都有 `schema`
  与统一四态；显式 `state: 'loading' | 'error'` 时交给 `kit.renderStatus` 出占位。
- **当前页高亮**：导航/侧栏项按 `active`、`pageId`、`match` 数组或归一化后的
  `href` 匹配当前页；命中后加 `is-active` 与 `aria-current="page"`。父级链命中时
  加 `is-branch-active`，整条目录分支保持可见。
- **外链语义**：`href` 以 `http(s)://` 或 `//` 开头，或显式 `external: true` 时，
  自动补 `target="_blank" rel="noopener noreferrer"`，并追加读屏文案
  「（新窗口打开）」；显式 `external: false` 可强制按站内链接处理。
- **移动端导航**：纯 CSS 复选框方案（`input.lc-shell-nav-check` +
  `label.lc-shell-nav-burger` + `:checked ~ .lc-shell-nav-panel`），
  `@media (max-width: 900px)` 切换为汉堡面板；静态导出后不需要额外运行时脚本。
  桌面端多级菜单用 `:hover` / `:focus-within` 展开，键盘可达。
- **引擎装配**：`project.navigation / footer / sidebar / breadcrumb` 引用
  `shellBlocks` 里的区块 id；页面可用 `page.shell.header/footer/sidebar/breadcrumb === false`
  逐项关闭。`project.sidebar` 存在时，页面主体包成 `.lc-shell-layout` 两列网格。
  新增页面级布局字段：`page.layout.align === 'center'`（正文居中，配合
  `maxWidth` 生成 `--lc-main-max`）。
- **模板骨架**：新增 `templates/starters.js`，纯数据 UMD，导出 `templates`、
  `listStarterTemplates()`、`starterTemplateIds()`、`getStarterTemplate(id)`
  （深拷贝，避免调用方改坏模板）。四套模板：
  `doc-site`（侧栏目录 + 正文 + 右侧章节导航 + 上下篇，页面 `article` 驱动）、
  `portfolio`（英雄区 + 作品网格 + 联系表单）、`dashboard`（侧栏 + 顶部栏 +
  KPI 卡 + 折线/柱状图 + 表格）、`auth`（居中卡片 + 表单 + 错误提示区）。
  每套给出 `project + shellBlocks + pages(+articles)`，套用后逐项可改。
- **不造新组件**：模板只组合现有 builtins（`ui-*`）与样例区块
  （`heading/paragraph/markdown/note/container`），自检会扫描模板里出现的所有
  块类型并要求它们都能在注册表或引擎内建类型中找到；不为模板新增任何组件。
- **数据安全**：模板与演示数据源全部是静态只读假数据，不读取、不写入任何业务库；
  自检额外断言模板 JSON 中不含订单相关数据。
- **演示与自检**：新增 `page-shell`（第 16 页），覆盖五类外壳、多级菜单、
  外链新窗口、自动面包屑、侧栏 + 正文两列。自检由 270 项增加到 306 项，
  覆盖外壳 schema / 单独注册 / 路径归一 / 高亮 / 外链 / 移动端纯 CSS /
  面包屑末项 / 页脚列，以及四套模板的默认页渲染、纯现有组件、深拷贝与数据安全。

### 19. 表单输入补全（文本框 / 验证码 / 上传）

- **文本框**：`floating` 控制浮动标签或普通占位符；新增 `prefixText` / `suffixText`
  （单位或短文本，可与 `prefixIcon` / `suffixIcon` 并存）与 `clearable` 清除按钮。
  清除按钮有 `aria-label="清除输入"`，无值时 `hidden`，并派发 `lc:textfield-clear`；
  字数计数继续由 `maxLength` 驱动。
- **验证码粘贴**：新增纯函数 `filterText` / `pastePlan`，粘贴从当前格开始向后铺，
  超出剩余位数截断、不足不补齐；空格/换行/中文等非允许字符过滤后，在输入框下方
  用 `role="status" aria-live="polite"` 的提示区给出文字反馈，并派发 `lc:otp-reject`。
  中文输入法用 `compositionstart/compositionend` 处理，组合期间不打断，结束后按最终
  文本处理；退格仍为「先清当前格、空格子再回上一格」，满位自动触发 `lc:otp-complete`。
- **上传**：新增 `maxTotalSize`（总大小上限，失败项不占额度）与 `mode: 'preview'`
  本地预览模式：只展示已选文件与大小，不发起请求、不伪造进度、不显示重试。
  未配置 `endpoint` 时明确提示「未配置上传地址」，文件以错误态留在列表，不标记成功。
  校验失败同时有可见文本（每条错误 + 汇总区）与 `role="alert"` / `aria-describedby`
  的读屏表达；进度条仍为 `role="progressbar"` 并带 `aria-valuenow`。
- **自检**：新增中文输入法、含空格换行、粘贴不足、中间粘贴、中间超长粘贴、字母数字
  过滤、清除按钮前缀后缀、总大小计算、本地预览等用例；总数 306 → 318，全部通过。

### 20. 大数据导出：外部数据岛（本轮覆盖上一轮第 1 项）

- **产物形态变更**：Web 导出包按「部署到服务器或本地服务」设计，不再为 `file://`
  硬扛 1.2MB 内联 JSON。超过 **32KB** 的数据岛在导出时移到 `data/<页面 id>.json`，
  HTML 只留 `<script class="lc-ui-data" data-lc-src="..." data-lc-key="...">`；
  同一导出包的所有大岛合成一个 JSON，按 `island-1...` 键分发，避免一表一请求。
  小于阈值的岛继续内联，小表格不为省几十 KB 多付一次请求。
- **运行时加载**：`runtimeUtilIsland` 只在产物里存在 `data-lc-src="*.json"` 时注入。
  同一 URL 用 `__LC_ISLAND_CACHE__` 记忆化、`__LC_ISLAND_QUEUE__` 合并并发请求；
  取得后回填脚本节点的 `textContent`，后续重扫仍走同步 `readIsland`。请求失败不写
  缓存，重试会重新发请求。
- **失败可读**：表格在等待数据时带 `aria-busy`；失败时在表格顶部插入
  `role="alert"` 区块，文案包含 HTTP 状态、 「需要通过 HTTP 访问」和
  「需要双击请导出 Tauri 应用」，并提供「重试」按钮。首屏仍显示已经渲染的
  前 24 行，不会白屏。
- **双击提示**：导出 HTML 在 `<body>` 后注入一段仅 `file:` 生效的横幅
  （`data-lc-transport-notice`），直接告诉用户改走 HTTP 或 Tauri；包内附
  `README.txt` 说明同一件事。已用 Edge headless 打开 `file://` 验证横幅与
  表格错误提示都出现。
- **体积与加载（Node bench / 本机 HTTP）**：

  | 场景 | 原 HTML | 导出 HTML | 数据文件 | 数据岛 | 构建 ms | JSON 解析 ms | 运行时 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 10k 虚拟滚动 | 1203KB | 25KB | 1179KB | 1 | ≈39 | 3.3 | 35KB |
  | 10k 全量对照 | 7303KB | 6125KB | 1179KB | 1 | ≈195 | 2.8 | 35KB |
  | 1k 虚拟滚动 | 141KB | 25KB | 117KB | 1 | ≈12 | 0.3 | 35KB |
  | 首页（无大岛） | 12KB | 13KB | — | 0 | ≈24 | — | 15KB |

  浏览器（本机 HTTP，10k 虚拟滚动）对照：内联版 DCL 395.9ms / load 403.5ms /
  HTML 1,233,479B；外部分离版 DCL 171.0ms / load 176.0ms / HTML 25KB +
  JSON 1,207,477B（请求 19ms，解析 3ms）。HTML 先到、表格先出前 24 行，
  数据到达后再接管排序/滚动/跳转。首屏 FCP 受 headless 环境波动（7040 → 5424ms），
  只作趋势参考，不作为绝对值承诺。
- **限制**：JSON 目前不压缩，压缩交给服务器（gzip/br）；若部署环境不能开压缩，
  可后续把数据文件改成 gzip + `DecompressionStream`，但本轮不再为 `file://`
  引入该分支。

### 21. 亮色次要文字对比度（上一轮第 2 项）

- **两个方案与视觉代价**：
  - A. 整体压暗一档：`muted-2` 全部变成可读深灰，视觉层级从「正文 / 次要 / 更弱」
    退化成「正文 / 次要 / 次要」，轻量提示会明显变重。
  - B. 拆两级：`muted-2` 只承载信息性次要文字，压到 ≥4.5:1；新增
    `--lc-color-decor` 只给纯装饰（代码行号、日期/滑块分隔符、面包屑 `/`、
    图表第 7 系列色、禁用态文字等），保留原来的轻量观感。
- **选择 B**：绝大多数 `muted-2` 用法是 KPI 注释、表单计数、文章元信息这类
  真正要读的信息，不能靠「装饰豁免」逃避对比度；而分隔符和行号不需要抢占注意力。
  代价是多一个令牌、每次新增用法要判断是否承载信息；默认按「可读」处理，
  只有纯标点/纯装饰才用 `decor`。
- **落地值（亮色）**：ink-green `#606760`、ink-ochre `#695e46`、
  ink-slate `#596762`；`decor` 不再手写，改由主题侧同一公式派生（见 §23）。
  四个亮色表面（bg / surface / surface-2 / surface-3）最低对比度
  5.34 / 5.77 / 5.06 / 4.54（ink-green），其余两套更高。
- **暗色复测**：`muted-2` 在 bg / surface / surface-2 上为 5.70 / 5.13 / 4.70
  （ink-green）、5.48 / 5.02 / 4.63（ochre）、6.21 / 5.53 / 5.00（slate）。
  `surface-3` 为 4.03–4.41，但 `muted-2` 当前不用于该表面；若后续要用，
  需再压暗一档。
- **浏览器复测**：`demo.html` 的 `.demo-stat-hint` 在亮色为 5.77:1（#606760 on
  #fffefb），暗色为 5.13:1（#8b9590 on #1d2421），均 ≥4.5:1。自检新增 12 项
  主题对比度断言。

### 22. 可变行高虚拟滚动（上一轮第 3 项：本轮不做）

- **结论**：不实现「测量后缓存行高」的可变行高虚拟滚动。原因不是纯工作量，
  而是它会破坏上一轮已经承诺的两个准确性：
  - 滚动条高度要正确，必须知道所有行高。只测可视区、其余用平均值估算时，
    10k 行从顶部滚到底部的累计误差可达数十万像素，滚动条会随测量结果跳动，
    「跳到最后一行」也会落到错误位置。
  - 要消除累计误差，只能在首次渲染时把 10k 行全部排一遍再测量。Node 全量
    渲染已经是 126.4ms / 6853KB HTML / 41.3MB 堆；浏览器全量布局约 1088ms，
    是虚拟滚动布局（约 5.7ms）的百倍以上，等于放弃虚拟滚动。
- **替代方案（多行单元格用户这样做）**：
  1. 关闭虚拟滚动并按页渲染：`virtual: false` + `pageSize: 20/40`，
     页面最多 40 行，行高可以自然变化；
  2. 需要换行时再加一条实例 CSS：`.lc-ui-td { white-space: normal; }`，
     并给列设置 `width`，避免长文本把表格撑爆；
  3. 仍要虚拟滚动时，把 `rowHeight` 设为该表最大行高（如两行 56–64px），
     接受短行留白；或把长文本拆成独立列/详情页。
- **文档落点**：`ui-table` 的 `virtual` 与 `rowHeight` schema 描述已经写明
  「多行单元格请关闭虚拟滚动」「固定行高是精确跳转的前提」。

### 23. 装饰色收口（本轮）

- **清单核对**：7 处已是装饰色、保持 `var(--lc-color-decor, #888)`：
  图表第 7 系列（charts）、代码行号（code）、日期分隔符与禁用输入（date ×2）、
  滑块刻度虚线（slider）、验证码禁用格（otp）、面包屑斜杠（shell）。
  其余承载信息的 `muted-2` 未动。
- **文本框禁用态选 `--lc-color-disabled-ink`**：禁用输入框仍显示字段当前值，
  是可读信息而非纯装饰；主题包已用 `DISABLED_PAIRS` 对
  `disabled-bg / surface / bg` 按 3:1 校核，语义与兜底都比装饰色稳。
  样例主题未定义该令牌时回退 `#888`，在 surface / bg 上约 3.3:1，仍过 3:1 下限。
- **验证码禁用格去掉 `opacity: 0.6`**：装饰色叠 0.6 透明度后有效对比度被乘到约
  2.0:1，破下限。去掉后格子背景是 `--lc-color-surface`，三套主题亮暗实测
  3.72 / 3.82 / 3.85 / 3.93 / 3.94 / 3.97:1，全部 ≥3:1。
- **`site.data.js` 派生 decor**：删除 6 处手写值，按主题侧公式
  `ensureContrastAll(mix(muted-2, bg, 0.45), [bg, surface, surface-2, surface-3, bg-deep], 3)`
  在 `themes` 数组后自动计算，避免两套值漂移。注意 `ensureContrastAll` 的提前
  返回必须写在 `for` 里，不能放进 `forEach` 回调（否则只是退出回调）。
- **实测（min / bg 上与 muted-2 的差）**：
  ink-green 3.03/1.78（亮）、3.02/1.57（暗）；ochre 3.05/2.12、3.19/1.15；
  slate 3.15/1.83、3.05/1.92。全部 ≥3:1 且差值 ≥1.00。
- **自检**：`verify.cjs` 增加 12 项 decor 对比度断言、3 项 CSS 断言
  （单层兜底计数 ≥7、文本框用 disabled-ink、验证码无透明度），共 383 项全部通过。

### 24. 内置组件默认内容（本轮）

- 新增 `src/render/defaults.js`：`componentDefaults`（39 类 `ui-*`）+
  `blockDefaults`（12 类基础区块 + `mermaid`、`articleBody` 两个常用默认），
  以及 `getComponentDefaults(type)` / `getBlockDefaults(type)`（返回深拷贝）。
- 内容全部为真实文案与数字：表格 6 行 6 列，折线/柱状各 6 个标签，
  饼图/圆环各 6 个扇区，迷你折线 12 个点，KPI 1,284,600 元，
  导航/页脚/时间线/侧栏/面包屑均 ≥3 条，表单 4 个字段。
- 图片默认值用内联 SVG 架构示意（`encodeURIComponent` 拼接），不请求网络，
  导出后仍可见；`alt` / `caption` 都写实际含义。
- `verify.cjs` 新增 161 项断言：逐类 schema 校验、逐类渲染无错误且有内容、
  列表条数与图表点数、占位文案黑名单、`getComponentDefaults` 深拷贝。
  当前共 544 项全部通过。
- 体积：39 类组件 16,985 B；14 类区块/特殊默认 6,454 B；合计约 22.9 KB。
- 平台侧接入点：插入内置组件时用 `getComponentDefaults(type)` 覆盖
  `builtinScaffold` 的空 props；基础区块同理读 `getBlockDefaults(type)`。
  本轮未改 `server/**` 与 `assets/app.js`。

### 25. 页面限高限宽（本轮）

- 新增 `src/render/page-size.js`：`normalizePageSize(size)`、`pageSizeStyle(size)`、
  `hasPageSize(size)`，通过 `R.normalizePageSize` 暴露给平台侧，预览与导出共用同一口径。
- 取值：字符串，仅接受 `px / vh / vw / % / rem`，空串表示不限。正则
  `^\d+(?:\.\d+)?(?:px|vh|vw|%|rem)$` 保证 `abc`、`-10px`、`100`、`100 px`、
  `10em`、`calc(100vh)` 一律回退为不限，也不会把 `;` / `}` 注入样式。
- 渲染：`.lc-page` 根容器输出内联 `max-width` / `max-height` / `overflow:auto`；
  设了 `maxHeight` 时再输出 `min-height:0`，避免预览里 `.lc-page{min-height:100vh}`
  压过 `max-height`。同时写 `data-lc-page-max-width` / `data-lc-page-max-height`
  便于测试与平台读取。旧页面没有 `size` 时节点上不产生任何多余声明。
- 外层不滚动：预览文档在 `maxHeight` 存在时追加
  `html, body { height: 100% } body { overflow: hidden }`；导出文档按页插入
  `<style>html, body{margin:0;height:100%} body{overflow:hidden}</style>`
  （只设 `maxWidth` 时只重置 `body` 外边距）。`%` 因此相对视口高度的 body 生效。
- 实测（Edge，导出产物 + builder 预览文档，1440×900 与 390×844 各一遍）：
  仅 `maxHeight:480px`、`640px+60vh`、`maxHeight:100vh` 三组外层
  `scrollHeight == clientHeight`（无外层滚动条），`.lc-page` 内部
  `scrollHeight > clientHeight`（内部滚动生效）；`100vh` 只出现内层滚动条，
  无双滚动条；`maxWidth:640px` 在 390 视口下收缩为 390 且无横向溢出。
  非法值与无 `size` 页面保持原样（外层正常滚动、`overflow:visible`）。
- `verify.cjs` 新增 19 项：合法/非法取值、仅高/仅宽/两者/未设置、恶意注入、
  旧页面无变化。当前共 563 项全部通过。

### 26. 背景统一走主题令牌（本轮）

- `themeCss()` 前置默认主题亮色兜底：`themeCss(themes)` 先输出
  `:root { --lc-color-* 默认主题亮色 }`，再输出
  `:root:where([data-lc-mode="dark"]) { 默认主题暗色 }`。`:where` 保持 0 额外特异性，
  任何带 `data-lc-theme` / `data-lc-mode` 的具体主题规则都能覆盖；文档缺属性时
  变量也不会退化成 `transparent`。
- `BASE_CSS` 首行显式铺底：`html, body { background: var(--lc-color-bg, #f4f0e6); color: var(--lc-color-ink, #1d2320); }`；
  `:where(.lc-page)` 同样补 `background` / `color`。导出文档在 head 常驻一段
  `shellCss`，不再依赖页面内容自身是否够高。
- 平台外壳：`lc-editor.css` 的 `html, body` 与 `.lc-shell` 显式主题背景；
  `.lc-canvas-stage` 保持透明但其父 `.lc-builder-canvas` 用 `--lc-color-bg-deep`
  不透明兜底，`.lc-canvas-frame` 用 `--lc-color-surface`，`.lc-canvas-placeholder`
  补 `--lc-color-surface`；`app.css` 的 `.lc-page` 补 `var(--bg)`。
- `lc-tokens.css` 增加 `html { color-scheme: light }` 与
  `html[data-lc-mode="dark"], html[data-theme="dark"] { color-scheme: dark }`；
  `vendor/site.css` 的 `html` / `html[data-theme="dark"]` 也补 `background: var(--bg)`。
- 组件预览 iframe（srcdoc）补 `<html data-lc-theme data-lc-mode>`、`color-scheme`
  与 `html/body` 背景；builder 画布文档由 `previewDocument()` 写入同名属性。
- 默认模式：`resolveMode()` 对 `auto` 直接返回 `light`，删除 `matchMedia` 变化监听；
  `themeBootScript` / `themeRuntime`、builder、平台 UI 的 auto 一律回退亮色，
  不再按 `prefers-color-scheme` 猜暗色。Tauri 窗口补 `backgroundColor: "#f4f0e6"`，
  避免加载前露出系统黑底。
- 实测（Edge，默认主题 ink-green，亮/暗各一遍，10 个面）：
  `html` / `body` / `.lc-page` 亮色均为 `rgb(244,240,230)`（#f4f0e6），
  暗色均为 `rgb(20,26,31)`（#141a1f）；卡片面亮 `rgb(255,252,245)`、
  暗 `rgb(26,34,41)`。编辑预览、组件预览、独立页面预览、Web 导出、Tauri 包内前端
  均无 `rgb(0,0,0)`、无 transparent。`verify.cjs` 补 3 项根兜底/铺底断言，
  当前共 566 项全部通过；`npm test` 64 项通过。

## 本模块尚未覆盖（留给其他模块）

- 导出静态站时动作与交互运行时的打包：`mount` 已提供绑定逻辑，导出器需把
  `interactions.js` / `mermaid.js` 一起带出去（两者都是无依赖 UMD，可直接拼成单文件）。
- 主题调色板派生、组件库 UI、存储与迁移、构建导出：分别属于 T1、编辑器、存储、导出模块。
- `@keyframes` 重命名、CSS 嵌套语法、`@container` 查询的高级用法。
- 文件名/路径转义只做了属性选择器需要的引号与反斜杠转义；含 `]` 的极端 id 建议在平台侧限制。
