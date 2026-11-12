# Tauri 2 桌面工程模板

导出桌面应用时把整个目录塞进压缩包，用户改 `config/desktop.json` 里的几个字段就能构建。默认配置已在本机跑通 `tauri build`（MSI + NSIS 均有产物，见文末构建记录）。

## 快速上手

<!-- lc:env-requirements -->
前置：Node 18+、Rust 1.80+、平台依赖（Windows 需 WebView2 运行时；Linux 需 WebKitGTK）。依赖全部走本地 npm / cargo 并锁定版本，**不引用任何 CDN**。
<!-- /lc:env-requirements -->

```bash
npm ci                 # 按 package-lock.json 装 @tauri-apps/cli 2.12.4
# 改 config/desktop.json（应用名、identifier、版本、窗口、协议、更新…）
npm run validate       # 校验配置，错误会在这里报，不到构建期才崩
npm run render         # 生成 tauri.conf.json / desktop.runtime.json / desktop-config.js
npm run preflight      # 打包前自检：工具链、缓存、磁盘、证书、签名材料（退出码 1 = 有阻塞项）
npm run build          # tauri build（按当前平台裁剪打包目标）
```

改完配置必须重新 `render`：`src-tauri/tauri.conf.json` 是生成产物，手改会在下次渲染时被覆盖。

## 目录

| 路径 | 作用 |
|---|---|
| `config/desktop.json` | 唯一配置源，所有字段都有默认值 |
| `scripts/validate-config.mjs` | 配置校验（错误 / 警告分级） |
| `scripts/preflight.mjs` | 打包前自检：工具链、打包缓存、权限、磁盘、证书、签名材料；只报有无，不打印密钥 |
| `scripts/build-sidecar.mjs` | 把后端二进制复制/构建到 `src-tauri/binaries/<name>-<triple>`（详见 `docs/sidecar.md`） |
<!-- lc:lang:go -->
| `examples/sidecar-go/` | Go 示例后端：端口注入、`--version`、`/health`、stdin 看门狗 |
<!-- /lc:lang:go -->
| `docs/sidecar.md` | 本地内置后端：externalBin、端口、密钥引导、版本校验、分语言可行性 |
| `docs/build-checklist.md` | 人工检查清单与"拒绝访问 / 包类型标记"的排查顺序 |
| `scripts/render-config.mjs` | 渲染三份产物，`--check` 只比对不写盘 |
| `scripts/gen-icons.mjs` | 纯 Node 生成 `src-tauri/icons/`（PNG / ICO），不依赖外部工具 |
| `scripts/prepare-frontend.mjs` | 把站点产物合并进 `web/`，并写 `desktop-config.js` |
| `scripts/gen-test-cert.mjs` / `.sh` | 生成自签 HTTPS 测试证书（详见 `docs/https.md`） |
| `scripts/serve-local.mjs` | 仅听 127.0.0.1 的本地预览，支持 `--tls` |
| `scripts/gen-update-manifest.mjs` | 生成 `latest.json`，含 semver 比较（详见 `docs/update.md`） |
| `src-tauri/` | Rust 工程；`tauri.conf.json`、`desktop.runtime.json` 为生成产物 |
| `web/` | 默认占位前端，导出时被站点产物替换 |

## 配置项与默认值

全部字段在 `config/desktop.json` 中可见，下面只列导出时会改到的部分。

