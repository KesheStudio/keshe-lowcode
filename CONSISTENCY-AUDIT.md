# 一致性审计清单（第四批 · 只读）

范围：`src/render/**`、`assets/builder.js`、`assets/app.js`、`src/theme/**`。
本轮只读，未修改任何被审计文件，未触碰任何数据库 / 订单数据。

## 口径

- 扫描排除 `node_modules`；`src/theme/themes/*.json` 视为「主题源数据」，其中的色值不算违规。
- `src/theme/preview.html`、`src/theme/preview-shell.html`、`src/theme/editor.html`、`src/theme/switcher-demo.html`、`src/theme/lc-theme-runtime.js` 是**生成物**，问题记在生成它们的 `build.mjs` / `runtime.mjs`。
- 判定「旧变量残留」用的是 `--lc-*` 之外的短名：`--bg / --surface / --ink / --muted / --line / --accent / --radius / --sans / --serif / --mono / --code-bg / --surface-2 / --ink-2 / --muted-2 / --accent-soft / --accent-line / --line-strong / --font-sans / --font-mono / --small-size / --container-pad / --line-height / --base-size`。
- `assets/css/lc-tokens.css` 仍在导出这批旧别名（`--bg: var(--lc-color-bg)` 等），所以它们能解析；但组件里把它们当 fallback 属于历史残留，且掩盖了新令牌缺失的问题。
- 「未声明变量」= 在本仓库内从未出现 `--变量名:` 声明，也没有进 `tokens.mjs` 的 `BASE_STATIC` / `COLOR_TOKEN_NAMES` / `BASE_SHADOW`。

## 汇总

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 旧变量 fallback | 约 470 处 / 约 300 行 | 24 个文件，集中在 shell.js、engine.js、controls.js、charts.js |
| 独立写死颜色（非 fallback） | 约 40 处 | `runtime.js`、`assets/app.js` 最集中 |
| 未声明变量（phantom） | 15 个名字 | `--lc-color-error` 15 处、`--lc-overlay-mask`、`--lc-search-hit-*`、`--lc-mermaid-*`、`--lc-color-code-*` |
| 硬编码 `rgba()` | 18 行 | 其中 4 行是 `rgba(0,0,0,.x)` 阴影 |
| 字体栈未走变量 | 4 处 | demo.html、runtime.js、sample.css ×2；另有 1 处旧 `--serif` |
| px 字面量 | 1900+ 处 | 8px=123、12px=114、10px=83、2px=86、14px=62、6px=66 |

严重度：P0 = 暗色下直接不可读或主题失效；P1 = 主题切换后明显不协调；P2 = 清理项。

---

# 一、硬编码颜色

## src/render/runtime.js（注入到每个导出站，P0/P1）

| 位置 | 问题 | 建议改成 | 影响面 |
| --- | --- | --- | --- |
| `runtime.js:350` | 图表色板写死 `['#3e6a56','#8a6f4d','#9c5c4a','#5b6f8a','#6b7280']` | `var(--lc-color-accent)`、`var(--lc-color-accent-2)`、`var(--lc-color-info)`、`var(--lc-color-warn)`、`var(--lc-color-muted)`，超出 5 色再循环 accent-2-soft | 所有导出站图表；换主题后第一系列永远是墨绿 |
| `runtime.js:460` | 图例文字 `fill="#6b7280"` | `var(--lc-color-muted)` | 暗色下图例偏灰，对比不足 |
| `runtime.js:529` | 主题切换器字体 `system-ui,-apple-system,"Segoe UI",sans-serif` | `var(--lc-font-sans)` | 中文回退到浏览器默认字体，与站点不一致 |
| `runtime.js:530` | `box-shadow:0 2px 10px rgba(0,0,0,.08)` | `var(--lc-shadow-sm)` | 暗色下几乎不可见 |
| `runtime.js:531` | `box-shadow:0 8px 28px rgba(0,0,0,.16)` | `var(--lc-shadow-md)` | 同上 |
| `runtime.js:534` | `color:#6b7280`（控件小标题） | `var(--lc-color-muted-2)` | 暗色对比约 3:1，低于 4.5:1 |
| `runtime.js:538` | `color:#8a6f4d`（提示文案） | `var(--lc-color-muted)` | 暗色对比约 2.5:1，不可读 |
| `runtime.js:542` | `color:#6b7280`（搜索计数） | `var(--lc-color-muted-2)` | 同 534 |
| `runtime.js:545` | 搜索命中 `background:rgba(201,162,39,.35)` | 见「待确认 A」；暗色建议 `var(--lc-color-accent-soft)` + `border-bottom:1px solid var(--lc-color-accent-line)` | 暗色下浅文字压半透明黄，对比不稳 |

