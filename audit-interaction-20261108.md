# 编辑器交互与状态专项审计（2026-11-08）

审计对象：`lowcode` 编辑器（`assets/builder.js`、`assets/canvas-bridge.js`、`server/src/routes/builder.js`、编辑相关样式）。
审计方式：Playwright 真实点击/拖拽 + 临时站点（`lc-e2e-*`，跑完即删，未触碰既有站点）。每条结论都实际触发过，证据为图中的 e2e 用例与接口读回结果。

本轮按用户要求：**能定位根因的直接修掉，清单只保留“确认存在但一时修不了 / 需要改设计”的问题**。

---

## 一、已修复（含根因、改动点、实测对比）

### 1. 插入容器后画布被铺满、原有区块被挤走、页面出现长滚动条（用户实测复现）
**严重度：阻断**

**现象**：在已有多个区块的页面上插入一个容器后，大容器铺满画布，标题/段落被挤到左下角，原本没有滚动条的页面变成很长的滚动条。图层树为「容器(2 子节点) → 标题 → 段落×3 → 容器(card)」。

**根因（三处叠加）**
1. `buildBlockFromSchema` 曾把 `schema.store === 'block'` 的默认字段一律塞进 `block.props`，导致容器的 `variant/columns` 等读不到；容器也没有补齐 `blocks` 数组。
2. 自由布局页面插入没有 `pos` 的区块时，渲染器走 `fallbackGeom`，按“所有区块最底部之下”排布；页面里只要有一个历史超远坐标区块，新容器就会被排到很远的位置并把页面撑长。
3. 自由块拖动/改尺寸时，边界取父级 `.lc-free`；该容器高度为 0，任何移动都会被判成“拖出边界”而取消，纵向位置还会被夹到 0。

**改动点**
- `assets/builder.js` `buildBlockFromSchema`：默认值按 `schema.store` 落到区块顶层；`container` 补 `blocks: []` 与默认 `variant: 'card'`。
- `assets/builder.js` `placeBlock` / `freePosForInsert`：自由布局根级或自由容器内插入时立即写入安全 `pos`（根级从 `left:24, top:24` 起，宽度按画布可视宽度计算）。
- `assets/canvas-bridge.js` `isFreeBlock`：改为按 `data-lc-positioned="abs"` 判定，根级自由块也走自由拖动。
- `assets/canvas-bridge.js` 新增 `containment()`：父级尺寸为 0 时回退到页面容器，用页面内容高度作为可拖范围；拖动/缩放夹取改用 `bounds.width/bounds.height`。

**前后对比（实测）**
- 流式页（已有区块）1280：修复前插入容器后原区块 rect 发生位移、容器宽度超出页面、iframe 出现纵向滚动；修复后原区块 `left/top/width/height` 完全不变，容器宽度 ≤ 页面内容宽度，高度仅占自身内容（空容器 < 220px），页面 `scrollHeight` 不变、不新增滚动条。
- 流式页 390：折叠侧栏后插入，同上；原区块位置不变、容器不越界、页面不新增滚动条。
- 自由页 1280/390：新容器落点 `x=24, y=24`，宽 560（390 下按可视宽度收缩），高 2（空容器自身高度）；iframe `scrollHeight` 保持 2280 不变；原有 4 个区块 rect 不变；页面 JSON 中容器为 `variant:'card'`、含 2 个子区块、默认值不再写进 `props`。
- 用真实鼠标把新容器拖出再拖回：其它区块 rect 不变；容器子节点可正常插入段落。

**验证用例**：`tests/e2e/specs/_audit-container.spec.mjs`（4 条，1280/390 × 流式/自由，全部通过）。

---

### 2. 画布跨容器拖拽只能插到容器前/后，无法放进容器内部
**严重度：严重**

**根因**：渲染器里容器外层是 `div.lc-block`，真正的 `section.lc-container` 是它的子节点；旧判断只看外层 class，容器永远走 `before/after` 分支。

**改动点**：`assets/canvas-bridge.js` `markDropAt()` 改为按 `data-lc-type="container"` / 内部 `.lc-container` 判定，并区分自由容器（自由容器仍只允许前/后，由 `pos` 摆放），普通容器按上/中/下三分区给出 `before / inside / after`。

