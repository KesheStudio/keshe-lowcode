# 数据、接口与持久化专项审计（2026-11-08）

## 1. 审计范围与执行方式

- 对象：`lowcode` 的集合/行数据、导入导出、自定义接口、版本/备份/回收站、站点迁移、数据页界面。
- 所有结论均通过实际请求或浏览器操作触发，不是只读代码推断。
- 运行环境：每一轮都在 `%TEMP%` 下新建独立数据目录，使用临时站点；没有读写既有 `data/` 站点。
- 数据库：本项目是文件存储（JSON + 原子写 + 站点锁），本轮没有 SQLite 需求；全程未连接本机 3306 / 6379 / 5432，也未向这些端口发起连接。接口红线测试使用的是"重定向到 3306 但在建立连接前拦截"的本地回环服务。
- 清理：测试站点、临时目录、临时 Junction 均已删除；`node_modules` 已确认完整。
- 复现脚本保留在 `.tmp/audit-data-20261108/`（`probe.mjs`、`ui-probe.mjs`、`runtime-probe.mjs`、`migrate-probe.mjs`），可独立重跑。

验证规模：

| 套件 | 结果 |
| --- | --- |
| 接口/数据探针（63 项） | 63 PASS / 0 FAIL |
| 数据页浏览器并发探针（6 项） | 6 PASS |
| 生成产物浏览器运行时探针（3 项） | 3 PASS |
| 迁移隔离探针（5 项） | 5 PASS |
| 仓库单测 `npm test` | 65 PASS / 0 FAIL |

---

## 2. 已定位并直接修复的问题

### D-01【高】两个标签页并发写集合，后写静默覆盖先写

- 现象：两个标签页从同一 `rev` 出发新增行，两次请求都返回 201；先写入的行被后写入的整体文件覆盖，界面无任何冲突提示。
- 复现：GET 集合拿到 `rev` → 两个标签页同时 `POST /data/collections/products/rows`（都带同一 `expectedRev`）→ 旧实现两次都成功，最终只保留一行。
- 影响：同一资源并发编辑丢数据，且用户无感知。
- 根因：`server/src/routes/data.js` 的集合/行/示例/导入/接口写入都不接收 `expectedRev`；`assets/data.js` 也不保存 rev。存储层本身支持 `expectedRev`，路由层没有传。
- 修复：
  - 集合详情与行列表返回 `rev`。
  - 集合、行、示例、导入、数据源的新增/修改/删除写入都把 `expectedRev` 透传给 `adapter.write/delete`。
  - 数据页保存集合/行/导入/示例/接口时携带 `state.rev` / `state.sourcesRev`。
  - 收到 `LC_E_REV_CONFLICT` 时提示"数据已被其它标签页修改，已刷新到最新内容，请重新编辑"，并重新加载当前集合。
- 验证：`D1/D2`（API：一个 201、一个 409、只落一行）、`F16`（数据源并发改名 200/409）、`U4/U5`（页面出现冲突提示并自动刷新出对方写入的行）。

### D-02【高】`POST` 行允许客户端指定已存在或同批重复的行 ID，产生重复主键

- 现象：提交 `{row:{id: 已存在的 id, ...}}` 返回 201；同一批两行使用相同 id 也返回 201，集合里出现两行同 ID。
- 影响：按行 ID 更新/删除只命中第一行，行身份失效，后续导入/绑定的行为不可预期。
- 根因：`server/src/data/model.js` 的 `prepareRows` 接受合法格式的客户端 id，但唯一性检查会跳过"与当前 rowId 相同"的行；`POST /rows` 也没有对已有 ID 做前置检查。
- 修复：`prepareRows` 检测同批重复 ID；`POST /rows` 在写入前拒绝与集合现有行重复的 ID，统一返回 409 `LC_E_DATA_ROW_ID_CONFLICT`。
- 验证：`B10`、`B11`、`B12`（行 ID 无重复）。

### D-03【高】覆盖导入只映射部分列时，未映射字段被清空

