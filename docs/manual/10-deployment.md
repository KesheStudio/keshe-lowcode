# 10 部署：nginx、HTTPS、反向代理与 CORS

> 本篇目标：会把导出包放到服务器上跑起来，会在后端 + nginx 的三种形态之间选择，会用自己的证书配 HTTPS，并知道跨域问题该改哪里。
>
> 所有命令都在**导出包根目录**执行。部署脚本已经放在包的 `deploy/scripts/` 下，不用另外安装。

---

## 一、先看导出包里有什么

```text
<导出包>/
├─ web/                        静态站：index.html、assets/、vendor/、data/
├─ server/                     后端源码（选无后端时没有）
├─ deploy/
│  ├─ backend/
│  │  ├─ config.generated.yaml 平台生成的配置底稿，不要手改
│  │  └─ config.yaml           你的覆盖位；首次运行会引导生成
│  ├─ nginx/nginx.conf         nginx 底稿
│  ├─ scripts/                 install / migrate / start / start-bg / stop / health / nginx
│  └─ README.md
├─ certs/                      部署时生成或导入的证书
└─ logs/                       server 与 nginx 的日志、pid
```

证书**不进导出包**，要部署时生成或导入。

前置条件：

| 后端 | 需要安装 | 建议版本 |
| --- | --- | --- |
| Node | Node.js + npm | Node ≥ 22.5 |
| Rust | cargo / rustc | Rust ≥ 1.80 |
| Go | Go | Go ≥ 1.23 |

另外需要 `curl`；用 nginx 时需要 nginx ≥ 1.25.1（`http2 on;` 需要这个版本）。

---

## 二、三种部署形态

| 形态 | 组成 | 适合 | 风险 |
| --- | --- | --- | --- |
| A 只跑后端 | 后端直接监听 8080 | 本机演示、内网小工具 | 没有 TLS，不要直接暴露公网 |
| B 后端 + nginx（HTTP） | nginx 对外 80，反代到 8080 | 内网入口、过渡阶段 | 没有 HTTPS |
| C 后端 + nginx + 证书 | nginx 对外 80/443 | 正式公网部署 | 需要正确证书与域名 |

静态站也可以让后端顺带发：在 `deploy/backend/config.yaml` 里加：

```yaml
static:
  enabled: true
  root: "../web"
```

再重启。`health.sh` 显示 `static=true` 就表示静态站由后端提供。

---

## 三、一键部署命令

### Linux / Git Bash

```sh
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh
sh deploy/scripts/health.sh
sh deploy/scripts/stop.sh
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File deploy\scripts\migrate.ps1
powershell -ExecutionPolicy Bypass -File deploy\scripts\start-bg.ps1
powershell -ExecutionPolicy Bypass -File deploy\scripts\health.ps1
powershell -ExecutionPolicy Bypass -File deploy\scripts\stop.ps1
```

说明：

- `start.sh` 是前台运行，`Ctrl+C` 停止，适合调试；
- 生产用 `start-bg.sh`，会等待 health 200，再自动跑一条只读集合查询冒烟；
- `install`、`migrate`、`start-bg` 都是幂等的，重复执行不会重复建表或重复启动；
- `stop` 只杀“pid 文件 + 命令行匹配”的进程，不会因 PID 复用误杀。

退出码：

```text
0 成功
1 运行失败（编译、启动、探活、冒烟）
2 环境/配置不满足（缺命令、缺文件、参数非法）
```

### 首次运行引导

如果 `deploy/backend/config.yaml` 缺失，或与 `config.generated.yaml` 完全一致，脚本会认为还没配置过，并询问：

```text
1) 后端监听端口 [8080]:
2) 数据库地址 [sqlite://data/app.db]:
3) 缓存 none / memory / redis [memory]:
```

直接回车使用方括号里的默认值。

- 连接串里带口令（`mysql://user:pass@host/db`）会被移除，提示改用环境变量注入；
- 一旦你手改过 `config.yaml`，后续脚本只读取、不覆盖；
- 删掉 `config.yaml` 再跑一次，即可重新引导。

CI / 容器里用非交互模式：

```sh
export LC_DEPLOY_NONINTERACTIVE=1
export LC_DEPLOY_PORT=8080
export LC_DEPLOY_DB='sqlite://data/app.db'
export LC_DEPLOY_CACHE=memory
sh deploy/scripts/install.sh
sh deploy/scripts/migrate.sh
sh deploy/scripts/start-bg.sh
sh deploy/scripts/health.sh --json
```

### 常用环境变量

