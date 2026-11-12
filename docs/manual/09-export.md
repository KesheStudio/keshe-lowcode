# 09 导出：Web 静态包与 Tauri 桌面工程

> 本篇目标：会走完导出向导，产出 Web 静态包；会配站点域名与路径前缀；会导出 Tauri 工程，并知道 Windows / Linux / Android 各自怎么出安装包、安卓该装哪个 APK。
>
> 导出向导只负责**生成产物**，不会替你启动 nginx、构建安装包或签名 APK。部署见第 10 章。

---

## 一、从哪里进入导出

三个入口，效果一样：

- 工作台项目卡片上的「导出」；
- Builder 顶栏「导出」；
- 直接打开 `export.html`，再在顶栏选站点。

进入后是四步向导：

```text
1 导出目标
2 内容与压缩
3 运行环境
4 体积与执行
```

左侧步骤可以点击回跳。页面顶部的站点下拉决定导出哪个站点。

### 配置加载完成前不可编辑（设计行为）

导出配置（站点域名、Web 路径前缀、桌面配置、后端与部署配置）是异步读取的。打开页面或切换站点后，向导会先显示「正在加载项目配置…」并禁用这些字段，等目标站点的配置到达后才解锁。

这是设计而不是缺陷：如果配置还没回来就允许填写，异步返回的项目默认值会无声覆盖已经输入的内容。切换站点时同样先关门再取数，旧站点的值不会残留在目标站点上。极端情况下（浏览器回填或加载期间快速操作）已经产生的输入会被保留，配置返回后向导会明确提示「已保留加载期间的输入」。

---

## 二、第 1 步：选导出目标

### Web 静态（默认）

产出 HTML / CSS / JS 与资源，可选压缩、数据快照和后端模板。

关键限制写在选项下方：

> 产物必须通过 http(s) 访问：部署到 nginx，或在本机用静态服务打开。直接双击 `index.html` 不可用（会看到说明页，不是正常站点）；想要双击直接用，请选 Tauri 桌面。

所以：

- 给服务器部署 → 选 Web 静态；
- 想双击就能打开的桌面程序 → 选 Tauri 桌面。

### Tauri 桌面

产出**可构建的 Tauri 工程**（`desktop/`），不是现成安装包。向导不会调用 `tauri build`，也不会替你签名。

---

## 三、第 2 步：内容与压缩

### 站点内容范围

| 选项 | 说明 |
| --- | --- |
| 全部页面 | 导出站点里所有页面 |
| 选定页面 | 只导出勾选的页面 |

选「选定页面」时要逐个勾选。导出管线会扫描已选页面与外壳里的 `pageId` / `href`，把被导航、页脚、侧栏或正文引用的站内页面自动补进导出范围，并把补入结果写进导出提示（`LC_W_SCOPE_EXPANDED`）。因此只选首页时，导航里的「关于」「联系」也会一起导出，不会留下死链。

没有被任何已导出页面引用的页面仍然保持排除，同时给出「只导出 X/Y 个页面」的提示。

### 版本号

可留空。填写后会写进产物清单与构建记录；留空时构建 ID 自带时间戳。

### 三个开关

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| 压缩 CSS / JS | 开 | 通常省 10%–25%，产物仍可读 |
| 压缩 HTML | 关 | HTML 已被 zip 的 DEFLATE 压缩，再压通常只会让 zip 变大 |
| 快照数据源 | 开 | 把 `data/sources.json`、collections、mocks 原样打进 `web/data/`，导出后不实时请求 |

「快照数据源」是静态产物能拿到数据的唯一方式：导出时拷一份数据，之后数据变了也不会自动更新。

### Tauri 应用配置（只在选 Tauri 时出现）

| 字段 | 规则 | 示例 |
| --- | --- | --- |
| 应用名 | 显示在窗口标题和安装包名称里 | `Builder 演练场` |
| 标识符 | 反向域名，不能含空格；Android 目标不能含连字符 | `com.example.playground` |
| 桌面版本号 | semver，不能带 `v` 前缀 | `0.1.0` |
| 目标平台 | Windows / Linux / Android | — |

格式不合法会直接阻止导出。

### 目标平台对应产物

| 目标平台 | 安装包类型 | 构建机要求 |
| --- | --- | --- |
| Windows | `msi` / `nsis` | Windows |
| Linux | `appimage` / `deb` / `rpm` | Linux（rpm 在 Windows 上不支持） |
| Android | `apk` / `aab` | Windows 或 Linux 均可 |

Tauri 不做跨平台交叉编译：要出 Linux 包，就在 Linux 构建机上构建。

### Android 专属配置

