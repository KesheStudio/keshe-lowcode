# 本地内置后端（Tauri sidecar）

把后端二进制随桌面应用一起分发，启动时由外壳拉起，前端通过 `http://127.0.0.1:<随机端口>` 访问。适用于「离线可用 / 单机工具 / 不想让用户自己装服务」的场景。

默认关闭：`config/desktop.json` 的 `sidecar.enabled=false`。关闭时不会声明 `externalBin`，也不打开 `withGlobalTauri`，行为与之前完全一致。

## 链路

```text
config/desktop.json
  └─ scripts/render-config.mjs
       ├─ src-tauri/tauri.conf.json       bundle.externalBin + CSP + app.withGlobalTauri
       ├─ src-tauri/desktop.runtime.json  sidecar 行为开关（Rust 运行时读）
       └─ web/desktop-config.js           前端可见开关（window.__LC_DESKTOP__）

scripts/build-sidecar.mjs
  └─ src-tauri/binaries/<name>-<target triple>[.exe]   （Tauri 要求的文件名）

启动：应用 → 复制默认后端配置 → 检查密码 → 挑端口 → 起 sidecar → /health 探测
    → 事件 lc:backend-ready（带 http://127.0.0.1:<port>）→ 前端拿地址
退出：RunEvent::Exit → kill + wait；被强杀时 sidecar 的 stdin 看门狗读到 EOF 自行退出
```

## 配置字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `sidecar.enabled` | `false` | 总开关；开启后渲染器才写 `externalBin`、`withGlobalTauri`、回环通配 CSP |
| `sidecar.name` | `lc-sidecar` | 二进制名，不带路径与 `.exe`；源文件名必须为 `<name>-<target triple>[.exe]` |
| `sidecar.args` | `[]` | 额外参数；**端口、配置路径由外壳注入，不要写死在这里** |
| `sidecar.readinessPath` | `/health` | 就绪探测路径；返回 200 即视为就绪 |
| `sidecar.readinessTimeoutMs` | `10000` | 1000–60000；超时后杀进程并显示失败页 |
| `sidecar.versionCheck` | `true` | 启动前跑 `<sidecar> --version`，与应用 `version` 比对 |
| `sidecar.env` | `{}` | 非敏感环境变量；键名命中 `pass/pwd/secret/token/credential/private/api_key/dsn` 会直接报 `E_SECRET_IN_CONFIG` |

校验规则（`npm run validate`）：

- `sidecar.enabled=true` 时，`src-tauri/binaries/` 下必须已有 `<name>-*` 文件，否则 `E_SIDECAR_BINARY`；
- 开启版本校验会提示：sidecar 必须实现 `--version` 且与应用版本一致；
- 同时开 `backend.enabled` 只警告，不报错（本地 sidecar + 外部服务一般只留一个）。

## 打包与构建步骤

```bash
<!-- lc:lang:go -->
npm run sidecar:build -- --go examples/sidecar-go      # Go：直接构建
<!-- /lc:lang:go -->
# 或把已有单文件二进制复制进来：
npm run sidecar:build -- --from /path/to/backend
npm run validate
npm run render
npm run build
```

`build-sidecar.mjs` 会：

1. 用 `rustc -vV` 的 `host:` 取目标三元组；
2. 把产物写到 `src-tauri/binaries/<name>-<triple>[.exe]`；
3. 跑一次 `<dest> --version`，与 `desktop.json` 的 `version` 比对，不一致直接退出码 1（排障可用 `--allow-version-mismatch`，不建议）。

<!-- lc:lang:go -->
Go 构建命令等价于：

```bash
go build -trimpath -ldflags "-s -w -X main.version=0.1.0" -o <dest> .
```
<!-- /lc:lang:go -->

`src-tauri/binaries/` 已加入 `.gitignore`：二进制不进仓库，构建时生成。

## 端口冲突

