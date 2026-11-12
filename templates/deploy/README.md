# 部署模板：一键部署 + nginx + 证书

导出包会把 `templates/deploy/**` 放到 `<导出包>/deploy/`，把选中的后端模板放到 `<导出包>/server/`
（模板内容平铺，不带 `rust/`、`node/` 这类语言目录），静态站放在 `<导出包>/web/`。
证书**不进导出包**，部署时用本目录的脚本生成或导入，落在 `<导出包>/certs/`。

```
<导出包>/
├─ web/                        静态站（index.html、assets/、vendor/、data/collections/）
├─ server/                     本包选中的后端源码（README 在 server/ 根）
├─ deploy/
│  ├─ backend/
│  │  ├─ config.generated.yaml 平台生成的配置底稿（不要手改）
│  │  └─ config.yaml           用户覆盖位；缺省时首次运行由脚本引导生成
│  ├─ nginx/nginx.conf         nginx 底稿；脚本按参数生成 nginx.generated.conf
│  ├─ scripts/                 install / migrate / start / start-bg / stop / health / nginx
│  │                           每个都有 .sh（Linux/Git Bash）与 .ps1（Windows）两版
│  └─ README.md                本文件
├─ certs/                      部署时生成/导入：site.crt、site.key、可选 site.chain.crt
└─ logs/                      server.pid / server.meta / server.log；nginx 的 pid、access、error
```

**拿到压缩包后不需要读后端 README 也能跑起来**：按下面第 1 节四条命令即可。
只有改业务、换数据库或排查问题时才需要看 `server/README.md`。

---

## 1. 一键部署（推荐）

### 1.1 前置条件

| 后端 | 需要安装 | 版本建议 |
| --- | --- | --- |
<!-- lc:lang:node -->
| Node | Node.js + npm | Node ≥ 22.5 |
<!-- /lc:lang:node -->
<!-- lc:lang:rust -->
| Rust | Rust 工具链（cargo/rustc） | Rust ≥ 1.80 |
<!-- /lc:lang:rust -->
<!-- lc:lang:go -->
| Go | Go | Go ≥ 1.23 |
<!-- /lc:lang:go -->

另外需要 `curl`（健康检查与冒烟）。nginx 形态还需要 nginx ≥ 1.25.1（见第 2 节）。
脚本只检查“命令是否存在”，版本问题会在编译/启动失败时给出下一步。

### 1.2 命令（两套脚本行为一致）

在**导出包根目录**执行。Windows 用 PowerShell，Linux 或 Windows 上的 Git Bash 用 sh。

| 步骤 | Linux / Git Bash | Windows PowerShell |
| --- | --- | --- |
| 装依赖并编译 | `sh deploy/scripts/install.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\install.ps1` |
| 建表 / 升级 | `sh deploy/scripts/migrate.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\migrate.ps1` |
| 前台启动 | `sh deploy/scripts/start.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\start.ps1` |
| 后台启动 | `sh deploy/scripts/start-bg.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\start-bg.ps1` |
| 探活 + 配置摘要 | `sh deploy/scripts/health.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\health.ps1` |
| 停止 | `sh deploy/scripts/stop.sh` | `powershell -ExecutionPolicy Bypass -File deploy\scripts\stop.ps1` |

最短路径（只跑后端）：

```sh
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh     # 等待 health 200，再自动跑一条只读集合查询
sh deploy/scripts/health.sh       # 可随时复查；口令会打码
sh deploy/scripts/stop.sh
```

`start-bg.sh` 成功后会打印 pid、日志路径与冒烟结果；失败会 tail 日志并给下一步，退出码非 0。
`start.sh` 是前台运行（`Ctrl+C` 停止），适合调试；生产用 `start-bg`。

### 1.3 首次运行引导

首次执行 `install`（或 `migrate`/`start*`）时，如果 `deploy/backend/config.yaml` 缺失，
或它与 `config.generated.yaml` 完全一致，脚本会认为“还没配置过”，并按环境询问：