| 字段 | 说明 |
| --- | --- |
| Android 签名 | 「测试签名（脚本生成 keystore，只能自己装）」或「正式签名（自己的上传密钥，可上架）」 |
| keystore 路径（构建机） | 只写路径，密码不要写进配置；构建时用环境变量注入 |
| 密钥别名 | 例如 `upload` |

签名区别：

- **测试签名**：脚本生成 keystore，文件名带 `TEST-SIGNING-ONLY`，适合真机调试与内测；Google Play 会拒绝测试签名包；
- **正式签名**：使用你自己的上传密钥，并开启 Play App Signing；上架用 AAB。

### 协议与 HTTPS

| 字段 | 说明 |
| --- | --- |
| 协议 | `https`（推荐，自定义协议走 https scheme）或 `http`（仅回环地址） |
| HTTPS 模式 | 生成测试证书（自签）/ 导入已有证书 / 不使用 HTTPS |

注意：

- 生成的自签证书**不会被系统信任**，安装或打开时会弹证书警告，不能给真实用户；
- 导入证书和私钥只留在构建机，不写进导出包；私钥进包会导致导出校验直接失败。

### 自动更新

默认关闭。开启时必须同时提供：

- `https` 更新地址；
- 更新签名公钥。

否则导出会被阻止。

---

## 四、第 3 步：运行环境

这一步选的是**本次导出**附带的服务端模板，不会改变项目类型。

### 后端模板

| 选项 | 说明 |
| --- | --- |
| 无后端 | 只导出静态站点 |
| Rust | 默认，axum + sqlx 服务模板 |
| Node | Node 服务模板，启动最快 |
| Go | Go 服务模板 |

即使项目创建时是纯静态，这里也能选后端；反过来，带后端项目也能选「无后端」只出静态站。这个选择只作用于本次导出。

### 数据库与 Redis

| 字段 | 说明 |
| --- | --- |
| 数据库 | 不使用 / SQLite（随包文件）/ MySQL / PostgreSQL |
| 主机、端口、库名、用户名、密码 | 选非 SQLite 时填写 |
| 使用 Redis | 默认关闭；关闭时后端用内存缓存 |

说明：

- 这里只保存连接参数，向导**不会连接、建库或改写任何数据库**；
- 密码只保存在本机站点配置里，界面不回显；
- 导出包里的 `config.yaml` 只写空密码，部署时用 `LC_DB_PASSWORD` / `LC_REDIS_PASSWORD` 注入；
- 示例端口刻意避开 3306 / 6379，减少误连已有服务。

### 站点域名与访问路径

| 字段 | 说明 |
| --- | --- |
| 站点域名 | 可带协议与端口，例如 `https://example.com`、`example.com`、`http://localhost:8080` |
| 路径前缀 | 默认 `/`；部署在子目录时填 `/app` |
| 额外允许来源 | 每行一个 CORS 来源；本地开发地址加在这里 |

规则：

- 域名留空会回退 `localhost`，导出结果提示「仅本机可用」；
- 域名里不能带路径，子目录请用「路径前缀」；
- 生成的 nginx 用该域名做 `server_name`，证书 SAN 与 CORS 允许来源跟着走；
- 路径前缀会作用到页面链接、资源引用和后端基址。

地址提示会实时显示，例如：

```text
域名未配置，仅本机可用；公开基址：http://localhost
```

或：

```text
公开基址：https://example.com/app
```

### nginx 配置

默认关闭。开启后：

- 产物带 `deploy/nginx/nginx.conf`；
- 可以直接在编辑框里改；
- 「恢复默认」只替换编辑框内容，不覆盖你手写的版本（保存前不会动磁盘）；
- 「撤销恢复」能回到手写版本；
- 点「保存运行环境配置」后写入站点 `config/nginx.conf`，导出时覆盖 `deploy/nginx/nginx.conf`；
- 向导不会启动、重载或探测任何 nginx 进程。

---

## 五、第 4 步：体积与执行

### 预估体积

点「预估体积」会**真实跑一遍渲染与压缩**，但不写构建记录。结果包括：

- 压缩包 zip；
- 解压后总量；
- 页面 HTML；
- 站点 CSS / JS；
- 运行时与第三方库；
- 资源与部署文件；
- mermaid 图表库占用；
- 桌面工程目标（选 Tauri 时）；
- 按页面体积、最大文件列表；
- 预估问题清单。

预估发现问题时先修，再正式导出。

### 开始导出

点「开始导出」后：

1. 显示进度条、阶段文案和百分比；
2. 完成后显示「成功 / 失败」徽标；
3. 产物保存在站点：

```text
builds/<构建ID>/artifact.zip
```

