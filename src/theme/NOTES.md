# 主题与设计系统 · 实现说明

这份东西的目标只有一句话：让编辑器、预览页、导出的静态站三处用的是同一份颜色和尺寸，换主题时不用改组件代码。

## 一分钟上手

在 `lowcode/` 根目录执行：

```bash
node src/theme/check.mjs     # 主题字段 / 令牌 / 对比度 / 图标集 / 断点 / 模板预设 / schema 兼容 / CSS 导出
node src/theme/build.mjs     # 重新生成令牌、主题、图标 sprite、断点演示页、预览页、编辑器页
```

预览页直接双击打开：`src/theme/preview.html`。主题编辑器双击打开：`src/theme/editor.html`。两者都是纯静态文件，样式走相对路径，不依赖本地服务、不 fetch JSON。

当前结果：10 套内置主题、20 组（亮/暗）配色全部通过。正文 36 组最低 4.51:1；次要/占位文字 7 组最低 4.55:1；禁用态 3 组最低 3.42:1（WCAG 豁免，内部按 3:1 要求）；描边/焦点环 7 组最低 3.28:1；遮罩焦点环 2 组最低 6.58:1。四套模板各有独立默认主题；主题包格式 v3 可迁移 v1/v2；CSS 导出接口在 Node 里直接可用。颜色令牌 42 个、图标 38 个、断点 640/900/1180px 与样式同步；主题编辑器、导入校验、切换器 7 个产物齐全。

## 文件清单

| 路径 | 作用 | 是否手写 |
| --- | --- | --- |
| `src/theme/tokens.mjs` | 令牌定义、断点注册表、CSS 生成函数；颜色与派生逻辑转出 `runtime.mjs` | 手写，唯一事实来源 |
| `src/theme/runtime.mjs` | 纯数据 + 纯函数：颜色算法、派生、主题解析、导入校验。Node 与浏览器共用 | 手写，唯一事实来源 |
| `src/theme/icons.mjs` | 38 个图标定义（id / 中文名 / 形状）和 sprite 生成 | 手写，唯一事实来源 |
| `src/theme/themes/*.json` | 10 套主题包，只写主色和少量覆盖 | 手写 |
| `src/theme/presets.mjs` | 四套模板与默认主题的映射（docs / portfolio / dashboard / auth） | 手写，唯一事实来源 |
| `src/theme/check.mjs` | 主题、图标、断点、产物接线自检脚本，Node 原生实现 | 手写 |
| `src/theme/build.mjs` | 生成 CSS、图标 sprite、运行时、断点演示页、预览页、编辑器页、切换器演示页 | 手写 |
| `src/theme/editor-page.mjs` | 编辑器页与切换器演示页的 HTML 模板 | 手写 |
| `src/theme/editor-app.js` | 主题编辑器交互（新建/复制/色板/覆盖/校验/导入导出） | 手写，经典脚本 |
| `src/theme/theme-switch.js` | 站点主题切换器（跟随系统 / 亮 / 暗 + 多套主题） | 手写，经典脚本 |
| `src/theme/preview.html` | 静态预览页 | 生成，不要手改 |
| `src/theme/preview-shell.html` | 断点演示用的外壳页（被预览页放进 iframe） | 生成，不要手改 |
| `src/theme/editor.html` | 主题编辑器页 | 生成，不要手改 |
| `src/theme/switcher-demo.html` | 主题切换器演示页 | 生成，不要手改 |
| `src/theme/lc-theme-runtime.js` | `runtime.mjs` 去掉 `export`、包成 IIFE，挂 `globalThis.LCThemeRuntime` | 生成，不要手改 |
| `src/theme/lc-icons.html` | 内联 SVG sprite 片段，粘到 `<body>` 开头即可用 | 生成，不要手改 |
| `assets/css/lc-tokens.css` | 基础令牌、断点令牌、亮暗两套值、旧变量别名 | 生成，不要手改 |
| `assets/css/lc-themes.css` | 内置主题包的变量块 | 生成，不要手改 |
| `assets/css/lc-icons.css` | 图标尺寸/描边/颜色规则，图标按钮 | 手写 |
| `assets/css/lc-editor.css` | 编辑器外壳：顶栏、三栏、画布、弹窗、状态栏 | 手写 |
| `assets/css/lc-theme-editor.css` | 主题编辑器专有布局：三栏、色板行、派生色列表、校验清单、双栏预览 | 手写 |
| `assets/css/lc-theme-switch.css` | 主题切换器容器，复用 `.lc-tab` / `.lc-select` | 手写 |
| `assets/css/lc-controls.css` | 基础控件：按钮、表单、标签、表格、提示条 | 手写 |
| `assets/css/lc-responsive.css` | 三档断点的收窄与覆盖层折叠规则 | 手写 |
| `assets/css/lc-a11y.css` | 焦点环容器内补丁、skip link、高对比模式 | 手写 |
| `assets/css/lc-print.css` | 打印样式（只在 `media="print"` 下加载） | 手写 |

只动了 `src/theme/**` 和 `assets/css/lc-*.css`。`platform.config.json`、`server/**`、`src/storage/**`、`src/render/**`、`scripts/**`、`package.json`、`index.html` 都没碰。

## 令牌命名规则

```
--lc-<类别>-<对象>[-<变体>]
```

| 类别 | 说明 |
| --- | --- |
| `color` | 颜色，全部由主题主色派生或覆盖 |
| `font` | 字体栈 |
| `text` | 字号阶梯 |
| `leading` | 行高 |
| `weight` | 字重 |
| `space` | 间距，4px 到 48px |
| `radius` | 圆角 |
| `border` | 边框宽度、样式、组合值 |
| `shadow` | 阴影，跟明暗走 |
| `motion` | 动效时长和缓动 |
| `z` | 层级，避免各模块自己拍脑袋写 9999 |
| `size` | 编辑器布局尺寸 |
| `bp` | 响应式断点，只作文档/JS 读取（见下） |
| `print` | 打印专用固定色，浅色纸面，不跟随主题（见下） |

颜色令牌 43 个，分四类：

- 背景层级：`bg`、`bg-deep`、`surface`、`surface-2`、`surface-3`
- 文字层级：`ink`、`ink-2`、`muted`、`muted-2`、`decor`、`placeholder`、`disabled-ink`
- 面：`disabled-bg`
- 线：`line`、`line-strong`
- 强调：`accent`（文字/图标）、`accent-fill`（按钮底色）、`accent-fill-hover` / `accent-fill-pressed`（主按钮悬停/按下）、`on-accent`（填充上的文字）、`accent-soft`、`accent-line`、`accent-2`（辅助强调色）、`accent-2-soft`、`accent-2-line`、`focus`、`focus-overlay`（遮罩上的反色焦点环）
- 状态：`success`、`warn`、`danger`、`info`，各带 `-soft`、`-line`
- 杂项：`code-bg`、`selection-bg`、`selection-ink`、`overlay`

