# 平台调用的非交互构建入口

`scripts/build-app.mjs` 是导出管线与平台侧唯一的打包入口：校验配置 → 渲染 `tauri.conf.json` → 调用 Tauri CLI → 收集安装包 → 输出 JSON。它不读 stdin、不弹确认，适合 CI 或平台任务进程直接调用。

```bash
node scripts/build-app.mjs --project <生成的工程目录> --out <输出目录> --targets msi,nsis
```

成功时 stdout 只有一行 JSON（进度与日志写 stderr）；失败时退出码非 0，JSON 里给 `code`、`message`、`hint`，**不输出调用栈**。

## 参数

| 参数 | 是否必填 | 默认 | 说明 |
|---|---|---|---|
| `--project <dir>` | 是 | — | 生成的工程目录，必须含 `config/desktop.json` 与 `src-tauri/Cargo.toml` |
| `--out <dir>` | 是 | — | 安装包输出目录；不存在会自动创建 |
| `--targets <list>` | 否 | 按 `bundle.targets` 裁剪到当前平台 | 逗号分隔，如 `msi,nsis`；Android 用 `apk,aab` |
| `--platform <name>` | 否 | 构建机平台 | `win32` / `linux` / `android`；Android 在 Windows/Linux 上都能构建 |
| `--android-targets <list>` | 否 | `aarch64,x86_64`（universal） | `aarch64,armv7,i686,x86_64` 的子集；默认同时出 arm64-v8a 与 x86_64 的 universal APK，真机与模拟器都能装；只装模拟器时可改 `x86_64` 缩短构建 |
| `--log-dir <dir>` | 否 | `<out>/logs` | 日志目录；该目录不可写时自动退回系统临时目录 |
| `--timeout-ms <n>` | 否 | `1800000`（30 分钟） | 打包超时；超时会杀掉整个进程树 |
| `--lock-timeout-ms <n>` | 否 | `3600000`（60 分钟） | 等待同工程其它构建释放缓存锁的上限 |
| `--help` | 否 | — | 打印用法（文本，不是 JSON） |

相对路径按**调用者的当前工作目录**解析；脚本自身不假设 cwd 是模板目录或工程目录。构建子进程的 cwd 固定为 `--project`。环境变量 `LC_BUILD_CACHE_DIR` 可改编译缓存根目录。

## 前置条件

- Node ≥ 18（构建入口本身），Rust 工具链（`cargo`、`rustc`）可用；
- Tauri CLI：优先用 `<project>/node_modules/@tauri-apps/cli/tauri.js`，其次 `<project>/node_modules/.bin/tauri`，最后 PATH 里的 `tauri`；
- `src-tauri/icons/` 已生成（缺失时给 `E_ICONS_MISSING`，不会抛栈）；
- 开启 sidecar 时 `src-tauri/binaries/<name>-<host triple>[.exe]` 必须已就位；
- 只做本机平台原生打包，不做交叉编译。
- Android 额外需要 JDK 17/21、`ANDROID_HOME`（含 platform/build-tools）、NDK 27（`$ANDROID_HOME/ndk/27.*` 或 `NDK_HOME`）、Rust Android 目标（`rustup target add aarch64-linux-android x86_64-linux-android` 等）。缺项会先给 `E_TARGET_UNSUPPORTED`/`E_TOOLCHAIN_MISSING` 或构建失败尾部，不会卡在交互提示。

## 并发与缓存：排队，不是各自为战

采用**按工程排队 + 每工程独立 `CARGO_TARGET_DIR`**：

- 缓存键 = `(工程真实路径, identifier)`；缓存目录为 `<cacheRoot>/<identifier>/<key>/`，其中 `cacheRoot` 默认是 `%LOCALAPPDATA%\lc-build-cache`（非 Windows 为 `~/.cache/lc-build-cache`）。
- 同一工程同时来两个构建时，第二个会等第一个释放 `build.lock` 后继续，**不并发写入同一份缓存**；等待时间出现在 JSON 的 `cache.waitedMs`。持有锁的进程已消失（崩溃/被杀）时，锁会被自动接管，不会永久卡死。
- 不同工程各自使用独立 target 目录，互不影响；代价是不同工程不共享 Rust 编译缓存。
- WiX / NSIS 打包工具缓存在 `%LOCALAPPDATA%\tauri`，由 Tauri CLI 共享：就绪后只读复用；**首次在全新机器上并发跑多个工程时，建议先单独跑一次让工具下载完成**。

