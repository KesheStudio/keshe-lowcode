#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · nginx 反代配置渲染 / 测试 / 启停
#
# 用法：
#   sh deploy/scripts/nginx.sh render [--mode http|https] [--domain 域名]
#                                     [--http-port 80] [--https-port 443]
#                                     [--upstream 127.0.0.1:8080]
#                                     [--cert certs/site.crt] [--key certs/site.key]
#                                     [--force]
#   sh deploy/scripts/nginx.sh test | start | reload | stop
#
# 三种部署形态：
#   A. 仅后端：不需要本脚本。
#   B. 后端 + nginx 反代：render --mode http，再 start。
#   C. 后端 + nginx + 证书：先生成/导入证书，render --mode https，再 start。
#
# 渲染结果写到 deploy/nginx/nginx.generated.conf：
#   - https 模式以 deploy/nginx/nginx.conf 为底稿，只替换端口、域名、upstream、证书路径；
#   - http 模式生成一份最小可用反代配置（无证书、无跳转）。
# 证书路径与 upstream 都从本脚本参数/配置推导，不需要手改多处。
#
# 退出码：0 成功；1 执行失败；2 环境/配置不满足。

set -eu
. "$(dirname -- "$0")/common.sh"

mode=https
domain=${LC_DEPLOY_DOMAIN:-localhost}
http_port=${LC_DEPLOY_HTTP_PORT:-80}
https_port=${LC_DEPLOY_HTTPS_PORT:-443}
upstream=${LC_DEPLOY_UPSTREAM:-}
cert=${LC_DEPLOY_CERT:-$LC_ROOT/certs/site.crt}
key=${LC_DEPLOY_KEY:-$LC_ROOT/certs/site.key}
force=0

usage() {
  sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    render|test|start|reload|stop) action=$1; shift ;;
    --mode) mode=${2:-}; shift 2 ;;
    --domain) domain=${2:-}; shift 2 ;;
    --http-port) http_port=${2:-}; shift 2 ;;
    --https-port) https_port=${2:-}; shift 2 ;;
    --upstream) upstream=${2:-}; shift 2 ;;
    --cert) cert=${2:-}; shift 2 ;;
    --key) key=${2:-}; shift 2 ;;
    --force) force=1; shift ;;
    --help|-h) usage ;;
    *) lc_blocked "未知参数：$1（用 --help 查看用法）" ;;
  esac
done

[ -n "${action:-}" ] || action=render
case "$mode" in http|https) : ;; *) lc_blocked "--mode 只能是 http 或 https" ;; esac

if ! command -v nginx >/dev/null 2>&1; then
  if [ "$action" = render ]; then
    printf '提示：本机没有 nginx，仍可渲染配置。执行 test/start 前请先安装 nginx 1.25.3+。\n'
  else
    lc_blocked "找不到 nginx。下一步：安装 nginx 1.25.3+ 并加入 PATH；仅需后端时可跳过本脚本。"
  fi
fi

[ -n "$upstream" ] || upstream="127.0.0.1:$(lc_effective_port)"

mkdir -p "$LC_DEPLOY/nginx" "$LC_LOGS"
# nginx 的临时目录默认相对 prefix；缺了临时目录时 -t/启动都会报 CreateDirectory 失败。
mkdir -p "$LC_ROOT/temp/client_body_temp" "$LC_ROOT/temp/proxy_temp" \
         "$LC_ROOT/temp/fastcgi_temp" "$LC_ROOT/temp/uwsgi_temp" "$LC_ROOT/temp/scgi_temp"