```
首次运行：需要生成 <导出包>/deploy/backend/config.yaml
直接回车使用方括号里的默认值。

1) 后端监听端口 [8080]:
2) 数据库地址 [sqlite://data/app.db]
   可填：sqlite://data/app.db、mysql://user@host:3306/db、postgres://user@host:5432/db，或 host:port/库名
   >
3) 缓存 none / memory / redis [memory]:
```

- 直接回车 = 用方括号里的默认值（端口/数据库默认值来自 `config.generated.yaml`）。
- 连接串里若带口令（`mysql://user:pass@host/db`），**口令会被移除**，提示改用环境变量注入。
- 一旦你手改过 `config.yaml`（与生成底稿不同），后续脚本都只读取、不覆盖。
- 删掉 `config.yaml` 再跑一次，即可重新引导。

**非交互（CI / 容器）**：设置 `LC_DEPLOY_NONINTERACTIVE=1`，用环境变量给出答案：

```sh
export LC_DEPLOY_NONINTERACTIVE=1
export LC_DEPLOY_PORT=8080
export LC_DEPLOY_DB='sqlite://data/app.db'      # 或 mysql://user@dbhost:3306/app
export LC_DEPLOY_CACHE=memory                    # none / memory / redis
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh
sh deploy/scripts/health.sh --json
```

PowerShell 写法相同（先 `$env:LC_DEPLOY_NONINTERACTIVE='1'`）。在管道/远程会话里想强制交互，
可设 `LC_DEPLOY_INTERACTIVE=1`。

### 1.4 环境变量

| 变量 | 作用 | 何时生效 |
| --- | --- | --- |
| `LC_DEPLOY_NONINTERACTIVE=1` | 禁止提问，用下面的 `LC_DEPLOY_*` 生成配置 | 首次引导 |
| `LC_DEPLOY_INTERACTIVE=1` | 强制提问（即使 stdin 不是终端） | 首次引导 |
| `LC_DEPLOY_HOST` | 监听地址，默认 `127.0.0.1` | 生成配置 |
| `LC_DEPLOY_PORT` | 监听端口，默认取生成底稿（8080） | 生成配置 |
| `LC_DEPLOY_DB` | 数据库地址（URL 或 `host:port/库名`） | 生成配置 |
| `LC_DEPLOY_DB_DRIVER` | `sqlite` / `mysql` / `postgres` | 生成配置 |
| `LC_DEPLOY_DB_HOST/PORT/NAME/USER` | 分开指定数据库连接项 | 生成配置 |
| `LC_DEPLOY_CACHE` | `none` / `memory` / `redis` | 生成配置 |
| `LC_DEPLOY_REDIS_URL` | Redis 地址（可含口令，写盘前会移除口令） | 生成配置/引导 |
| `LC_DEPLOY_SKIP_SMOKE=1` | 后台启动后跳过集合查询冒烟 | `start-bg` |
| `LC_DEPLOY_WAIT` | 后台启动等待 health 的秒数，默认 60 | `start-bg` |
<!-- lc:lang:rust -->
| `LC_DEPLOY_PROFILE=debug` | Rust 用 debug 构建（默认 release） | `install` / `start*` |
<!-- /lc:lang:rust -->
| `LC_PORT` / `LC_HOST` | 运行期覆盖监听地址/端口 | 启动时 |
| `DATABASE_URL` | 运行期覆盖数据库连接串（优先级最高） | 启动时 |
| `LC_DB_PASSWORD` | 数据库口令（推荐，不写进配置） | 启动时 |
| `REDIS_URL` | Redis 口令/地址（推荐，不写进配置） | 启动时 |

优先级：内置默认 < `config.generated.yaml` < `config.yaml` < 环境变量 < 启动参数。

### 1.5 脚本约定：幂等、安全、失败可读

