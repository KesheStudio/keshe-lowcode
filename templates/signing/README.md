# 签名模板

签名这件事没有"顺手做一下"的余地：移动端不签装不上，桌面端不签会被系统拦。这里放的是各平台的规则、可直接执行的脚本，以及一条不可越过的红线——密钥不能泄漏到任何产物里。

## 各平台的要求

| 平台 | 是否必须 | 不签的后果 | 正式分发还需要 |
|---|---|---|---|
| Android | 必须 | 无法安装（`INSTALL_PARSE_FAILED_NO_CERTIFICATES`），也无法上架 | 上传密钥 + Play App Signing |
| Windows | 建议 | SmartScreen 拦截，提示"未知发布者" | 代码签名证书（EV 更容易建立信誉） |
| Linux | 不需要 | — | — |

## 测试签名与正式签名

| | 测试签名 | 正式签名 |
|---|---|---|
| 用途 | 本机/内测安装、验证打包流程 | 对外分发 |
| 证书来源 | 脚本生成（自签 / 自建 keystore） | CA 签发或平台申请 |
| 有效期 | 短（1–10 年，够用就行） | 长（Android 上传密钥建议 ≥ 25 年） |
| 文件标记 | 文件名与目录里都有 `TEST-SIGNING-ONLY` | 无标记，单独保管 |
| 密码管理 | 可放密码管理器，允许重复用于本地测试 | 必须独立、必须有人负责备份 |
| 常见误用 | 拿去上架 → 被平台拒绝 | 丢了 → 老用户永久收不到更新 |

### Android 的两条路径

- **测试签名**：跑 `android/gen-test-keystore.ps1`（Windows）或 `android/gen-test-keystore.sh`（Linux），生成带 `TEST-SIGNING-ONLY` 标记的 keystore。只能自己安装、内测分发，**不能上架**。
- **正式签名**：用自己的上传密钥，在 Google Play 开启 Play App Signing 后上传 AAB。上传密钥单独生成、长期备份，**可上架**。

两者的包签名不同，用户从测试包切到正式包必须先卸载。

## 目录

| 路径 | 内容 | 本机验证状态 |
|---|---|---|
| [POLICY.md](./POLICY.md) | 私钥/密码的九条硬规则 | — |
| [android/README.md](./android/README.md) | keystore 生成、别名、有效期、Gradle 接线 | 生成流程已实测 |
| [android/gen-test-keystore.ps1](./android/gen-test-keystore.ps1) | Windows 一键生成测试 keystore | 已实测（keytool 生成 + 指纹输出） |
| [android/gen-test-keystore.sh](./android/gen-test-keystore.sh) | Linux 版本 | 未在本机验证（本机是 Windows） |
| [windows/README.md](./windows/README.md) | signtool 流程与自签测试证书 | 部分实测（证书生成已跑通；signtool 签名未验证，本机无 signtool） |
| [windows/gen-test-cert.ps1](./windows/gen-test-cert.ps1) | 生成自签代码签名证书 | 已实测（pfx 2622 字节 / cer 792 字节，指纹与有效期输出正常，pfx 可用密码打开） |
| [scripts/scan-secrets.mjs](./scripts/scan-secrets.mjs) | 导出包/构建产物泄漏扫描 | 已实测（正例与反例） |

## 界面侧的约定

导出包如果没配签名材料，**不要给"签名构建"按钮**：按下去只会得到一个失败提示，用户不知道缺什么。正确的做法是：

1. 只导出工程、打包说明与对应脚本。
2. 在界面上列出还缺什么（keystore、别名、密码来源），指明去哪个页面准备。
3. 明确告诉用户：这是阻塞项，不是可选项。

界面只报缺哪几项，不打印任何值。

## 一句话总结

签名能用脚本自动化，密钥管理不能。脚本解决"怎么签"，[POLICY.md](./POLICY.md) 解决"签完东西别漏出去"。