注意 `muted-2` 虽然是「更弱的文字」，实际值比 `muted` 略深。原因很实际：占位符也是文字，按 AA 正文标准必须过 4.5:1，不能真的调得更浅，否则检查直接挂。占位符单独有 `--lc-color-placeholder`，值等于 `muted-2`，语义更清楚。

### 打印令牌：固定浅色纸面

打印**不跟随当前主题**。无论站点处于亮色还是暗色，纸面一律是白底墨字；否则暗色主题会把浅灰文字、浅色强调底直接印到白纸上，几乎不可读。

为此新增一组 `--lc-print-*` 固定令牌（25 个），只在 `tokens.mjs` 的 `PRINT_TOKENS` 维护一份值，产物写进 `lc-tokens.css` 的 `:root`。`lc-print.css` 只负责把主题令牌映射过去：

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--lc-print-bg` | `#ffffff` | 纸面 / 卡片 / 代码底 |
| `--lc-print-ink` / `ink-2` | `#111111` / `#222222` | 正文与标题 |
| `--lc-print-muted` / `muted-2` | `#555555` / `#444444` | 次要文字、占位符 |
| `--lc-print-decor` | `#8a8a8a` | 装饰色（白纸上 3.45:1，够 3:1 下限） |
| `--lc-print-disabled-ink` | `#767676` | 禁用文字（仍保留 4.5:1） |
| `--lc-print-line` / `line-strong` | `#bbbbbb` / `#888888` | 表格与代码边框 |
| `--lc-print-accent` / `accent-fill` / `on-accent` | `#111111` / `#eeeeee` / `#111111` | 链接、主按钮、按钮文字 |
| `--lc-print-accent-soft` | `#f5f5f5` | 强调浅底 |
| `--lc-print-success` / `warn` / `danger` / `info` | `#14532d` / `#7a4b00` / `#9b1c1c` / `#1e4b7a` | 状态文字 |
| `--lc-print-*-soft` | `#f0fdf4` / `#fff8e6` / `#fef2f2` / `#eff6ff` | 状态浅底 |
| `--lc-print-focus` | `#111111` | 焦点环 |

`check.mjs` 会核对：25 个令牌都进了基础 CSS、`lc-print.css` 对每个令牌都有引用、打印样式里没有写死色值、纸面对比度（正文组合 4.5:1，线/焦点环/装饰色 3:1）。增删打印令牌只改 `tokens.mjs`，不要在两处各写一份。

### 装饰色 decor 与 muted-2 的分工

`--lc-color-decor` 只用于**不承载信息**的纯装饰文字与线条：代码行号、日期/滑块的分隔符、面包屑斜杠、图表第 7 系列之后的颜色、禁用态文字。它不参与正文 4.5:1 检查，但有自己的下限。

派生规则（`runtime.mjs`，10 套主题亮暗各算一份，主题 JSON 不手填）：

```text
muted-2 = mix(muted, ink, 0.22)
decor   = ensureContrastAll(mix(muted-2, bg, 0.45), [bg, surface, surface-2, surface-3, bg-deep], 3)
```

先让装饰色比 `muted-2` 再向底色退 45%，再在五种常见底色上兜底到 3:1。先退再兜底，保证它稳定地比 `muted-2` 淡，而兜底只在个别底色上把它抬回红线。

下限为什么是 3:1：

- 装饰色不承载信息，不适用正文 4.5:1；也不属于 WCAG 1.4.11 必须达标的控件边界。
- 但它承担「可扫描结构」：行号、分隔符看不见时，表格和表单会变成一坨。低于 3:1 在暗色面上会直接消失，所以借用 1.4.11 的非文本下限作为内部红线。
- `check.mjs` 用 1.00 的对比度差作为「与 muted-2 明显区分」的门槛：差值太小说明装饰色没真正变淡，等于白加令牌。

实测（`bg` 上的比值；最差底色是亮色 `bg-deep`、暗色 `surface`）：

| 主题 | 亮色 decor | 亮色最差 | 亮色 gap | 暗色 decor | 暗色最差 | 暗色 gap |
| --- | --- | --- | --- | --- | --- | --- |
| auth-clean | `#81878d` | 3.01:1 | 3.54 | `#646e77` | 3.40:1 | 5.93 |
| blueprint-amber | `#78828a` | 3.04:1 | 3.70 | `#66717c` | 3.35:1 | 5.90 |
| dashboard-calm | `#7d848a` | 3.03:1 | 3.63 | `#66727a` | 3.49:1 | 5.97 |
| docs-quiet | `#828485` | 3.12:1 | 4.05 | `#696f74` | 3.31:1 | 5.42 |
| ink-graphite | `#808283` | 3.03:1 | 3.64 | `#6c7070` | 3.27:1 | 5.38 |
| ink-green | `#7d7f7e` | 3.11:1 | 2.88 | `#696f73` | 3.16:1 | 5.01 |
| ink-navy | `#7c8082` | 3.10:1 | 2.89 | `#69717a` | 3.25:1 | 5.47 |
| ink-ochre | `#837c73` | 3.17:1 | 3.22 | `#746b62` | 3.18:1 | 5.16 |
| night-contrast | `#82868c` | 3.16:1 | 5.90 | `#696e75` | 3.68:1 | 7.29 |
| portfolio-bold | `#887e76` | 3.18:1 | 4.47 | `#756a60` | 3.37:1 | 5.72 |

「gap」= 同一底色上 `muted-2` 与 `decor` 的对比度差，全部 ≥ 2.88。

使用边界，别混用：

| 场景 | 用哪个 | 检查标准 |
| --- | --- | --- |
| 行号、分隔符、面包屑斜杠、图表第 7+ 系列、禁用态文字 | `decor` | ≥3:1，且比 muted-2 淡 ≥1.00 |
| 说明文字、KPI 注释、表单计数、时间/作者、占位符、日历星期标题 | `muted-2` / `placeholder` | 承载信息，正文 4.5:1 |
| 控件禁用态的底色/边框 | `disabled-bg` / `disabled-ink` | 3:1（部分豁免，仍保底） |

判断标准只有一条：**去掉它，信息是否丢失**。会丢信息就 `muted-2`，不会就 `decor`。装饰色不允许用来放标签、数值、错误提示或任何需要读的文字。

### 页面级尺寸：不新增变量

页面级尺寸（整页最大宽度、内容栏宽度等）**不设** `--lc-page-*` 之类的新变量，统一用容器宽度（`max-width` + `padding`）与已有 `--lc-space-*` 解决。原因：

- 页面尺寸是单个页面的布局决策，令牌化会迫使所有页面共享同一组宽度，限制单页排版；
- 页面宽度和组件内间距不是一类东西，混进令牌会让「改一个页面」变成「改全站」；
- 现有间距令牌已经能表达内边距与栏间距，不需要再加一层。

本轮无障碍审计没有提出「为页面尺寸加变量」的建议；本决定作为既定规则记录，后续遇到同类建议按此驳回，不再讨论。

### 别名只保留一层

每个兼容别名只写一层：

```css
--bg: var(--lc-color-bg);
```