| 变量 | 作用 |
| --- | --- |
| `LC_DEPLOY_HOST` | 监听地址，默认 `127.0.0.1` |
| `LC_DEPLOY_PORT` | 监听端口，默认 8080 |
| `LC_DEPLOY_DB` | 数据库地址 |
| `LC_DEPLOY_CACHE` | `none` / `memory` / `redis` |
| `LC_PORT` / `LC_HOST` | 运行期覆盖监听 |
| `DATABASE_URL` | 运行期覆盖数据库连接串，优先级最高 |
| `LC_DB_PASSWORD` | 数据库口令，推荐用这个注入 |
| `REDIS_URL` | Redis 地址/口令 |
| `LC_CORS_ORIGINS` | 覆盖 CORS 允许来源，逗号分隔 |
| `LC_PUBLIC_BASE_URL` | 站点公开基址，影响链接与 CORS 默认来源 |

优先级：

```text
内置默认 < config.generated.yaml < config.yaml < 环境变量 < 启动参数
```

---

## 四、nginx：生成、校验、启动

不要手改 `nginx.generated.conf`。要改端口、域名、上游或证书，就重跑 `render`。

### 形态 B：HTTP 反代

```sh
sh deploy/scripts/nginx.sh render --mode http --http-port 19080 \
  --domain demo.local --upstream 127.0.0.1:8080

sh deploy/scripts/nginx.sh test   --mode http --http-port 19080 \
  --domain demo.local --upstream 127.0.0.1:8080

sh deploy/scripts/nginx.sh start  --mode http --http-port 19080 \
  --domain demo.local --upstream 127.0.0.1:8080
```

验证：

```sh
curl -I  http://127.0.0.1:19080/
curl -s  http://127.0.0.1:19080/api/health
curl -s  "http://127.0.0.1:19080/api/collections/demo/rows?page=1&pageSize=1"
```

### 形态 C：HTTPS

```sh
sh deploy/scripts/gen-test-cert.sh --domain demo.local --days 365
# 或导入自有证书
sh deploy/scripts/import-cert.sh --cert /path/fullchain.pem --key /path/privkey.pem --domain demo.local

sh deploy/scripts/nginx.sh render --mode https --http-port 80 --https-port 443 \
  --domain demo.local --upstream 127.0.0.1:8080 \
  --cert certs/site.crt --key certs/site.key

sh deploy/scripts/nginx.sh test   --mode https --http-port 80 --https-port 443 \
  --domain demo.local --upstream 127.0.0.1:8080 \
  --cert certs/site.crt --key certs/site.key

sh deploy/scripts/nginx.sh start  --mode https --http-port 80 --https-port 443 \
  --domain demo.local --upstream 127.0.0.1:8080 \
  --cert certs/site.crt --key certs/site.key
```

验证：

```sh
curl -kI https://127.0.0.1/
curl -k  https://127.0.0.1/api/health
curl -I  http://127.0.0.1/
```

最后一条应返回 301 跳到 HTTPS。

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File deploy\scripts\nginx.ps1 -Action render -Mode http -HttpPort 19080 -Domain demo.local -Upstream 127.0.0.1:8080
```

`test` / `start` / `reload` / `stop` 同理。默认 80/443 在 Linux 需要特权，先用高端口验证，再上线。

### nginx 脚本参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--mode` | `https` | `http` 生成最小反代；`https` 以底稿替换 |
| `--domain` | 站点域名，未配置则 `localhost` | 写入 `server_name` |
| `--http-port` | 80 | HTTP 端口；HTTPS 模式用于 301 |
| `--https-port` | 443 | HTTPS 端口 |
| `--upstream` | `127.0.0.1:8080` | 写入 `proxy_pass` |
| `--cert` / `--key` | `<包>/certs/site.*` | 写入证书路径 |
| `--force` | 关 | 覆盖已有 `nginx.generated.conf` |

动作：

```text
render  只生成配置，不要求装 nginx
test    nginx -t 校验
start   启动
reload  重载
stop    停止
```

---

## 五、证书：自签与自有证书

### 生成自签测试证书

```sh
sh deploy/scripts/gen-test-cert.sh --domain demo.local --days 365
```

- 证书 CN / SAN 使用 `--domain`，并固定加入 `localhost`、`127.0.0.1`；
- 默认输出 `certs/site.crt`、`certs/site.key`；
- 私钥不加密（nginx 需要无人值守读取），Unix 权限 `600`，Windows 只给当前用户；
- 浏览器会提示不受信任，测试时必须 `curl -k`；
- **不要用自签证书对外提供正式服务。**

### 导入自有证书