- **install 幂等**：重复执行不报错；<!-- lc:lang:node -->Node 重新 `npm ci --omit=dev`。<!-- /lc:lang:node --><!-- lc:lang:rust -->Rust 增量构建。<!-- /lc:lang:rust --><!-- lc:lang:go -->Go 增量构建。<!-- /lc:lang:go -->
- **migrate 幂等**：重复执行输出“无待执行迁移”并退出 0；启动时也会自动补齐未应用的迁移。
- **start-bg 幂等**：已在运行且健康时直接返回 0，不重复启动；遗留的 pid 文件会被清理后再启动。
- **stop 兜底**：pid 已死或 pid 文件为空时直接清理；只杀“pid 文件 + 进程命令行匹配”的进程，
  不会因 PID 复用误杀；先 SIGTERM，等 10 秒再强制结束。
- **日志不打印口令**：配置里不写口令；连接串中的 `user:pass@`、`redis://:pass@` 在
  health/摘要里统一打码成 `***`；日志检查也确认不出现口令。
- **失败给下一步**：错误输出包含“原因 + 建议命令”，退出码约定：
  `0` 成功；`1` 运行失败（编译、启动、探活、冒烟）；`2` 环境/配置不满足（缺命令、缺文件、参数非法）。

### 1.6 自动冒烟

`start-bg` 在 health 返回 200 后，会：

1. 从 `web/data/collections/*.json` 找第一个集合；
2. 请求 `GET /api/collections/<集合>/rows?page=1&pageSize=1`（只读，不写库）；
3. 打印 `total`；集合为空（`total=0`）也算通过；集合要求登录（401/403）会说明并跳过；
4. 其他非 200 视为失败，退出码 1。

不想跑冒烟：`--no-smoke` 或 `LC_DEPLOY_SKIP_SMOKE=1`。
随时手动复查：`sh deploy/scripts/health.sh --wait 10`（`--json` 只输出原始 JSON，便于 CI）。

---

## 2. 三种部署形态

导出时平台会把站点配置里的域名贯穿到部署侧：`deploy/nginx/nginx.conf` 的 `server_name`、
部署脚本的 `--domain` 默认值，以及 `server/.env.example` 的 `LC_PUBLIC_BASE_URL`（域名 + 路径前缀）。

- 未填域名：回退 `localhost` / `127.0.0.1`，仅本机可用，导出结果会给出提示；
- 域名缺协议、带尾斜杠：平台先归一化再写入；带路径等非法值在保存配置时直接报错；
- 证书 CN/SAN 跟随同一个域名：`gen-test-cert` 的默认域名已改成站点域名，也可用 `--domain` 覆盖；
- 改了域名请重新导出，或部署时显式传 `--domain`。

三条路径都只改配置/参数，**不需要手改 nginx 里的 upstream 和证书路径**：`nginx.sh` / `nginx.ps1`
会按参数把监听端口、`server_name`、`proxy_pass`、`ssl_certificate`、`ssl_certificate_key`
（以及非 443 时的跳转端口）一次性替换，写到 `deploy/nginx/nginx.generated.conf`。

### 2.1 形态 A：只跑后端（无 nginx）

适合本机演示、内网小工具、临时联调。没有 TLS 与边缘缓存，**不要直接暴露公网**。

```sh
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh
sh deploy/scripts/health.sh

# 只读接口（把 demo 换成 web/data/collections 里的集合 id）
curl "http://127.0.0.1:8080/api/collections/demo/rows?page=1&pageSize=1"

sh deploy/scripts/stop.sh
```

如果希望后端顺带发静态站（而不是只提供 API），在 `deploy/backend/config.yaml` 里加：

```yaml
static:
  enabled: true
  root: "../web"     # 相对 server/ 工作目录
```

再重启。`health.sh` 的 `static=true` 表示静态站已由后端提供。

### 2.2 形态 B：后端 + nginx（HTTP 反代）

适合内网入口、无需 HTTPS 的过渡阶段。后端只监听 `127.0.0.1:8080`，nginx 对外 80。