4. 可以点「下载压缩包」；
5. 可以点「构建记录」，查看范围、压缩与体积明细。

常见阶段文案：

```text
准备
渲染页面
生成主题
打包资源
写入后端模板
压缩
完成
```

失败时下方「失败项」会列出原因和涉及文件。

---

## 六、Web 静态包里有什么

典型结构：

```text
web/
  index.html
  其它页面.html
  assets/
  data/                （开启快照时）
deploy/
  nginx/nginx.conf     （开启时）
  README.md
server/                （选了后端模板时）
desktop/               （选了 Tauri 时）
docs/
  build-app.md
```

具体以构建记录里的文件清单为准。

### 为什么不能双击打开

产物里的脚本和资源按 http(s) 基址加载，并且页面通过 fetch 读 `web/data/`。`file://` 下会被浏览器拦截，所以双击 `index.html` 只会看到说明页。

正确打开方式：

- 部署到 nginx（第 10 章）；
- 或在本机用任意静态服务器指向 `web/`。

---

## 七、Tauri 桌面工程：怎么变成安装包

导出后得到的是工程，需要构建机具备工具链：

- Rust；
- Windows：MSVC 构建工具；
- Linux：系统构建依赖；
- Android 额外需要 JDK 17/21、`ANDROID_HOME`（含 platform / build-tools）、NDK 27、Rust Android 目标。

工程自带 `scripts/build-app.mjs` 和 `docs/build-app.md`，按文档执行：

```bash
node scripts/build-app.mjs --project <工程目录> --out <输出目录> --platform win32
node scripts/build-app.mjs --project <工程目录> --out <输出目录> --platform linux
node scripts/build-app.mjs --project <工程目录> --out <输出目录> --platform android
```

平台参数：

| 参数 | 取值 |
| --- | --- |
| `--platform` | `win32` / `linux` / `android` |
| `--targets` | Windows `msi,nsis`；Linux `appimage,deb,rpm`；Android `apk,aab` |
| `--android-targets` | `aarch64,armv7,i686,x86_64` 的子集 |

构建产物会收集到 `--out` 目录，日志在 `--out/logs/`。

### 失败返回怎么读

构建失败会返回结构化 JSON，例如：

```json
{
  "ok": false,
  "code": "E_TOOLCHAIN_MISSING",
  "stage": "preflight",
  "message": "...",
  "hint": "...",
  "logs": { "path": "..." }
}
```

先看 `hint` 和 `logs.path`，不要只看最后一行报错。

---

## 八、Android：装哪个 APK（重点）

### 默认产出 universal

Android 构建的默认 ABI 是：

```text
aarch64 + x86_64
```

也就是同时编译 **arm64-v8a** 和 **x86_64**，产出 **universal APK**。手机和模拟器都能装。

对应命令（不写 `--android-targets` 就是这个默认值）：

```bash
node scripts/build-app.mjs --project <工程目录> --out <输出目录> \
  --platform android --targets apk
```

### 真机装哪个

| 设备 | 建议安装 |
| --- | --- |
| 绝大多数安卓真机（含 vivo / iQOO） | **universal** 或 **arm64** 包 |
| x86_64 模拟器 | x86_64 包（体积更小） |
| 只编了 x86_64 的包 | **不要发给真机** |

原因：绝大多数真机只认 `arm64-v8a`。只含 `x86_64` 的 APK 在真机安装时会提示：

```text
指令集与当前设备 ABI 均不匹配
```

这不是签名问题，也不是安装权限问题，而是包里没有设备需要的 CPU 架构。

所以：

- 给用户分发，优先 universal；
- 包体积敏感时，给真机单独出 arm64：

```bash
node scripts/build-app.mjs --project <工程目录> --out <输出目录> \
  --platform android --targets apk --android-targets aarch64
```

- `x86_64` 只用于模拟器调试，不要当成“真机调试包”。

### 安装步骤

1. 手机开启「开发者选项」和「USB 调试」；
2. 用数据线连接电脑，执行：

```bash
adb devices
adb install -r <应用名>-universal-release.apk
```

3. 如果没有 adb，把 APK 传到手机，用文件管理器点开安装；
4. 系统提示「未知来源」时，允许当前文件管理器安装未知应用；
5. 安装失败提示 `INSTALL_FAILED_NO_MATCHING_ABIS`，就是装错了 ABI，换 universal 或 arm64 包。

### 签名

- release APK 默认**未签名**；
- 测试包用工程里的 `templates/signing/android/gen-test-keystore.*` 生成 keystore，口令只经环境变量传入；
- 签名命令：