render_http() {
  tmp="$LC_NGINX_GEN.tmp"
  cat > "$tmp" <<'EOF'
# 由 deploy/scripts/nginx.sh render 生成（http 形态）。重新 render 会覆盖本文件。
worker_processes  auto;
pid        logs/nginx.pid;
error_log  logs/error.log warn;

events {
    worker_connections  1024;
}

http {
    types {
        text/html                    html htm;
        text/css                     css;
        application/javascript       js mjs;
        application/json             json map;
        image/svg+xml                svg;
        image/png                    png;
        image/jpeg                   jpg jpeg;
        image/webp                   webp;
        image/gif                    gif;
        image/x-icon                 ico;
        font/woff2                   woff2;
        font/woff                    woff;
        font/ttf                     ttf;
        text/plain                   txt;
        application/pdf              pdf;
        application/xml              xml;
        video/mp4                    mp4;
        application/octet-stream     bin;
    }
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    keepalive_timeout  65;
    server_tokens   off;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" rt=$request_time req=$request_id';
    access_log  logs/access.log  main;

    gzip              on;
    gzip_vary         on;
    gzip_comp_level   5;
    gzip_min_length   1024;
    gzip_proxied      any;
    gzip_types        text/plain text/css text/xml application/json
                      application/javascript application/xml image/svg+xml;

    server {
        listen       {{HTTP_PORT}};
        server_name  {{SERVER_NAME}};

        add_header X-Content-Type-Options  nosniff                         always;
        add_header X-Frame-Options         SAMEORIGIN                     always;
        add_header Referrer-Policy         strict-origin-when-cross-origin always;

        client_max_body_size  10m;
        root   web;
        index  index.html;
        {{BASE_PATH_REWRITE}}

        location /api/ {
            proxy_pass  http://{{UPSTREAM}};
            proxy_http_version  1.1;
            proxy_set_header  Host               $host;
            proxy_set_header  X-Real-IP          $remote_addr;
            proxy_set_header  X-Forwarded-For    $proxy_add_x_forwarded_for;
            proxy_set_header  X-Forwarded-Proto  $scheme;
            proxy_set_header  X-Forwarded-Host   $host;
            proxy_connect_timeout  5s;
            proxy_send_timeout     60s;
            proxy_read_timeout     60s;
        }

        location ~* \.(?:css|js|mjs|json|map|woff2?|ttf|png|jpe?g|webp|gif|svg|ico|mp4)$ {
            try_files  $uri =404;
            add_header Cache-Control          "public, max-age=31536000, immutable" always;
            add_header X-Content-Type-Options  nosniff                         always;
            add_header X-Frame-Options         SAMEORIGIN                     always;
            add_header Referrer-Policy         strict-origin-when-cross-origin always;
        }

        location ~* \.html?$ {
            try_files  $uri =404;
            add_header Cache-Control          "no-cache"                      always;
            add_header X-Content-Type-Options  nosniff                         always;
            add_header X-Frame-Options         SAMEORIGIN                     always;
            add_header Referrer-Policy         strict-origin-when-cross-origin always;
        }

        location / {
            try_files  $uri $uri/ =404;
        }

        location ~ /\.(?!well-known) {
            deny  all;
        }
    }
}
EOF
  sed -e "s|{{HTTP_PORT}}|$http_port|g" \
      -e "s|{{SERVER_NAME}}|$domain localhost 127.0.0.1|g" \
      -e "s|{{UPSTREAM}}|$upstream|g" "$tmp" > "$LC_NGINX_GEN"
  rm -f "$tmp"
}

render_https() {
  [ -f "$LC_NGINX_CFG" ] || lc_blocked "缺少 $LC_NGINX_CFG。导出时未包含 nginx 配置：请重新导出并勾选 nginx，或把 nginx.conf 放到 deploy/nginx/ 后重试。"
  tmp="$LC_NGINX_GEN.tmp"
  sed -e "s|listen       80;|listen       $http_port;|" \
      -e "s|listen       443 ssl;|listen       $https_port ssl;|" \
      -e "s|server_name  [^;]*;|server_name  $domain localhost 127.0.0.1;|g" \
      -e "s|proxy_pass  http://127.0.0.1:8080;|proxy_pass  http://$upstream;|" \
      -e "s|ssl_certificate      ../../certs/site.crt;|ssl_certificate      $cert;|" \
      -e "s|ssl_certificate_key  ../../certs/site.key;|ssl_certificate_key  $key;|" \
      "$LC_NGINX_CFG" > "$tmp"
  if [ "$https_port" != 443 ]; then
    tmp2="$tmp.2"
    sed "s|return 301 https://\$host\$request_uri;|return 301 https://\$host:$https_port\$request_uri;|" "$tmp" > "$tmp2"
    mv "$tmp2" "$tmp"
  fi
  {
    printf '# 由 deploy/scripts/nginx.sh render 生成（https 形态，底稿 deploy/nginx/nginx.conf）。\n'
    printf '# 重新 render 会覆盖本文件；要自定义请改 nginx.conf 后重新 render。\n'
    cat "$tmp"
  } > "$LC_NGINX_GEN"
  rm -f "$tmp"

  for probe in "$upstream" "$cert" "$key"; do
    if ! grep -Fq "$probe" "$LC_NGINX_GEN"; then
      printf '警告：渲染结果里没有找到 %s，请确认底稿 deploy/nginx/nginx.conf 是否被改过。\n' "$probe" >&2
    fi
  done
}

