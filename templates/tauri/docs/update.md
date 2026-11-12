# 更新清单、签名校验与版本比较

桌面端的自动更新有三步：构建产出带签名的更新包 → 写一份清单放到服务器 → 客户端拉清单、验签、比版本。任何一步省掉，更新都会静默不生效。

## 清单长什么样

`node scripts/gen-update-manifest.mjs` 实际生成的结果（签名内容是示意）：

```json
{
  "version": "0.2.0",
  "notes": "修复导出目录为空的问题",
  "pub_date": "2026-11-07T18:29:57Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
      "url": "https://updates.example.com/desktop/App_0.2.0_x64_en-US.msi"
    }
  }
}
```

| 字段 | 作用 | 注意 |
|---|---|---|
| `version` | 新版本号，semver | 客户端拿它和已装版本比大小 |
| `notes` | 更新说明 | 可空；有 UI 时展示给用户 |
| `pub_date` | 发布时间（UTC） | 建议真实时间，便于排查"为什么没更新" |
| `platforms` | 按目标平台列条目 | key 必须是 `windows-x86_64`、`linux-x86_64` 这类标准串 |
| `platforms[*].url` | 安装包完整 URL | 必须 https（内网调试例外） |
| `platforms[*].signature` | 安装包的 `.sig` 内容 | 整段 base64，不是文件路径 |

只写 `url` 和 `signature` 两个字段。多塞自定义字段虽然当前会被忽略，但一旦上游把解析收紧，整份清单会直接失效——这种"明明没改逻辑却突然不更新"的故障不值得留。

## 先签字，再发布

更新包的签名密钥和代码签名证书是两套东西，别混在一起：

```bash
# 生成更新签名密钥（只做一次，私钥务必离线备份）
npm run tauri signer generate -- -w ~/.tauri/lc-updater.key
```

- 公钥内容填进 `config/desktop.json` 的 `update.pubkey`，会渲染到 `plugins.updater.pubkey`。
- 私钥只放构建机环境变量：`TAURI_SIGNING_PRIVATE_KEY`（内容或路径）+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- 打开 `update.active` 后，构建必须产出 `createUpdaterArtifacts`，否则没有 `.sig`；反之如果没配私钥，打包阶段会直接报错——这就是默认配置里它保持 `false` 的原因：开箱能构建，比"默认打开但第一次构建就失败"更实用。

私钥丢了的后果很具体：已装用户无法再收到任何更新（新包签名验证不过），只能让用户手动重装。所以它比代码签名证书更需要备份，而且要备份到机器之外。

## 版本比较的规则

客户端只做一件事：`清单 version > 当前 version` 才更新。写进清单的版本号如果没变大，等于白发一份。

semver 比较按段来，预发布版参与比较：

| 比较 | 结果 |
|---|---|
| `1.2.0` vs `1.1.9` | 后者旧 |
| `1.0.0-beta.1` vs `1.0.0` | 预发布小于正式版 |
| `1.0.0-beta.10` vs `1.0.0-beta.2` | 数字段按数值比，10 大于 2 |
| `1.0.0-alpha` vs `1.0.0-beta` | 字母段按字典序 |

生成脚本带 `--current <已发布版本>` 时，新版本不高于它就直接拒绝写盘，防止手滑发一份"看起来更新了但没人收到"的清单。脚本里的比较函数被单测过：上面四种情况都按预期返回。

降级不支持：清单版本低于已装版本时，客户端不会装。想回滚只能发一个版本号更大的"回滚包"。

## 清单只坏一个条目，整份都不认

Tauri 会先校验整份清单的结构，再取对应平台的条目。这意味着哪怕只有一个平台的 `url` 写错，其它平台的用户也会一起收不到更新。发布前用 `--verify-only` 或直接看生成结果，别只看"文件写成功了"。

## 检查、下载与失败处理

应用启动后异步检查一次（`update.checkOnStartup`），结果只落到界面状态，**不会自动下载安装**。界面提供「检查更新 / 下载并安装」两个按钮，调用外壳命令：

| 命令 | 作用 |
|---|---|
| `update_status` | 读取当前状态；页面加载时补一次，避免事件早于监听 |
| `update_check` | 拉清单并比较版本；结果是 `available` / `up-to-date` / `error` |
| `update_install` | 重新检查 → 下载 → 验签 → 启动安装器；失败返回 `error` 状态 |

状态：`idle / checking / available / up-to-date / downloading / installing / error`，通过 `lc:update-status` 事件推送；下载中带 `downloaded/total`，界面显示百分比。

不会卡在更新界面的三条保证：

1. 启动检查在窗口创建之后的独立异步任务里，网络失败只落到 `error` 状态，不影响应用启动；
2. 手动检查/下载失败后按钮恢复可用，文案包含具体原因，应用继续可用；
3. 安装成功后 Windows 上由安装器接管并重启应用；失败时进程不退出，不会停在「安装中」。

错误文案由 `update_error_text` 映射，区分网络/超时、非 https、签名校验失败、清单缺当前平台条目、清单 404/空内容等。离线时界面显示「更新源连接超时或被拒绝……不影响继续使用应用」。

## 本机调试：http 更新源

正式构建强制 https。本机/内网想用 `http://127.0.0.1:<port>` 做端到端验证时，必须在 `desktop.json` 里显式打开危险开关：

```json
"update": {
  "active": true,
  "endpoint": "http://127.0.0.1:63188/latest.json",
  "insecureTransport": true
}
```

`validate-config` 会给出 `W_UPDATE_HTTP` 警告；渲染器把它写成 `plugins.updater.dangerousInsecureTransportProtocol=true`。验证完必须移除 `insecureTransport`（或换回 https），否则等于把「更新源可被中间人拒绝服务」带进发布包。

## 发布清单

1. 改 `config/desktop.json` 的 `version`，`npm run validate` 通过。
2. 构建：`npm run build`（`createUpdaterArtifacts` 会在开启更新时强制为真，产出 `.sig`）。
3. 上传安装包与 `.sig` 同目录到更新服务器。
4. 生成清单：`node scripts/gen-update-manifest.mjs --version <新版本> --current <旧版本> --base-url <更新目录> --artifact <包> --target <平台>`。
5. 把 `latest.json` 放到 `update.endpoint` 指向的位置。
6. 用一台装着旧版本的机器实测一次"检查到新版本"。

## 本机端到端验证（2026-11-08，Windows x64）

用 0.1.0 / 0.2.0 两个真实 NSIS 安装包 + 本机 `serve-local.mjs`（端口 63188）+ `tauri signer generate` 的测试密钥跑通：

- **成功路径**：安装 0.1.0 → 启动 → 自动检查发现 0.2.0 → 在 WebView 里真实点击「下载并安装」→ 下载、验签、安装器静默执行 → 应用退出后被重启，安装目录里的 `lc-desktop.exe` ProductVersion 变为 0.2.0；
- **离线路径**：关掉本地更新源 → 启动检查与手动检查都进入 `error`，文案含「连接超时或被拒绝」，按钮恢复可点，应用保持运行；
- **验签失败路径**：清单里的签名仍是原包，但把更新包追加字节后发布 → 下载完成后进入 `error`，文案为「更新包签名校验失败……已拒绝安装」，应用保持运行且仍为 0.1.0；
- 三条路径均在 WebView 内用真实鼠标事件点击（`Input.dispatchMouseEvent`），不是直接调用外壳函数。

未验证：MSI 作为更新产物的安装路径（本次用 NSIS）；Linux updater；安装器交互界面模式（本次用 `installMode: quiet`）。
