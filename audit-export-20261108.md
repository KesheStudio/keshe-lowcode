# 导出与产物专项审计（2026-11-08）

## 一、结论摘要

- 审计在隔离的平台副本、临时站点和临时目录中完成，未读写既有 `data/sites`，未覆盖既有导出产物。
- 实际执行 18 组导出，覆盖纯静态 Web、Node/Go/Rust 后端 Web、Tauri 桌面；全部成功生成产物，并完成页面打开、接口回填、后端启动、Go 编译、Rust `cargo check`、Tauri 工程校验。
- 本轮直接修复 15 个根因明确的问题；原“遗留问题”中的 4 项也按确认口径完成，当前没有挂起项。
- 最终 manifest 与真实文件一致性：18/18 通过，未发现缺失、未列出或大小不符的文件。

## 二、审计方法与环境

- 隔离平台根：复制 `server/src`、`shared`、`assets`、`vendor`、`templates`、根配置文件，使用临时端口和临时数据目录。
- 临时站点：包含标题、段落、数据绑定标题、表格、Markdown Mermaid、滑块、导航等区块。
- 实际使用方式：
  - 纯静态包：本机静态服务器打开，检查主题、Mermaid、字体/图标、外链、绑定请求。
  - 后端包：真实启动导出的 Node 后端，执行 `POST/GET /api/items`，并在浏览器点击绑定标题回填表格。
  - Go/Rust：`go build`、`cargo check` 实际编译。
  - Tauri：校验导出的 `desktop/config/desktop.json`、`src-tauri/tauri.conf.json`、`desktop/web`，执行工程 `validate-config` 与 `cargo check`，并在浏览器打开 `desktop/web` 验证页面与接口指向。
- 压缩与源码模式：同站点分别以 `minify: true` / `false` 导出后对比文件体积与可读性。
- 失败与非法参数：目标非法、后端语言非法、Tauri 标识符非法、Tauri HTTPS 组合非法、向导保存非法值。

## 三、导出矩阵

| # | 场景 | 目标 | 后端 | 结果 | 关键验证 |
|---|---|---|---|---|---|
| 1 | 不配地址 | Web | none | 通过 | 页面、主题、Mermaid、滑块、无外链 |
| 2 | 不配地址 | Web | node | 通过 | 后端启动，POST/GET `/api/items` 正常，浏览器回填成功 |
| 3 | 域名 + 路径前缀 | Web | none | 通过 | 页面基址为配置域名/前缀 |
| 4 | 仅路径前缀 | Web | none | 通过 | 浏览器请求 `/docs/api/items?event=click` 200，表格回填 |
| 5 | 已保存域名 + 单次导出覆盖 | Web | none | 通过 | `body.web` 覆盖生效，页面基址为 `/sub` |
| 6 | 域名 + 前缀 | Web | node | 通过 | 后端配置正常，CORS 来源为站点域名 |
| 7 | 域名 + 前缀 | Web | go | 通过 | 导出结构完整，`go build` 成功 |
| 8 | 域名 + 前缀 | Web | rust | 通过 | 导出结构完整，`cargo check` 成功 |
| 9 | 桌面（无后端） | Tauri | none | 通过 | `desktop/web` 完整，页面无 Web 域名，桥接脚本生效 |
| 10 | 桌面 + Node 后端 | Tauri | node | 通过 | 页面基址为桌面后端地址，CORS 放行 Tauri 来源 |
| 11 | 桌面 + 自定义后端端口 | Tauri | node | 通过 | 页面基址 `http://127.0.0.1:9840`，后端从导出配置启动并回填 200 |
| 12 | 桌面完整配置 | Tauri | none | 通过 | 应用名、标识符、版本、协议、窗口落盘；http + 证书模式归一为 none |
| 13 | 不压缩 | Web | none | 通过 | 源码可读、无压缩 |
| 14 | 重复导出 | Web | none | 通过 | 生成新构建记录，不覆盖旧产物 |
| 15 | 只导出首页 | Web | none | 通过 | 导航/正文引用的页面自动补入；无引用的页面仍排除，无死链 |
| 16 | 开启 HTML 压缩 | Web | none | 通过 | 内联文本空格、`pre` 空白保留 |
| 17 | 纯静态项目选后端 | Web | node | 通过 | 按文档允许，产物包含后端 |
| 18 | Tauri 配置保存校验 | — | — | 通过 | 非法标识符在保存阶段返回 422 |

