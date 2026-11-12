# 后端积木编排 · 设计说明

> 目标：后端接口像前端图层树一样用节点树搭出来，手写代码降级为可选的「用户代码」节点。
> 当前纵向切片只实现 Node 的 codegen；节点模型、IR、清单从第一版起就按多语言设计。

## 1. 范围与不变量

- 页面：`backend-flow.html`（独立页面，不改 `builder.html` 与首页）。
- 数据：`/api/sites/:siteId/backend-flow` 读写流程草稿，默认站点内 `main` 流程。
- 代码：仍落在现有三区结构，不另起目录。
  - 生成区：`src/generated/**`（`[LC-GENERATED]`，可整体重建）
  - 用户区：`src/custom/**`（`[LC-CUSTOM]`，重生成不覆盖）
  - 清单：`GENERATED-MANIFEST.json` + `src/generated/flows/manifest.json`
- 数据库：预览只用构建目录里的一次性 SQLite（随机端口、临时文件、跑完即删），
  不读取站点配置里的 MySQL / PostgreSQL / Redis，也不碰本机 3306 / 6379 / 5432。

## 2. 节点模型

### 2.1 流程文档

```jsonc
{
  "schemaVersion": 1,
  "siteId": "demo",
  "language": "node",              // 站点后端语言，不是目标代码语言
  "flow": {
    "id": "main",
    "name": "物品列表接口",
    "treeVersion": 3,              // 每次成功生成 +1
    "lastCompiledAt": "2026-11-08T03:12:00.000Z",
    "lastTreeHash": "02399a138c2cdd8e",
    "root": { "id": "root", "type": "flow.root", "children": [] }
  },
  "settings": {
    "configCenter": {
      "definitions": [{ "key": "appName", "type": "string", "default": "积木示例" }],
      "values": {}
    }
  }
}
```

### 2.2 节点

```jsonc
{
  "id": "db_items",                // 稳定 id，见 2.3
  "type": "db.readCollection",     // 注册表里的类型名
  "name": "读取集合 items",
  "enabled": true,                 // false = 禁用，生成时整棵子树跳过
  "params": { "collection": "items", "output": "rows" },
  "children": [],                  // 仅容器节点
  "elseChildren": []               // 仅条件分支
}
```

- **顺序**：同层按 `children` 数组顺序执行；中间件例外，按固定优先级排序（见 2.5）。
- **嵌套**：`flow.branch` 有 `children` / `elseChildren` 两棵子树，`flow.loop` 只有 `children`。
- **禁用**：`enabled=false` 时节点与其子树都不参与校验和生成；树上仍保留，可随时恢复。
- **重排**：拖拽只改数组顺序，不改 `id`，所以输出变量引用不会因排序失效。

### 2.3 稳定 id

- 规则：`^[a-z][a-z0-9_]{1,39}$`，按分类前缀生成：`entry_` / `mw_` / `db_` / `tf_` / `ctl_` / `res_` / `cmp_` / `code_`。
- id 一经生成不再变化；重命名节点只改 `name`，不改 `id`。
- 代码节点文件名、组件引用、诊断定位、清单都依赖 id，不允许在生成时重新分配。
- 重复 id 在校验阶段报 `LC_F_ID_DUP` 并指出另一处路径。

### 2.4 节点类型清单（16 种）