`check.mjs` 额外禁止别名指向别名。业务样式只有两种合法写法：`var(--lc-color-bg)` 或 `var(--bg)`；禁止 `var(--lc-color-bg, var(--bg, #f4f0e6))` 这种「正式名 → 别名 → 字面量」的三层兜底——它会在暗色或打印时悄悄用回写死值，让主题切换和检查都失效。

`check.mjs` 的 `checkFallbacks()` 扫描 `assets/css/*.css`、`assets/app.css` 与 `src/theme` 两个演示页，解析 `var()` 的嵌套参数，发现内层 `var()` 还自带 fallback 就直接报错并给出行号。渲染层组件不在本层扫描范围，由渲染模块单独收敛。

### 主题体积与按需加载

数据口径：UTF-8 原文 + zlib level 6 gzip，由 `build.mjs` 生成并写入 `assets/css/lc-theme-manifest.json`，`check.mjs` 会核对清单与实际产物一致。

当前生成物（10 套主题）：

| 产物 | 原文 | gzip | 说明 |
| --- | --- | --- | --- |
| `lc-tokens.css` | 8,825 B | 2,474 B | 基础令牌 + 打印令牌 + 别名，所有站点共用一份 |
| `lc-themes.css` | 43,852 B | 7,044 B | 10 套 × 亮暗 20 个规则块 |
| 单套主题块 | 4,461–4,479 B | 1,147–1,200 B | 含 84 B 表头注释，仅颜色令牌 |

每多带一套主题的边际成本（同一份 CSS 里追加）：

| 已带套数 | 累计原文 | 累计 gzip | 本套新增原文 | 本套新增 gzip |
| --- | --- | --- | --- | --- |
| 1 | 4,465 B | 1,185 B | 4,465 B | 1,185 B |
| 2 | 8,846 B | 1,895 B | 4,381 B | 710 B |
| 3 | 13,231 B | 2,563 B | 4,385 B | 668 B |
| 4 | 17,602 B | 3,211 B | 4,371 B | 648 B |
| 5 | 21,977 B | 3,857 B | 4,375 B | 646 B |
| 6 | 26,346 B | 4,496 B | 4,369 B | 639 B |
| 7 | 30,713 B | 5,055 B | 4,367 B | 559 B |
| 8 | 35,082 B | 5,703 B | 4,369 B | 648 B |
| 9 | 39,467 B | 6,371 B | 4,385 B | 668 B |
| 10 | 43,852 B | 7,044 B | 4,385 B | 673 B |

结论：多带一套约 **+4.4 KB 原文 / +0.64 KB gzip**。多带两套约 +8.8 KB 原文 / +1.3 KB gzip，比一张压缩后的照片小两个数量级；取舍应按「用户需不需要换主题」判断，不必按字节判断。

模板预设的实际成本（选定主题 + `lc-tokens.css` 一起）：

| 模板 | 主题 | 主题原文 | 主题 gzip | 含基础令牌 gzip |
| --- | --- | --- | --- | --- |
| docs | docs-quiet + ink-green + ink-navy + ink-graphite | 17,576 B | 3,110 B | 4,654 B |
| portfolio | portfolio-bold + ink-ochre + blueprint-amber | 13,229 B | 2,614 B | 4,690 B |
| dashboard | dashboard-calm + ink-navy + ink-graphite + blueprint-amber | 17,602 B | 3,202 B | 5,241 B |
| auth | auth-clean + docs-quiet + ink-green | 13,205 B | 2,561 B | 4,111 B |

拆分方案：

- 导出管线调用 `themeCssForIds(themes, ids, { defaultThemeId })`（`runtime.mjs`，已同步导出到 `lc-theme-runtime.js`）。只输出 `ids` 里的主题，未知 id、空列表、默认主题不在列表都会抛错，不静默少带。
- 默认主题的亮色规则挂在 `:root, [data-lc-theme="id"][data-lc-mode="light"]`，暗色挂 `[data-lc-theme="id"][data-lc-mode="dark"], :root[data-lc-mode="dark"]`；其余主题只挂带 id 的选择器。这样即使页面漏写属性也有兜底，且换主题时不会被 `:root` 覆盖。
- 默认 `onlyThemeTokens: true`，每套只输出颜色/别名/覆盖；基础令牌由 `lc-tokens.css` 出一份。若用完整解析（`themeStyleSheet`），每套会多带 5 个阴影令牌（`--lc-shadow-*` / `--lc-ring`），约 +507 B/套。
- 单主题不会比合并版大：合并版没有可复用的声明块，唯一公共部分就是 84 B 表头和 8.8 KB 的基础令牌。反过来，**把 10 套拆成 10 个文件反而更贵**：合并 gzip 7,044 B，10 个单文件 gzip 相加 12,364 B（1.75 倍）——每个响应各自建压缩字典，选择器和属性名无法跨文件复用。合理切法是「一个站点一份 CSS，里面只放允许的主题」，不是「一套一个请求」。
- 如果某站点允许的主题多到一份 CSS 超过预算，再按主题拆文件时也必须用同一份压缩上下文（HTTP/2 下仍不共享 gzip 字典）或改用 brotli；不要把「拆分」当成默认优化。

首屏与切换时的白闪：

- 运行时切换本身不会白闪：允许的主题都在同一份已解析的 CSS 里，改 `data-lc-theme` / `data-lc-mode` 只触发重算，不产生网络请求。
- 会闪的是**首次加载**：切换器在 `DOMContentLoaded` 才读存档，首屏先按页面写死的主题画一遍再跳变。解决办法是把 `themeBootScript()`（`src/theme/theme-boot.mjs`）生成的脚本内联到 `<head>`、排在所有样式表之前；`switcher-demo.html` 已这样做，生成物是 `src/theme/lc-theme-boot.js`。
- 如果按主题拆文件并在切换时才 `<link>` 动态加载，就会真的闪白（新样式到达前旧主题已卸载或新主题未解析）。要么把允许的主题预加载/内联，要么切换时等 `load` 事件后再移除旧主题，期间不要留空档。

### 断点令牌的天花板

`--lc-bp-sm/md/lg` 只输出成 CSS 变量供 JS 读取和文档使用。**CSS 规范不允许自定义属性出现在 `@media` 条件里**，所以媒体查询写的是固定数值。断点的唯一事实来源仍是 `tokens.mjs` 的 `BREAKPOINTS`，`check.mjs` 会核对 `lc-responsive.css` 里的 `max-width` 数值和它一致——两边不同步直接报错。

## 主题包结构

一个主题文件长这样：

```json
{
  "schemaVersion": 3,
  "id": "ink-green",
  "name": "纸墨 · 松绿",
  "tone": "paper",
  "description": "默认主题。米色纸面配墨绿……",
  "modes": {
    "light": {
      "seeds": {
        "bg": "#f4f0e6",
        "surface": "#fffcf5",
        "ink": "#20242a",
        "muted": "#5f656b",
        "line": "#ded6c5",
        "accent": "#3e6a56",
        "codeBg": "#efeade",
        "success": "#2f5f4b",
        "warn": "#7d4a1a",
        "danger": "#a3342c",
        "info": "#35577f"
      },
      "overrides": {}
    },
    "dark": {
      "seeds": {
        "bg": "#141a1f",
        "surface": "#1a2229",
        "ink": "#e6e2d8",
        "muted": "#a0a8ae",
        "line": "#2a343c",
        "accent": "#8fb9a1",
        "accentFill": "#2f5545",
        "onAccent": "#f3f7f2",
        "codeBg": "#151d23",
        "success": "#8fc7a9",
        "warn": "#d6a177",
        "danger": "#e08a7d",
        "info": "#93b3d6"
      }
    }
  },
  "shared": {
    "tokens": {
      "--lc-motion-base": "220ms"
    }
  }
}
```