## 四、已修复问题

### 4.1 Tauri 导出包缺少 `desktop/web`，`frontendDist` 指向空目录

- **问题描述**：导出包把站点产物放在包根 `web/`，但 Tauri 工程位于 `desktop/`，`delivery.webDir = "../web"` 相对 `desktop/src-tauri` 解析到 `desktop/web`，该目录不存在，`build-app` 无法打包前端。
- **复现步骤**：导出 Tauri 目标 → 进入 `desktop/` 执行 `node scripts/validate-config.mjs --project .`，出现 `web 目录不存在` 警告；`build-app` 的前端目录为空。
- **影响**：Tauri 包无法直接构建，属于阻断问题。
- **严重度**：P1。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)（Tauri 产物组装）；[templates/tauri/config/desktop.json](file:///c:/project/docs/lowcode/templates/tauri/config/desktop.json)（默认 `webDir`）。
- **修复与验证**：导出 Tauri 时把最终 `web/*` 同步到 `desktop/web/*`；`validate-config` 通过，`cargo check` 通过，`desktop/web/index.html` 与 `assets/js/site.js` 均存在。

### 4.2 Tauri 页面把 Web 站点域名写成接口基址

- **问题描述**：Tauri 页面沿用了 Web 站点地址，配了 `https://example.test/docs` 后，桌面产物里的 `window.LC_PUBLIC_BASE_URL` 也是该域名，桌面应用会请求错误主机。
- **复现步骤**：站点保存域名 `https://example.test/docs` → 导出 Tauri → 打开 `web/index.html` 或 `desktop/web/index.html`，可见 `LC_PUBLIC_BASE_URL` 为 Web 域名。
- **影响**：桌面数据绑定、接口请求全部指向错误地址。
- **严重度**：P1。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)（`publicBaseConfig` / `runtimeScript`）。
- **修复与验证**：桌面目标改用桌面后端基址（有后端时）或不注入基址（无后端时）。浏览器验证：`desktop/web` 页面 `LC_PUBLIC_BASE_URL` 为 `http://127.0.0.1:9840`，页面内无 `example.test` 请求。

### 4.3 Tauri 页面未加载 `desktop-config.js`，`window.__LC_DESKTOP__` 缺失

- **问题描述**：导出会生成 `desktop-config.js`，但页面没有引用，桌面运行时拿不到应用名、版本、后端地址等桥接信息。
- **复现步骤**：导出 Tauri → 在页面控制台读取 `window.__LC_DESKTOP__`，为 `undefined`。
- **影响**：桌面应用元信息、更新检查、运行时桥接功能不可用。
- **严重度**：P2。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)（`buildPageDocument`）。
- **修复与验证**：页面 head 注入带正确前缀的 `desktop-config.js`。浏览器验证：`window.__LC_DESKTOP__.appName` 为站点名，页面无脚本错误。

### 4.4 Tauri 后端 CORS 未放行 Tauri WebView 来源

- **问题描述**：桌面页面来源是 `tauri://localhost` / `https://tauri.localhost`，但导出后端 CORS 只放行 Web 站点来源，桌面里的 `fetch` 会被浏览器内核拦截。
- **复现步骤**：导出 Tauri + Node 后端 → 启动导出后端 → 用 `Origin: https://tauri.localhost` 请求 `/api/health`，响应没有 `Access-Control-Allow-Origin`。
- **影响**：桌面 + 后端的接口回填全部失败。
- **严重度**：P1。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)（`renderBackendConfig` 的 CORS 来源）。
- **修复与验证**：桌面目标额外写入 `tauri://localhost`、`https://tauri.localhost`、`http://tauri.localhost`。验证：`Origin: https://tauri.localhost` 请求返回对应 ACAO；导出后端加载生成配置后 `/api/items?event=click` 返回 200。