## 成功返回

```json
{
  "ok": true,
  "code": "OK",
  "buildId": "lc-20261108-153012-1234-abcd",
  "platform": "win32",
  "project": { "dir": "C:\\tmp\\export\\app", "productName": "Example App", "identifier": "com.example.app", "version": "0.1.0" },
  "outDir": "C:\\tmp\\export\\out",
  "targets": ["msi", "nsis"],
  "durationMs": 48321,
  "signing": { "updater": false, "mode": "none", "keySource": null, "keyFile": null, "artifactsSigned": null },
  "artifacts": [
    {
      "target": "msi",
      "path": "C:\\tmp\\export\\out\\Example App_0.1.0_x64_en-US.msi",
      "file": "Example App_0.1.0_x64_en-US.msi",
      "sizeBytes": 2506752,
      "updateSigned": false,
      "signaturePath": null
    }
  ],
  "logs": { "path": "C:\\tmp\\export\\out\\logs\\lc-20261108-153012-1234-abcd.log" },
  "cache": {
    "mode": "queue-per-project",
    "cacheDir": "C:\\Users\\me\\AppData\\Local\\lc-build-cache\\com.example.app\\a1b2c3d4e5f6",
    "targetDir": "C:\\Users\\me\\AppData\\Local\\lc-build-cache\\com.example.app\\a1b2c3d4e5f6\\target",
    "waitedMs": 0,
    "sharedToolsCache": "打包工具（WiX/NSIS）缓存由 Tauri CLI 共享，只读复用"
  },
  "warnings": [],
  "cleanup": { "tempRemoved": [], "logsKept": true, "note": "成功构建保留编译缓存用于下次增量；失败构建会删除未完成的 bundle" }
}
```

| 字段 | 用途 |
|---|---|
| `artifacts[].path` | 平台上传/分发用的最终文件路径（产物已复制到 `--out`） |
| `artifacts[].sizeBytes` | 文件体积 |
| `artifacts[].updateSigned` / `signaturePath` | 是否找到更新签名 `.sig`（不是 Windows 代码签名）；无更新签名时恒为 `false`/`null` |
| `signing.updater` | 本次是否要求更新包签名（`update.active` 或 `createUpdaterArtifacts`） |
| `signing.artifactsSigned` | 开启签名时，是否每个产物都找到了 `.sig` |
| `durationMs` | 入口总耗时（含校验、渲染、编译、打包、复制） |
| `logs.path` | 完整构建输出；成功也保留 |
| `warnings` | 不阻塞构建的提示（如缺少签名密码、sidecar 无法读版本） |

## Android 构建与签名

```bash
# 模拟器/真机调试包（只编 x86_64，速度快）
node scripts/build-app.mjs --project <工程目录> --out <输出目录> \
  --platform android --targets apk --android-targets x86_64

# 上架用 AAB（产物在 --out 下）
node scripts/build-app.mjs --project <工程目录> --out <输出目录> \
  --platform android --targets aab --android-targets aarch64
```

