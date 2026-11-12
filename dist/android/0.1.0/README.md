# 科设低代码平台 0.1.0 · Android 安装包

## 产物

| 文件 | ABI | 大小 | SHA256 |
| --- | --- | --- | --- |
| `KesheLowCode-0.1.0-arm64.apk` | arm64-v8a | 7,575,741 B（约 7.22 MiB） | `9e896b5c1190ff0569b55f9d42cf2ae780c8aa5b0795de354f1ee8b7477e11c2` |
| `KesheLowCode-0.1.0-universal.apk` | arm64-v8a + x86_64 | 14,137,610 B（约 13.48 MiB） | `29e305b45d622b805404e02979628064a5d2529855494a3e01ed9404319224d5` |

- 应用名（桌面显示）：科设低代码平台
- 英文名：Keshe LowCode
- 包名：`com.keshestudio.lowcode`
- 版本：versionName `0.1.0`，versionCode `1000`
- minSdk 24（Android 7.0），targetSdk 37（Android 17），compileSdk 37
- 签名：临时测试 keystore（`CN=KesheStudio, OU=Release, O=KesheStudio, L=Shanghai, ST=Shanghai, C=CN`），证书 SHA256 `f0100ec89168b29fe74cd73beeba289f36e68b4b2bf92e247b374d1a12bfaed9`；keystore 已删除，**不可用于正式商店发布**
- 图标：仍为模板内置占位图标（深色圆角方块 + 三条斜杠，中间一条绿色），未替换正式品牌图标

## 该装哪个

| 场景 | 选择 |
| --- | --- |
| 绝大多数安卓手机（arm64 真机） | `KesheLowCode-0.1.0-arm64.apk` |
| 安卓模拟器（x86_64） | `KesheLowCode-0.1.0-universal.apk` |
| 不确定设备 ABI，想一份包通吃 | `KesheLowCode-0.1.0-universal.apk` |

- `arm64` 包只含 `lib/arm64-v8a/liblc_desktop_lib.so`（5,901,560 B），无法安装到 x86_64 模拟器。
- `universal` 包同时含 `lib/arm64-v8a/liblc_desktop_lib.so`（5,901,560 B）与 `lib/x86_64/liblc_desktop_lib.so`（6,548,736 B），真机与模拟器都能装。
- 不再提供仅 x86_64 的包；模拟器请用 universal。

## 安装

```powershell
# 覆盖安装（保留数据）
adb install -r KesheLowCode-0.1.0-universal.apk

# 卸载
adb uninstall com.keshestudio.lowcode
```

也可以把 APK 传到手机后在文件管理器中打开，按系统提示允许“安装未知来源应用”。若系统提示“应用与您的手机不兼容”，通常是装错了 ABI（例如把 arm64 包装到 x86_64 模拟器，或把旧 x86_64 包装到 arm64 真机）。

## 校验 SHA256

```powershell
Get-FileHash .\KesheLowCode-0.1.0-arm64.apk -Algorithm SHA256
Get-FileHash .\KesheLowCode-0.1.0-universal.apk -Algorithm SHA256
```

也可直接与同目录 `SHA256SUMS.txt` 对照。

## 本次验证记录

| 项目 | 结果 |
| --- | --- |
| ABI / 包结构 | arm64 包 `lib/arm64-v8a/liblc_desktop_lib.so`；universal 包 arm64-v8a + x86_64 两个非空 `.so` |
| 包元数据（aapt2） | package=`com.keshestudio.lowcode`，label=科设低代码平台，minSdk=24，targetSdk=37，versionName=0.1.0 |
| 签名校验（apksigner） | 两个包 `Verification successful`，证书 DN 为 KesheStudio |
| 字节对齐（zipalign） | 两个包 `Verification successful` |
| 模拟器安装（Medium_Phone_API_37.0，Android 17，x86_64） | universal 包 `adb install` 返回 Success；`primaryCpuAbi=x86_64` |
| 模拟器运行 | 启动 `com.keshestudio.lowcode/.MainActivity`，pid 稳定，无 FATAL EXCEPTION |
| 模拟器卸载 | `adb uninstall` 返回 Success，`pm list packages` 无残留 |
| arm64 真机 | 本次未连接 arm64 设备（`adb devices` 仅有 emulator-5554），未做实机安装；已完成 ABI、minSdk/targetSdk、包名与签名的静态校验 |

> 上一轮同代码的 arm64 包曾在 vivo iQOO Z10 Turbo Pro 上安装并运行通过；本次因项目定名改为 `com.keshestudio.lowcode` 重新打包，未再次上真机复测。arm64 真机请安装 `KesheLowCode-0.1.0-arm64.apk`。
