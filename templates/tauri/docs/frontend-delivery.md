# 前端产物怎么进桌面壳

导出桌面应用时，前端就两件事：把文件塞进应用，或者让应用去访问一个已经在跑的服务。前者是默认，后者要额外承担一个进程和一张证书。

## 两条路径的取舍

| | 资源内嵌（static，默认） | 外部服务（server） |
|---|---|---|
| 配置 | `delivery.mode = "static"`，`webDir = "../web"` | `delivery.mode = "server"`，地址由 `protocol` + `https.host/port` 拼 |
| 产物位置 | 构建前放在 `web/`（或配置指向的目录），编译进二进制 | 放在服务端的静态目录，构建包里没有页面 |
| 谁在提供页面 | Tauri 内置的自定义协议 | 你自己的进程（本地或远程） |
| 需要证书 | 不需要 | https 时需要，而且必须被系统信任 |
| 安装包体积 | 变大（页面随二进制走） | 变小 |
| 断网可用 | 是 | 否（页面本身都可能加载不出来） |
| 适用场景 | 纯静态站、离线工具、不想多起进程 | 已经有一个本地后端/需要服务端渲染/页面要热更新 |

一般静态站没有理由选 server：多一个进程就多一类崩溃、多一个端口冲突、多一张要装的证书。

## 路径 A：资源内嵌

`src-tauri/tauri.conf.json` 里的 `build.frontendDist` 指向 `../web`。这个路径是**相对 `src-tauri/` 目录**解析的，不是相对仓库根目录，改路径时容易在这里翻车。

构建时 Tauri 会把该目录整个读进去，编到二进制里；`tauri build` 之后再去改 `web/` 是没用的，得重新构建。运行时页面由自定义协议提供：

- Windows / Android：`http://tauri.localhost`
- Linux：`tauri://localhost`

配置里的 `protocol` 只影响 Windows/Android 上是否把 scheme 换成 `https://tauri.localhost`（Tauri 的 `useHttpsScheme`）。这不是真的 TLS，没有证书参与，只是让页面处于安全上下文。注意：切换这个开关会改变页面来源（origin），之前存的 localStorage / IndexedDB 会读不到，别在版本迭代中途随手切换。

还有一个容易忽略的点：内嵌协议**没有 SPA 回退**。请求一个不存在的路径就是 404，不会回落到 `index.html`。多页面静态站正好符合这个行为；单页应用需要自己处理路由。

`tauri dev` 不写 `devUrl`（静态模式下渲染脚本会刻意不写），直接加载 `web/` 里的内容：改页面刷新窗口即可，不需要另起开发服务器。如果硬写一个没人监听的 `devUrl`，`tauri dev` 会一直等那个地址，看起来像卡死。

## 路径 B：外部服务

`frontendDist` 写成一个 URL（`https://localhost:1420` 或 `http://127.0.0.1:8080`），窗口创建后直接导航过去。三个后果必须提前接受：

1. 服务必须先起来。启动顺序没处理好，用户看到的是白屏，不是错误提示——因为窗口本身没问题，只是页面没加载出来。
2. 服务挂了，应用就废了，连"服务未启动"这种提示都得由壳自己渲染（但壳渲染不了，页面在白屏）。所以这条路径通常要配一个 sidecar 进程和启动探活。
3. https 就要处理证书信任，详见 [https.md](./https.md)。

本地回环场景优先选 `http://127.0.0.1`：不出网、不需要证书、也没有信任链问题。代价是本机其它进程能抓包，且页面不是安全上下文（`crypto.subtle` 之类会受限）。桌面壳里页面来源固定，风险面比公网小得多。

## 前端怎么知道后端地址

渲染脚本会生成 `web/desktop-config.js`，内容是一段普通 JS：

```js
window.__LC_DESKTOP__ = {
  "appName": "Example App",
  "appVersion": "0.1.0",
  "protocol": "https",
  "deliveryMode": "static",
  "backend": { "enabled": false, "baseUrl": "http://127.0.0.1:8080" }
};
```

前端页面按需引入它，不依赖任何 Tauri JS API，也不需要额外权限：

```html
<script src="./desktop-config.js"></script>
<script>
  var cfg = window.__LC_DESKTOP__ || {};
  if (cfg.backend && cfg.backend.enabled) {
    fetch(cfg.backend.baseUrl + '/api/articles');
  }
</script>
```

导出管线替换 `web/` 时要重新生成这个文件（`node scripts/prepare-frontend.mjs --web <产物目录>`），否则前端拿不到配置，但页面本身不会报错——属于"看起来能用、后端地址却是默认值"的隐性故障。

跨域提醒：页面的 origin 是 `https://tauri.localhost`（或 `http://tauri.localhost`），后端要把它加进 CORS 白名单，而不是加 `localhost:1420`。

## 白屏排查顺序

| 现象 | 常见原因 | 第一步查什么 |
|---|---|---|
| 窗口出来了，全白 | `frontendDist` 指向错目录 / 目录里没有 `index.html` | 构建日志里 assets 的数量；`web/` 是否真的有 `index.html` |
| 只有文字没有样式 | CSS 路径写成绝对 `/assets/...`，加载到了不存在的路径 | 开发者工具 Network 面板 |
| 页面 404 | 用了 SPA 路由，内嵌协议不回退 | 请求的路径与文件是否一一对应 |
| `tauri dev` 一直转圈 | 写了 `devUrl` 但服务没起 | `tauri.conf.json` 的 `build.devUrl` |
| 控制台 CSP 报错 | 页面引用了外域资源 | `app.security.csp` 里是否放行了该来源（模板默认只允许自身） |
| 改了页面没生效 | 改的是构建后的 `web/`，没重新 build | 是否重新执行 `tauri build` |

## 产物侧的约定

- `web/` 里不要有指向 CDN、外链字体、外链图片的引用：桌面端断网时这些资源拿不到，而且 CSP 默认会拦。
- 目录结构原样保留（文章路径约定不变），不要在桌面工程里重新组织。
- 文件名大小写敏感：Windows 上开发、Linux 上构建时，`Assets/CSS/x.css` 和 `assets/css/x.css` 是两个东西。
