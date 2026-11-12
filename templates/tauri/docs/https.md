# 桌面端的 HTTPS 与证书

先把最容易混淆的地方拆开：桌面应用里说的"走 https"其实是两件不同的事，处理方式完全不同。

| | 自定义协议 scheme（资源内嵌） | 真实 TLS（外部服务） |
|---|---|---|
| 谁负责传输页面 | Tauri 内置的协议处理器，直接读内存里的资源 | 你的服务进程，真的在监听端口 |
| 有没有 TLS 握手 | 没有 | 有 |
| 需不需要证书 | 不需要 | https 必须有，且要被系统信任 |
| 配置入口 | `protocol: "https"` → `useHttpsScheme: true` | `delivery.mode: "server"` + `https.*` |
| 失败表现 | 页面正常，只是 origin 变化 | 证书不被信任 → 页面加载失败 |

第一列只是让页面处于安全上下文（`https://tauri.localhost`），日志里不会出现任何证书，也不存在"证书过期"这种故障。**静态接入的用户不用管本文档后面的证书部分。**

第二列才是真的在跑 TLS。下面的内容都针对这种情形。

## 自签测试证书

用途只有一个：本地验证 TLS 链路能通、服务能起。它不可能被用户机器信任。

```bash
node scripts/gen-test-cert.mjs            # 默认输出到 certs/，365 天，CN=localhost
node scripts/gen-test-cert.mjs --host 127.0.0.1 --days 90 --force
```

没有 Node 的构建机用 `scripts/gen-test-cert.sh`，参数顺序一致。脚本依赖本机 `openssl`（Windows 上 Git for Windows 或 MSYS2 自带；找不到时脚本会直接报错退出，不会假装成功）。

产物：

| 文件 | 内容 | 能不能进导出包 |
|---|---|---|
| `certs/site.crt` | 自签证书（PEM） | 可以，只是公开信息 |
| `certs/site.key` | 私钥，无密码（`-nodes`） | **不可以** |
| `certs/cert-info.txt` | 主题、有效期、SHA-256 指纹 | 可以 |
| `certs/TEST-ONLY.txt` | 测试证书标记 | 可以 |

证书的 SAN 覆盖 `DNS:<host>`、`DNS:localhost`、`IP:127.0.0.1`、`IP:::1`。`localhost` 和 `127.0.0.1` 是**不同的**主机名，少写一个就会出现"用 localhost 能打开、用 127.0.0.1 报证书错误"这种看起来莫名其妙的问题，所以两个都写。

本机实测（MSYS2 OpenSSL 3.x）：生成的证书与私钥 modulus 一致，`openssl verify -CAfile site.crt site.crt` 通过，SAN 扩展里确实包含上述四项。

## 自有证书怎么接

证书来自正式 CA（或者你们自己的内部 CA）时，构建机准备两样东西：完整证书链（PEM）和私钥。要求：

1. **SAN 必须包含客户端实际访问的主机名**。用 `127.0.0.1` 访问就得有 `IP:127.0.0.1`，只写 `localhost` 不算。
2. **证书链要完整**：服务器给的是 leaf + 中间证书，缺中间证书时部分客户端能过、部分直接失败，这种问题最难查。
3. **有效期至少覆盖发布周期**，别把 30 天有效期的测试证书发出去。
4. **私钥与证书必须配对**：`openssl x509 -noout -modulus` 与 `openssl rsa -noout -modulus` 输出一致才算配套。

构建机上验证一遍再进流程：

```bash
openssl verify -CAfile <根证书> site.crt
openssl x509 -in site.crt -noout -subject -dates -ext subjectAltName
```

证书文件放 `certs/`（已在 `.gitignore` 里），私钥权限收到 0600。桌面工程里**只写路径引用，不写私钥内容**，配置里也不会出现私钥。

## 什么时候会被系统拒绝

自签证书在客户端不受信任时，表现取决于运行环境：

| 环境 | 表现 |
|---|---|
| Windows（WebView2） | 页面显示证书错误页（`ERR_CERT_AUTHORITY_INVALID`），窗口里就是一个报错界面，不是白屏 |
| Linux（WebKitGTK） | 加载失败 + 控制台报错，窗口里可能直接空白 |

用户机器上同理：他们没导入你的自签证书，就一定打不开。

常见触发条件：证书没导入系统信任库、主机名与 SAN 不匹配、证书过期、缺中间证书、系统时间不对、证书被吊销。

在**测试机**上临时信任（只解决开发验证，不代表用户机器可用）：

```powershell
# Windows：只影响当前机器的当前用户
certutil -addstore -user Root certs\site.crt
```

信任之后重启应用再试：WebView 会缓存证书状态，不重启可能还是旧结果。

## 选型建议

- **静态站**：别开 server 模式。多一张证书就多一类"用户那边打不开"的支持工单。
- **必须本地服务**：优先 `http://127.0.0.1`。不出网，不需要证书，不受信任链影响。
- **必须 https 且面向外部用户**：用正式 CA 证书，别把自签证书当正式方案。自签只适合内部工具，而且要在文档里明确告诉使用者需要先导入证书。

## 硬红线

- 私钥不进导出包、不进构建产物、不进日志、不进报错信息。任何一条都算泄漏。
- 不要把私钥写进配置、不要把 base64 后的私钥塞进环境变量再写进日志。
- 测试证书文件名带 `TEST-ONLY`，避免和正式证书混淆后被误发。
- 导出包里只带生成脚本，不带任何生成结果。证书是构建期或部署期产物。