```sh
# 1) 后端
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh

# 2) nginx：生成 → 校验 → 启动（对外 19080，反代到 8080）
sh deploy/scripts/nginx.sh render --mode http --http-port 19080 \
  --domain demo.local --upstream 127.0.0.1:8080
sh deploy/scripts/nginx.sh test   --mode http --http-port 19080 \
  --domain demo.local --upstream 127.0.0.1:8080
sh deploy/scripts/nginx.sh start  --mode http --http-port 19080 \
  --domain demo.local --upstream 127.0.0.1:8080

# 3) 验证：静态首页、API、集合查询都走 nginx
curl -I  http://127.0.0.1:19080/
curl -s  http://127.0.0.1:19080/api/health
curl -s  "http://127.0.0.1:19080/api/collections/demo/rows?page=1&pageSize=1"

# 4) 停止（先 nginx，后后端）
sh deploy/scripts/nginx.sh stop
sh deploy/scripts/stop.sh
```

Windows 把命令换成 `powershell -ExecutionPolicy Bypass -File deploy\scripts\nginx.ps1 -Action render -Mode http -HttpPort 19080 -Domain demo.local -Upstream 127.0.0.1:8080`，
`test/start/stop` 同理。默认端口 80/443 在 Linux 需要特权；先用高端口验证，再上线。

### 2.3 形态 C：后端 + nginx + 证书（HTTPS）

```sh
# 1) 证书：测试用自签，正式用自有证书
sh deploy/scripts/gen-test-cert.sh --domain demo.local --days 365
# 或
sh deploy/scripts/import-cert.sh --cert /path/fullchain.pem --key /path/privkey.pem --domain demo.local

# 2) 后端
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh

# 3) nginx：对外 80/443（非特权测试用 19081/19443），证书路径由脚本写入
sh deploy/scripts/nginx.sh render --mode https --http-port 80 --https-port 443 \
  --domain demo.local --upstream 127.0.0.1:8080 \
  --cert certs/site.crt --key certs/site.key
sh deploy/scripts/nginx.sh test   --mode https --http-port 80 --https-port 443 \
  --domain demo.local --upstream 127.0.0.1:8080 \
  --cert certs/site.crt --key certs/site.key
sh deploy/scripts/nginx.sh start  --mode https --http-port 80 --https-port 443 \
  --domain demo.local --upstream 127.0.0.1:8080 \
  --cert certs/site.crt --key certs/site.key

# 4) 验证
curl -kI https://127.0.0.1/            # 静态首页 200
curl -k  https://127.0.0.1/api/health  # 200
curl -I  http://127.0.0.1/             # 301 -> https

# 5) 停止（先 nginx，后后端）
sh deploy/scripts/nginx.sh stop
sh deploy/scripts/stop.sh
```

`--cert/--key` 不给时默认 `<导出包>/certs/site.crt`、`certs/site.key`；相对路径按导出包根解析。
自签证书测试时必须带 `-k`；正式证书应去掉 `-k` 并能通过校验。

### 2.4 nginx 脚本参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--mode http\|https` | `https` | http 生成完整最小反代；https 以 `nginx.conf` 为底稿替换 |
| `--domain` | 站点域名（未配置则 `localhost`） | 写入 `server_name`；导出时已按站点配置改好默认值 |
| `--http-port` | `80` | HTTP 监听端口；https 模式下用于 301 跳转 |
| `--https-port` | `443` | HTTPS 监听端口 |
| `--upstream` | `127.0.0.1:8080` | 写入 `proxy_pass`（可写 `host:port`） |
| `--cert` / `--key` | `<包>/certs/site.*` | 写入 `ssl_certificate` / `ssl_certificate_key` |
| `--force` | 关 | 重新生成时覆盖已有 `nginx.generated.conf` |

动作：`render`（生成配置，无需装 nginx）、`test`（`nginx -t`）、`start`、`reload`、`stop`。
脚本会创建 `logs/` 与 `temp/` 子目录（nginx 缺失临时目录时 `-t`/启动会失败）；
`start` 发现 pid 文件为空或进程已死会先清理，再启动；启动后 1 秒校验 pid，失败会打印错误日志尾部。
nginx 不在 `PATH` 时，`render` 仍可用；`test/start` 返回退出码 2 并提示先安装 nginx。