| 字段 | 默认值 | 说明 / 校验 |
|---|---|---|
| `productName` | `科设低代码平台` | 应用显示名；禁止 `\ / : * ? " < > \|`，Windows 打包会失败 |
| `identifier` | `com.keshestudio.lowcode` | 反向域名，至少两段；Android 的 applicationId 不允许连字符；发布者固定为 `KesheStudio` |
| `version` | `0.1.0` | 严格 semver，不带 `v` 前缀；预发布写成 `1.2.0-beta.1` |
| `window.width` / `height` | `1024` / `720` | 初始尺寸 |
| `window.minWidth` / `minHeight` | `800` / `600` | 不能大于初始尺寸，否则报错 |
| `window.resizable` | `true` | 是否可调整大小 |
| `window.fullscreen` / `center` | `false` / `true` | |
| `icon.source` | `builtin` | `builtin` 用自带图标；`imported` 时 `icon.path` 指向 ≥512 的 PNG |
| `protocol` | `https` | 映射到窗口 `useHttpsScheme`，决定 WebView 的 origin（`http(s)://tauri.localhost`） |
| `delivery.mode` | `static` | `static`：前端资源打进安装包；`server`：连外部服务 |
| `delivery.webDir` | `../web` | 静态模式的资源目录，相对 `src-tauri/` 解析 |
| `https.{mode,host,port}` | `generated` / `localhost` / `1420` | **仅 `delivery.mode="server"` 生效**，见 `docs/https.md` |
| `backend.enabled` / `baseUrl` | `false` / `http://127.0.0.1:8080` | 是否需要连后端；启用时该 origin 会进 CSP 的 `connect-src` |
| `runtime.singleInstance` | `true` | 二次启动只聚焦已有窗口 |
| `runtime.autostart` | `false` | 开机自启（注册到系统启动项） |
| `update.active` | `false` | 开启时必须同时给 `endpoint`（https）与 `pubkey` |
| `update.checkOnStartup` | `true` | 启动后异步检查；失败只打日志，不影响启动 |
| `bundle.targets` | `["msi","nsis","appimage"]` | 渲染时按当前平台裁剪，Windows 只留 `msi`/`nsis`；Android 的 `apk`/`aab` 走 `android build`，不写进 `bundle.targets` |
| `bundle.createUpdaterArtifacts` | `false` | 开更新时渲染器强制置 `true`（否则客户端没有签名可验） |
| `bundle.windows.installMode` | `passive` | NSIS 安装模式 |
| `dev.url` | `http://127.0.0.1:1420` | 仅 server 模式写入 `build.devUrl`；静态模式忽略，避免 `tauri dev` 卡等不存在的服务 |

校验分两级：**错误**让 `render` 退出码为 1（字段缺失、类型错、identifier 非法、semver 非法、窗口尺寸矛盾、update 开了却没端点/公钥、android.signing 取值非法）；**警告**只提示不阻塞（http 明文、自签证书、跨平台目标被裁剪、开了 updater 产物却没有签名密钥）。

## 前端产物怎么接进去

两条路径只在 `delivery.mode` 上切换，细节（CSP、origin 变化、SPA 回退、白屏排查）见 [`docs/frontend-delivery.md`](docs/frontend-delivery.md)。

| | `static`（默认） | `server` |
|---|---|---|
| 资源位置 | 打进安装包，`frontendDist` 指向本地目录 | 不打包前端，指向远端或本机服务 |
| 适用 | 离线可用、单机工具、内容型站点 | 内容频繁更新、需要服务端渲染或账号体系 |
| 风险 | 站点更新要重新出包 | 断网即白屏；跨域与证书问题都要处理 |

`static` 模式下用 `npm run prepare:web -- --from <构建输出目录>` 把站点产物合并进 `web/`；脚本始终重写 `web/desktop-config.js`，前端通过 `window.__LC_DESKTOP__` 拿到应用名、版本、协议、后端地址。

## HTTPS 与证书

- 只有 `delivery.mode="server"` 才涉及真实 TLS；`protocol` 只改 WebView 的 origin，不做加密。
- 自签测试证书：`npm run gen:cert`，产物 `certs/site.crt`（可进包）+ `certs/site.key`（**绝不进包**）。
- 自有证书要求 SAN 覆盖实际访问主机名、链条完整、有效期正常、证书与私钥配对。自签证书在未信任它的机器上会被 WebView 直接拒绝（Windows 报证书错误页）。
- 详见 [`docs/https.md`](docs/https.md)。

## 更新与版本

`npm run updates -- --version 0.2.0 --base-url https://... --artifact ... --target windows-x86_64` 生成 `latest.json`；脚本强制 https、拒绝版本不递增、要求 `.sig` 存在且非空。清单格式、签名校验与离线降级见 [`docs/update.md`](docs/update.md)。

## 签名

见 `../signing/README.md`：Android keystore、Windows 代码签名。Android 有两条路径：测试签名用 `gen-test-keystore` 生成的 keystore，只能自己安装/内测、不能上架；正式签名用自己的上传密钥配合 Play App Signing，可上架。私钥与密码的红线在 `../signing/POLICY.md`，出包前跑 `node ../signing/scripts/scan-secrets.mjs --dir <导出包目录>`。

## 本机构建验证记录

环境：Windows x64、Node v24.21.0、rustc / cargo 1.99.0、`@tauri-apps/cli` 2.12.4、`tauri` crate 2.12.5、`tauri-build` 2.7.4。

| 验证项 | 结果 |
|---|---|
| `node scripts/gen-icons.mjs` | 通过，产出 6 个图标文件 |
| `npm run validate` / `render --check` | 通过，幂等 |
| `cargo check`（dev profile） | 通过，12.14s |
| `cargo clean` 后 `tauri build --bundles msi,nsis` | 通过，4m 16s 编译；MSI 2.36 MiB、NSIS 1.75 MiB |
| 不重新编译再打一次 `--bundles nsis` | 通过，15.24s；无 `__TAURI_BUNDLE_TYPE` 告警 |
| MSI 载荷取证（`msiexec /a` 解包） | `lc-desktop.exe` 标记为 `_MSI`，`UNK` 计数 0 → updater 返回 `Msi` |