必填字段：`schemaVersion`、`id`、`name`、`tone`、`description`、`modes.light`、`modes.dark`。可选字段：`shared`、`meta`（作者 / 主页 / 标签，导出时原样保留，不参与渲染）。`id` 是 2–32 位小写字母、数字、连字符；文件名必须和 `id` 一致。

### 版本与向后兼容（v3）

`THEME_SCHEMA`（`runtime.mjs`）是字段表的唯一事实来源，`check.mjs` 用合成旧文件逐条验证：

| 来源版本 | 处理方式 |
| --- | --- |
| v1（根节点直接写 `light` / `dark`，或包在 `colors` 下） | `migrateThemeData()` 折叠进 `modes`；缺 `tone` 补 `neutral`，缺 `description` 补占位说明；缺 `overrides` 补空对象 |
| v2（`modes.light / dark + seeds`，与 v3 同构） | 字段原样读取，只把 `schemaVersion` 升到 3，不丢任何覆盖 |
| 未来版本（如 v4） | 不拒绝文件，按已知字段尽力读取，并在导入报告里提示「版本高于当前」 |
| 缺 `schemaVersion` | 按 v1 处理并补迁移说明 |
| 未知字段 | 忽略，不因为多一个字段就让整包失败 |

迁移只发生在导入 / 导出 / 构建读取阶段，不改原文件；`validateThemeData()` 返回 `version` 和 `migrated`，编辑器导入报告会显示「已从 v2 升级到 v3」这类提示，而不是一句「导入失败」。

每个模式必须写全 11 个主色：`bg`、`surface`、`ink`、`muted`、`line`、`accent`、`codeBg`、`success`、`warn`、`danger`、`info`。可选写 `accentFill`、`onAccent`、`accent2`：

- `accentFill` 不写就等于 `accent`。深色主题里 `accent` 通常是浅色（用来当链接文字），直接当按钮底色会和白字打架，所以深色模式几乎都要单独写一个更深的 `accentFill`。
- `onAccent` 不写就在近白和近黑里挑对比度高的那个。
- `accent2` 不写就按「accent 与 info 各一半」自动混出来，用于图表第二系列、次级标记等；填了才用填的值。

`shared.tokens` 是亮暗共用的覆盖，只能放确实需要主题化的静态令牌（如动效、层级），不能放颜色。圆角与字体栈都是全站唯一来源，不允许主题覆盖，`check.mjs` 会直接报错。`modes.*.overrides` 可以覆盖任意已知令牌，包括颜色；颜色值必须是实色十六进制。

主题包只写主色，其余靠派生：

| 令牌 | 派生方式 |
| --- | --- |
| `bg-deep` | 亮色：bg 往 ink 混 7%；暗色：bg 往纯黑混 22% |
| `surface-2` / `surface-3` | surface 往 bg 混 55% / 30%，做次级面板 |
| `ink-2` | ink 往 bg 混 16% |
| `muted-2` | muted 往 ink 混 22%，保证占位符对比度 |
| `line-strong` | line 往 ink 混 46%（亮）/ 48%（暗），满足非文字 3:1 |
| `accent-soft` | accent 往 bg 混 90%（亮）/ 86%（暗） |
| `accent-line` | accent 与 line 各一半 |
| `accent-fill-hover` / `-pressed` | 亮色：accent-fill 往黑混 10% / 18%；暗色：往白混 |
| `accent-2` / `-soft` / `-line` | 未填种子时 accent 与 info 各一半，其余同 accent 派生 |
| 状态 `-soft` / `-line` | 状态色分别往 bg / line 混，规则同上 |
| `focus` | 等于 accent |
| `overlay` | 亮色 `rgba(20,24,28,.44)`，暗色 `rgba(2,4,6,.68)` |

暗色的 `bg-deep` 特意用纯黑混合，而不是往 `ink` 混。`ink` 在暗色里是浅色，按老公式算出来的「更深一层」会反而变亮，这是旧版配色里踩过的坑。

## CSS 导出接口

`runtime.mjs` 提供三个纯函数，Node / CI / 静态站生成器直接 import 即可，不依赖浏览器、不读写文件：

```js
import { themeCssBlock, themeCssRule, themeStyleSheet } from './src/theme/runtime.mjs';

const css = themeCssBlock(theme);      // 单套：:root（亮色）+ [data-lc-theme][data-lc-mode="dark"]（暗色）
const rule = themeCssRule(theme, 'dark', '[data-theme="brand"]', { onlyThemeTokens: true });
const sheet = themeStyleSheet(themes); // 多套：每套一组，:root 由调用方按需替换
```

- `themeCssBlock(theme, options)` 默认输出两个选择器：`:root` 放亮色全部变量，`[data-lc-theme="<id>"][data-lc-mode="dark"]` 放暗色全部变量；可用 `lightSelector` / `darkSelector` 换成 scoped 选择器。
- `themeCssRule(theme, mode, selector, options)` 是底层的单规则生成器。`onlyThemeTokens: true` 只输出颜色、共享令牌和覆盖项，`themesCss()` 用的就是这个模式，保证构建出的 `lc-themes.css` 与导出接口同一份实现。
- `themeStyleSheet(themes, options)` 批量拼接，每套主题各自带 id 的暗色选择器；一次导出一套主题时用 `themeCssBlock`，一次导出多套时用 `themeStyleSheet`。
- 所有变量值先过 `safeCssValue()`：含 `;`、`{`、`}` 或换行的覆盖值会被整条丢弃，防止导入的 JSON 把样式表结构撑破。
- 输出只包含主题变量（颜色、阴影、`shared.tokens`、`overrides`）；字号、间距、圆角等静态令牌仍由 `lc-tokens.css` 提供，导出时按需一起内联。

## 内置主题

| id | 名称 | 调性 | 特点 |
| --- | --- | --- | --- |
| `docs-quiet` | 文档 · 素白 | 纸感 | 文档站默认，近白纸面配墨绿，长文阅读 |
| `ink-green` | 纸墨 · 松绿 | 纸感 | 通用回落主题，米色纸面配墨绿 |
| `ink-navy` | 纸墨 · 藏青 | 冷调 | 藏青强调，技术文档 |
| `ink-ochre` | 纸墨 · 赭石 | 暖调 | 暖纸面，赭石强调 |
| `ink-graphite` | 纸墨 · 石墨 | 中性 | 低饱和，中性灰阶 |
| `portfolio-bold` | 作品集 · 赤霞 | 暖调 | 作品集默认，暖白纸面配赤陶红，色块更抢眼 |
| `dashboard-calm` | 仪表盘 · 石青 | 冷调 | 仪表盘默认，冷灰蓝底、低饱和数据色 |
| `auth-clean` | 认证 · 净白 | 中性 | 认证中心默认，近纯白底 + 单一蓝强调 |
| `blueprint-amber` | 蓝图 · 琥珀 | 工程蓝 | 冷灰蓝底配琥珀，工程文档 |
| `night-contrast` | 夜航 · 高对比 | 高对比 | 近黑底、近白字、亮青强调 |