---

## 3. 证书：生成测试证书 / 导入自有证书

两个脚本都会：校验证书与私钥、把私钥权限收紧到当前用户、只打印主题/有效期/SHA-256 指纹
（公开信息），**从不打印私钥内容**。证书与私钥固定放到 `certs/site.crt`、`certs/site.key`。

### 3.1 生成自签测试证书

```sh
sh deploy/scripts/gen-test-cert.sh --domain localhost --days 365
```

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\gen-test-cert.ps1 `
  -Domain localhost -Days 365 -OutDir certs
```

- `--domain`：证书 CN 与 SAN；同时固定加入 `localhost`、`127.0.0.1`，方便本机测试。
- `--days`：有效期，必须为正整数；默认 365。
- `--out` / `-OutDir`：输出目录，默认 `certs`；已有文件默认拒绝，确认覆盖加 `--force` / `-Force`。
- 自签证书的“链”只有它自己（`site.crt` 一张）。浏览器会提示不受信任，测试环境需手动信任。
- 私钥不加密（nginx 需无人值守读取），因此权限必须是当前用户可读：
  Unix `600`；Windows 用 `icacls` 去掉继承、只授予当前用户读写。
- **不要用自签证书对外提供正式服务。**

### 3.2 导入用户自有证书

```sh
sh deploy/scripts/import-cert.sh \
  --cert /path/fullchain.pem \
  --key  /path/privkey.pem \
  [--chain /path/chain.pem] \
  --domain example.com
```

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\import-cert.ps1 `
  -Cert C:\path\fullchain.pem -Key C:\path\privkey.pem `
  [-Chain C:\path\chain.pem] -Domain example.com