## assets/app.js（编辑器 / 导出站骨架，P0/P1）

| 位置 | 问题 | 建议改成 | 影响面 |
| --- | --- | --- | --- |
| `app.js:546` | 步骤序号 `background: var(--accent); color:#fdfbf4` | `background: var(--lc-color-accent-fill); color: var(--lc-color-on-accent)` | 暗色主题 accent 是浅绿，白字对比约 1.6:1，序号看不清 |
| `app.js:3627` | `<meta name="theme-color" content="#f4f0e6">` 固定亮色 | 导出时按主题 read 亮/暗 bg，或直接省略该 meta | 移动端浏览器地址栏在暗色站点仍是米色 |
| `app.js:4634` | 调色板小方块 `esc(colors[key] || '#999')` | fallback 改 `var(--lc-color-muted-2)` | 仅缺值时生效，P2 |
| `app.js:4703-4707` | 预览色块 fallback 写死 5 个主题色 | 直接用主题解析结果，去掉 fallback | 仅缺值时生效，P2 |
| `app.js:450 / 4736` | `normHex(..., '#000000')` | 保留（工具函数空值兜底，不参与渲染） | 无 |
| `app.js:37-59` | 四套内置调色板 `accent/bg/surface/...` | **属于数据源**，与 `themes/*.json` 重复 | 换主题时两处要同步，见「待确认 B」 |

## src/render/components/*（组件样式，P1）

| 位置 | 问题 | 建议改成 | 影响面 |
| --- | --- | --- | --- |
| `controls.js:704` | 开关滑块 `box-shadow:0 1px 3px rgba(0,0,0,.25)` | `var(--lc-shadow-xs)` | 暗色下阴影消失，滑块边界不清 |
| `autocomplete.js:577` | 下拉 `box-shadow:0 10px 28px rgba(0,0,0,.12)` | `var(--lc-shadow-md)` | 暗色下浮层与背景粘连 |
| `date.js:434` | 日期弹层 `box-shadow:0 10px 30px rgba(0,0,0,.12)` | `var(--lc-shadow-md)` | 同上 |
| `overlay.js:286` | 模态面板 `box-shadow:0 18px 48px rgba(0,0,0,.22)` | `var(--lc-shadow-lg)` | 同上 |
| `shell.js:492` | 二级导航 `box-shadow:0 10px 24px rgba(0,0,0,.12)` | `var(--lc-shadow-md)` | 同上 |
| `shell.js:548` | 移动端导航面板 `box-shadow:0 14px 28px rgba(0,0,0,.12)` | `var(--lc-shadow-md)` | 同上 |
| `interactions.js:39` | 搜索命中 `var(--lc-search-hit-bg, rgba(255,214,102,.55))` | 变量未声明 → 永远走黄色；见「待确认 A」 | 暗色下黄底 + 浅字对比不足 |
| `interactions.js:40` | 当前命中 `rgba(255,168,32,.85)` | 同上 | 同上 |
| `autocomplete.js:574` 等 5 处 | focus 阴影 fallback `rgba(62,106,86,.18)` | 保留 fallback 或去掉；首选 `var(--lc-color-accent-soft)` | 仅在令牌缺失时生效，P2 |
| `code.js:328-333` | 语法色 `#2f7a55 / #9a5a1f / #3b5fa8 / #8a5c1f / #4a6a52` | `--lc-color-code-string` 等未声明 → 永远走写死值 | **暗色下 keyword/tag 蓝 `#3b5fa8` 对比约 2.7:1，不可读** |
| `mermaid.js:234-239` | `--lc-mermaid-*` 均未声明 | 要么在 `tokens.mjs` 注册，要么删掉这层改用 `--lc-color-*` | 现在多一层无用间接，且 fallback 写死浅色 |