### 4.5 仅配置路径前缀时接口基址未拼接

- **问题描述**：只配置 `basePath`、不配域名时 `address.configured` 为 false，页面不注入任何基址，接口请求落到站点根路径而不是前缀下。
- **复现步骤**：站点配置 `domain: ""`、`basePath: "/docs"` → 导出纯静态 → 部署到 `/docs/` 下 → 点击数据绑定，请求为 `/api/items` 而非 `/docs/api/items`。
- **影响**：子路径部署时接口 404。
- **严重度**：P2。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)（`publicBaseConfig`）；[server/src/export/site-address.js](file:///c:/project/docs/lowcode/server/src/export/site-address.js)。
- **修复与验证**：无域名但有前缀时注入同源相对前缀。浏览器验证：请求 `/docs/api/items?event=click` 返回 200，表格出现“前缀接口命中”。

### 4.6 单次导出参数 `body.web` 被忽略

- **问题描述**：`POST /api/sites/:id/export` 接收 `web`，但路由没有传给管线，单次导出无法覆盖已保存的站点地址。
- **复现步骤**：先保存域名 `https://example.test/docs` → 导出请求体传 `web: { domain: "", basePath: "/sub" }` → 产物仍使用旧地址。
- **影响**：API 调用方只能先 PUT 配置再导出，行为与参数契约不一致。
- **严重度**：P2。
- **根因文件**：[server/src/routes/export.js](file:///c:/project/docs/lowcode/server/src/routes/export.js)。
- **修复与验证**：路由透传 `body.web`，管线与已保存配置合并。导出后页面基址为 `/sub`，无旧域名残留。

### 4.7 manifest 的 `backend.database` 写成 `"[object Object]"`

- **问题描述**：数据库配置是对象，manifest 直接 `String()`，报告里出现 `"[object Object]"`。
- **复现步骤**：导出任意带后端项目 → 打开 `artifact-manifest.json` → 查看 `backend.database`。
- **影响**：构建报告/自动化读取错误，无法判断数据库引擎。
- **严重度**：P2。
- **根因文件**：[shared/export-bundle.js](file:///c:/project/docs/lowcode/shared/export-bundle.js)（`normalizeBackend`）。
- **修复与验证**：按 `driver/type/engine/name` 取可读值；无后端时固定 `none`。18 组 manifest 全部正确显示 `sqlite` 或 `none`。

### 4.8 HTML 压缩会粘连内联文本

- **问题描述**：压缩规则删除所有标签间空白，`<span>a</span> <span>b</span>` 会被压成 `a` 与 `b` 粘连；`<pre>` 内容也可能被误伤。
- **复现步骤**：准备含内联标签和空格的页面 → `minify: true` 导出 → 对比原文，空格消失。
- **影响**：开启压缩时正文语义/排版被破坏。
- **严重度**：P2。
- **根因文件**：[shared/export-minify.js](file:///c:/project/docs/lowcode/shared/export-minify.js)；[src/render/export.js](file:///c:/project/docs/lowcode/src/render/export.js)。
- **修复与验证**：只删除块级标签两侧空白，并保护 `pre` / `textarea`。单测确认内联空格与 `pre` 缩进保留；压缩仍生效（页面 HTML 约 149,794 → 132,832 字节）。

### 4.9 `deploy.tls.domain` 在 manifest 中丢失

- **问题描述**：清单的 TLS 段没有域名；同时 TLS 未启用时 `source` 仍写成 `generated-or-imported`。
- **复现步骤**：导出后查看 `artifact-manifest.json` 的 `deploy.tls`。
- **影响**：部署信息不完整，容易误判已有证书。
- **严重度**：P3。
- **根因文件**：[shared/export-bundle.js](file:///c:/project/docs/lowcode/shared/export-bundle.js)；[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)。
- **修复与验证**：清单写入 `tls.domain`；未启用时 `source` 为 `none`。

### 4.10 向导保存阶段不校验 Tauri 配置

- **问题描述**：`PUT /api/sites/:id/export/config` 直接保存 `tauri`，非法标识符/版本/协议/未知字段要等到最终导出才报错。
- **复现步骤**：向导第二步保存 `identifier: "com.example bad"` → 保存成功 → 最后导出失败。
- **影响**：错误发现太晚，用户需要回到上一步；未知字段（如 `locale`）也会延迟到导出才失败。
- **严重度**：P2。
- **根因文件**：[server/src/routes/export-config.js](file:///c:/project/docs/lowcode/server/src/routes/export-config.js)。
- **修复与验证**：保存阶段校验应用名、反向域名标识符、semver 版本、协议、HTTPS 模式与未知字段。验证：非法标识符 PUT 返回 422 `LC_E_CONFIG`；正常导出矩阵不受影响。

## 五、追加修复（原遗留四项）

### 5.1 `buildKeepPerTarget` 未生效，构建记录无限累积

- **问题描述**：同一站点连续导出时 `data/sites/<id>/builds` 只增不减，配置项形同虚设。
- **复现步骤**：同一站点导出两次；`builds` 下出现两个构建目录，旧目录不清理。
- **影响**：磁盘和构建列表无限增长；旧产物可能包含敏感数据，长期堆积。
- **严重度**：P2。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)；[server/src/config.js](file:///c:/project/docs/lowcode/server/src/config.js)。
- **修复与验证**：按导出目标保留最近 N 份（`storage.buildKeepPerTarget` 自动进入 `paths`）。超出的旧构建整体移入 `builds/.trash/<buildId>`，保留 `build.json` 与 `artifact.zip`，可随时移回恢复；清理前先写 `builds/.cleanup-log.json`，当前构建和每个目标最近一次成功构建永不清理。实测 `N=1` 连续导出两次：`builds/` 仅保留最新一份，旧构建出现在 `.trash/`，`build.json` 的 `cleanup` 与清理日志都记录了归档路径。

### 5.2 `protocol: "http"` 与证书模式互相矛盾

- **问题描述**：选 `http` 同时又把 `https.mode` 设为 `generated/imported` 时，导出仍成功，产物保留证书模式但永远不会使用。
- **复现步骤**：Tauri 导出传 `desktop: { protocol: "http", https: { mode: "generated" } }`；`desktop.json` 仍为 `generated`，`tauri.conf.json` 的 `useHttpsScheme` 为 `false`。
- **影响**：用户误以为已配置 TLS；导出报告也可能提示证书相关内容，排查成本高。
- **严重度**：P3。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)；[templates/tauri/scripts/validate-config.mjs](file:///c:/project/docs/lowcode/templates/tauri/scripts/validate-config.mjs)；[export.html](file:///c:/project/docs/lowcode/export.html)；[assets/export.js](file:///c:/project/docs/lowcode/assets/export.js)。
- **修复与验证**：导出时 `protocol: http` 会把 `https.mode` 归一为 `none`，并产生 `LC_W_TAURI_HTTPS_IGNORED` 说明改成 https 的方式；模板 `validate-config` 对任意交付模式下的该组合给出警告；向导选 http 时禁用证书模式并显示提示。实测导出包 `desktop.json` 的 `https.mode` 为 `none`，无证书文件，`useHttpsScheme` 为 `false`。

### 5.3 部分页面导出时导航指向未导出页面

- **问题描述**：`scope: selected` 只选首页时，导航/页脚/正文仍链接到未导出页面，产物出现死链。
- **复现步骤**：站点含首页、关于、联系、孤页四个页面，导航引用前三页；只选首页导出后打开产物，点击“关于/联系”出现 404。
- **影响**：导出的站点存在死链，影响交付质量。
- **严重度**：P3。
- **根因文件**：[server/src/export/pipeline.js](file:///c:/project/docs/lowcode/server/src/export/pipeline.js)（页面范围筛选）。
- **修复与验证**：导出前扫描外壳和已选页面的 `pageId`/`href`，把被引用的站内页面自动补入范围并迭代到闭包；产生 `LC_W_SCOPE_EXPANDED` 记录补入了哪些页面。实测只选首页导出：产物包含首页、关于、联系，未删除仍无引用的孤页；导航三条链接全部可打开。

### 5.4 `sanitizeBackend` 静默丢弃未暴露字段

- **问题描述**：`sanitizeBackend` 只重建少量白名单字段，`database.file`、`maxOpenConns`、`connectTimeoutSeconds`、`customMiddleware`、`environment` 等字段在保存/读取链路中被吃掉。
- **复现步骤**：`PUT /api/sites/:id/export/config` 传 `backend.database.file` 与自定义中间件，随后 `GET` 配置，字段消失。
- **影响**：API 调用方无法持久化自定义 SQLite 路径和中间件配置；排查时误以为产品不支持。
- **严重度**：P3。
- **根因文件**：[server/src/routes/export-config.js](file:///c:/project/docs/lowcode/server/src/routes/export-config.js)。
- **修复与验证**：保留所有非密钥字段，并显式归一 `database.file`、连接池与超时字段；递归剥离密码/Token 类字段，中间件 `{ key, value }` 字段命中密钥名时只保留结构、值置空。实测 `database.file`、`maxOpenConns`、`connectTimeoutSeconds`、`environment`、`customMiddleware` 均保留，`password`/`token` 值未回显。

### 5.5 导出配置异步到达时无声覆盖用户输入

- **问题描述**：向导打开后 `GET /export/config` 异步返回，用户在配置到达前开始填写（缓存回填或快速操作），默认值返回时直接写回表单，已填内容被无声覆盖，用户无法察觉丢失。
- **复现步骤**：人为把 `/api/sites/:id/export/config` 延迟 2 秒 → 打开导出向导 → 在加载期间修改“站点域名” → 配置返回后字段变回默认域名，且无任何提示。
- **影响**：用户以为已经填好，实际导出用的是被覆盖后的默认值，属于静默数据丢失。
- **严重度**：P2。
- **根因文件**：[assets/export.js](file:///c:/project/docs/lowcode/assets/export.js)；[export.html](file:///c:/project/docs/lowcode/export.html)；[assets/css/lc-wizard.css](file:///c:/project/docs/lowcode/assets/css/lc-wizard.css)。
- **修复与验证**：
  - 门闩：初始与切站都先进入 `configLoading`，配置字段全部禁用并压暗，显示“正在加载项目配置，字段暂不可编辑”；“估算/开始导出/下一步/保存配置”同步禁用，只有加载成功后才解锁。
  - 输入保留：在加载期间捕获配置字段的 `input`/`change` 快照，配置返回时先写默认值再恢复用户值，并显示“已保留你在加载期间的输入”，不会静默覆盖。
  - 切站：`loadSite` 递增请求序号防旧响应回写；切换站点立即清空表单、清掉上一次的保留快照并重新加锁，避免旧站点值残留。
  - 失败：配置拉取失败时保持禁用并给出错误提示，不会放开一张半填充的表单。
  - 慢速验证（真实 Fastify + 2 秒延迟 + Edge）：加载中提示可见，字段与按钮禁用；加载期间输入的 `typed-during-load` 在配置到达后仍保留，保留提示可见；切站瞬间字段被清空且禁用，切站完成后为目标站点的 `https://b.example.com`、`/b`、`3.0.0`、`B 应用`，旧输入提示隐藏。
- **设计说明**：该行为已写入 [docs/manual/09-export.md](file:///c:/project/docs/lowcode/docs/manual/09-export.md)，“配置加载完成前不可编辑”是刻意的防覆盖设计，不是控件损坏。

## 六、行为边界与澄清

- **纯静态项目选后端**：文档明确允许静态项目临时选择后端导出（本次第 17 组验证通过），不属于拦截缺失。
- **Tauri 证书**：导入证书的私钥不会进入导出包，构建机需要另行提供证书与私钥；导出只落盘 HTTPS 模式与主机/端口。协议为 `http` 时证书模式统一归为 `none`，不会留下“配了证书但没使用”的假配置。
- **Tauri `desktop/web` 与包根 `web`**：为保证 `desktop/` 可独立构建，导出会在 `desktop/web` 保留一份前端副本；包根 `web/` 继续用于 Web 预览/部署。zip 中两份内容会重复，压缩后体积增加有限。
- **Mermaid 体积警告**：`vendor/mermaid.min.js` 约 5.5 MB，导出触发 `LC_W_ASSET_BYTES` 属于预期提示，不是资源缺失。
- **`locale` 校验失败**：此前出现过一次 `desktop/config/desktop.json` 报“不认识的字段 locale”，本次多轮隔离复测未复现；保存阶段现在会直接拒绝未知字段，避免该字段再进入配置。
- **`LC_W_TEMPLATE_COLLISION`**：Tauri 导出会覆盖模板中的 `config/desktop.json`、`tauri.conf.json`、`desktop.runtime.json`、`web/desktop-config.js`，属于设计内覆盖，不是文件冲突错误。

## 七、关键验证数据

- manifest 一致性：18/18 导出目录通过；`backend.database` 均为 `sqlite` 或 `none`；`deploy.tls.domain` 已落盘。
- 压缩开关：CSS 75,097 → 66,120 字节；页面 HTML 149,794 → 132,832 字节；不压缩导出源码可读。
- 仅前缀部署：浏览器网络记录 `GET /docs/api/items?event=click` 200，表格回填“前缀接口命中”。
- 桌面接口：页面 `window.LC_PUBLIC_BASE_URL = http://127.0.0.1:9840`，`window.__LC_DESKTOP__.appName` 正确；导出后端加载生成配置后 `/api/items?event=click` 返回 200。
- 构建保留：`buildKeepPerTarget=1` 连续导出两次后，`builds/` 只剩最新构建，旧构建完整位于 `builds/.trash/`，`.cleanup-log.json` 与当前 `build.json.cleanup` 均记录归档路径。
- 部分导出：只选首页时自动补入导航引用的“关于/联系”，孤立页面仍排除；产物中三条导航链接均可打开。
- http + 证书：`desktop/config/desktop.json` 的 `https.mode` 为 `none`，`tauri.conf.json` 的 `useHttpsScheme` 为 `false`，输出 `LC_W_TAURI_HTTPS_IGNORED`。
- 后端字段：`database.file`、`maxOpenConns`、`connectTimeoutSeconds`、`environment`、`customMiddleware` 保存后仍可读取，`password`/`token` 值未回显。
- 配置时序：`/export/config` 延迟 2 秒时，加载中提示可见、字段与保存按钮禁用；加载期间输入在配置到达后保留；切站后字段为目标站点值，无旧值残留。
- 桌面 CORS：`Origin: https://tauri.localhost` 请求返回对应 `Access-Control-Allow-Origin`；非白名单来源不放行。
- 编译：Go 后端 `go build` 成功；Rust 后端 `cargo check` 成功；Tauri 工程 `cargo check` 成功，`validate-config` 无错误警告。
- 离线/自包含：静态产物未发现外部 CDN、`http(s)` 外链、外部字体；Mermaid 按引用打包并在浏览器渲染为 SVG；主题亮/暗 CSS 令牌均存在。

## 八、清理记录

- 审计使用的隔离平台副本、临时站点、临时导出目录、临时后端运行目录均位于 `.tmp-audit` / `lowcode/.tmp-*`，已停止相关服务并删除。
- 未修改 `lowcode/data` 下既有站点与构建产物，未覆盖任何既有导出 zip。
- 代码改动仅限导出管线、产物运行时、模板配置校验与导出路由。