```

校验内容（任一失败即退出码 1，不写入文件）：

1. 证书可解析（PEM / X.509）。
2. 私钥可解析且**未加密**（加密私钥 nginx 无法无人值守读取）。
3. 证书与私钥配对（比较公钥 DER 的 SHA-256，不输出密钥）。
4. 有效期 ≥ 30 天。
5. 传了 `--domain` 时，SAN 必须包含该域名。
6. 传了 `--chain` 时，链可解析；并尝试用系统根证书验证。失败默认阻断，
   确知是系统缺根证书时可加 `--allow-incomplete-chain`（风险自负）。

输出 `certs/site.crt`、`certs/site.key`，有链时另存 `certs/site.chain.crt`。

### 3.3 安全红线

- 私钥与证书口令**不得**出现在模板、README 示例、日志、错误信息、聊天记录、工单里。
- 私钥文件权限：Unix `600`、Windows 仅当前用户 ACL；目录建议 `700`。
- **不要把 `certs/` 或 `*.key` 提交到仓库**：

  ```
  certs/
  *.key
  *.pem
  *.p12
  *.pfx
  ```

- 导出包本身不包含私钥；如果发现私钥进了 zip，视为事故，重新导出并轮换证书。
- 泄露私钥后立即吊销并重新签发，不要只改文件名。

---

## 4. nginx 配置说明（`nginx/nginx.conf`）

`nginx.sh render` 生成的文件已经按参数替换好，**不要手改** `nginx.generated.conf`；
要调端口/域名/upstream/证书就重跑 render。底稿 `nginx.conf` 的关键默认值：

| 项 | 默认 | 为什么 |
| --- | --- | --- |
| `listen.http` / `listen.https` | 80 / 443 | 常规入口；本地/内网也可改成高位端口 |
| `redirectHttp` | 开（301） | 只保留 HTTPS 入口，避免两套安全/缓存策略 |
| TLS 协议 | TLSv1.2 + TLSv1.3 | 兼容主流客户端，淘汰 1.0/1.1 |
| `ssl_session_tickets` | off | 降低密钥泄露后的历史流量解密风险 |
| `proxy.upstream` | `127.0.0.1:8080` | 与后端默认端口一致 |
| `proxy.timeoutSeconds` | 连接 5s / 读写 60s | 本机/内网连接快，API 常规耗时留余量 |
| `static.root` | `web` | 导出产物目录 |
| gzip | 开，≥1024 字节 | 小文件压缩收益低、费 CPU |
| 静态缓存 | 1 年 + immutable | 文件名带内容哈希，内容变则 URL 变 |
| HTML 缓存 | `no-cache` | 发布后用户能立刻拿到新页面 |
| 安全头 | nosniff / SAMEORIGIN / Referrer-Policy | 低风险默认加固 |
| HSTS | **注释掉** | 自签测试阶段开启会让浏览器长期强制 HTTPS，难回退 |
| `clientMaxBodySize` | `10m` | 覆盖常规上传；后端 JSON 仍有 1 MB 上限 |

注意点：

- `add_header` **不会**从 `server` 继承到写了 `add_header` 的 `location`；配置里在静态与 HTML
  location 重复了安全头，删改时不要漏。
- `http2 on;` 需要 nginx ≥ 1.25.1；更老的版本改成 `listen 443 ssl http2;`。
- 静态站默认按文件存在性 404。若站点是前端 history 路由，把 `location /` 改成
  `try_files $uri $uri/ /index.html;`，但会掩盖拼错的资源路径。
- 只跑后端形态没有 TLS；公网部署必须加反向代理或负载均衡。

---

## 5. 排障：脚本失败时先看这里

| 现象 | 原因 | 下一步 |
| --- | --- | --- |
| <!-- lc:lang:node -->`缺少命令：node/npm`<!-- /lc:lang:node --><!-- lc:lang:rust -->`缺少命令：cargo/rustc`<!-- /lc:lang:rust --><!-- lc:lang:go -->`缺少命令：go`<!-- /lc:lang:go --> | 工具链没装或不在 PATH | 装对应版本后重开终端；`install` 退出码 2 |
| `port ... 已被占用` / health 连不上 | 端口冲突或监听地址不对 | 改 `config.yaml` 的 `port`、设 `LC_PORT`，或用 nginx 的 `--http-port/--https-port`；`health.sh` 看实际监听 |
| `health 000`、启动超时 | 后端没起来/崩了/防火墙 | 看 `logs/server.log` 与 `logs/server.err.log` 尾部；`start.sh` 前台跑一次看完整输出 |
| `database=down` / 503 `LC_E_DB_UNAVAILABLE` | 数据库地址/口令/驱动不对 | 用 `LC_DB_PASSWORD` 注入口令；确认库已启动、端口可达；`health.sh` 的“存储”行会给出状态 |
| `cacheFallback=true` | Redis 不可用，已降级 | 属预期降级；要恢复就修 Redis 或用 `LC_DEPLOY_CACHE=memory` 显式关闭 |
| `nginx: command not found` | 未安装 nginx 或不在 PATH | `render` 不受影响；装 nginx ≥ 1.25.1 后再跑 `test/start` |
| `nginx -t` 报 `CreateDirectory` | `temp/` 子目录缺失 | 重新跑 `nginx.sh render`（脚本会自动创建 `temp/client_body_temp` 等） |
| `nginx 似乎已在运行` 但访问失败 | pid 文件残留 | 直接跑 `nginx.sh stop`（会清理空 pid）；再 `start` |
| 冒烟 `401/403`、已跳过 | 集合要求登录 | 属预期；用公开集合或带令牌手动验证 |
| `stop` 提示“PID 不属于本次部署” | pid 被复用 | 脚本不会误杀；确认后用 `taskkill`/`kill` 手动处理残留进程 |

`health.sh` 的退出码：0 健康；1 不健康/连不上；2 环境不满足。CI 里建议：

```sh
sh deploy/scripts/health.sh --json
curl -fsS "http://127.0.0.1:8080/api/collections/demo/rows?page=1&pageSize=1" >/dev/null
```

---

<!-- lc:export-hide -->
## 6. 本机验证记录（2026-11-08）

环境：Windows 11 + Git Bash（sh 路径）与 Windows PowerShell 5.1（ps1 路径），
nginx 1.28.0，OpenSSL 3.x；三套导出包都用**动态端口 19080–19082**、SQLite 驱动，
**未连接本机 3306 / 6379 / 5432**。

| 语言 | sh：install → migrate → start-bg → health → 查询 → stop | ps1 同流程 |
| --- | --- | --- |
| Node | 通过；重复 install/migrate/start/stop 均幂等 | 通过 |
| Rust | 通过（release 增量构建） | 通过（复用已编译产物验证 start/migrate/stop） |
| Go | 通过 | 通过（复用已编译产物） |

本轮用模板重新导出后的实测耗时（sh，单机，冷缓存）：

| 语言 | install（首次 / 重复） | migrate（首次 / 重复） | start-bg | health | 只读查询 | stop |
| --- | --- | --- | --- | --- | --- | --- |
| Node | 32s / 80s | 4.7s / 3.5s | 3.9s | 10.0s | 0.2s | 2.5s |
| Rust | 140s / 4.8s | 1.2s / 0.8s | 2.2s | 4.7s | 0.2s | 2.1s |
| Go | 18.8s / 3.2s | 1.8s / 0.9s | 3.2s | 3.6s | 0.2s | 2.0s |

Rust 的 140s 是 `target/` 为空时的全量 release 编译；再次执行 install 只做增量检查。
Node 的重复 install 会重新执行 `npm ci`（保证依赖与 lock 一致），因此慢于首次；不报错、结果一致。

补充验证：

- **首次引导**：删掉 `config.yaml` 后交互模式默认值正确（端口 19080、`sqlite://data/app.db`）；
  回车生成配置；再次运行提示“使用已有配置”，手改内容未被覆盖；
  `LC_DEPLOY_NONINTERACTIVE=1` + `LC_DEPLOY_PORT/DB/CACHE` 在无 stdin 时生成配置成功。