## src/render/samples/（示例站，P2）

| 位置 | 问题 | 建议改成 | 影响面 |
| --- | --- | --- | --- |
| `samples/sample.css:41,42,76` | 主按钮 `background: var(--lc-color-accent)` + `color: var(--lc-color-on-accent)` | `background: var(--lc-color-accent-fill)` | 暗色下浅底浅字，示例站按钮不可读 |
| `samples/site.data.js:183` | `.demo-callout-btn:hover` 同上 | 同上 | 同上 |
| `samples/site.data.js:29-158` | 三套内联主题变量（亮/暗各 16 条） | 属于示例数据，可保留；建议改为引用 `themes/*.json` 的导出结果 | 与内置主题重复，漂移风险 |
| `samples/sample.css:4-5,12,19,61,74` | 字体：4 处走令牌、2 处写死 mono | 见第五节 | P2 |

## src/theme/**（多数为生成物 / 刻意固定色）

| 位置 | 问题 | 建议改成 | 影响面 |
| --- | --- | --- | --- |
| `build.mjs:448-450` | 预览页演示 override `--lc-color-bg:#f5efe3`、accent `#8c4a26` | 保留（就是在演示 overrides），但建议注释写明「演示用」 | P2 |
| `build.mjs:1080-1089` | 打印纸面 `#ffffff/#111111/#999999/#333333/#bbbbbb/#555555` | **刻意**的打印模拟，建议加注释；见「待确认 C」 | 仅 `@media print` |
| `build.mjs:207 / 992` | 静态说明里的 `#3e6a56` 色值文本 | 改为从主题读取，避免文案与主题不同步 | P2 |
| `preview.html:151-160,278-372,401-403,912` | 同上，生成物 | 改 `build.mjs`，不要改生成物 | — |
| `runtime.mjs:33-43,77-88,341,374-421` | 阴影常量、默认 seeds、混色黑白端点 | **算法常量**，不算违规 | 无 |
| `editor-app.js:469,515` | 颜色输入空值 `#000000` | 保留（输入框兜底） | 无 |
| `check.mjs:561` | `'#fff;} body{display:none'` | 保留（注入测试串） | 无 |

---

# 二、旧变量残留（`--lc-*` 之外的旧名）

统一建议：删除 `var(--lc-color-x, var(--old, #hex))` 里的旧名与 hex，只留 `var(--lc-color-x)`；确实需要兜底时用**同名新令牌的默认值**，不要用旧名。下表按文件列行号（同一行多处只计一次）。