**验证**：`_audit-interaction.spec.mjs` “画布内拖拽跨容器移动并能撤销”通过，落下后 `p1` 的父级为 `c2`，撤销后回到 `c1`。

---

### 3. 删除区块后连续按 Delete 会误删相邻区块
**严重度：严重**

**复现步骤**
1. 页面有 2 个根级区块；图层树选中第 1 个。
2. 按 `Delete`，剩 1 个。
3. 再按一次 `Delete`。

**实测结果**
- 修复前：第一次删除后图层树仍把补位上来的区块标成 active（旧选中路径 `[0]` 直接指向了它）；第二次 `Delete` 把它也删掉，`data-layer-count` 从 `1` 变成 `0`，磁盘 `blocks` 变为空。
- 修复后：第一次删除后 active=0；第二次 `Delete` 不产生任何操作，区块数保持 1，磁盘仍为 1 个区块。

**根因**：`deleteSelected` 删除后只重算父路径，根级删除时 `nextPath` 为空、`afterStructureChange(null)` 不会清空 `state.selection/selectionId`，旧路径残留并指向相邻区块。

**改动点**：`assets/builder.js` `deleteSelected`：根级删除后显式清空选中；同时增加 `removed` 不存在时直接返回的保护。

**验证**：“删除根级区块后再次按 Delete 不应误删相邻区块”通过。

---

### 4. 撤销/重做结果不落盘，切页或刷新会丢
**严重度：严重**

**根因**：`applySnapshot` 只写 `localStorage` 草稿，没有触发自动保存；撤销后的页面内容与磁盘不一致。

**改动点**：`assets/builder.js` `applySnapshot` 改为 `scheduleSave()`，与普通编辑同样落盘。

**验证**：“撤销后应自动保存撤销结果”通过；“属性改动可以撤销并重做”通过（属性改动 → 保存 → `Ctrl+Z` 回到原值 → `Ctrl+Y` 回到改动值，磁盘同步）。

---

### 5. 自动保存与并发冲突系列
**严重度：严重（部分为一般）**

| 问题 | 根因 | 修复 / 实测 |
|---|---|---|
| 保存进行中继续编辑，后一次改动被吞 | `saveNow` 无排队，后一次 `saveNow` 直接返回 | 增加 `saving/savePromise` 队列，保存结束后若仍有 dirty 再存一次；实测两条连续输入最终落盘为第二条 |
| 保存进行中切页会打断/丢改动 | 切页不等保存结束 | `openPage` 先 `saveNow`，成功才切换；保存中切页用例通过 |
| 保存失败仍允许切站点，改动静默丢失 | 切站点未检查保存结果 | 失败时回滚下拉并提示“保存失败，暂不切换项目”；用例通过 |
| 同站点其它页面写入导致当前页误报 rev 冲突 | `expectedRev` 是站点级单调 rev，别的文件写入也会 bump | 记录 `baselineHash`；409 时先 GET 当前页比对 hash，未变则换新 rev 静默重存；实测只改另一页时不再弹冲突 |
| 冲突弹窗点“放弃我的改动”后立刻再次冲突 | 放弃后仍走保存，旧 rev 必冲突 | 改为重新读取磁盘版本（`openPage(..., {skipSave:true})`）；用例通过 |
| 切到没有任何页面的站点后仍保留上一站点编辑态 | `loadSite` 空站点分支未清理页面/历史/定时器 | 清理 `page/pagePath/rev/baseline/dirty/selection/history/timers` 并切空态；用例通过 |
| 站点切换失败时状态提示不明确 | 只重绘下拉 | 回滚下拉并显示具体保存错误 |

**验证**：`_audit-interaction.spec.mjs` 中保存、冲突、跨页写入、失败拦截、空站点共 7 条用例全部通过。

---

### 6. 弹窗打开时快捷键穿透到背后的页面
**严重度：严重**