- Rust 侧 `TcpListener::bind("127.0.0.1:0")` 拿系统分配的空闲端口，读取后立刻释放，再把端口通过 `--port` 与 `LC_BACKEND_PORT` 传给 sidecar；
- sidecar 收到非 0 端口后 **绑定失败必须直接退出**（示例里退出码 3），不能偷偷换成随机端口——外壳已按旧端口拼好了地址，偷偷换端口会让前端连到一个不存在的地方；外壳会显示可读的失败页并允许重试；
- CSP 只能放开 `http://127.0.0.1:* http://localhost:*`（端口运行时才知道，写死会让「自动挑端口」失效）；
- 前端实际地址来自 `sidecar_status` / `lc:backend-ready` 的 `backendUrl`，同时写回 `window.__LC_DESKTOP__.backendUrl`。

前端契约（`web/index.html` 里的占位实现即参考）：

| 入口 | 说明 |
|---|---|
| `invoke('sidecar_status')` | 返回 `{state, backendUrl, version, needsPassword, message}`；`state`: `idle/starting/ready/error/setup-required` |
| `invoke('submit_backend_password', { password })` | 首次启动写入本机凭据并拉起后端 |
| `invoke('restart_sidecar')` | 失败后重试 |
| 事件 `lc:backend-ready` / `lc:backend-error` / `lc:backend-setup-required` / `lc:backend-starting` | 比轮询快；事件可能早于页面加载，所以页面启动时还要主动查一次 |

拿不到地址时的表现：`error` 状态显示具体原因（找不到二进制 / 版本不一致 / 端口被占 / 提前退出 / 健康检查超时），并提供「重试启动」；页面自己还有一层 `readinessTimeoutMs + 4s` 的兜底，防止 IPC 不通时永远停在「启动中」。

## 配置与密钥（硬要求）

- 随包的 `config/backend.template.json` **不含任何密码**，只有 host/port/db/user 与 `passwordEnv`；
- 首次启动时把它复制到应用配置目录（`app_config_dir()/backend.json`）；
- 若后端配置声明了 `database.passwordEnv`，而环境和本机凭据都没有密码，**不启动后端**，前端显示密码引导；用户提交后写入 `app_config_dir()/secrets.json`，再以环境变量交给子进程；
- Unix 上 `secrets.json` 权限 `0600`；Windows 依赖用户目录 ACL（未额外加密，也未接入系统凭据库）；
- 密码只出现在子进程环境变量里，不进命令行参数、不写日志、不进安装包；
- `sidecar.env` 与 `desktop.json` 都受 validator 的密钥键名拦截，防止「把密码写进会随包分发的文件」。

如实说明：本模板实现的是**首次启动引导 + 本机文件**，不是系统凭据库。要接系统凭据库，需要另加平台 API 或 `keyring` 类依赖，本模板未做，也未在本机验证。

## 版本一致性

两处校验，避免「前端更新了、后端还是旧的」：

1. **构建期**：`build-sidecar.mjs` 比对 `<sidecar> --version` 与 `desktop.json.version`，不一致构建失败；
2. **启动期**：`versionCheck=true` 时，Rust 先跑 `--version` 再比对 `desktop.runtime.json.version`，不一致拒绝启动并显示错误。

后端版本由构建脚本注入<!-- lc:lang:go -->（Go 示例用 `-ldflags "-X main.version=<version>"`）<!-- /lc:lang:go -->，不要手改。

## 分语言可行性