| 文件 | 行号 | 涉及旧变量 | 影响面 |
| --- | --- | --- | --- |
| `components/shell.js` | 479,482,486-488,492,495-496,498,500,504-505,509,512,515,518,520-522,525,527,530,532,535,538,540-542,544,548,552 | surface,line,ink,muted,accent,radius,surface-2,accent-soft,muted-2,ink-2 | 32 行，全仓最密；每处都多一层 fallback |
| `engine.js` | 25-27,32,34-35,46-47,49,54,60-61,65-66,68-70,71,73-74 | ink,bg,font-sans,accent,line,muted,surface,radius,accent-line,surface-2,muted-2,line-height,base-size,small-size,container-pad,gap | 基础排版，影响所有页面 |
| `components/controls.js` | 684-685,687-688,691,693-694,699-700,703-705,707,709-711,713,715,719-720,722 | ink-2,accent,line,radius,surface,ink,accent-soft,muted,muted-2,line-strong,accent-line | 表单基础件 |
| `components/charts.js` | 524,569,1155,1160-1161,1165-1167,1173-1178,1180,1183-1185,1193-1194 | surface,accent,accent-line,muted-2,ink,muted,line | 图表文字与网格 |
| `components/date.js` | 423-424,426-430,432-434,437,439,441,443-445,448 | ink-2,accent,line,radius,surface,accent-soft,ink,muted-2,surface-2,line-strong,muted,accent-line | 日期选择器 |
| `demo.html` | 10-16,19-22,25-29,31 | bg,ink,line,surface,muted,radius,muted-2,surface-2,accent,accent-line | 独立验收页 |
| `components/upload.js` | 584-586,588-590,592,597,600-601,603-605,607-608 | line-strong,radius,surface-2,accent,surface,accent-soft,ink,muted,surface-3,line,muted-2,ink-2,accent-line | 上传组件 |
| `components/common.js` | 23-27,29,31-32,35,39-40,42-44 | ink,accent,line,radius,surface-2,muted,accent-line,surface-3,surface | 共享 kit |
| `components/textfield.js` | 250-255,257-260,265,268,270 | ink-2,accent,line,radius,surface,accent-soft,ink,muted-2,muted,surface-2 | 文本框 |
| `components/form.js` | 503-505,507-509,511-512,514-518 | ink,accent,line,radius,surface,muted,ink-2,accent-line,accent-soft | 表单容器 |
| `components/autocomplete.js` | 567-568,570,573-575,577,579-580,583-585 | ink-2,accent,accent-line,accent-soft,line,radius,surface,ink,line-strong,muted | 自动补全 |
| `components/slider.js` | 321-322,324,326-327,330-334,341-342 | ink-2,accent,line,surface,ink,muted-2,accent-line,muted | 滑块 |
| `components/table.js` | 585-586,588-589,591,597,599-600,603-604 | muted,line,radius,surface,surface-2,ink,accent | 表格 |
| `components/stats.js` | 567,571-572,574-575,579,581-583,585-587,593,595,598,601-603 | accent,line,radius,surface,muted,ink,ink-2,muted-2,surface-3 | 指标卡 |
| `mermaid.js` | 27,31,234-239 | line,radius,ink,accent,muted,surface-2,accent-soft | 图表容器 |
| `interactions.js` | 28-31,34-35,37,39-40 | line,radius,surface,muted,accent,accent-line | 目录/搜索 |
| `components/code.js` | 314-315,318-320,322,325,327-333 | line,radius,code-bg,surface-2,muted,surface,accent,accent-line,font-mono,muted-2,code-string/number/keyword/tag/attr/prop | 代码块 |
| `components/timeline.js` | 139,141,143-145,148,150 | line,surface,muted,accent,accent-soft,ink-2 | 时间线 |
| `components/otp.js` | 408-409,411-413,415 | ink-2,accent,line,radius,surface,ink,accent-soft,muted-2,muted | 验证码 |
| `components/carousel.js` | 356,360,364,368-369 | line,radius,surface,ink-2,accent | 轮播 |
| `components/overlay.js` | 286,290,295,299 | line,radius,surface,ink,muted | 浮层 |
| `components/tabs.js` | 298-301 | line,muted,accent | 标签页 |
| `components/state.js` | 99 | radius | 空状态 |
| `assets/app.js` | 532-533,541-543,545-548,551,553,555,557-558,563-564,567,4466,4626,4628-4630 | line,muted,serif,accent,surface,ink,surface-2,bg | 导出站骨架；4466/4626-4630 是主题面板 |

另：`assets/css/lc-tokens.css` 仍在导出旧别名。是否保留作为外部兼容层，需要主题模块决定（见「待确认 D」）。

---

# 三、暗色下会出问题的地方