| 分类 | 类型 | 说明 | 关键参数 |
| --- | --- | --- | --- |
| 入口 | `entry.request` | HTTP 入口，单例 | `method`、`path`、`params[]`（name / in / type / required） |
| 中间件 | `middleware.cors` | 跨域头 + OPTIONS 预检 | `origins`、`credentials`、`maxAgeSeconds` |
| 中间件 | `middleware.auth` | 登录校验 + 角色白名单 | `roles` |
| 中间件 | `middleware.rateLimit` | 令牌桶限流 | `rps`、`burst`、`keyBy` |
| 中间件 | `middleware.log` | 方法、路径、状态码、耗时 | `level`、`skipHealth` |
| 数据 | `db.readCollection` | 按页读集合 | `collection`、`page`、`pageSize`、`q`、`sort`、`fields`、`output` |
| 数据 | `db.insertCollection` | 写集合 | `collection`、`body`、`output` |
| 数据 | `file.read` | 读 `data/files` | `path`、`encoding`、`output` |
| 数据 | `file.write` | 写 `data/files` | `path`、`content`、`append` |
| 数据 | `http.request` | 调外部接口 | `method`、`url`、`headers`、`body`、`timeoutMs`、`output` |
| 变换 | `data.transform` | `pick` 裁字段 / `template` 拼装 | `mode`、`input`、`fields`、`template`、`output` |
| 控制 | `flow.branch` | if / else 两棵子树 | `condition` |
| 控制 | `flow.loop` | 遍历数组，可收集 | `source`、`itemVar`、`maxIterations`、`collect`、`output` |
| 响应 | `response.json` | 状态码 + JSON 体 + 头 | `status`、`body`、`headers` |
| 组件 | `component.custom` | 引用自定义后端组件 | `component`、`args`、`output` |
| 代码 | `code.node` | 用户代码，写入 `custom/` | `codeLanguage`、`output` |

每个字段声明 `kind`（text / number / select / toggle / textarea / expression / params）、
`width`（short 180px / medium 280px / full 整行）、`required`、`default`、`pattern`、`min`、`max`。
服务端校验、浏览器属性面板、代码生成读同一份定义：`server/src/flow/nodes.js`。

### 2.5 执行顺序

1. 入口匹配（方法 + 路径）。
2. 中间件按 `middlewarePriority` 排序：CORS 10 → 日志 20 → 鉴权 30 → 限流 40。
   树上位置不影响真实执行顺序，位置不对只给 `LC_F_MW_ORDER` 警告。
3. 处理节点按树顺序深度优先执行；分支只走命中的子树；循环对数组逐项执行子树。
4. `response.json` 显式返回；其后的节点报 `LC_F_UNREACHABLE` 警告。

## 3. 能力矩阵与多语言

### 3.1 声明方式

每个节点类型、每个自定义组件都带两份声明：

```js
languages: ['node', 'rust', 'go'],   // 设计上能翻译成哪些语言
implementedLanguages: ['node']       // 当前真正有 codegen 的语言
```

内置积木目前两份声明分别是「三种语言」与「仅 Node」；自定义组件由创建者勾选，
`implementedLanguages` 至少包含实际提供了实现的 `code.<language>`。

### 3.2 编译时的筛选

`buildFlowIR(doc, { target })` 逐节点检查：

| 情况 | 诊断码 | 处理 |
| --- | --- | --- |
| `languages` 不含目标语言 | `LC_F_LANG_NODE` | 报错，给出「换成同类积木」或「插入声明该语言的代码节点」两条替代方案 |
| `languages` 含但 `implementedLanguages` 不含 | `LC_F_LANG_CODEGEN` | 报错，说明该语言 codegen 未实现 |
| 代码节点声明了别的语言 | `LC_F_CODE_SKIP` | **警告**并跳过，提示为该语言补一个代码节点或拆成通用积木 |
| 组件不存在 | `LC_F_COMPONENT_MISSING` | 报错，提示去组件库创建/导入 |
| 组件不支持目标语言 | `LC_F_COMPONENT_LANG` | 报错，列组件支持的语言 |
| 组件缺目标语言实现 | `LC_F_COMPONENT_CODEGEN` | 报错，提示补实现 |

所有诊断都带 `nodeId`、`nodeLabel`、树路径 `path`、`message`、`suggestion`。
只有 warning 时仍可生成；出现 error 时生成中止，接口返回 422 并附完整 `issues`。