- 首次调用时若 `src-tauri/gen/android` 不存在，入口会自动执行 `tauri android init --ci`；不需要人工确认。
- 产物从 `src-tauri/gen/android/app/build/outputs` 收集：`apk/**/release/*.apk`、`bundle/**/release/*.aab`。
- **Windows 构建机前置**：Tauri 会把 Rust 产出的 `.so` 以符号链接放进 `jniLibs`。未开启 Windows 开发者模式（没有 `SeCreateSymbolicLinkPrivilege`）时会报 `Creation symbolic link is not allowed for this system`。解决方式：开启开发者模式；或手动把 `.so` 复制到 `app/src/main/jniLibs/<abi>/`，再执行 `gradlew.bat :app:assemble<Abi>Release -x rustBuild<Abi>Release` 打包。
- `src-tauri/src/lib.rs` 的 `run()` 必须带 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`；缺了它桌面端照常，Android 启动时会报 `UnsatisfiedLinkError: No implementation found for ... Rust.onCreate`。
- `tauri android build` 产出的 release APK 默认未签名。测试包用 `templates/signing/android/gen-test-keystore.*` 生成 keystore，口令只经环境变量传入（见该目录 README），然后：

```bash
apksigner sign --ks test.p12 --ks-pass env:LC_KEYSTORE_PASS --key-pass env:LC_KEYSTORE_PASS app-release.apk
apksigner verify --print-certs app-release.apk
```

- 上架要用自己的上传密钥，并用 AAB；测试 keystore 只能自己安装，不能上架。AAB 需要由 Google Play 用上传密钥重签，不能直接用 `apksigner` 安装。

## 失败返回

```json
{
  "ok": false,
  "code": "E_SIGNING_MISSING",
  "message": "需要更新包签名，但没有 TAURI_SIGNING_PRIVATE_KEY",
  "hint": "在构建机环境变量里放私钥内容或私钥文件路径（配 TAURI_SIGNING_PRIVATE_KEY_PASSWORD）；私钥不要写进工程。",
  "buildId": "lc-20261108-153012-1234-abcd",
  "stage": "preflight",
  "platform": "win32",
  "project": { "dir": "C:\\tmp\\export\\app", "identifier": "com.example.app", "version": "0.1.0" },
  "targets": ["msi", "nsis"],
  "durationMs": 520,
  "logs": { "path": "C:\\tmp\\export\\out\\logs\\lc-20261108-153012-1234-abcd.log" },
  "warnings": [],
  "cleanup": { "tempRemoved": [], "logsKept": true }
}
```

失败时：删除未完成的 `<targetDir>/release/bundle` 与本次已复制到 `--out` 的半成品；**不删编译缓存与日志**；`logs.path` 一定给出（`--out` 不可写时日志退回系统临时目录 `lc-build-logs/`）。

## 失败码

退出码分组：`2` 参数、`3` 工程/配置、`4` 目标、`5` 签名与证书、`6` 环境与前置、`7` 排队、`8` 构建/产物、`9` 超时、`130` 被中断、`10` 入口自身异常。

| code | 退出码 | 含义 | 平台侧处理 |
|---|---|---|---|
| `E_USAGE` | 2 | 缺参数、未知参数、数值参数非法 | 修正调用参数 |
| `E_PROJECT_NOT_FOUND` | 3 | `--project` 不存在或不是目录 | 确认导出已落盘 |
| `E_PROJECT_INVALID` | 3 | 缺 `config/desktop.json` 或 `src-tauri/Cargo.toml`，或配置 JSON 解析失败 | 检查导出产物完整性 |
| `E_CONFIG_INVALID` | 3 | 配置校验不通过（字段/类型/标识符/版本等），`details.errors` 有完整清单 | 修配置后重试，不重试无意义 |
| `E_TARGET_UNSUPPORTED` | 4 | 请求的目标不能在本机平台构建（如 Windows 上要 `rpm`） | 按构建机平台改 `--targets`，或换对应平台的构建机 |
| `E_TARGET_EMPTY` | 4 | `--targets` 为空 | 传至少一个目标 |
| `E_SIGNING_MISSING` | 5 | 需要更新包签名，但没设 `TAURI_SIGNING_PRIVATE_KEY` | 配构建机密，不重试 |
| `E_SIGNING_KEY_NOT_FOUND` | 5 | `TAURI_SIGNING_PRIVATE_KEY` 是路径形式，但文件不存在 | 修路径或改为传内容 |
| `E_CERT_NOT_FOUND` | 5 | server + https + `https.mode=generated` 时缺 `certs/site.crt`/`site.key` | 先 `npm run gen:cert` 或放自有证书 |
| `E_SIDECAR_BINARY` | 6 | `sidecar.enabled=true` 但 `src-tauri/binaries` 里没有对应三元组的文件 | 先跑 `build-sidecar.mjs` |
| `E_SIDECAR_VERSION_MISMATCH` | 6 | sidecar `--version` 与 `desktop.json.version` 不一致 | 用当前版本重建 sidecar |
| `E_TOOLCHAIN_MISSING` | 6 | `cargo`/`rustc` 不可用 | 构建机环境问题，重试无效 |
| `E_TAURI_CLI_MISSING` | 6 | 工程 `node_modules` 与 PATH 都找不到 Tauri CLI | 先 `npm ci` |
| `E_OUT_DIR_INVALID` | 6 | `--out` 不可创建/不可写 | 换输出目录 |
| `E_CACHE_DIR_INVALID` | 6 | 编译缓存目录不可创建（`LC_BUILD_CACHE_DIR` 或默认路径） | 指定可写缓存目录 |
| `E_ICONS_MISSING` | 6 | `src-tauri/icons/` 缺 tauri.conf 声明的图标 | 先 `npm run icons` |
| `E_RENDER_FAILED` | 6 | 写 `tauri.conf.json` / `desktop.runtime.json` / `web/desktop-config.js` 失败 | 检查工程目录权限 |
| `E_BUILD_LOCK_TIMEOUT` | 7 | 等同一工程的其它构建超时 | 查是否有卡住的构建；可调大 `--lock-timeout-ms` |
| `E_BUILD_FAILED` | 8 | `tauri build` 退出码非 0，`details.tail` 是日志尾部 | 看 `logs.path`；`hint` 给常见根因 |
| `E_ARTIFACT_MISSING` | 8 | 构建返回成功但预期目录没有产物 | 查打包工具是否被跳过（WiX/NSIS 缓存） |
| `E_ARTIFACT_COPY_FAILED` | 8 | 产物复制到 `--out` 失败 | 检查输出目录磁盘/权限/占用 |
| `E_TIMEOUT` | 9 | 超过 `--timeout-ms`，进程树已终止 | 调大超时或排查依赖下载 |
| `E_INTERRUPTED` | 130 | 收到 SIGINT/SIGTERM，已终止子进程并释放锁 | 可安全重试 |
| `E_UNEXPECTED` | 10 | 入口脚本自身异常 | 带日志与入参反馈 |

## 进程与目录清理

- 子进程以 `stdio=['ignore','pipe','pipe']` 启动，不读 stdin；正常完成后 Tauri CLI 及其 `cargo`/`rustc` 子进程均已退出，不会继续占用工程目录。
- 超时、失败或收到信号时：Windows 用 `taskkill /PID <pid> /T /F`，POSIX 用独立进程组 `SIGKILL`，整棵树一起结束，然后释放缓存锁。
- 缓存锁在进程异常退出后由「持有者 pid 已消失」判定自动接管；锁文件内容损坏时超过 2 小时也会被视为陈旧。
- 失败保留日志；成功也保留日志，便于审计。

## 本机验证记录（2026-11-08，Windows x64）

测试对象是**临时复制到 `%TEMP%` 的工程目录**（不是模板目录），调用时 cwd 在工程目录之外；`LC_BUILD_CACHE_DIR` 指向临时目录（沙箱默认不允许写 `%LOCALAPPDATA%`，真实构建机可用默认值）。

| 场景 | 结果 |
|---|---|
| `--targets nsis` 成功 | 退出码 0；冷缓存全量编译 + 打包 `290,354 ms`；产物 `Example App_0.1.0_x64-setup.exe`，`1,866,801` 字节 |
| 两个构建同时启动（同一工程，不同 `--out`） | 两者均 `ok`；第二个 `cache.waitedMs=124,428`，说明排队生效，未并发写同一 target 目录 |
| `--targets rpm`（Windows） | `E_TARGET_UNSUPPORTED`，退出码 4，`message` 含“本机支持：msi, nsis” |
| `update.active=true` 且无 `TAURI_SIGNING_PRIVATE_KEY` | `E_SIGNING_MISSING`，退出码 5 |
| `TAURI_SIGNING_PRIVATE_KEY` 指向不存在的文件 | `E_SIGNING_KEY_NOT_FOUND`，退出码 5，`message` 带完整路径 |
| server + https(generated) 且 `certs/` 为空 | `E_CERT_NOT_FOUND`，退出码 5，`message` 列出两个缺失文件 |
| `--timeout-ms 5000` | `E_TIMEOUT`，退出码 9；已删除 `release/bundle`、释放 `build.lock`；2 秒后 `cargo`/`rustc`/`tauri`/`node` 无残留进程；日志保留 |

Android 分支实测：Windows x64 + SDK platform 36/37 + NDK 27.2 + JDK 21。`tauri android init --ci`、Rust 原生库编译、产物收集逻辑均已跑通；本机因未开启开发者模式，卡在 `.so` 符号链接一步，测试 APK 按上文的手动复制 + Gradle 打包方式产出并完成真机（模拟器）安装运行。未实测：Linux 目标、开启更新签名后 `.sig` 的收集（更新签名链路本身已在 `docs/update.md` 中用测试密钥验证）。

## 与旧脚本的关系

`npm run build`（`tauri build`）仍然可用，但要求先手动 `render`、且使用模板默认 `src-tauri/target`。平台与导出管线请统一走 `build-app.mjs`：参数、渲染、sidecar 校验、失败码都在这一处，避免两边逻辑漂移。