四套模板的默认主题各不重复，`presets.mjs` 是唯一映射；`check.mjs` 会核对模板数量、默认主题存在性、是否被多套模板共用。四套纸墨系沿用旧版 id，避免迁移时对不上；没有用紫蓝渐变，也没有外部字体。

| 模板 | 模板 id | 默认主题 | 气质 | 可换主题 |
| --- | --- | --- | --- | --- |
| 文档站 | `docs` | `docs-quiet` | 纸感素净 | docs-quiet / ink-green / ink-navy / ink-graphite |
| 作品集 | `portfolio` | `portfolio-bold` | 大胆 | portfolio-bold / ink-ochre / blueprint-amber |
| 仪表盘 | `dashboard` | `dashboard-calm` | 冷静 | dashboard-calm / ink-navy / ink-graphite / blueprint-amber |
| 认证中心 | `auth` | `auth-clean` | 干净 | auth-clean / docs-quiet / ink-green |

## 对比度自检

`check.mjs` 每组主题的亮暗各查五类组合：

| 类别 | 组数 | 阈值 | 覆盖 |
| --- | --- | --- | --- |
| 正文 | 36 | 4.5:1 | 正文/次级正文/强调色/辅助强调色/按钮文字/状态色 × 各级底色 |
| 次要与占位文字 | 7 | 4.5:1 | `muted`、`muted-2`、`placeholder` × 背景/面板/次级面板/更深背景 |
| 禁用态 | 3 | 3:1 | `disabled-ink` × `disabled-bg`、面板、背景 |
| 非文字 | 7 | 3:1 | `focus`、`line-strong` × 背景/面板/次级面板/强调浅底 |
| 遮罩焦点环 | 2 | 3:1 | `focus-overlay` × 遮罩叠在面板/背景后的合成色 |

遮罩是半透明的，不能直接拿 `rgba` 当背景算，否则算出来的是假数。`compositeOver()` 先把遮罩按 alpha 叠到底色上，再算对比度。亮色主题用近黑环、暗色主题用纯白环，所以合成后的比值分别是 6.5–7.0 和 19+。

树形菜单选中项原先用 `muted` 配强调浅底，藏青主题算出来只有 4.50 的边缘值，所以选中项里的次要文字改成 `ink-2`。这类问题靠肉眼看不出来，得让脚本把实际用到的组合都列进去。

失败时会直接打印令牌名、当前色值和算出来的比值，给一句人话结论。浅底主题把强调色和状态色调深一点、深底主题调亮一点，通常就能过。

## 图标集

38 个图标，全部内联 SVG。统一 24×24 网格、1.75 描边、圆头端点、视觉重心压在 (12,12)，所以并排时不会有的偏高、有的偏沉。没有 iconfont、没有图标库 CDN、没有 data URI。

覆盖的动作：新增、移除、删除、编辑、复制、撤销、重做、拖拽手柄、展开/收起、可见/隐藏、锁定/解锁、保存、导出、导入、运行、搜索、筛选、排序、关闭、更多（横/纵），另外补了完成/警告/信息/帮助/链接/设置/图层/文本/图片/网格/外部打开、调色板。

用法：

```html
<!-- 1. 把 src/theme/lc-icons.html 整段粘到页面 <body> 开头 -->
<!-- 2. 按 id 取用 -->
<svg class="lc-icon" aria-hidden="true"><use href="#lc-icon-save"></use></svg>

<!-- 改尺寸：类名或变量 -->
<svg class="lc-icon lc-icon-xl"><use href="#lc-icon-save"></use></svg>
<svg class="lc-icon" style="--lc-icon-size:18px;--lc-icon-stroke:2"><use href="#lc-icon-grip"></use></svg>

<!-- 改颜色：父级 color 就是描边色，图形全走 currentColor -->
<span style="color:var(--lc-color-danger)">
  <svg class="lc-icon"><use href="#lc-icon-delete"></use></svg>
</span>
```

- id 规则固定为 `lc-icon-<name>`，`name` 见 `icons.mjs` 的 `ICON_SET`。
- 尺寸档位 `.lc-icon-sm`（14）/ 默认 16 / `.lc-icon-lg`（20）/ `.lc-icon-xl`（24）。
- 描边档位 `.lc-icon-thin`（1.5）/ 默认 1.75 / `.lc-icon-bold`（2.25）。
- 单独做按钮用 `.lc-icon-btn`，`aria-pressed` 或 `.is-active` 表示选中，`.is-danger` 表示破坏性操作，`:disabled` 有独立的禁用配色。

为什么不用外链 sprite（`<use href="icons.svg#id">`）：本地双击打开时浏览器会按跨源资源处理外部 SVG，直接静默失败。内联 sprite 在 `file://` 下也能用，这是预览页「双击就能看」的前提。

`check.mjs` 会核对：id 唯一且符合规则、每个图标有中文名和图形、任务要求的动作一个不少、分组不遗漏、网格是 24。改图标后跑一次 `build.mjs` 重新生成 sprite。

## 响应式断点

断点收在 `tokens.mjs` 的 `BREAKPOINTS`，同时输出 `--lc-bp-*` 变量：

| 断点 | 行为 |
| --- | --- |
| ≤ 1180px | 侧栏 264→224px、检查器 320→276px，工作区优先 |
| ≤ 900px | 检查器改成右侧覆盖层（默认滑出屏幕），工具栏隐藏次要信息；`lc-show-below-md` 的按钮出现 |
| ≤ 640px | 侧栏改成左侧覆盖层；导航、品牌副标题、按钮文字（`.lc-btn-label`）收起，只留图标 |

折叠由容器属性驱动，样式不猜业务：

```html
<div class="lc-shell" data-lc-sidebar="open" data-lc-inspector="closed">
```

- `open` / `closed` 只在窄屏覆盖层里生效，宽屏回到默认布局，不会因为忘记复位把侧栏一直藏起来。
- `hidden` 是用户明确要求隐藏，任何宽度都生效。
- 覆盖层打开时，`.lc-main::after` 自动画一层遮罩，`z-index` 比抽屉低一层。
- 通用工具类：`.lc-hide-below-lg/-md/-sm`、`.lc-show-below-md/-sm`。

样式只管「怎么收」，不管「什么时候收」：抽屉开关、`aria-expanded` 同步、焦点移入抽屉、Esc 关闭、滚动锁定都需要渲染层写少量 JS。预览页里的两个抽屉按钮只是演示，不是业务实现。

## 打印样式