界面上：节点库给每个积木显示 Node / Rust / Go 徽章，实线=已实现，虚线=仅设计支持；
切到非 Node 目标语言时，节点库顶部明确提示「codegen 还没实现」，点生成会逐节点报错。

## 4. 中间表示（IR）

### 4.1 分层

```
节点树 (flow doc)
   └─ buildFlowIR(doc, { target, components })   server/src/flow/ir.js
        └─ IR（语言无关，不含任何目标语言语法）
             └─ Node codegen                      server/src/flow/compile.js
                  ├─ src/generated/flows/<flowId>.js
                  ├─ src/generated/flows/<flowId>.ir.json
                  └─ src/generated/flows/manifest.json
```

同一棵节点树 + 同一目标语言 → 相同 IR（`irHash` 稳定）；不同语言只换 codegen，
不重新解释节点树。

### 4.2 IR 形态

```jsonc
{
  "irVersion": 1,
  "target": "node",
  "flow": { "id": "main", "name": "物品列表接口", "treeVersion": 3 },
  "entry": {
    "nodeId": "entry_items", "label": "GET /api/items",
    "method": "GET", "path": "/api/items",
    "params": [{ "name": "pageSize", "in": "query", "type": "number", "required": false }]
  },
  "middleware": [
    { "nodeId": "mw_cors", "op": "middleware.cors", "label": "CORS", "params": {} }
  ],
  "body": [
    {
      "kind": "op", "op": "db.read", "nodeId": "db_items", "label": "读取集合 items",
      "out": "rows",
      "args": {
        "collection": "items",
        "page": { "kind": "expr", "ast": {} },
        "pageSize": { "kind": "expr", "ast": {} },
        "q": { "kind": "expr", "ast": {} },
        "sort": "", "fields": ""
      }
    },
    {
      "kind": "return", "nodeId": "res_items", "label": "返回列表 JSON",
      "args": { "status": 200, "body": { "kind": "object", "entries": [] }, "headers": {} }
    }
  ],
  "codeModules": [{ "nodeId": "code_ab12", "language": "node", "file": "src/custom/handlers/main.code_ab12.js" }],
  "components": [{ "id": "order-total", "version": 2, "scope": "global", "language": "node" }],
  "diagnostics": [],
  "irHash": "5f0c1e7a9d2b4c63"
}
```

指令只有四类：

| kind | 字段 | 说明 |
| --- | --- | --- |
| `op` | `op`、`out`、`args` | 有输出的单步操作；`out` 为空表示无返回值 |
| `branch` | `cond`、`then[]`、`else[]` | 条件分支，两棵指令数组 |
| `loop` | `out`、`args.source/itemVar/limit/collect`、`body[]` | 有界循环 |
| `return` | `args.status/body/headers` | 终止并响应 |

`op` 的取值是语言无关的动作名，不是函数名：
`db.read`、`db.insert`、`file.read`、`file.write`、`http.request`、`data.pick`、
`data.template`、`code.run`、`component.run`。Node codegen 把它们映射到运行时函数；
Rust / Go codegen 将来映射到各自的等价实现。

### 4.3 值与表达式

值 IR：

| kind | 含义 |
| --- | --- |
| `literal` | 字符串、数字、布尔、null |
| `expr` | 受限表达式 AST；`literal: true` 表示整段就是一个 `{{…}}` |
| `template` | 字符串分段：纯文本与表达式交替 |
| `array` / `object` | JSON 模板结构 |
| `undefined` | 参数留空 |

表达式 AST 节点：`number` / `string` / `boolean` / `null` / `undefined` / `ref` / `member` /
`index` / `unary` / `binary` / `ternary`。

语法优先级从低到高：`?:` → `||` → `&&` → `== != === !==` → `> >= < <=` → `+ -` → `* / %` → 一元 `! -` → 成员/下标 → 括号/字面量/变量。

**禁止**：函数调用、赋值、对象字面量、模板字符串、分号、`new`。
解析失败报 `LC_F_IR_EXPR`，并指出是哪个节点的哪个字段。

