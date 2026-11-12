# Android 签名

Android 的签名本质是"这个安装包来自同一个身份"。身份由 keystore + 别名共同决定，两者任一变化，老用户就装不上新包。

## 一键生成测试 keystore

Windows PowerShell（交互式，密码不回显、不进历史）：

```powershell
.\gen-test-keystore.ps1
```

非交互（CI / 远程 shell）：先注入环境变量，再调用脚本，**不要把密码写进命令行**。

```powershell
$env:LC_KEYSTORE_PASS = '<密码>'; .\gen-test-keystore.ps1
```

Linux：

```bash
./gen-test-keystore.sh          # 交互式，缺少 LC_KEYSTORE_PASS 时会提示输入
```

> 不要写 `-Password "你的测试密码"`，也不要写 `LC_KEYSTORE_PASS='...' ./gen-test-keystore.sh`：前者进进程列表，后者整行进 shell 历史。keytool 的 `-storepass` 同理，一律用 `-storepass:env`。

脚本做的事：找 keytool（PATH → `JAVA_HOME` → Android Studio 自带 JBR）→ 生成 PKCS12 → 打印 SHA-256 指纹 → 写一份不含密码的说明文件。密码通过环境变量传给 keytool（`-storepass:env`），**不会出现在命令行和进程列表里**。

产物默认在 `~/.lc-signing/`：

| 文件 | 说明 |
|---|---|
| `TEST-SIGNING-ONLY-upload-keystore.p12` | keystore，含私钥 |
| `TEST-SIGNING-ONLY-README.txt` | 别名、有效期、SHA-256 指纹；不含密码 |

## 参数为什么这么定

| 参数 | 取值 | 原因 |
|---|---|---|
| `-keyalg RSA -keysize 2048` | RSA 2048 | Android 从 API 18 起不接受更短的密钥；2048 是够用且兼容性最好的档位 |
| `-sigalg SHA256withRSA` | SHA-256 | 显式指定，避免不同 JDK 默认算法不一致导致同样的参数产出不同签名 |
| `-validity` | 测试 3650 天 | 测试期足够长，省得反复生成；正式上传密钥建议 ≥ 25 年 |
| `-alias` | `upload` | 一个 keystore 可以放多个密钥，gradle 靠别名找到对应的那个 |
| `-storetype` | PKCS12 | JDK 9 之后的默认格式，gradle 与 Android 工具链都支持；老项目如果是 JKS，不要中途换格式 |

**别名不是随便起的名字。** `keystore.properties` 里的 `keyAlias` 一旦和 keystore 里的别名对不上，构建会报 "Alias \<name\> does not exist"，而且错误信息出现在打包最后一步，很容易让人以为别的地方出了问题。改了别名，就等于换了一个签名身份。

**有效期到期不是小事。** 上传密钥过期后无法再给已发布应用签名，Google Play 会直接拒收更新。所以正式密钥的有效期按"比产品生命周期更长"来设，别按年设。

## 测试签名与正式签名

| | 测试 | 正式 |
|---|---|---|
| 文件 | `TEST-SIGNING-ONLY-*.p12` | 自己命名，不带 TEST 标记 |
| 有效期 | 10 年，够本机反复安装 | ≥ 25 年 |
| 密码 | 可以复用，仍需 ≥ 8 位 | 独立、专人保管、有备份 |
| 用途 | 本机安装验证 | 上架 / 分发 |

两个签名不同的包不能互相覆盖安装。用户从测试包切到正式包时，必须先卸载——这条要写进发布说明，否则会被当成"更新失败"报上来。

## Gradle 接线

Tauri 的 Android 工程在 `src-tauri/gen/android/` 下。两步：

1. 把 `keystore.properties.sample` 复制成 `src-tauri/gen/android/keystore.properties`，只填别名与 keystore 路径；**不要写密码**。
2. 把 `build.gradle.kts.snippet` 的内容合进 `src-tauri/gen/android/app/build.gradle.kts`（那个目录下有多个 `build.gradle.kts`，认准 `app/` 下这个，它有 `buildTypes` 块）。片段从 `LC_KEYSTORE_PASS` 环境变量读取口令。

`keystore.properties` 不要提交到版本库。CI 里由 secret 注入 `LC_KEYSTORE_PASS`，构建结束即失效。

不用 Gradle 接线时，也可以先出未签名 APK，再用 `apksigner sign --ks-pass env:LC_KEYSTORE_PASS --key-pass env:LC_KEYSTORE_PASS` 签名；口令同样只在进程环境里。

## Play App Signing

上架 Google Play 时现在默认启用 Play App Signing：你手里的叫"上传密钥"，Google 那边保管"应用签名密钥"。好处是上传密钥丢了还能找 Google 重置；坏处是首次上传时的密钥决定了应用身份，不能随便换。如果没启用 Play App Signing，keystore 丢了就等于这个应用永久无法更新。

## 备份与恢复

- 备份对象：`.p12` 文件 + 密码 + 别名。三者缺一不可，分开存放（文件在离线介质，密码在密码管理器）。
- 恢复：把 `.p12` 放回原路径、`keystore.properties` 指向它，构建时用同一别名。
- 导出/恢复必须是用户主动操作，界面上要明确写"丢失后已发布应用无法更新"。不做自动导出，不写进浏览器存储。

## 常见故障

| 现象 | 真实原因 | 第一步查什么 |
|---|---|---|
| `Alias <name> does not exist` | keystore.properties 的 keyAlias 与 keystore 里的不一致 | `keytool -list -keystore <file>` 看实际别名 |
| `Keystore was tampered with, or password was incorrect` | 密码错，或文件被截断/损坏 | 用 `keytool -list` 单独验证 keystore 能打开 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 新旧包签名不同 | 对比两个包的签名指纹，不是比较版本号 |
| 打包成功但没签名 | `signingConfig` 没接到 `release` 的 `buildTypes` | 看 build.gradle.kts 里 release 块是否真的引用了 signingConfig |
| 属性文件读不到 | `storeFile` 的反斜杠没转义 | 用 `C:\\Users\\...` 或正斜杠 `C:/Users/...` |

## 本机实测记录

本机（Windows，JDK 自带 keytool）实测：脚本能定位 keytool、生成 PKCS12、输出 SHA-256 指纹、写出不含密码的说明文件；`keytool -list -v` 能正常读出别名与有效期。`-storepass:env` 可用，密码确实没有出现在命令行里。

未在本机验证：Gradle 真正产出 APK/AAB（本机没有 Android SDK 与对应 Gradle 工具链），以及真机安装。这部分只给了配置与命令，不宣称跑通。