`lc-print.css` 用 `media="print"` 加载，**必须放所有样式之后**——它靠顺序覆盖主题的暗色变量块。规则：

- 纸面一律浅色：暗色主题、强调浅底、代码底、状态浅底全部转成白纸墨字，不会白字白纸。
- 隐藏编辑器外壳与导航：顶栏、侧栏、检查器、工具栏、状态栏、弹窗遮罩、轻提示、分页、面包屑、目录（`.lc-toc`）。
- 文档排版：正文 11pt / 行高 1.6，`h1–h4` 加 `break-after: avoid-page`，段落 `orphans/widows: 3`。
- 整块不跨页：表格、代码块、引用、图片、`.lc-table-wrap`。
- 链接保留下划线，颜色统一墨色；表格保留细灰分隔线，不做斑马纹底色。

预览页的「打印样式」区块里有一个按钮直接调 `window.print()`；打印本页时其他区块会被隐藏，只输出纸面文档，这样能同时验证「导航不打断版面」。

已知边界：打印规则只作用于 `.lc-doc`（文档正文）和编辑器外壳。如果以后有别的页面要打印，需要在 `lc-print.css` 里补一条对应的容器选择器，不要复制一份新样式。

## 无障碍复核

复核对象是现有 `lc-` 样式覆盖的控件与外壳，结论如下。

### 键盘可达性

| 检查项 | 结论 | 处理 |
| --- | --- | --- |
| 交互元素是否都是原生可聚焦元素 | 通过 | 按钮、输入、选择、复选、单选、开关全部用 `button/input/select`，没有 `div` 伪按钮 |
| 图标按钮有没有可读名称 | 通过 | `.lc-icon-btn` 要求写 `aria-label`，纯装饰图标写 `aria-hidden="true"` |
| 是否出现正 `tabindex` | 无 | 样式层不写 `tabindex`；顺序由 DOM 决定，顶栏 → 侧栏 → 画布 → 检查器 → 状态栏，和视觉顺序一致 |
| 禁用元素是否仍能聚焦 | 原生控件用 `disabled`（不可聚焦）；`aria-disabled` 的保留可聚焦，方便读屏读到原因 | 两者视觉上都用 `disabled-bg/ink`，不会看起来可点 |
| 键盘能否跳过导航 | 已补 | `.lc-skip-link`，默认移出视口，聚焦时滑入 |

### 焦点环可见性

| 场景 | 结论 | 处理 |
| --- | --- | --- |
| 普通浅底 / 深底 | 通过 | `--lc-ring` 改成双环：面板色内圈 + 强调色外圈，比值 ≥3:1 |
| `overflow` 滚动或裁剪容器（弹窗正文、侧栏、检查器、画布、树、表格） | 已修 | 外发光会被裁掉，这些容器内的 `:focus-visible` 改成 2px **内嵌环** |
| 弹窗本体压在遮罩上 | 已修 | 新增 `--lc-color-focus-overlay`（亮色近黑、暗色纯白），遮罩合成后 ≥6.5:1 |
| 暗色主题 | 已验证 | 浏览器实测：暗色下 Tab 进入主题按钮和侧栏，焦点环清晰可见 |
| 被 sticky 头部挡住 | 已补 | 所有可聚焦元素 `scroll-margin-block: 96px`，键盘滚动时留出头部高度 |
| `forced-colors` 高对比模式 | 已补 | 边框改用 `ButtonText`、焦点改用 `Highlight`，避免自定义色被系统吞掉 |

### 弱化文本对比度

每个主题的亮暗都查，数值见上面「对比度自检」：

- 次要文字（`muted` / `muted-2`）按正文 4.5:1，最低 4.55:1。
- 占位符（`placeholder`）是真实文字内容，按 4.5:1，最低 4.55:1。
- 禁用态 WCAG 明确豁免，但内部按 3:1 要求，最低 3.42:1；禁用按钮/输入框/开关全部改用量牌值，不再用 `opacity`，避免文字对比度被一起降低。

### 仍需上层配合

样式层做不了、也不该做的事：

1. 弹窗打开时的焦点陷阱与初始焦点、关闭后焦点归位。
2. `.lc-tabs` / `.lc-tree` 的方向键漫游（roving tabindex）与 `aria-selected` 同步。
3. `.lc-toast` 的 `role="status"` / `aria-live="polite"`。
4. 覆盖层抽屉打开时的焦点移入、Esc 关闭、背景滚动锁定。

这几条会写进与渲染模块的对接说明，不在 CSS 里假装实现。

## 主题编辑器

双击 `src/theme/editor.html` 就能用，不需要本地服务。截图在 `screenshots/editor-dark.png`（暗色主题下编辑，外壳、色板、校验、双栏预览都跟着变暗）。

### 新建与复制

- 「新建」从空白开始：生成一个最小可用草稿，先填一套接近默认的主色，用户再改。
- 「复制」把当前选中的主题整份克隆，自动换 id 和名称，避免和原主题冲突。
- 左侧列出全部 10 套内置主题，每行末尾有「复制为基础」按钮：点一下就从那套主题生成草稿并切过去编辑，内置文件保持只读。顶栏的「复制」对当前主题做同样的事。
- 主题列表分「内置主题」和「我的主题」两组。内置主题只读，改动另存为草稿，不会覆盖 `themes/*.json`。
- 草稿存在 `localStorage` 的 `lc-theme-editor-drafts-v1`，刷新不丢；点「保存草稿」写回本地，导出 JSON 才会生成文件。

### 色板与派生色

- 主色按 `runtime.mjs` 的 `REQUIRED_SEEDS` 分组：页面、文字、描边、强调、状态。每行是「色块 + 十六进制输入 + 重置」。
- 派生色（悬停、按下、弱化背景、描边）一改主色就实时重算，列在下面的「派生色」清单里。
- 任一派生色都可以手动覆盖：输入合法十六进制后写入 `modes.<mode>.overrides`，行尾出现「还原」按钮；重置后回到自动值。覆盖值和主色一样会进导出的 JSON。
- 强调色有 `accent2`（辅助强调）和 `accentFill`/`onAccent`（按钮填充）三个可选种子；不填时按派生规则算，填了优先用用户值。
- 所有颜色只写进 CSS 变量，编辑器和预览都不出现硬编码色值。

### 实时校验

- 编辑过程中直接用 `runtime.mjs` 里的 `TEXT_PAIRS / UI_PAIRS / WEAK_PAIRS / DISABLED_PAIRS / OVERLAY_PAIRS`，和 `check.mjs` 是同一份数据，不会出现「脚本过了编辑器不过」。
- 校验清单按亮/暗两栏列出关键组合（正文、次要文字、按钮文字、状态色、描边、焦点环等 14 条）。不达标项标红，文案直接给差值：
  `正文文字（--lc-color-ink）在 页面背景（--lc-color-bg）上 3.12:1，要求 ≥ 4.5:1，差 1.38`
- 遮罩焦点环先 `compositeOver` 合成再算，不会拿半透明 `rgba` 当底色得出假比值。
- 顶部还有一组汇总：正文最低比值、检查组数、通过数，改色时同步刷新。