| 语言 | 形态 | 体积（量级） | 结论 | 失败时的表现 |
|---|---|---|---|---|
| **Rust** | 单文件二进制 | 几 MB 起 | **推荐**。与外壳同一工具链，静态链接可控（MSVC 默认依赖 VC 运行时，必要时 `-C target-feature=+crt-static`） | 起不来时进程直接退出，外壳显示退出码 |
<!-- lc:lang:go -->
| **Go** | 单文件二进制（纯标准库） | 示例实测 **6701.0 KiB** | **推荐**。CGO 关掉后无系统依赖，启动快；本机已走通完整链路 | 同上；端口绑定失败退出码 3 |
<!-- /lc:lang:go -->
| **Node** | 单可执行文件（Node SEA） | 本机实测：SEA 可执行文件 **89.4 MB**，NSIS 安装包 **24.2 MiB**（含 Node 本体） | 可行但代价大。方案：Node SEA（`--experimental-sea-config` + 复制 node 可执行文件 + `postject` 注入 blob），或用 `bun build --compile`；`pkg` 已停止维护、且会把代码解压到临时目录。**本机已用 SEA 走通：构建单文件 → externalBin → NSIS 安装包 → 应用内启动 → 健康检查 → 退出无孤儿**。局限：Node 运行时随包分发、体积约为<!-- lc:lang:go --> Go 的 6 倍<!-- /lc:lang:go -->；原生模块（`.node`）必须静态化；Windows 上注入会破坏原 node.exe 的签名（未做代码签名时无影响） | SEA：注入步骤失败则产物起不来；`pkg` 解压目录被杀软拦截或只读时启动失败；外壳侧只会看到「提前退出」或「健康检查超时」 |

Node 的体积为公开经验值，随版本浮动；本机实测了<!-- lc:lang:go --> Go 与<!-- /lc:lang:go --> Node SEA。若后端已有现成服务且必须带运行时，优先考虑改成<!-- lc:lang:go --> Go/<!-- /lc:lang:go -->Rust，或接受体积后选 Node SEA。

## 排错

| 现象 | 先查 |
|---|---|
| `E_SIDECAR_BINARY` | 没执行 `npm run sidecar:build`；或文件名不是 `<name>-<triple>[.exe]` |
| 启动即 `error`，提示找不到二进制 | 打包后应位于应用可执行文件同目录；开发时 `tauri-build` 会复制到 target 目录，直接 `cargo run` 则回退到 `src-tauri/binaries/` |
| 退出码 3 | 端口在挑好之后被别的进程抢占；点重试，或查谁在频繁占用端口 |
| 版本不一致 | 用当前 `desktop.json.version` 重新 `sidecar:build` |
| 页面提示没有 `window.__TAURI__` | 渲染产物没打开 `withGlobalTauri`（`sidecar.enabled` 与 `update.active` 都为 false 时不会打开），或页面是在浏览器里直开 |
| 前端请求被 CSP 拦 | 确认 `connect-src` 里有 `http://127.0.0.1:* http://localhost:*`，并重新 `render` |
| 关应用后还有 `lc-sidecar` 进程 | 正常退出应已 kill；强杀场景靠 stdin EOF 看门狗。若仍有，检查后端是否自己 fork 了子进程（看门狗只能管直接子进程） |

<!-- lc:export-hide -->
## 本机验证记录（2026-11-08，Windows x64）

已完成：

<!-- lc:lang:go -->
- `node scripts/build-sidecar.mjs --go examples/sidecar-go` → `x86_64-pc-windows-msvc`，6701.0 KiB，`--version` 输出 `0.1.0` 与应用一致；
<!-- /lc:lang:go -->
- 临时把 `sidecar.enabled` 置 `true` 后 `render`，`tauri.conf.json` 含 `externalBin: ["binaries/lc-sidecar"]`、`withGlobalTauri: true`、`connect-src ... http://127.0.0.1:* http://localhost:*`；
- `cargo check` / `cargo build`（debug）通过；
- 完整链路：启动 `lc-desktop.exe`（pid 24060）→ sidecar 就绪（随机端口 63135）→ `GET /health` 返回 `200 {"dbConfigured":true,...,"version":"0.1.0","pid":40088}` → `taskkill`（不带 `/F`，走正常关闭）→ 应用退出 → sidecar 进程消失、端口关闭；日志确认「应用退出，正在结束本地后端进程」；
- 首次启动引导：不提供 `LC_DB_PASSWORD` 时，未生成端口文件、`lc-sidecar` 进程数为 0，日志为「未找到数据库密码，进入首次启动引导（不会启动后端）」；
- 强杀兜底：`taskkill /F` 杀掉应用后 2 秒内 sidecar 自行退出（stdin EOF 看门狗）。