- 现象：集合已有 `status=停售`、`active=false`，导入只映射 `name,price` 并选"覆盖"，更新后 `status` 变成默认值，其它未映射字段同样被重置。
- 影响：一次局部更新会静默破坏历史数据，且导入结果仍显示成功。
- 根因：`server/src/data/import.js` 覆盖分支用 `Object.assign({id}, normalized)` 整行替换，而 `normalized` 会为未映射字段补默认值。
- 修复：只把本次明确映射的列写回目标行，未映射列保留原值。
- 验证：`E2b`（独立集合，覆盖后 `status`/`active` 保持不变）。

### D-04【中】覆盖导入的唯一性检查可被真实 `pending` 行 ID 绕过

- 现象：唯一性预检把哨兵行 ID 固定为 `pending`，如果集合里恰好有 `id=pending` 的真实行，检查会跳过它。
- 影响：可能把与真实行冲突的值写进集合。
- 根因：`server/src/data/import.js` 用固定字符串作为临时 rowId。
- 修复：预检不再传入可命中的 rowId。
- 验证：`E8`（追加模式重复唯一值正确跳过并计数）及单测覆盖。

### D-05【中】日期字段接受日历溢出值（如 `2026-02-30`）

- 现象：`2026-02-30` 被 `Date.parse` 静默归一成 3 月 2 日并保存成功，用户看到的是自己没输入的日期。
- 影响：报表/筛选按日期统计失真。
- 根因：`server/src/data/model.js` 只判断 `Date.parse` 是否可解析。
- 修复：对 `YYYY-MM-DD` 前缀做 UTC 日历回读校验，拒绝不存在的日期。
- 验证：`B6`（返回 409）。

### D-06【中】重复字段 ID 被静默改名，引用会悄悄指向另一个字段

- 现象：同一集合提交两个 `id=same` 的字段，第二个被改名为 `same_2`，接口返回 201；调用方以为引用仍是 `same`。
- 影响：页面/组件/导入映射可能绑定到错误字段，且无提示。
- 根因：`server/src/data/model.js` 的 `normalizeFields` 只做去重，不拒绝重复显式 ID。
- 修复：显式字段 ID 重复时返回 409 `LC_E_DATA_FIELD_ID_CONFLICT`。
- 验证：`B13`。

### D-07【高 / 安全】自定义接口重定向可绕过数据库端口红线，也可能把密钥发往其它主机

- 现象：直接请求 `http://127.0.0.1:3306/` 会被 422 拦截；但让本地回环接口 302 跳到 `http://127.0.0.1:3306/`，旧实现会跟随重定向继续发起连接。跨主机重定向也会把 `Authorization` 密钥带到新主机。
- 影响：红线端口可被间接探测；密钥可能外泄。
- 根因：`server/src/data/sources.js` 使用 `fetch(..., {redirect:'follow'})`，只在初始 URL 做端口校验。
- 修复：改为 `redirect:'manual'` 逐跳处理；每一跳重新做协议/端口校验；只允许同主机重定向；拒绝 HTTPS→HTTP 降级；最多 5 跳；跨主机与超跳返回 422。
- 验证：`F11`（直连 3306 拦截，未发起连接）、`F13`（重定向到 3306 在连接前 422）、`F14`（跨主机 422）、`F12`（同主机重定向正常）。

### D-08【高】浏览器运行时无法解析 `registerDataSource` 注册的数据源

- 现象：组件通过 `LC.Render.registerDataSource('demo', ...)` 注册后，图表一直不取数；未注册数据源反而正常显示空态。
- 影响：自定义接口/数据源与组件绑定的取数在导出后的浏览器端完全失效。
- 根因：`src/render/runtime.js` 用 `render.dataSources.get(name)` 读取，但 `datasource.js` 把 `dataSources` 暴露成普通对象，没有 `get`。
- 修复：优先调用 `render.resolveDataSource(name)`，其次按对象属性读取。
- 验证：`R1`（生成运行时中注册数据源后图表 `data-lc-state=ready` 且绘制 SVG）、`R2`、`R3`。

### D-09【中】非法 JSON 请求体把 Fastify 解析器异常原样返回