do_render() {
  if [ "$mode" = http ]; then
    render_http
    printf '已生成 http 反代配置：%s（listen %s，upstream %s）\n' "$LC_NGINX_GEN" "$http_port" "$upstream"
  else
    render_https
    printf '已生成 https 反代配置：%s（listen %s，upstream %s）\n' "$LC_NGINX_GEN" "$https_port" "$upstream"
    if [ ! -f "$cert" ] || [ ! -f "$key" ]; then
      printf '提示：证书或私钥还不存在（%s / %s）。\n' "$cert" "$key"
      printf '下一步：sh deploy/scripts/gen-test-cert.sh --domain %s（测试）或 sh deploy/scripts/import-cert.sh（正式证书）。\n' "$domain"
    fi
  fi
  printf '校验：sh deploy/scripts/nginx.sh test\n'
}

nginx_pid_alive() {
  npid=$(tr -d '[:space:]' < "$LC_LOGS/nginx.pid" 2>/dev/null || true)
  [ -n "$npid" ] || return 1
  if kill -0 "$npid" 2>/dev/null; then return 0; fi
  if command -v tasklist >/dev/null 2>&1 && tasklist //FI "PID eq $npid" 2>/dev/null | grep -Fq "$npid"; then
    return 0
  fi
  return 1
}

require_rendered() {
  if [ ! -f "$LC_NGINX_GEN" ] || [ "$force" = 1 ]; then
    do_render
  fi
  if [ "$mode" = https ] && { [ ! -f "$cert" ] || [ ! -f "$key" ]; }; then
    lc_blocked "证书缺失，nginx 无法启动：$cert / $key。下一步：sh deploy/scripts/gen-test-cert.sh --domain $domain，或 sh deploy/scripts/import-cert.sh。"
  fi
}

case "$action" in
  render) do_render ;;
  test)
    require_rendered
    nginx -t -p "$LC_ROOT" -c "$LC_NGINX_GEN" || lc_die "nginx 配置校验失败。下一步：按上面的行号修改 deploy/nginx/nginx.conf 或重新 render；本地/内网可改用 8080/8443 这类高位端口。"
    ;;
  start)
    require_rendered
    if nginx_pid_alive; then
      printf 'nginx 似乎已在运行（%s）。需要重载用：sh deploy/scripts/nginx.sh reload\n' "$LC_LOGS/nginx.pid"
      exit 0
    fi
    if [ -f "$LC_LOGS/nginx.pid" ]; then
      printf '清理遗留 pid：%s\n' "$LC_LOGS/nginx.pid"
    fi
    rm -f "$LC_LOGS/nginx.pid"
    nginx -p "$LC_ROOT" -c "$LC_NGINX_GEN" || lc_die "nginx 启动失败。下一步：先跑 sh deploy/scripts/nginx.sh test；端口被占用就改 --http-port/--https-port；<1024 端口需要特权。"
    sleep 1
    if [ ! -s "$LC_LOGS/nginx.pid" ]; then
      printf 'nginx 退出。错误日志尾部：\n'
      tail -n 20 "$LC_LOGS/error.log" 2>/dev/null || true
      lc_die "nginx 没有保持运行。下一步：按上面的错误改配置或端口后重试；端口被占用时换 --http-port/--https-port。"
    fi
    printf 'nginx 已启动：http%s://%s（upstream %s）\n' "$([ "$mode" = https ] && printf 's')" "$domain" "$upstream"
    ;;
  reload)
    [ -f "$LC_NGINX_GEN" ] || lc_blocked "还没有生成配置：先执行 sh deploy/scripts/nginx.sh render"
    nginx -p "$LC_ROOT" -c "$LC_NGINX_GEN" -s reload || lc_die "nginx reload 失败：确认 nginx 正在运行（sh deploy/scripts/nginx.sh start），再重试。"
    printf 'nginx 已重载。\n'
    ;;
  stop)
    npid=$(tr -d '[:space:]' < "$LC_LOGS/nginx.pid" 2>/dev/null || true)
    if [ -z "$npid" ]; then
      rm -f "$LC_LOGS/nginx.pid"
      printf 'nginx 未运行（没有有效 logs/nginx.pid）。\n'
      exit 0
    fi
    if [ -f "$LC_NGINX_GEN" ]; then
      nginx -p "$LC_ROOT" -c "$LC_NGINX_GEN" -s quit 2>/dev/null || nginx -p "$LC_ROOT" -c "$LC_NGINX_GEN" -s stop 2>/dev/null || true
    fi
    # 兜底：配置已被删或信号方式不支持时，按 pid 文件停止（Windows 用 taskkill）。
    if kill -0 "$npid" 2>/dev/null; then
      kill "$npid" 2>/dev/null || true
    fi
    if command -v tasklist >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
      if tasklist //FI "PID eq $npid" 2>/dev/null | grep -Fq "$npid"; then
        taskkill //PID "$npid" //F >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$LC_LOGS/nginx.pid"
    printf 'nginx 已停止。\n'
    ;;
esac