- **口令**：`cache.url` 写成 `redis://:s3cret@127.0.0.1:16379/0`（driver=memory，不会真连 Redis），
  `health.sh` 输出 `redis://:***@...`，`logs/` 中没有出现口令。
- **nginx 三形态**：形态 A（无 nginx）health 200；形态 B（HTTP）`nginx -t` 通过，
  静态首页 200、`/api/health` 200、集合查询 200；形态 C（HTTPS，自签证书）`nginx -t` 通过，
  `https://:19443/` 与 `/api/health` 200，`http://:19088/` 301 到 19443；
  `nginx.generated.conf` 中监听端口、`server_name`、`proxy_pass`、证书/私钥路径均按参数替换。
- **幂等/兜底**：重复 install/migrate 输出“无待执行迁移”并退出 0；重复 start-bg 直接返回；
  空 pid / 死 pid 被 `stop` 或 `start` 清理；`stop` 后 health 返回非 0。
- **重新导出后复跑**：上表三套均为模板重新生成的真实导出包（非手工同步脚本），sh 与 ps1 各跑一遍完整生命周期。
- **Windows 兼容**：证书脚本的私钥 ACL 为 `(R,W,D)`，保证可以轮换或删除私钥（只给 `R,W` 时删除会报 EPERM）。

未验证：真实 CA 证书链、Docker/容器、长稳压测；
Windows 版 nginx 的 HTTP/2 与高并发表现不如 Linux。正式上线前按第 2 节在生产环境再跑一次
`install → migrate → start-bg → health → 查询`。
<!-- /lc:export-hide -->

---

## 7. 已知限制

- 单机单实例：没有 upstream 多后端、没有健康检查摘除、没有 nginx 级限流。
- 证书续期需重新执行导入脚本并 reload nginx；没有自动续期（不用 CDN/ACME 客户端）。
- Windows 版 nginx 在高并发与 HTTP/2 支持上不如 Linux 版，正式环境建议 Linux。
- 只跑后端形态没有 TLS；公网部署必须加反向代理或负载均衡。