变量根：`request`（method / path / query / body / headers / params）、上一步的 `output` 变量、
循环里的 `item` / `itemIndex`。未知根变量在校验阶段报错，不会留到运行时。

### 4.4 代码节点在 IR 中的表示

代码节点是**不可翻译的黑盒**：

```jsonc
{
  "kind": "op",
  "op": "code.run",
  "nodeId": "code_ab12",
  "out": "codeResult",
  "impl": { "language": "node", "file": "src/custom/handlers/main.code_ab12.js" },
  "args": { "codeLanguage": "node" }
}
```

规则：

- `codeLanguage` 必填，且必须是 `node | rust | go`；未声明或写错报 `LC_F_CODE_LANG`。
- 只有 `codeLanguage === target` 时，该节点才进入 IR 的 `body`。
- 其他语言生成时跳过，并产出 `LC_F_CODE_SKIP` 警告，写明「哪个节点、声明了什么语言、被跳过」，
  同时建议为该语言再放一个代码节点，或把逻辑拆成通用积木。
- IR 只记录实现文件路径，不内联代码；代码内容永远在用户区 `custom/handlers/`，
  由 `ensureCodeFile` 以 `wx` 方式创建，已存在则不改写。
- 生成器只 import、不重写；界面上代码节点固定显示
  「用户代码，不会被生成过程改写」以及实际文件路径。

### 4.5 确定性与哈希

- `flowTreeHash`：对 `flow.root` 与 `configCenter` 做键排序后的规范化 JSON，取 sha256 前 16 位。
- `flowIRHash`：对 `irVersion / target / flow.id / treeVersion / entry / middleware / body / components`
  做同样处理；不含诊断与时间戳。
- 清单同时记录 `treeVersion`、`treeHash`、`irVersion`、`irHash`，可判断「树变了」还是「只是重新生成」。

## 5. 自定义后端组件

### 5.1 定位

组件与「前端组件」并列，是可复用的后端积木：有自己的参数 schema，以及一份或多份语言实现。
节点 `component.custom` 只是对组件的引用，组件本体在组件库里维护。

### 5.2 作用域与目录

| 作用域 | 目录 | 可见范围 |
| --- | --- | --- |
| 仅本项目 | `data/sites/<siteId>/backend/node/_components/<id>.json` | 当前站点 |
| 全局 | `<dataDir>/backend-components/<id>.json` | 所有项目 |

合并规则：同 id 时项目内版本优先，全局版本不覆盖项目内版本；
节点保存的是组件 id，生成时按合并后的池解析。

### 5.3 组件定义

