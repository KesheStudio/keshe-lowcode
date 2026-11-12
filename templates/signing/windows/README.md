# Windows 代码签名

Windows 上的签名有两个层次：**让系统知道是谁发布的**（代码签名证书），**让系统不弹警告**（信誉，需要时间和 EV 证书）。第一步做完了，也不代表第二步自动成立——这是最容易被误解的地方。

## 正式签名需要什么

| 材料 | 说明 |
|---|---|
| 代码签名证书 | OV 或 EV，`.pfx` 格式，带私钥与密码 |
| 私钥密码 | 只放环境变量或交互输入，不进命令行参数 |
| 时间戳服务 | 不加时间戳的签名在证书过期后失效 |

`signtool` 来自 Windows SDK，不在系统 PATH 里时要写全路径（通常在 `C:\Program Files (x86)\Windows Kits\10\bin\<版本>\x64\signtool.exe`）。

手动签名推荐**先把证书导入当前用户存储，再按指纹签**——这条路完全不需要密码：

```powershell
# 只做一次。密码由 Import-PfxCertificate 交互提示，不经过命令行、不进历史记录。
Import-PfxCertificate -FilePath app.pfx -CertStoreLocation Cert:\CurrentUser\My

# 取指纹（输出的 Thumbprint 一列）
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert

signtool sign /fd sha256 /sha1 <THUMBPRINT> `
  /tr http://timestamp.digicert.com /td sha256 app.msi
signtool verify /v /pa app.msi
```

`/fd sha256` 与 `/td sha256` 两处都要给：只给一个时，部分老系统仍会认为签名是 SHA-1。

> **不要用 `/f app.pfx /p <密码>`**：PowerShell 会先把密码展开成明文再交给 `signtool`，它会出现在进程列表、CI 日志和 shell 历史里；而且 `signtool` 没有"从环境变量读密码"的选项，一旦写成命令行就收不回来。必须用 `.pfx` 直签时，只在一次性 CI 里用专用密钥库，并确保该命令不被打印。

Tauri 侧也可以直接接线（`src-tauri/tauri.conf.json` 的 `bundle.windows`）：

| 字段 | 用途 |
|---|---|
| `certificateThumbprint` | 证书已导入本机证书存储时，用指纹指定 |
| `digestAlgorithm` | 设为 `sha256` |
| `timestampUrl` | 时间戳服务地址 |
| `signCommand` | 自定义签名命令（需要把签名交给第三方工具时） |

证书装在"当前用户 → 个人"存储里时，`tauri build` 能直接找到指纹对应的证书；装在机器存储或只给了 `.pfx` 文件时，用 `signCommand` 调 `signtool` 更省事。

## 自签测试证书

测试签名能验证"打包 → 签名 → 安装"这条链路，但**不能解决用户机器上的 SmartScreen 拦截**。自签证书在任何没手动信任它的机器上都等同于未知发布者。

生成（不需要管理员权限，证书写进当前用户存储）：

```powershell
# 交互式（推荐）：密码只存在于当前进程的内存里
$pw = Read-Host -AsSecureString "证书密码"
.\gen-test-cert.ps1 -Password $pw

# 非交互（CI / 远程 shell）：用环境变量，不用命令行参数
$env:LC_CERT_PASS = '<密码>'; .\gen-test-cert.ps1
```

> `powershell -File gen-test-cert.ps1 -Password $pw` 不能用：跨进程只能传字符串，SecureString 会变成明文。被 ExecutionPolicy 拦住时用 `Set-ExecutionPolicy -Scope Process Bypass`（只影响当前窗口），不要改机器策略。

脚本会生成一张代码签名用途的自签证书（RSA 2048 / SHA-256 / 3 年）、导出 `test-codesign.pfx` 与 `test-codesign.cer`、打印指纹，不打印密码；目标文件已存在时直接报错，不覆盖旧私钥。

在**测试机**上信任它（两步都要做，缺一个 signtool verify 仍会失败）：

```powershell
Import-Certificate -FilePath test-codesign.cer -CertStoreLocation Cert:\CurrentUser\Root
Import-Certificate -FilePath test-codesign.cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

这属于修改本机证书存储，脚本不替你执行；要不要信任由你自己决定。

## 会被拦的几种情况

| 现象 | 真实原因 | 第一步查什么 |
|---|---|---|
| "未知发布者" | 没签名，或签名证书不在信任链里 | 右键安装包 → 属性 → 数字签名 |
| 签了名还是被 SmartScreen 拦 | 证书信誉不足（新证书常见） | 换 EV 证书，或等信誉累积；拦截不是签名的 bug |
| `signtool verify` 报证书链错误 | 缺中间证书 | 用完整证书链导出 `.pfx` |
| 签名在证书过期后失效 | 没加时间戳 | 命令里是否有 `/tr` 与 `/td` |
| 安装包被改过后签名失效 | 签名后又改了包（例如替换图标） | 签名必须是打包的最后一步 |

## 本机验证状态

已在本机验证：

- `gen-test-cert.ps1` 端到端跑通：生成自签证书（RSA 2048 / SHA-256 / 3 年），导出 `test-codesign.pfx` 2622 字节、`test-codesign.cer` 792 字节，打印出 `SHA256 0736D547…` 与有效期 `2026-11-08 → 2029-11-08`；`.pfx` 用同一密码可正常打开（指纹一致）。验证后已删除该测试证书与临时目录。
- 脚本的非交互入口（`LC_CERT_PASS` 环境变量）可用；`powershell -File` 传 `-Password` 会失败（SecureString 不能跨进程），README 已改为直接调用或走环境变量。

未在本机验证（如实记录）：

- 本机没有 `signtool`（未装 Windows SDK），所以上面的 `signtool sign` / `signtool verify` 命令没有实际跑过。
- 没有把证书导入信任存储（会修改本机证书存储），"信任后不再报未知发布者"这一步未实测。
- 未用该证书实际签过 MSI/NSIS 产物，只验证了证书与 `.pfx` 本身可用。
- MSI 打包曾以 `拒绝访问 (os error 5)` 失败，手动种 WiX 缓存后成功；这属于打包工具链的目录问题，不是签名问题，详见 `../../tauri/README.md` 的构建记录。

结论：证书生成链路已跑通，`signtool` 签名与验签仍未在本机验证。
