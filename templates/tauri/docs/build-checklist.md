# 构建自检清单

目标：换机器、换用户、换 CI 时，不用靠试错撞出"拒绝访问"或签名缺项。能自动跑的部分都在 `npm run preflight` 里，下面是它覆盖不到的人工确认项。

## 0. 一键自检

```bash
npm run preflight          # 有阻塞项时退出码 1
npm run preflight -- --json
```

它检查：Node / cargo / rustc 版本、本地 CLI 是否装好、CLI 与 crate 版本、配置校验、渲染产物是否同步、target 与打包缓存是否可写、磁盘空间、WiX / NSIS 缓存是否完整、证书文件、签名材料是否就位。**只报"有/缺"，不打印任何密码或私钥内容。**

## 1. 工具链

| 检查 | 期望 | 不满足时的表现 |
|---|---|---|
| `node --version` | ≥ 18 | `npm ci` 或脚本直接报语法错误 |
| `npm ci` 完成 | `node_modules/@tauri-apps/cli` 存在 | `'tauri' is not recognized`，或版本与 lockfile 不一致 |
| `cargo --version` / `rustc --version` | rustc ≥ 1.80 | 编译期报 MSRV 错误 |
| `package-lock.json` 与 `Cargo.lock` 都在 | 已提交、未被改写 | 不同机器装出不同版本，问题无法复现 |

CLI 与 crate 是两条发布渠道：CLI 2.12.4（npm 最新）与 crate 2.12.5（crates.io 最新）补丁版不同是正常的，**不要为了"对齐"把任一方钉到不存在的版本**。这两者不匹配不会导致打包失败；包类型标记的问题另有原因（见第 8 节）。

## 2. 打包缓存与权限（Windows）

| 检查 | 命令 / 路径 | 失败症状 | 处理 |
|---|---|---|---|
| WiX 缓存完整 | `%LOCALAPPDATA%\tauri\WixTools314\candle.exe`、`light.exe` | `拒绝访问 (os error 5)`，MSI 阶段失败 | 手动解压 `wix314-binaries.zip` 到该目录（见下） |
| NSIS 缓存完整 | `%LOCALAPPDATA%\tauri\NSIS\makensis.exe` | NSIS 阶段失败或一直卡在下载 | 删掉 `NSIS` 目录让 CLI 重新解压，或手动解压归档 |
| 缓存目录可写 | 在 `%LOCALAPPDATA%\tauri` 新建再删除一个临时文件 | 同 `os error 5` | 杀毒软件 / 受控文件夹访问 / 目录属主不对 |
| target 目录可写 | `src-tauri/target` 或 `CARGO_TARGET_DIR` | 链接失败、`Access is denied` | 设置可写的 `CARGO_TARGET_DIR`，或把工程移到用户目录 |
| 磁盘空间 | ≥ 3 GB | 链接或打包中断 | 清理 target 与旧产物 |
| 运行身份 | 与安装缓存时同一用户 | 换用户后缓存不可读 | 用同一账号构建，或给新用户重新种缓存 |

首次 MSI 失败时的手动种缓存（本机实测有效）：

```powershell
$wix = "$env:LOCALAPPDATA\tauri\WixTools314"
Invoke-WebRequest https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip -OutFile "$env:TEMP\wix314.zip"
Expand-Archive "$env:TEMP\wix314.zip" -DestinationPath $wix -Force
```

`拒绝访问 (os error 5)` 的排查顺序：**目录是否为空 → 目录是否可写 → 杀软是否拦截 → 是否换了用户**。不要一上来就怀疑签名或代码。

## 3. 配置与渲染产物

```bash
npm run validate           # 错误必须为 0
npm run render -- --check  # 必须输出"渲染结果与磁盘一致"
```

- 改了 `config/desktop.json` 却没重新 `render`，打出来的包仍是旧配置。
- 不要手改 `src-tauri/tauri.conf.json`，它是生成产物。

## 4. HTTPS 与证书（仅 `delivery.mode="server"`）

| 检查 | 说明 |
|---|---|
| `certs/site.crt` + `certs/site.key` 存在 | 自签测试用 `npm run gen:cert`；自有证书按 `docs/https.md` 放置 |
| SAN 覆盖实际访问主机名 | 缺 SAN 时 WebView 报证书错误 |
| 证书链完整、未过期 | 中间证书缺失会报 `unable to get local issuer` |
| 私钥不在 `web/`、`dist/`、安装包内 | 出包后用 `scan-secrets` 复扫 |
| 自签证书的信任状态 | 未导入信任的机器一定被拒，这是预期行为，不是 bug |