### 预览

- 右侧是亮/暗两栏并排的真实内容：标题、正文段落、主/次按钮、表单（输入、下拉、复选、开关）、表格、柱状图各一个样本。
- 预览容器逐个写入解析后的 CSS 变量，并设置 `color-scheme`，所以滚动条、原生控件也跟着对。
- 图表用内联 SVG，柱色取 `accent`、`accent-2`、`success`、`warn` 等令牌，不写死颜色。
- 预览只用于看效果，不保存任何数据。

### 导入导出

- 导出：把当前主题序列化成单个 JSON（`schemaVersion` 3），用 Blob 下载，文件名是 `<id>.json`。
- 导入：支持文件选择和把 JSON 拖到左侧拖拽区。`validateThemeData()` 会检查字段完整性、id 格式、主色合法性、覆盖项是否合法，以及全部对比度组合。
- 旧版本文件先过 `migrateThemeData()` 再进编辑器：v1 的平铺 `light` / `dark` 会折进 `modes`，v2 原样读取，报告里显示「已从 v2 升级到 v3」；不会因为版本号不同直接崩。
- **导入不拒绝文件**：校验不合格也会载入并展示问题清单（缺哪个字段、哪个组合差多少），用户可以接着改；只有 JSON 解析失败才提示无法读取。
- 导入报告同时列错误和提醒（例如文件名与 id 不一致），不会只给一句「导入失败」。

### 编辑器自己跟随主题

- 顶栏「编辑器外观」有三档：跟随主题 / 亮 / 暗。
- 选「跟随主题」时，编辑器把当前草稿的解析结果以内联 CSS 变量写到 `<html>`，`data-lc-mode` 跟着编辑面板的亮/暗切换，所以编辑暗色主题时外壳也是暗的。
- 选「亮」或「暗」时移除内联变量，回落到 `lc-themes.css` 的 `ink-green`，方便在固定光照下检查某一版。
- 编辑面板的亮/暗 tab 也支持左右方向键切换。

### 浏览器里怎么跑

- 编辑器用经典脚本（`lc-theme-runtime.js` + `editor-app.js` + `theme-switch.js`），不用 ES module。原因和图标一样：`file://` 下模块会被 CORS 拦掉，双击打不开。
- `lc-theme-runtime.js` 由 `build.mjs` 从 `runtime.mjs` 去掉行首 `export`、包成 IIFE 生成，挂到 `globalThis.LCThemeRuntime`。Node 侧仍然 `import` 原始 `runtime.mjs`，两边是同一份逻辑。
- 页面通过 `window.LC_BUILTIN_THEMES` 注入内置主题，编辑器不 fetch 任何 JSON。

## 主题切换器

`src/theme/switcher-demo.html` 是可双击的演示；站点接入只需要一个容器和两个脚本：

```html
<div data-lc-theme-switch
     data-theme-list="docs-quiet,dashboard-calm,auth-clean,night-contrast"
     data-storage-key="lc-site-theme"></div>
<script src="src/theme/theme-switch.js"></script>
```

- 控件分两部分：三档模式（跟随系统 / 亮 / 暗）+ 主题下拉。样式复用 `.lc-tab`、`.lc-select`，只新增 `.lc-theme-switch` 容器，不另造一套。
- 切换只改 `<html>` 的 `data-lc-theme` / `data-lc-mode` 和 `style.colorScheme`，颜色仍由 CSS 变量下发。
- `system` 模式用 `matchMedia('(prefers-color-scheme: dark)')`，并监听系统变化；只有处于 `system` 时才跟随，手动选亮/暗后不再被系统覆盖。
- 选择写入 `data-storage-key`（默认 `lc-site-theme`），刷新后恢复。
- 每次切换派发 `lc-theme-change` 事件（`detail` 含 `theme`、`mode`、`resolvedMode`），需要重绘图表等场景可以监听。
- 容器上加 `data-lc-resolved-mode` 后，标签会追加「· 亮 / · 暗」，明确当前实际效果。
- 图标全部来自内联 sprite，没有新增字体或图标依赖。

## 编辑器样式怎么用

新外壳按这个顺序加载（`lc-print.css` 只在打印时生效）：

```html
<link rel="stylesheet" href="assets/css/lc-tokens.css">
<link rel="stylesheet" href="assets/css/lc-themes.css">
<link rel="stylesheet" href="assets/css/lc-icons.css">
<link rel="stylesheet" href="assets/css/lc-controls.css">
<link rel="stylesheet" href="assets/css/lc-editor.css">
<link rel="stylesheet" href="assets/css/lc-responsive.css">
<link rel="stylesheet" href="assets/css/lc-a11y.css">
<link rel="stylesheet" href="assets/css/lc-print.css" media="print">
```

顺序不能乱：令牌 → 主题 → 图标 → 控件 → 外壳 → 断点 → 无障碍 → 打印。`lc-a11y.css` 要在控件之后，才能覆盖按钮/输入自带的焦点样式；`lc-print.css` 要在所有样式之后，才能压过暗色主题变量。

主题编辑器页和切换器演示页在此基础上追加 `lc-theme-editor.css` / `lc-theme-switch.css`，放在 `lc-controls.css` 之后、`lc-responsive.css` 之前，这样断点规则仍然最后生效。

根元素挂主题和明暗：

```html
<html data-lc-theme="ink-green" data-lc-mode="light">
```

外壳骨架：

```html
<div class="lc-shell">
  <header class="lc-topbar">…</header>
  <main class="lc-main">
    <aside class="lc-sidebar">…</aside>
    <section class="lc-workspace">…</section>
    <aside class="lc-inspector">…</aside>
  </main>
  <footer class="lc-statusbar">…</footer>
</div>
```

常用类名：

- 外壳：`lc-topbar`、`lc-brand`、`lc-nav`、`lc-nav-item`、`lc-main`、`lc-sidebar`、`lc-workspace`、`lc-inspector`、`lc-toolbar`、`lc-canvas-scroll`、`lc-canvas`、`lc-statusbar`
- 资源树：`lc-tree`、`lc-tree-item`、`lc-tree-meta`、`lc-tree-group-title`
- 面板：`lc-panel`、`lc-panel-title`、`lc-prop-group`、`lc-prop-row`
- 弹层：`lc-dialog-backdrop`、`lc-dialog`、`lc-dialog-head/body/foot`、`lc-toast`
- 控件：`lc-btn` 及 `-primary/-ghost/-danger/-sm/-icon/-block`、`lc-field`、`lc-label`、`lc-hint`、`lc-input`、`lc-select-wrap`、`lc-textarea`、`lc-check`、`lc-radio`、`lc-switch`、`lc-tabs`、`lc-tab`、`lc-tag`、`lc-badge`、`lc-note`、`lc-table`、`lc-progress`、`lc-pagination`、`lc-breadcrumb`、`lc-kbd`

约定：