**现象**：冲突弹窗/新建页弹窗/代码弹窗/主题弹窗打开时，按 `Delete` 会删掉弹窗背后的选中区块；`Ctrl+Z` 同理。
**根因**：`onKeydown` 只拦截 ESC 与保存，没有统一的弹窗门禁。
**改动点**：`assets/builder.js` `onKeydown`：检测 `.lc-dialog-backdrop / [data-new-page-dialog] / 代码弹窗 / 主题弹窗`，打开时仅保留 `Ctrl+S` 的 preventDefault，其余编辑快捷键全部让位。
**验证**：“冲突弹窗打开时按 Delete 不应删除背后的区块”通过（区块数保持 2）。

---

### 7. 图层树键盘导航后焦点丢失
**严重度：一般**

**根因**：`ArrowDown/ArrowUp` 选中后会重绘图层树，旧 DOM 行被替换，焦点落回 `body`，继续按方向键无效。
**改动点**：`assets/builder.js` 图层树 keydown：选中后按新渲染的 `.is-active` 行恢复焦点。
**验证**：“图层树键盘导航：按下箭头后第二行获得焦点”通过（`document.activeElement[data-path] === "1"`）。

---

### 8. 空态与删除最后一块
**严重度：体验（回归确认）**

删除到 0 个区块后：图层树显示“当前页还没有区块”，`data-layer-count` 为 0，磁盘 `blocks` 为空数组，页面属性面板正常回到页面级。用例“删除最后一个区块后显示空态”通过。

---

### 9. 自由块拖出画布外松手（回归确认，非缺陷）
**严重度：体验（确认无问题）**

指针拖出 iframe 再松手，再回到画布时区块 `left` 仍为 `24px`，页面数据 `pos.left` 保持 `24`，不会卡在拖拽状态。用例“自由块拖出画布后再松开，不应把拖拽状态卡住”通过。

---

## 二、待设计 / 暂不修清单

### S1. 多选缺失：Shift / Ctrl 点击只保留单选
- **问题描述**：图层树与画布都不支持多选。按住 Shift 或 Ctrl 点击第二个区块，仍然只有一个 `.is-active`；删除/移动/复制只作用于最后点击的那一个。
- **复现步骤**：
  1. 打开任一页面，图层树可见 2 个以上区块。
  2. 点击第 1 行，再按 `Shift` 点击第 2 行。
  3. 观察 `[data-layer-tree] .lc-tree-item.is-active` 数量。
- **实测结果**：`is-active` 数量 = 1（用例输出 `shift-select active count = 1`）。
- **影响**：无法批量删除、批量移动、批量复制；与主流编辑器操作习惯不一致。
- **严重度**：一般（功能设计缺口，不是崩溃/数据丢失）。
- **怀疑根因文件**：
  - `assets/builder.js`：`state.selection` 是单一路径、`state.selectionId` 是单 id；`selectBlock(path)` 直接覆盖选中；`deleteSelected / duplicateSelected / copySelected` 均按单个 `state.selection` 取值。
  - `assets/canvas-bridge.js`：`select(id, free)` 先 `clearSelection()` 再标一个块，消息协议只支持单个 id。
  - 需要改设计：引入 selection 数组/集合，扩展 `select` 消息与快捷键、图层树渲染、属性面板的多选态（或明确只支持单选并在 UI 上不暗示多选）。

---

## 三、审计环境与清理

- 浏览器：本机 Edge/Chrome（Playwright，headless），视口 1440×900；容器验收额外在画布宽度 1280 与 390 下各跑一遍。
- 服务：每轮隔离平台根目录 + 自动分配端口；站点均由 `createTempSite` 创建，`afterEach` 调 `cleanupTempSite` 删除；未读写既有站点。
- 取证用例（临时，审计完成后删除）：
  - `tests/e2e/specs/_audit-container.spec.mjs`：4 条，覆盖容器插入 1280/390 × 流式/自由。
  - `tests/e2e/specs/_audit-interaction.spec.mjs`：21 条，覆盖选中/拖拽/撤销重做/自动保存/冲突/图层树/快捷键/空态/切页切站点。
- 最后一轮回归：上述 25 条全部通过（25 passed，2.2m）；另外 `canvas.spec.mjs`、`main-flow.spec.mjs`、`builtin-instance-slider.spec.mjs` 回归通过。
- 清理：临时站点由用例自动删除；临时 spec 与运行日志在审计收尾时删除。