```sh
sh deploy/scripts/import-cert.sh \
  --cert /path/fullchain.pem \
  --key  /path/privkey.pem \
  [--chain /path/chain.pem] \
  --domain example.com
```

导入校验（任一失败即退出码 1，不写入文件）：

1. 证书可解析（PEM / X.509）；
2. 私钥可解析且未加密；
3. 证书与私钥配对（比较公钥 DER 的 SHA-256）；
4. 有效期 ≥ 30 天；
5. 传了 `--domain` 时，SAN 必须包含该域名；
6. 传了 `--chain` 时，链可解析，并尝试用系统根证书验证。

成功输出：

```text
certs/site.crt
certs/site.key
certs/site.chain.crt   （有链时）
```

### 安全红线

- 私钥和口令不得出现在模板、日志、错误信息、聊天记录里；
- 不要把 `certs/`、`*.key`、`*.pem`、`*.p12` 提交到仓库；
- 导出包本身不带私钥；发现私钥进了 zip，视为事故，重新导出并轮换证书；
- 私钥泄露后立即吊销并重新签发，不要只改文件名。

---

## 六、后端反代与静态目录

nginx 底稿的关键默认值：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `listen` | 80 / 443 | 常规入口 |
| `redirectHttp` | 开 | HTTP 301 到 HTTPS |
| TLS 协议 | TLSv1.2 + TLSv1.3 | 淘汰 1.0 / 1.1 |
| `ssl_session_tickets` | off | 降低历史流量解密风险 |
| `proxy.upstream` | `127.0.0.1:8080` | 与后端默认端口一致 |
| 代理超时 | 连接 5s / 读写 60s | API 常规耗时留余量 |
| `static.root` | `web` | 静态产物目录 |
| gzip | 开，≥1024 字节 | 小文件不压 |
| 静态缓存 | 1 年 + immutable | 文件名带内容哈希 |
| HTML 缓存 | `no-cache` | 发布后立刻拿到新页面 |
| 安全头 | nosniff / SAMEORIGIN / Referrer-Policy | 默认加固 |
| HSTS | 注释掉 | 自签阶段开启会让浏览器长期强制 HTTPS |
| 请求体上限 | 10m | 覆盖常规上传；后端 JSON 仍限 1 MB |

注意事项：

- `add_header` 不会从 `server` 继承到写了 `add_header` 的 `location`，静态与 HTML 的 location 重复写了安全头，删改时不要漏；
- `http2 on;` 需要 nginx ≥ 1.25.1；更老的版本改成 `listen 443 ssl http2;`；
- 默认按文件存在性 404。如果站点是前端 history 路由，把 `location /` 改成：

```nginx
try_files $uri $uri/ /index.html;
```

但这会掩盖拼错的资源路径，确认站点确实需要再改。

### 部署在子目录（路径前缀不是 `/`）

导出向导里的「路径前缀」会写进页面链接和后端公开基址，但 nginx 底稿默认按站点根部署。前缀填 `/app` 时，需要在 server 块里手工加：

```nginx
location /app/ {
    alias /path/to/web/;
    try_files $uri $uri/ /app/index.html;
}

location /app/api/ {
    proxy_pass http://127.0.0.1:8080/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

或者更省事的做法：路径前缀保持 `/`，把站点部署在独立域名或独立端口。

改完执行 `nginx -t` 再 reload。

---

## 七、CORS：什么时候要改，改哪里

### 默认行为

后端配置里：

```yaml
cors:
  enabled: true
  origins: []
  credentials: false