- 现象：`POST` 带 `{"name":` 返回 `Unexpected end of JSON input` 一类内部错误文本。
- 影响：错误话术泄露内部实现细节，用户也无法据此修复。
- 根因：`server/src/http.js` 错误处理只识别业务错误与校验错误，解析器错误落到通用分支。
- 修复：识别 `FST_ERR_CTP_INVALID_JSON_BODY` / `BODY_TOO_LARGE` / `INVALID_MEDIA_TYPE`，返回中文业务话术。
- 验证：`H1`。

### D-10【中】423 站点锁错误回传 PID、主机名与锁令牌

- 现象：手动持有站点锁后写入，423 响应 `detail` 含 `pid`、`host`、`token`。
- 影响：错误详情泄露进程内部信息。
- 根因：`src/storage/errors.js` 把整个 lock holder 放进 detail。
- 修复：只保留 `acquiredAt`。
- 验证：`H3`。

### D-11【低】导入 JSON 解析失败泄露解析器内部报错

- 修复：统一为"JSON 解析失败：请检查是否有多余逗号、缺失引号或未闭合的括号"。
- 验证：`E4`。

### D-12【中】超大导入先整段解析、后判上限

- 现象：5MB 以上文本会先进入 JSON/CSV 解析，再被拒绝；64MB 请求体上限内可造成明显内存峰值。
- 根因：`server/src/data/import.js` 的 `buildPreview` / `runImport` 顺序是"解析 → 校验"。
- 修复：解析前先做字节上限校验。
- 验证：`E6`、`E7`（20001 行返回 422）。

### D-13【严重】迁移从不复制 `project.json`，每次导入都会校验失败；`--force` 还会先删旧站点

- 现象：隔离迁移首次导入就报 `project 缺失`；由于删除旧站点的动作在复制/校验之前，`--force` 会先毁掉目标站点再失败。
- 影响：迁移不可用，强覆盖场景可能直接丢站点。
- 根因：`scripts/migrate.mjs` 的 `importOne` 只写 `site.json`，未复制 `project.json`；来源完整性检查在破坏性操作之后。
- 修复：导入前先校验来源 `project.json` 与页面目录；导入时复制 `project.json`。
- 验证：`M1`、`M2`、`M3`、`M5`。

### D-14【严重】迁移备份排除 `data/files`，强覆盖会永久丢上传文件

- 现象：`--force` 前生成的备份里没有上传目录；覆盖时 `data` 被整体删除，上传文件无法找回。
- 根因：`scripts/migrate.mjs` 的 `SOURCE_EXCLUDE` 把 `data/files` 当成可丢弃内容。
- 修复：备份包含 `data/files`。
- 验证：`M4`（备份中可读回旧上传文件与旧集合）。

### D-15【中】迁移校验只比页面/资源数量，集合与上传损坏也能通过

- 修复：站点计数增加 `collections` / `uploads`，校验与预览一并展示；为兼容既有站点，指纹仍只使用原有五项计数。
- 验证：`M2`、`M4`、`M5`。

---

## 3. 数据安全加固（本轮追加，R-01~R-04 已落地）

### R-01【中→已修复】站点回收站恢复入口

- 接口：`GET /api/sites/trash` 列出 `.trash` 条目（站点 ID、名称、删除时间、页面数、同名冲突信息）；`POST /api/sites/trash/:trashId/restore` 支持 `mode=rename|overwrite`。
- 行为：无冲突时恢复回原 `siteId`；同名冲突返回 `409 LC_E_SITE_EXISTS`，必须显式选择改名（自动分配 `-restored` 或指定新 ID）或覆盖；覆盖前把现有站点整体移入 `.trash`（`...-replaced`），不静默删除；改名时同步更新 `site.json` 的 `siteId` 与 `slug`。
- UI：首页新增回收站列表、恢复按钮、同名冲突的"改名恢复 / 覆盖同名站点"选择，以及站点卡片的"删除"入口。
- 根因文件：`server/src/routes/sites.js`、`assets/home.js`、`home.html`、`assets/css/lc-home.css`。
- 验证：`tests/feature-safety.test.mjs`（回收站用例）、UI 探针 `U1`–`U4`。