| 位置 | 问题 | 建议 | 严重度 |
| --- | --- | --- | --- |
| `assets/app.js:546` | 白字压主题 accent，暗色 accent 是浅色 | accent-fill + on-accent | P0 |
| `components/shell.js:496-497` | `.lc-shell-cta` 用 accent 作底色 + on-accent | `--lc-color-accent-fill` / hover 用 `-hover` | P0 |
| `samples/sample.css:41-42,76` | 同上 | 同上 | P1 |
| `components/overlay.js:284` | `var(--lc-overlay-mask, rgba(12,18,16,.52))`，变量**未声明** | `var(--lc-color-overlay)` | P1（主题遮罩值被绕过） |
| 15 处 `--lc-color-error` | 变量**未声明** → 永远 `#b42318`，暗色对比约 2.4:1 | `--lc-color-danger` / `--lc-color-danger-line`；见「待确认 E」 | P0 |
| `code.js:328-333` | 语法色未走令牌，暗色下蓝/褐不可读 | 注册 code 语法令牌或改用状态色 | P0 |
| `interactions.js:39-40` / `runtime.js:545` | 固定黄色高亮，暗色下浅字压黄底 | accent-soft / 自定义命中令牌 | P1 |
| `components/controls.js:704` 等 6 处 | `rgba(0,0,0,.x)` 阴影，暗色不可见 | `--lc-shadow-xs/sm/md/lg` | P1 |
| `runtime.js:350,460,534,538,542` | 固定灰/色板 | 主题令牌 | P1 |
| `assets/app.js:3627` | 固定浅色 `theme-color` | 按模式输出 | P1 |
| `components/shell.js:489` | 三角 `border-top: 4px solid currentColor` | 无问题（跟随文字色） | — |
| `components/shell.js:486,488,524` | `border-bottom/left: 2px solid transparent` | **刻意**占位，不是「透明分隔线」问题 | — |
| 全仓 | 未发现独立写死的白底（`background:#fff` 均带 `--lc-color-surface`） | — | — |

---

# 四、尺寸与间距硬编码

高频值（全审计范围）：

| 值 | 次数 | 处置 |
| --- | --- | --- |
| 1px | 197 | 边框统一 `--lc-border-width`；`border-radius:1px` 归 `--lc-radius-xs` |
| 8px | 123 | `--lc-space-2` |
| 12px | 114 | `--lc-space-3` |
| 2px | 86 | 无令牌（细描边/内缩）；建议加 `--lc-space-0` 或保留 |
| 10px | 83 | **无令牌**，出现最多；建议按 `space-2`(8) 或 `space-3`(12) 归一 |
| 4px | 69 | `--lc-space-1` |
| 6px | 66 | **无令牌**；高频 gap，建议统一 8px 或新增 `--lc-space-1-5` |
| 14px | 62 | **无令牌**；padding 高频，建议归 12/16 |
| 13px | 54 | 多为 `font-size`，应 `--lc-text-sm` |
| 16px | 45 | `--lc-space-4` |
| 11px | 31 | `font-size`，应 `--lc-text-xs` |
| 999px | 18 | `--lc-radius-full` |
| 18px / 20px / 24px | 20 / 16 / 14 | 20→`space-5`，24→`space-6`；18 无令牌 |
| 15px / 9px / 5px / 3px / 7px | 15 / 16 / 25 / 27 / 13 | 无令牌 |

最集中的文件：`components/shell.js` 129 处、`samples/sample.css` 91 处、`src/theme/build.mjs` 76 处、`assets/app.js` 70 处、`engine.js` 67 处、`components/controls.js` 61 处、`runtime.js` 52 处、`components/date.js` 42 处、`components/upload.js` 42 处。

属性维度：`padding` 587、`border-radius` 512、`font-size` 481、`gap` 305、`width` 302、`margin` 243。

重点清理建议（只列不改）：

- `font-size:12px` 72 处、`font-size:13px` 53 处 → `--lc-text-xs` / `--lc-text-sm`。
- `border-radius:8px` 45 处 → `--lc-radius-md`；`999px` → `--lc-radius-full`。
- `padding:10px` 28 处 → `--lc-space-2/3`；`gap:6px` 24 处 → 新增 `--lc-space-1-5` 或 `space-2`；`padding:14px` 24 处 → `space-3/4`。
- `min-width:190px`（shell.js:492）、`max-height:720px`（overlay.js:286/296）、`width:264px`（date.js:434）、`width:210px`（runtime.js:531）属于组件定尺寸，建议集中为 `--lc-size-*`，不要散落。