**遇到并解决的真实问题（如实记录，不是一次通过）**

1. **WiX 解压阶段报 `拒绝访问 (os error 5)`**：`tauri build --bundles msi` 首次在下载/解压 WiX 3.14 时失败，报"拒绝访问"，与项目此前记录的 NSIS 问题现象一致。关掉命令沙箱后重试仍然失败，说明不是沙箱拦截。手动下载 `wix314-binaries.zip` 用 `Expand-Archive` 解压完全正常；检查 `%LOCALAPPDATA%\tauri` 发现目录存在但为空、没有 `WixTools314`。把官方 zip 手动解压到 `%LOCALAPPDATA%\tauri\WixTools314` 后重跑，MSI 成功产出。
   - 结论：是本机缓存目录的写入/创建环节失败，不是打包或签名代码的问题。换一台干净的构建机大概率不会复现；复现时按 `docs/build-checklist.md` 第 2 节处理。CI 里可预先解压好该目录再构建。
2. **`Failed to add bundler type to the binary: __TAURI_BUNDLE_TYPE variable not found`（已定位并消除）**：这条告警**不是** crate 2.12.5 与 CLI 2.12.4 的补丁差造成的。`tauri-utils::platform::bundle_type()` 读的是二进制里的一个静态标记：打包器在打包前把 `__TAURI_BUNDLE_TYPE_VAR_UNK` 改写成 `msi` / `nsis`，打包结束后再还原成 `UNK`。**打包中断或失败时可能跳过还原**——本机在 WiX 阶段反复失败之后，二进制实际停留在 `_MSI` 状态（`_UNK` 计数 0），下一次打包找不到 `UNK`，于是告警，并且打出的包可能沿用错误的类型。
   复测（`cargo clean` 后一次打包 `msi,nsis`）：两次 `Info Patching ... with bundle type information: msi / nsis` 均成功，告警消失；用 `msiexec /a` 解出 MSI 载荷，`lc-desktop.exe` 中 `_MSI` 出现 2 次（match 字面量 + 被改写的静态）、`_UNK` 出现 0 次，按 `bundle_type()` 的 `match` 返回 `Msi`，updater 会走 MSI 安装路径；打包结束后 target 里的 exe 已还原为 `UNK`，不重编译再打 NSIS 也无告警。
   结论：npm 最新 CLI 就是 2.12.4，**不存在可对齐的补丁版**，补丁差本身不影响打包；要防的是"打包中途失败后未还原的二进制"。处理方式见 `docs/build-checklist.md` 第 8 节。NSIS 安装包内的载荷因本机无 7-Zip 未解包验证，只确认了打包器对它执行的 Patching 与最终二进制的还原状态。
3. **`identifier ... ends with .app`**：Tauri CLI 会对以 `.app` 结尾的 identifier 发警告。默认值已改为 `com.keshestudio.lowcode`，不再触发；自定义时避开 `.app` 结尾即可。

## 未在本机验证

| 项 | 原因 |
|---|---|
| 图形界面实际启动、窗口尺寸与最小尺寸手感 | 无人值守环境无法交互查看；仅验证到编译与打包成功 |
| 在干净机器上安装 MSI / NSIS 产物 | 会修改本机系统状态，未执行 |
| signtool 实际签名与验签 | 本机 PowerShell 环境未装 Windows SDK 的 signtool |
| 完整两版本自动更新链路（下载 → 验签 → 安装） | 需要可访问的 https 更新服务器与两版产物，未搭建 |

以上各项没有假装跑通：模板里只提供工程配置与命令说明，没有配置材料时也不会出现"点了就失败"的签名按钮。

## 与 CONTRACTS-v1 的偏离（需契约维护方确认）

| 项 | 契约 | 模板实际 | 原因 |
|---|---|---|---|
| `bundle.createUpdaterArtifacts` 默认值 | `true` | `false` | 开启且没有 `TAURI_SIGNING_PRIVATE_KEY` 时打包阶段直接失败，与"默认配置必须能直接构建"冲突；`update.active=true` 时渲染器强制置 `true` |
| 静态模式下的 `build.devUrl` | 未明确 | 不写入 | 写入后 `tauri dev` 会等待一个不存在的服务，开发流程卡死 |
| 默认 `identifier` | 未明确 | `com.keshestudio.lowcode` | 与项目定名一致，且不以 `.app` 结尾，不再触发 Tauri CLI 警告 |