### R-02【中→已修复】备份一键恢复

- 接口：`GET /api/sites/:siteId/backups` 列表、`GET .../backups/:name` 范围预览、`POST .../backups/:name/restore`。
- 行为：恢复前逐个校验 manifest hash；生成 `pre-restore-*` 安全备份且不参与保留清理；整站事务写回；写入失败自动从安全备份回退并删除本次新增文件；恢复后强制 `site.json` 的 `siteId` 与当前目录一致。
- 范围提示：恢复前列出"覆盖 X 个现有文件（其中 Y 个内容不同）、新增 Z 个；不删除备份之外的文件"。
- UI：首页站点卡片"备份"入口，支持立即备份、查看列表、二次确认后恢复。
- 根因文件：`server/src/routes/backups.js`、`src/storage/backups.js`、`assets/home.js`、`home.html`。
- 验证：`tests/feature-safety.test.mjs`（备份用例：正常恢复、安全备份、损坏备份拒绝、写入失败自动退回）、UI 探针 `U5`–`U6`。

### R-03【低→已修复】数据页分页与排序

- 服务端：行列表接受 `sort`（字段 ID 或 `id`）与 `order=asc|desc`，未知排序字段返回 `400 LC_E_DATA_SORT_FIELD`；分页、搜索、排序可组合，空值固定排最后。
- 数据页：默认每页 100 行，支持上一页/下一页、50/100/200/500 切换、点击表头切换升降序；翻页、排序变化时保留搜索条件，切换集合才重置到第一页。
- 根因文件：`server/src/routes/data.js`、`assets/data.js`、`data.html`、`assets/css/lc-data.css`。
- 验证：`tests/feature-safety.test.mjs`（排序/分页/筛选用例）、UI 探针 `U7`–`U12`。

### R-04【低→已修复】迁移失败自动回滚

- 行为：`--force` 覆盖导入在备份成功后开始破坏目标；任一复制/写入/校验步骤失败，自动从 `pre-import` 备份恢复；新建站点失败则删除半截目录；迁移前已有空目录则清空本次写入；已存在的 `builds` / `versions` / `trash` / `certs` / `.lowcode` 不受回滚影响；回滚结果会打印在失败信息里。
- 根因文件：`scripts/migrate.mjs`。
- 验证：隔离迁移探针 `M6`（来源 `pages` 变成文件触发 `ENOTDIR`，回滚后站点内容与迁移前逐文件一致）。

---

## 4. 已确认正常的关键行为（便于回归）

- 字段类型/必填/枚举/JSON/数字校验返回 409；唯一字段与唯一组合索引冲突返回 409（`B3`–`B9`）。
- 分页 `limit` 上限 500、`offset` 生效、`q` 过滤与 `total` 一致（`C1`–`C5`）。
- 导入：5MB/2 万行上限、重复唯一值跳过计数、带 BOM 的 CSV 表头、非法 JSON 话术（`E1`–`E10`）。
- 自定义接口：密钥不回显、已存密钥可用于连接测试、空结果成功、500/非 JSON/超时/401 分类正确、查询密钥回显掩码（`F1`–`F15`）。
- 版本快照：写入产生版本、详情可读、过期 `expectedRev` 恢复返回 409、恢复成功并生成备份（`G1`–`G5`）。
- 删除集合生成可读备份，集合文件确实在备份内（`G8`/`G9`）。
- 站点删除进入 `.trash`，目录可读（`I1`/`I2`）。
- 路径穿越被拒且错误话术不含绝对路径（`H2`）。

---

## 5. 回归方式

```powershell
cd lowcode
node .tmp/audit-data-20261108/probe.mjs
node .tmp/audit-data-20261108/ui-probe.mjs
node .tmp/audit-data-20261108/runtime-probe.mjs
node .tmp/audit-data-20261108/migrate-probe.mjs
npm test
```

四个探针都会自建临时站点/临时平台根，退出时删除；不会触碰既有站点数据。