- 这些文件只做样式，不写业务逻辑，不假设除了上面的类名和层级之外的结构。
- 主题只在 `<html>` 上挂。旧变量别名在 `:root` 上声明，挂到子树里会解析成基础值。
- 旧版 `assets/app.css` 和这套新样式不要同时加载。旧文件里也有一批 `lc-` 类名，但语义和数值不同，混用会互相覆盖。旧版 `index.html` 归 F0 处理。
- 图标用 `src/theme/lc-icons.html` 的内联 sprite，按 id 取用；不在样式里用 `url()` 画图标，也不引图标库。
- 动效在 `prefers-reduced-motion: reduce` 下会被压成 0ms。
- 打印时由 `lc-print.css` 收掉外壳，所有页面入口都应把这份样式挂在 `media="print"`。

## 契约含糊处与待确认

1. 契约 v2 第 7 节只写了「主题 v2，变量命名不变」，没有给主题 JSON 的字段表。这里已把字段表落到 `THEME_SCHEMA`（v3）：`seeds / overrides / shared` 结构，另有可选 `meta`。如果契约后续给出正式字段表，优先按契约改，不要改契约文档本身。
2. 契约提到主题路径是 `themes/<themeId>.json`。当前主题源文件放在 `src/theme/themes/`，这是模块内可编辑的位置；运行时要读写的那份由存储/渲染模块决定。是否需要额外导出到根目录的 `themes/`，**待确认**。
3. `ink-green` 与契约示例里的 `defaultThemeId` 对齐，作为通用回落；四套模板的默认主题由 `presets.mjs` 注册（docs / portfolio / dashboard / auth），四者不重复。模板 id 是新增约定，**待确认**是否与平台页面模板 id 一致。
4. 契约里的 `theme.mode: auto` 没有在 CSS 层实现。`lc-tokens.css` 只认 `data-lc-mode="light|dark"`，auto 由上层读系统偏好后决定挂哪个值。这样样式层不猜业务。
5. 旧别名 `--accent` 指向的是「强调色文字」，不是按钮底色。旧版 `.lc-btn-primary` 用 `var(--accent)` 当背景再写死白字，在深色主题下对比度会不够。新组件请用 `--lc-color-accent-fill` / `--lc-color-on-accent`，旧样式迁移时也要换。
6. 主题包只收 `#rgb` / `#rrggbb` 实色；`overlay` 这类带透明度的值只在基础层或 `overrides` 里出现，不参与对比度计算。
7. 非颜色令牌目前只校验「存在且非空」，没有校验单位是否合理（比如 `--lc-radius-md: 8` 少写 `px` 不会被抓出来）。这条留作后续增强，**待确认**要不要加。
8. 契约没有规定断点数值。这里取 1180 / 900 / 640px 三档，理由是编辑器三栏在 1180 以下开始挤、900 以下三栏必收一栏、640 以下只能单栏。如果渲染模块已有断点表，以渲染模块为准，同步改 `BREAKPOINTS` 和 `lc-responsive.css`。
9. 契约没有规定打印行为。这里按「文档类页面」处理：强制浅色纸面、隐藏外壳与导航。如果导出站打印需求不同，改 `lc-print.css` 的隐藏列表即可。
10. 图标集契约里没有给具体动作清单。这里覆盖了任务列出的 15 类动作并扩展到 38 个；如需增补，改 `icons.mjs` 后跑 `build.mjs`，`check.mjs` 会核对必需 id。
11. 契约没有规定主题编辑器草稿存在哪。这里先放 `localStorage`（`lc-theme-editor-drafts-v1`），不写入 `themes/`、不碰存储层。真正的「保存到站点主题库」需要存储模块提供写入接口，**待确认**。
12. 导入校验按「不拒绝文件、只列问题」实现：结构或对比度不合格仍载入可编辑。如果上层希望严格模式（不合格直接不入库），需要在外层加一道拦截，编辑器本身保留现在的宽松行为。
13. 编辑器页的内置主题是构建时通过 `window.LC_BUILTIN_THEMES` 注入的静态数据，不随运行时新增主题自动更新。站点若从接口读取主题列表，应在渲染层替换这个注入来源，**待确认**接口形态。
14. 切换器的记忆键默认 `lc-site-theme`，可用 `data-storage-key` 改。契约没有规定键名和事件名，`lc-theme-change` 是新增约定，**待确认**是否需要统一。
15. 主题包格式从 v2 升到 v3。v3 没有加必填字段，只把 `meta` 和兼容规则写进 `THEME_SCHEMA`；旧文件由 `migrateThemeData()` 自动升级。如果导出管线已经按 v2 解析，升级前请确认它不会拒绝 `schemaVersion: 3`。
16. `themeCssBlock()` 默认把亮色写到 `:root`，一次只适合导出一套主题。若要在一个样式表里导出多套，请用 `themeStyleSheet()` 或把 `lightSelector` 换成 `[data-lc-theme="<id>"][data-lc-mode="light"]`，否则后面的 `:root` 会覆盖前面的。导出管线采用哪种方式，**待确认**。

## 已知边界

- 预览页只演示外观，不代替真实编辑器的交互；页面里的按钮、开关不会真的保存数据。主题卡片上的四色缩略块直接取主题包的种子色展示，属于数据展示，不参与主题生效。
- 对比度按 WCAG 2.x AA 算，不包含 APCA；只检查列出的组合，不扫描任意前景/背景搭配。
- 主题包只管颜色与少量确实需要主题化的静态令牌（如动效、层级），不包含图片、图案或组件级样式覆盖；圆角、字体栈、间距、字号由 `lc-tokens.css` 统一定义。
- 生成物是静态 CSS，部署不依赖 `build.mjs`；只有改令牌、加主题或改图标时才需要重新生成。
- 没有新增 npm 依赖，`check.mjs`、`build.mjs`、`icons.mjs`、`runtime.mjs` 只用 Node 内置模块；编辑器与切换器不引外部字体、图标库或 CDN。
- 主题编辑器的草稿只在本机浏览器；导出 JSON 才是给别人的交付物。导入 JSON 不会自动写入任何站点数据。
- 实时校验覆盖 `runtime.mjs` 里登记的组合，不是任意前景/背景搭配的穷举；用户硬填一组没人用的颜色组合，仍可能绕过检查。
- 编辑器预览是静态样本，不能代表站点所有组件；新增组件后需要把对应令牌组合补进 `TEXT_PAIRS / UI_PAIRS`，两个入口才会一起校验。
- 主题切换器只负责切换和记忆，不监听 `lc-theme-change` 之外的重绘；Canvas/WebGL 图表的颜色需要业务侧自行响应。
- 图标必须内联（`lc-icons.html` 粘进页面），不能改成外链 `<use href="icons.svg#id">`；本地 `file://` 打开时外部 sprite 会静默失败。
- 无障碍复核是样式层面的：焦点环、颜色、结构约定都处理了，但没有做读屏软件实测，弹窗焦点陷阱、页签/树的方向键漫游仍归渲染层。
- 断点与打印的浏览器复验是抽样：Chrome 下暗色焦点环、三档断点折叠、图标渲染、打印纸面均已验证；侧栏最底部元素的裁剪验证被工具预算截断，规则本身是确定的 2px 内嵌环，建议后续 E2E 补一条。