```jsonc
{
  "schemaVersion": 1,
  "id": "order-total",           // ^[a-z][a-z0-9-]{1,63}$
  "name": "订单合计",
  "description": "把明细行汇总成总额",
  "scope": "global",             // project | global
  "version": 2,                  // 保存时自增
  "languages": ["node", "rust"],
  "implementedLanguages": ["node"],
  "params": [
    { "key": "items", "label": "明细", "kind": "expression", "required": true, "default": "{{rows.items}}", "hint": "" }
  ],
  "code": {
    "node": "export async function run(ctx, args) { /* … */ }",
    "rust": ""
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

- 参数 `kind`：`text / number / toggle / select / json / expression`；key 唯一。
- 属性面板按 `params` 自动渲染输入，值写进节点的 `params.args`（JSON 对象）。
- 构建时组件实现落到构建目录 `src/custom/components/<id>.<js|rs|go>`，
  打上 `[LC-CUSTOM]` 头，生成区只 import 不改写。

### 5.4 导入导出

导出文件：

```jsonc
{
  "kind": "lc-backend-component",
  "schemaVersion": 1,
  "exportedAt": "2026-11-08T03:12:00.000Z",
  "component": { "id": "order-total", "name": "…", "version": 2, "languages": [], "implementedLanguages": [], "params": [], "code": {} }
}
```

- 导入接受上面的包装对象，也接受裸组件对象；导入后进入草稿态，点「保存组件」才落盘，
  保存时可重新选择「仅本项目 / 保存为全局」。
- 跨项目引用全局组件时，清单记录 `{ id, version, scope, language }`；
  组件后续升级不会悄悄改变已生成的产物。

## 6. 校验规则

校验发生在保存后、生成前，全部带节点定位（`nodeId` + 树路径）。

| 类别 | 诊断码 | 说明 |
| --- | --- | --- |
| 文档结构 | `LC_F_DOC` / `LC_F_SCHEMA` / `LC_F_FLOW` / `LC_F_ROOT` / `LC_F_NAME` | 文档、schema 版本、流程根 |
| 节点基础 | `LC_F_NODE` / `LC_F_TYPE` / `LC_F_ENABLED` / `LC_F_ID` / `LC_F_ID_DUP` | 结构、未知类型、非法/重复 id |
| 结构约束 | `LC_F_CYCLE_TREE` / `LC_F_DEPTH` / `LC_F_TOO_MANY` | 重复挂载成环、嵌套过深、节点数上限 |
| 位置约束 | `LC_F_ENTRY_NESTED` / `LC_F_MW_NESTED` / `LC_F_ENTRY_MISSING` / `LC_F_ENTRY_DUP` / `LC_F_MW_DUP` | 入口/中间件必须在根下、入口单例、同类中间件单例 |
| 必填与格式 | `LC_F_REQUIRED` / `LC_F_PARAM_NUMBER` / `LC_F_PARAM_RANGE` / `LC_F_PARAM_ENUM` / `LC_F_PARAM_PATTERN` / `LC_F_PARAM_JSON` | 字段级校验 |
| 引用 | `LC_F_OUTPUT` / `LC_F_OUTPUT_DUP` / `LC_F_REF_CYCLE` / `LC_F_EXPR` | 输出变量名、重复定义、变量引用环、表达式语法 |
| 节点语义 | `LC_F_CORS` / `LC_F_ROLE` / `LC_F_HTTP` / `LC_F_HEADERS` / `LC_F_FILE_PATH` / `LC_F_PARAM_SCHEMA` | 各节点特有约束（如 `*` 与凭证互斥、私网地址拦截） |
| 语言能力 | `LC_F_LANG_TARGET` / `LC_F_LANG_NODE` / `LC_F_LANG_CODEGEN` / `LC_F_CODE_LANG` / `LC_F_CODE_FILE` | 目标语言、能力矩阵、代码文件是否存在 |
| 组件 | `LC_F_COMPONENT_MISSING` / `LC_F_COMPONENT_LANG` / `LC_F_COMPONENT_CODEGEN` | 悬空引用、语言不支持、缺实现 |
| 提示 | `LC_F_UNREACHABLE` / `LC_F_MW_ORDER` / `LC_F_COLLECTION` | 响应后的死节点、中间件顺序、集合不存在 |

「悬空引用」包含两层：树上引用了不存在的组件；表达式引用了未定义的输出变量。
两者都指出具体节点，不会生成一份表面能跑、运行时才炸的代码。
检测到引用环（`LC_F_REF_CYCLE`）时给出完整环路径，例如 `a → b → c → a`。

## 7. 编译契约与落点

### 7.1 生成文件（Node）

| 文件 | 内容 |
| --- | --- |
| `src/generated/flows/runtime.js` | 表达式求值、集合读写、文件沙箱、HTTP、中间件 |
| `src/generated/flows/<flowId>.js` | 按 IR 生成的显式代码，每个节点一段，错误包上节点 id |
| `src/generated/flows/<flowId>.ir.json` | 语言无关 IR，供其他语言 codegen 与排查 |
| `src/generated/routes/flows.js` | 汇总注册所有流程路由 |
| `src/generated/routes/index.js` | 模板基础上追加 `registerFlowRoutes` |
| `src/generated/flows/manifest.json` | IR 版本/哈希、节点树版本/哈希、组件版本、代码节点清单 |
| `src/custom/components/<id>.js` | 组件实现（用户区） |
| `src/custom/handlers/<flowId>.<nodeId>.js` | 代码节点（用户区，不存在时自动创建空模板） |

构建产物在 `data/sites/<siteId>/backend-build/node/`；站点源码区不写入生成代码。

### 7.2 清单字段

`src/generated/flows/manifest.json` 与 `GENERATED-MANIFEST.json` 均记录：

```jsonc
{
  "flowId": "main",
  "entry": "GET /api/items",
  "treeVersion": 3,
  "treeHash": "02399a138c2cdd8e",
  "irVersion": 1,
  "irHash": "5f0c1e7a9d2b4c63",
  "targetLanguages": ["node"],
  "components": [{ "id": "order-total", "version": 2, "scope": "global", "language": "node" }],
  "codeModules": [{ "nodeId": "code_ab12", "language": "node", "file": "src/custom/handlers/main.code_ab12.js" }]
}
```

### 7.3 运行时语义

- 入参校验失败返回 400，并在响应体里指出参数名与位置。
- 每个节点执行包 `try/catch`，抛错时带上 `nodeId` 与节点名，便于定位。
- `http.request` 阻断 localhost、私网与 `.local`；`file.*` 限制在 `data/files` 且单文件 1 MB。
- 表达式求值使用 `Proxy` 作用域，未定义变量返回 `undefined`，不会读取全局对象。
- 模板内置的 `itemsRoutes` 与流程同路径时，跳过内置注册并给 `LC_F_ROUTE_OVERRIDE` 警告，
  避免 Fastify 重复路由崩溃。

## 8. 界面

三栏沿用前端 builder 的控件与宽度规范（短 180px / 中 280px / 整行、细滚动条）：

- **左：节点库**。分类可折叠、可搜索；每个积木显示语言徽章；拖拽或点击插入。
- **中：节点树**。拖拽排序与嵌套、插入指示线、容器空槽、禁用开关、展开/收起；
  右侧卡片显示节点树版本与上次生成哈希。
- **右：属性面板**。四个 Tab：
  - 节点：选中节点的参数表单，宽度按字段定义；代码节点显示用户区路径与不改写提示。
  - 中间件：CORS / 鉴权 / 限流 / 日志的开关与参数，直接改树上对应节点。
  - 配置中心：`definitions` + `values` 的编辑；`secret` 类型只存环境变量名，不落值。
  - 组件库：项目/全局组件列表、新建/编辑/导出/删除、导入 JSON、语言勾选与参数 schema。
- **顶栏**：站点、目标语言、保存、校验、生成、启动/停止预览、真实请求发送。
- **生成结果**：按文件列出生成内容与 `treeVersion` / `treeHash`，便于核对。

## 9. 如何新增一种节点类型

1. 在 `server/src/flow/nodes.js` 的 `NODE_TYPES` 增加定义：`category`、`label`、`summary`、
   `languages`、`implementedLanguages`、`fields`（含 `width` 与校验属性）；容器节点再加
   `container: true` 与 `slots`。
2. 在 `server/src/flow/ir.js` 的 `buildInstructions` 增加该类型的 IR 映射（`op` 名 + 参数值 IR）。
3. 在 `server/src/flow/compile.js` 增加该 `op` 的 Node 代码生成分支；必要时补 `node-runtime.js`。
4. 在 `server/src/flow/validation.js` 补该类型的语义校验（缺省字段与引用检查）。
5. 前端无需改代码：节点库、属性面板、拖拽都由注册表驱动；如字段需要动态选项，
   在组件或集合里提供数据源，通过 `/backend-flow` 返回。

新增语言时：在 `FLOW_LANGUAGES` 注册语言，逐类型更新 `implementedLanguages`，
在 `compile.js` 旁增加对应 codegen（消费同一份 `<flowId>.ir.json`），
未覆盖的节点由 `LC_F_LANG_CODEGEN` 明确报出。

## 10. 参考项目评审

四个仓库均为用户本人所写，许可证不作为限制；评审仍按「结构清晰、抽象合理才复用」的标准，
不因为作者相同就照搬。

### 10.1 VarJson — 采纳 IR 形状与诊断，不采纳自研 parser

- **结构**：`src/common.ts`（类型与错误格式化）、`src/parse.ts`（lexer/parser/linker）、
  `src/decompile.ts`、`src/stringify.ts`、`src/index.ts`、`src/test/fixtures/*`。
- **IR**：`NodeIR = LiteralNode | ArrayNode | ObjectNode | RefNode`，配合 `FieldIR / ScopeIR / ModuleIR`；
  每个节点带 `Loc { fileIndex, line, col }`，引用分 `local / scope / alias` 三种基。
- **诊断**：`VjsonError { type, message, fileIndex?, line?, col?, importChain? }`，
  `formatError` 输出 `at file line:col` 与 `imported from …`；错误上限 100，超出写 `error.log`。
- **结论**：**值得借**。IR 的「Module → Scope → Field → Node」分层与我们的
  「流程 → 中间件/指令 → 值/表达式」同构；`Loc` 与 `importChain` 正好补上我们诊断只有
  `nodeId/path`、没有源码位置的短板。
- **采纳**：结构化诊断字段（对应我们的 `code / nodeId / nodeLabel / path / message / suggestion`）、
  导入链思路（对应组件版本与作用域的记录）、cycle / forward-ref 的 fixture 纪律。
- **不采纳**：自研 lexer/parser 与 decompile——我们的输入是 JSON 节点树，不需要再解析一门语言。
- **受影响改动**：诊断统一保留 `path`；计划给代码节点内容增加 `span`（行/列）以支持
  「代码节点里引用了不存在的变量」这类跨文件定位。

### 10.2 tclang — 采纳模块分层，不采纳 CFG

- **结构**：`lexeme.rs → parser.rs → semantic/* → ir/{mod,generator}.rs → target/mod.rs`；
  另有重复的 `src/IR/` 与 `src/Target/` 目录。
- **IR**：`Operand { IntConst / FloatConst / StringConst / Temp / Var / Label }`，
  `Instr { Mov / Add / … / Jmp / JmpIf / Call / Ret / Label / Nop }`，
  `BasicBlock { label, instrs, terminator }`，`Function { params, return_type, blocks, temp_counter }`，
  `Module { functions, string_table }`，`TypeInfo { Int, Float, String, Bool, Void, Unknown }`。
- **诊断**：AST 节点没有 span，错误定位弱。
- **结论**：**部分值得借**。`Module → Function → Block` 的分层与临时值命名（`Temp`）清晰，
  但基本块/标签/跳转对「生成高级语言」是多余抽象——我们的节点树本身就是结构化的。
- **采纳**：每流程一个「模块」+ 指令序列的组织方式；输出变量用稳定名字而不是临时寄存器；
  类型的最小集合（字符串/数字/布尔/空/未知）作为表达式推断的边界。
- **不采纳**：基本块、标签、`Jmp/JmpIf`、`temp_counter` 重命名；重复目录结构；无 span 的 AST。
- **受影响改动**：IR 的 `flow / entry / middleware / body` 就是对 `Module / Function / Block` 的
  结构化替代；`op.out` 使用用户可见的 `output` 变量名，而不是 `t1/t2`。

### 10.3 compact-profile — 不作为 IR 参考

- **结构**：`parser.ts`、`ast.ts`、`stringify.ts`、`typelevel.ts`、`CompactProfile.ts`、`types.ts`。
- **AST**：仅表达式/字面量节点（AstString / AstInteger / AstMemberAccess / AstBinary / AstTernary 等），
  没有位置字段，也没有 codegen 或解释执行层。
- **结论**：**不值得作为积木 IR 参考**。它是「配置文本 ↔ 对象」的序列化库，
  不是「中间表示 → 多目标代码」的流水线。
- **采纳**：仅借鉴重复键诊断与 parse/stringify 往返测试的严谨性（可选，不是必需）。
- **不采纳**：把配置 AST 当作流程 IR；它缺少指令、作用域与执行顺序的表达力。
- **受影响改动**：无结构性改动；表达式 AST 的写法与它相近，但我们已经独立实现且有白名单限制。

### 10.4 Nexus — 采纳分层纪律，不采纳 LLVM 式指令集

- **结构**：`compiler/frontend`（lexer/parser/ast/semantic_analyzer）→
  `compiler/middleend`（ir.h/ir.cpp、optimizer、codegen）→ `compiler/backend`。
- **IR**：`OpCode` 枚举（ADD/SUB/…/BR/COND_BR/PHI/CALL/RET/CONST/ALLOCA/GETELEMENTPTR），
  `Instruction` 基类 + ConstInst / BinaryInst / CondBrInst / CallInst / PhiInst 等，
  `BasicBlock / Function / Module`，`Type { VOID, BOOL, INT8..INT64, FLOAT, DOUBLE, POINTER, ARRAY, STRUCT }`。
- **诊断**：`semantic_analyzer` 只有 `error(message)`，没有行列号，定位弱。
- **结论**：**部分值得借**。frontend / middleend / backend 的职责切分值得保留；
  但 PHI、CFG、完整类型系统对「搭积木生成业务接口」是过度设计。
- **采纳**：分层纪律（我们的 `nodes.js` / `ir.js` / `compile.js` 三段）；
  `op` 用集中注册表而不是散落的 `if`；每种指令有统一字段形状。
- **不采纳**：PHI 节点、基本块、指针/结构体类型系统、寄存器式指令。
- **受影响改动**：IR 的指令统一为 `{ kind, op, nodeId, label, out, args }`，
  新增 `op` 必须同时在 IR 与 codegen 注册，避免出现「能解析但生成不了」的中间态。

### 10.5 汇总

| 仓库 | 借什么 | 不借什么 |
| --- | --- | --- |
| VarJson | IR 分层、`Loc`/导入链式诊断、环与前置引用的测试纪律 | 自研 lexer/parser、decompile |
| tclang | Module/Function 分层、稳定临时值与最小类型集 | 基本块、标签跳转、重复目录、无 span 的 AST |
| compact-profile | 重复键诊断与往返测试（可选） | 把配置 AST 当流程 IR |
| Nexus | frontend/middleend/backend 分层、opcode 注册表纪律 | PHI、CFG、指针/结构体类型系统 |

## 11. 当前边界与后续

- **已跑通**：Node 纵向切片（入口 GET /api/items → CORS/日志 → 读集合 → 返回 JSON），
  真实请求 200、分页正确；代码节点、组件、能力矩阵、IR 落盘、清单版本均已接入。
- **设计就绪、未实现**：Rust / Go 的 codegen。目标语言切过去时，校验与生成会逐节点
  报 `LC_F_LANG_CODEGEN`，并给出替代方案，不会静默跳过或产出半成品。
- **已知缺口**：诊断尚无源码行列（计划按 VarJson 的 `Loc` 补齐到代码节点）；
  全局组件的跨项目版本升级目前只记录、不自动迁移；IR 暂未做优化 pass。

## 12. 验证方式

- `node scripts/flow-slice.mjs`：临时站点 + 临时 SQLite + 随机端口，编译后真实请求
  `GET /api/items` 校验 200、行数、分页与清单字段，跑完删除临时目录。
- 预览：页面「启动预览」→「发送请求」，服务只监听 `127.0.0.1` 随机端口；
  停止预览会等待子进程真实退出。