## 5. 签名材料（只看有无）

| 场景 | 需要 | 检查方式 |
|---|---|---|
| 自动更新 | `TAURI_SIGNING_PRIVATE_KEY`（+ 可选密码变量） | `npm run preflight` 报"已设置/未设置" |
| Windows 正式分发 | `signtool` + 证书指纹或 `signCommand` | `where signtool`；`tauri.conf.json` 的 `bundle.windows` |
| Android | JDK、Android SDK/NDK、Rust Android 目标、测试 keystore | `npm run preflight -- --platform android`；签名口令只通过环境变量传入 |

没有材料时不要点"签名构建"：缺少证书不会因为多点几次就成功，只会多一条失败日志。

## 6. 出包后

```bash
node ../signing/scripts/scan-secrets.mjs --dir dist      # 或导出包目录
```

- 核对产物清单：安装包、`.sig`（开了更新时）、`latest.json` 的版本与 target 是否对应。
- 更新包的 `.sig` 必须存在且非空，否则客户端验签失败。
- 确认构建日志里没有打印过密码或私钥（`/p`、`--password`、`echo $env:...`）。

## 7. 换机器 / 换用户

| 现象 | 最常见原因 |
|---|---|
| `os error 5` | 缓存目录为空或不可写（见第 2 节） |
| 打出的包装不上 / 更新报签名不符 | 换了签名身份（keystore / 证书 / 别名不同） |
| 更新检查一直失败 | 更新源 http、清单版本没递增、`.sig` 缺失 |
| `tauri dev` 卡住不动 | 静态接入下被写入了 `devUrl`（模板已规避） |

## 8. 已知陷阱：安装包类型标记

Tauri 打包时会往二进制里写一个"包类型标记"，更新器靠它决定用 `msiexec` 还是 NSIS 安装器。机制是：打包前把静态 `__TAURI_BUNDLE_TYPE_VAR_UNK` 改写成 `_MSI` / `_NSS`，打包结束后还原成 `UNK`。

**打包中断或失败时可能跳过还原**（本机在 WiX 的 `os error 5` 反复失败后，二进制实际停在 `_MSI` 状态）。下一次打包找不到 `UNK`，输出：

```
Failed to add bundler type to the binary: __TAURI_BUNDLE_TYPE variable not found
```

这时打出来的包可能沿用上一次的类型，更新器会走错安装路径。处理顺序：

1. 打包失败后不要直接重打：先 `cargo clean -p lc-desktop` 或 touch 一下 `src-tauri/src/main.rs` 强制重编译；
2. 重打后确认输出里有 `Info Patching ... with bundle type information: <目标类型>`，且没有上面那条告警；
3. 需要取证时解出 MSI 载荷看标记（本机复测有效）：

```powershell
$msi = "src-tauri\target\release\bundle\msi\Example App_0.1.0_x64_en-US.msi"
$ex  = "$env:TEMP\lc-msi-x"
Start-Process msiexec -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$ex`"") -Wait
$f = Get-ChildItem $ex -Recurse -Filter lc-desktop.exe | Select-Object -First 1
$s = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($f.FullName))
foreach ($m in '__TAURI_BUNDLE_TYPE_VAR_UNK','__TAURI_BUNDLE_TYPE_VAR_MSI','__TAURI_BUNDLE_TYPE_VAR_NSS') {
  "{0} = {1}" -f $m, ([regex]::Matches($s, [regex]::Escape($m))).Count
}
```

MSI 包的期望值：`_MSI = 2`（match 字面量 + 被改写的静态）、`_NSS = 1`、`_UNK = 0`。若 `_UNK = 1` 或 `_MSI/NSS` 归属不对，说明包类型没写对，不要发更新包。

本机复测结论（crate 2.12.5 + CLI 2.12.4，`cargo clean` 后一次打 `msi,nsis`）：两次 Patching 都成功、无告警；MSI 载荷符合上面的期望值；打包结束后 target 里的 exe 已还原为 `UNK`，不重编译再打一次 NSIS 同样无告警。**补丁版不同不是这条告警的原因**（npm 最新 CLI 就是 2.12.4，没有可对齐的版本）。

未验证：NSIS 安装包内的载荷（本机没有 7-Zip，无法解包确认）。

## 9. 本机记录

本清单对应的脚本在 Windows x64 / Node 24.21.0 / rustc 1.99.0 上跑过；`npm run preflight` 输出过真实结果（含 WiX、NSIS 缓存路径与可写性）。本机没有验证的部分：干净机器首次下载 WiX/NSIS、CI 上的权限模型、Linux 分支。