---

# 五、字体栈

| 位置 | 问题 | 建议 | 影响面 |
| --- | --- | --- | --- |
| `src/render/demo.html:9` | 裸写系统栈，未走 `--lc-font-sans` | `font-family: var(--lc-font-sans)` | 验收页换主题字体不跟随 |
| `src/render/runtime.js:529` | `system-ui,-apple-system,"Segoe UI",sans-serif`，**缺中文字体** | `var(--lc-font-sans)` | 导出站主题切换器中文落到默认字体 |
| `samples/sample.css:19` | `ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace` | `var(--lc-font-mono)` | 示例代码块不跟随 blueprint-amber 的 Cascadia 栈 |
| `samples/sample.css:74` | 同上 | 同上 | 同上 |
| `assets/app.js:542` | `font-family: var(--serif)`（旧别名） | `var(--lc-font-serif)` | 依赖旧别名层，P2 |
| `engine.js:27` | `var(--lc-font-sans, var(--font-sans, …))` | 去掉旧名 | P2 |
| `mermaid.js:28` / `code.js:322` | `var(--lc-font-mono, var(--font-mono, …))` | 去掉旧名 | P2 |
| `mermaid.js:240` | fallback 栈缺 `Hiragino Sans GB` / `Noto Sans CJK SC` | 与 `BASE_STATIC['--lc-font-sans']` 对齐 | 令牌缺失时中文回退更差 |
| `components/shell.js:482,509,538`、`stats.js:574` | `var(--lc-font-serif, Georgia, serif)` | 保留令牌，fallback 可去 | P2 |
| `themes/ink-ochre.json:43` | `"Kaiti SC","STKaiti","KaiTi","Songti SC","STSong",serif` | 已声明，依赖系统楷体；非 Windows 会退化到宋体 | 可接受 |
| `themes/blueprint-amber.json:43` | `"Cascadia Mono","Cascadia Code",Consolas,…` | Cascadia 非全平台预装，会退化 Consolas | 见「待确认 F」 |

全仓未发现 `@font-face`、`fonts.googleapis`、`.woff/.ttf` 引用，也没有系统外网络字体。`node_modules/katex` 自带字体不在审计范围。

---

# 六、待确认（不猜，需对应模块拍板）

**A. 搜索命中高亮**：`interactions.js:39-40`、`runtime.js:545` 用了三种黄色（`255,214,102` / `255,168,32` / `201,162,39`），且变量 `--lc-search-hit-bg`、`--lc-search-hit-current-bg` 未注册。要「主题化」就得在 `tokens.mjs` 加两个颜色令牌（亮色黄、暗色强调浅底），否则只能固定色。请主题模块确认是否新增令牌。

**B. 两套主题数据源**：`assets/app.js:37-59` 内置四套调色板与 `src/theme/themes/*.json` 重复。若导出站的口径是「以 JSON 为准」，`app.js` 这份应该删或改为读 JSON；否则会出现改了主题 JSON、导出站不生效。请编辑器/导出模块确认口径。

**C. 打印纸面固定色**：`build.mjs:1080-1089` / `preview.html:151-160` 的 `#ffffff/#111111/#999999/#333333/#bbbbbb/#555555` 是模拟纸张。建议保留并加注释「打印专用，故意不跟主题」；若要求打印也跟主题走，再改。

**D. 旧别名层**：`assets/css/lc-tokens.css` 仍导出 `--bg/--surface/--ink/--muted/--line/--accent/--code-bg/--sans/--serif/--mono/--radius`。保留 = 外部旧样式还能用；删除 = 全仓 470 处 fallback 会失效（但本来也不该生效）。请主题模块决定保留/删除，并同步 NOTES。

**E. 错误色令牌**：15 处 `--lc-color-error` 未声明。可以直接改用已有的 `--lc-color-danger` / `--lc-color-danger-line`（推荐，零新增令牌）；也可以新增 `--lc-color-error` 作为 danger 的别名（语义更贴表单）。请主题模块二选一。