```

`origins: []` 表示**不返回任何 CORS 头**。同源访问不受影响；浏览器跨域调 `/api/*` 会被拦截，服务端不会报错。

### 什么情况需要配

| 场景 | 是否需要 CORS |
| --- | --- |
| 静态站和 API 都由同一个 nginx 域名提供 | 不需要（同源） |
| 前端跑在 `localhost:5173`，API 在另一个端口 | 需要 |
| 多个域名共用一个后端 | 需要 |
| 桌面 / App 直连后端 | 通常不需要浏览器 CORS，但要注意鉴权与来源限制 |

### 在哪配

三种方式，优先级从高到低：

1. 环境变量：

```sh
LC_CORS_ORIGINS=https://example.com,http://localhost:5173
```

2. 导出向导第 3 步的「额外允许来源」，每行一个；
3. 部署包的 `deploy/backend/config.yaml`：

```yaml
cors:
  enabled: true
  origins:
    - https://example.com
    - http://localhost:5173
  credentials: true
```

导出时站点域名会自动进入允许来源。域名留空则回退 `localhost`。

### 两条硬规则

- `credentials: true` 与 `origins: ["*"]` 同时出现会**拒绝启动**，浏览器规范不允许；
- 允许来源要写完整 origin（协议 + 域名 + 端口），不要带路径或结尾斜杠。

### 排查顺序

跨域失败时先看浏览器控制台：

1. 报 `No 'Access-Control-Allow-Origin'`：`LC_CORS_ORIGINS` 没包含当前页面的 origin；
2. 报 credentials 相关错误：检查 `credentials` 与 `origins` 是否同时配错；
3. OPTIONS 返回 404：确认 nginx 把 `/api/` 转发到了后端，且后端 CORS 开启；
4. 请求根本没到后端：看 nginx `access.log`，再查 `proxy_pass`。

---

## 八、探活、日志与停止

### 健康检查

```sh
sh deploy/scripts/health.sh
sh deploy/scripts/health.sh --wait 10
sh deploy/scripts/health.sh --json
```

输出会包含：

- 监听地址与端口；
- 数据库状态（`database=up/down`）；
- 缓存状态与是否降级（`cacheFallback=true`）；
- 静态站是否由后端提供（`static=true`）；
- 配置摘要，口令统一打码成 `***`。

退出码：0 健康；1 不健康/连不上；2 环境不满足。

### 日志位置

```text
logs/server.log
logs/server.err.log
logs/server.pid
logs/nginx/access.log
logs/nginx/error.log
```

`start-bg` 失败会 tail 日志并给下一步，先看日志尾部再猜。

### 停止

先停 nginx，再停后端：

```sh
sh deploy/scripts/nginx.sh stop
sh deploy/scripts/stop.sh
```

`stop` 先 SIGTERM，等 10 秒再强制结束。

---

## 九、常见问题

### 1. `缺少命令：node/npm/cargo/go`

工具链没装或不在 PATH。装好后重开终端，再跑 `install`。

### 2. 端口被占用 / health 连不上

改 `config.yaml` 的 `port`，或设 `LC_PORT`；nginx 用 `--http-port` / `--https-port` 换端口。先 `health.sh` 看实际监听。

### 3. `database=down` 或 503 `LC_E_DB_UNAVAILABLE`

数据库地址、口令或驱动不对。用 `LC_DB_PASSWORD` 注入口令；确认库已启动、端口可达；看 `health.sh` 的存储行。

### 4. `cacheFallback=true`

Redis 不可用，已降级到内存缓存。属预期降级；要恢复就修 Redis，或用 `LC_DEPLOY_CACHE=memory` 显式关闭。

### 5. `nginx: command not found`

没装 nginx 或不在 PATH。`render` 仍可用；装 nginx ≥ 1.25.1 后再 `test/start`。

### 6. `nginx -t` 报 `CreateDirectory`

缺 `temp/` 子目录。重跑 `nginx.sh render`，脚本会自动创建。

### 7. 提示 nginx 已在运行但访问失败

pid 文件残留。先 `nginx.sh stop` 清理，再 `start`。

### 8. 自签证书浏览器报警

正常。测试用 `-k` 或手动信任；正式环境换可信证书。

### 9. 导入证书提示有效期不足 30 天

换新证书。脚本会拒绝写入，不会留下半套文件。

### 10. 子目录部署后资源 404

检查 nginx 是否加了 `/app/` 的 `alias`，以及前端基址与路径前缀是否一致。最省事的方案是把前缀改回 `/`。

---

## 本篇检查清单

- [ ] 知道导出包里 `web/`、`server/`、`deploy/`、`certs/` 各自是什么；
- [ ] 能说出三种部署形态的适用场景；
- [ ] 会在 Linux / Windows 上跑 install → migrate → start-bg → health；
- [ ] 知道首次引导会生成 `config.yaml`，手改后不会被覆盖；
- [ ] 会用 `nginx.sh render / test / start`，并知道不要手改 `nginx.generated.conf`；
- [ ] 会生成自签证书、导入自有证书，并知道校验项；
- [ ] 知道私钥不进仓库、不进日志；
- [ ] 知道后端只监听 127.0.0.1:8080，由 nginx 对外；
- [ ] 知道子目录部署要自己加 `alias`，或保持前缀为 `/`；
- [ ] 知道同源不需要 CORS，跨域要配 `LC_CORS_ORIGINS`；
- [ ] 知道 `credentials: true` 不能和 `*` 同时用；
- [ ] 会用 `health.sh` 看数据库、缓存、静态站状态。

下一篇：[11 备份、版本与迁移](11-backup-and-migration.md)。会讲站点备份、历史版本、跨机器迁移，以及当前界面哪些入口还没有。