```bash
apksigner sign --ks test.p12 --ks-pass env:LC_KEYSTORE_PASS --key-pass env:LC_KEYSTORE_PASS app-release.apk
apksigner verify --print-certs app-release.apk
```

- 测试 keystore 只能自己安装，不能上架；
- AAB 需要 Google Play 用上传密钥重签，不能直接用 `apksigner` 安装。

### Windows 构建机常见坑

Tauri 会把 Rust 产出的 `.so` 以符号链接放进 `jniLibs`。未开启 Windows 开发者模式时会报：

```text
Creation symbolic link is not allowed for this system
```

解决：

- 开启 Windows 开发者模式；或
- 手动把 `.so` 复制到 `app/src/main/jniLibs/<abi>/`，再执行：

```text
gradlew.bat :app:assemble<Abi>Release -x rustBuild<Abi>Release
```

### Android 启动报 UnsatisfiedLinkError

检查 `src-tauri/src/lib.rs` 的 `run()` 是否带：

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
```

缺了它桌面端照常，Android 启动会报：

```text
UnsatisfiedLinkError: No implementation found for ... Rust.onCreate
```

---

## 九、导出结果里的提示怎么处理

| 提示 | 含义 | 处理 |
| --- | --- | --- |
| 域名未配置，仅本机可用 | 没填站点域名 | 正式部署前补域名并重新导出 |
| 选定页面存在未导出链接 | 导航指向被排除的页面 | 补导出页面，或改导航 |
| 用户代码覆盖存在 | 页面/流程有覆盖代码 | 确认覆盖内容已随产物带走 |
| 桌面模板缺失 | Tauri 工程文件不全 | 检查模板目录，重新导出 |
| 自签证书仅测试 | HTTPS 用了生成证书 | 正式发布改导入可信证书 |
| 私钥进包 | 证书私钥被写进导出包 | 导出会被直接阻止，移出私钥 |

---

## 十、常见问题

### 1. 导出成功后双击 index.html 打不开？

正常。Web 静态产物必须通过 http(s) 访问。用 nginx 或本地静态服务器；想双击就用 Tauri 桌面。

### 2. 选了「无后端」，为什么页面接口 404？

静态产物没有服务端。后端积木、集合实时读写、鉴权都需要服务端模板。需要这些能力就重导并选 Rust / Node / Go。

### 3. 路径前缀填了 `/app`，为什么资源 404？

检查：

- nginx 是否真的部署在 `/app` 子目录；
- 反向代理是否剥掉或保留了前缀；
- 页面里是否有手写的绝对路径没走导出基址。

### 4. Android 包在真机提示 ABI 不匹配？

装错包了。换 universal 或 arm64 包。只含 x86_64 的包只适合模拟器。

### 5. APK 安装被拒，提示签名冲突？

手机上已装过同包名、不同签名的版本。先卸载旧版，或用相同 keystore 签名。

### 6. 导出很慢 / 卡在压缩？

先看进度阶段。大站点、开启 HTML 压缩、包含大量图片时会慢。关掉「压缩 HTML」通常更快，zip 也更小。

### 7. 导出 Tauri 工程后没有安装包？

向导只导出工程。安装包要在构建机执行 `build-app.mjs` / `tauri build`，并准备对应工具链。

### 8. 预估通过，正式导出失败？

预估是 dry run，不写构建记录；正式导出还会写盘、压缩、校验签名与私钥。失败项里通常会指出具体文件或权限问题。

---

## 本篇检查清单

- [ ] 能分清 Web 静态和 Tauri 桌面各自产出什么；
- [ ] 知道 Web 静态包不能双击打开；
- [ ] 会选全部页面 / 选定页面，并知道死链提示；
- [ ] 知道三个压缩/快照开关的默认值和作用；
- [ ] 会填站点域名、路径前缀和额外 CORS 来源；
- [ ] 知道域名留空会回退 localhost 并提示仅本机可用；
- [ ] 会保存 nginx 配置，并知道「恢复默认」只改编辑框；
- [ ] 会选后端模板，并知道它只作用于本次导出；
- [ ] 会预估体积、开始导出、下载 `builds/<构建ID>/artifact.zip`；
- [ ] 知道 Tauri 只导出工程，安装包要自己构建；
- [ ] 知道 Windows / Linux / Android 各自的构建机与产物类型；
- [ ] 知道 Android 默认 universal 含 arm64-v8a 与 x86_64；
- [ ] 知道真机装 universal 或 arm64，只有 x86_64 的包会报 ABI 不匹配；
- [ ] 会用 `adb install -r` 安装，并知道测试签名不能上架。

下一篇：[10 部署](10-deployment.md)。会讲 nginx、HTTPS 证书、后端反向代理和 CORS。