**F. Cascadia**：`blueprint-amber` 的等宽栈依赖 Cascadia。若要求「任何机器一致」，需要接受退化到 Consolas，或把字体打包（会引入体积与许可问题）。请主题模块确认接受退化。

**G. 页面级尺寸变量**：`--lc-shell-max`、`--lc-main-pad`、`--lc-shell-pad`、`--lc-sidebar-w`、`--lc-shell-gap`、`--lc-container-pad`、`--lc-anchor-offset`、`--lc-article-gap`、`--lc-article-toc-top`、`--lc-breadcrumb-sep`、`--lc-code-max-height`、`--lc-code-num-width` 从未被赋值，也没有文档说明。它们只在 `var(..., 默认值)` 里出现。请渲染模块确认是「对外覆盖钩子」（要写进文档）还是「应换成 `--lc-space-*` / `--lc-size-*`」。

**H. Mermaid 令牌**：`--lc-mermaid-ink/muted/line/node-bg/accent/accent-soft` 未声明，纯间接层。请渲染模块确认是否保留这层 API。

---

# 七、给各模块的待办

## 渲染模块（src/render/**、assets/builder.js）

1. P0：`overlay.js:284` 的 `--lc-overlay-mask` → `--lc-color-overlay`。
2. P0：`shell.js:496-497` 的 CTA、`samples/sample.css:41-42,76`、`site.data.js:183` 改用 `--lc-color-accent-fill` + `--lc-color-on-accent`。
3. P0：15 处 `--lc-color-error` → `--lc-color-danger`（等 E 确认）。
4. P0：`code.js:328-333` 语法色确认方案（见 H/E）。
5. P1：`runtime.js:350,460,530-545` 把固定色板 / 灰色 / 阴影 / 黄色高亮换成令牌。
6. P1：6 处 `rgba(0,0,0,.x)` 阴影 → `--lc-shadow-*`。
7. P1：`interactions.js:39-40` 命中高亮（等 A）。
8. P2：24 个文件的旧变量 fallback 清理；优先 `shell.js`、`engine.js`、`controls.js`、`charts.js`。
9. P2：`demo.html:9`、`sample.css:19,74`、`mermaid.js:240` 字体栈归一。
10. P2：px 字面量按第四节的高频表逐步替换为 `--lc-space-* / --lc-text-* / --lc-radius-*`；`gap:6px` 建议先定一个统一值。
11. 建议：`--lc-shell-max` 等未赋值的页面级变量（见 G）补文档或替换。

## 编辑器 / 导出模块（assets/app.js）

1. P0：`app.js:546` 步骤序号 `var(--accent)` + `#fdfbf4` → `--lc-color-accent-fill` + `--lc-color-on-accent`。
2. P1：`app.js:3627` `theme-color` 按亮/暗输出，或移除。
3. P1：确认 `app.js:37-59` 四套调色板与 `themes/*.json` 的取舍（见 B）。
4. P2：`app.js` 24 行旧变量 fallback 清理（532-567、4466、4626-4630）。

## 主题模块（src/theme/**，本轮只读）

1. 确认 E：是否新增 `--lc-color-error` 别名，或全部改用 danger。
2. 确认 A：是否新增搜索命中令牌。
3. 确认 D：旧别名层保留还是删除，并同步 `NOTES.md`。
4. 确认 F：Cascadia 退化方案。
5. P2：`build.mjs:207,992` 的示例色值改为读取主题；`preview.html` 是生成物，不手改。
6. P2：`build.mjs:1080-1089` 打印样式补注释（见 C）。
7. 建议：在 `check.mjs` 增加一条「组件里 `var(--lc-color-x` 的 x 必须在 `COLOR_TOKEN_NAMES` 内」的静态检查，防止再出现 `--lc-color-error` 这类 phantom。

## 无需处理

- `assets/builder.js`：仅 `636` 行 `var(--lc-color-accent,#3e6a56)` 一个 fallback，无旧变量、无 rgba、无字体问题。