**安装包（同一份代码，分别关/开 sidecar 打两轮）**：

| 包 | 无 sidecar | 带 Go sidecar | 增量 |
|---|---|---|---|
| MSI | 2,506,752 字节（2.39 MiB） | 5,394,432 字节（5.14 MiB） | +2,887,680（+115.2%） |
| NSIS | 1,855,777 字节（1.77 MiB） | 4,075,200 字节（3.89 MiB） | +2,219,423（+119.6%） |

- MSI 用 `msiexec /a`（管理安装）解包、NSIS 用 `/S /D=<临时目录>` 静默安装：两者都把 `lc-sidecar.exe` 放在 `lc-desktop.exe` **同目录**，与 Tauri 的 externalBin 约定一致；
- 从 NSIS 安装目录直接运行 `lc-desktop.exe`：端口文件生成、`/health` 返回 200、sidecar 有独立 pid；正常关闭应用后子进程退出；
- 同代码复测（补更新面板/错误回显后）NSIS 带 Go sidecar 为 4,088,148 字节；绝对体积随前端与外壳代码变化，但 sidecar 带来的增量约 2.2 MB 量级不变。

**WebView 密码表单（CDP 真实鼠标事件 + `Input.insertText`，非 JS 合成点击）**：

- 首次启动显示「需要初始化」表单；点击「保存并启动」后进入 `ready`，`backendUrl=http://127.0.0.1:<随机端口>`；`secrets.json` 写入正确密码，`/health` 返回 200；关闭应用后 sidecar 退出；
- 重启后直接 `ready`，表单隐藏，未再次询问密码；
- 300 字符输入被前端与外壳双重拦截，提示「密码长度 300 超过 256 个字符」，且没有写入 `secrets.json`；
- 用测试替身 sidecar（密码错误时向 stderr 打印认证失败并退出码 4）提交错误密码：界面显示「退出码 4」并附带后端最后一行 `数据库连接失败：password authentication failed`；表单保留可重新输入，应用不退出。

**Node SEA 路线**：

- `node --experimental-sea-config` + 复制 `node.exe` + `postject@1.0.0-alpha.6` 注入，产出 93,708,800 字节（89.4 MB）单文件，`--version` 输出 `0.1.0`；
- 替换 release 目录的 `lc-sidecar.exe` 后从应用内启动：`/health` 返回 200，关闭应用后无孤儿进程；
- `build-sidecar.mjs --from` 接受该 SEA 文件并按版本校验通过；NSIS 安装包 **25,353,844 字节（24.2 MiB）**，安装后 `lc-sidecar.exe` 为 93,708,800 字节；从安装目录启动应用后 `/health` 200、关闭后无孤儿。

未在本机验证（如实标注）：

- **MSI 安装后的运行验证**：本次只对 MSI 做管理安装解包确认文件落位，运行链路走的是 NSIS 安装目录；从 Program Files 运行未单独复测；
- **系统凭据库**：未接入（见上文限制）；
- **Linux**：未验证；
- **Node 原生模块（`.node`）**：SEA 场景未验证（需要静态化原生依赖）；
- **Node SEA 的代码签名**：注入会破坏原 `node.exe` 的签名，本机未做 Authenticode 重新签名。

补充：Windows 上 Tauri 的 `app_config_dir()` 走 Known Folder API，**不读 `APPDATA` 环境变量**，所以测试时无法用环境变量把配置目录指到临时目录；本次是跑完后按目录创建时间确认并清理。项目实际使用时请改掉 `com.example.app`，避免与模板测试数据混淆。
<!-- /lc:export-hide -->
