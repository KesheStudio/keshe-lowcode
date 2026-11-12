#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · sh 公共函数
#
# 被 install/migrate/start/start-bg/stop/health/nginx 共同 source。
# 不在这里执行任何会改动数据的命令；只做路径解析、语言识别、配置读取/引导、输出。
#
# 约束：
# - 只用 POSIX sh 语法（Linux / Git Bash 都能跑）。
# - 任何输出都不打印数据库/Redis 口令；连接串里的 user:pass 会打码。
# - 退出码约定：0 成功；1 运行失败；2 环境/配置不满足（BLOCKED）。

set -u

LC_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LC_ROOT=$(CDPATH= cd -- "$LC_SCRIPT_DIR/../.." && pwd)
LC_SERVER="$LC_ROOT/server"
LC_DEPLOY="$LC_ROOT/deploy"
LC_CFG="$LC_DEPLOY/backend/config.yaml"
LC_GEN="$LC_DEPLOY/backend/config.generated.yaml"
LC_NGINX_CFG="$LC_DEPLOY/nginx/nginx.conf"
LC_NGINX_GEN="$LC_DEPLOY/nginx/nginx.generated.conf"
LC_LOGS="$LC_ROOT/logs"
LC_PID="$LC_LOGS/server.pid"
LC_META="$LC_LOGS/server.meta"
LC_LOG="$LC_LOGS/server.log"

LC_LANG=''

lc_is_windows() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

lc_exe_suffix() {
  if lc_is_windows; then printf '.exe'; fi
}

lc_require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '缺少命令 %s：请先安装后再试。\n' "$1" >&2
    exit 2
  fi
}

lc_die() {
  printf '%s\n' "$*" >&2
  exit 1
}

lc_blocked() {
  printf '%s\n' "$*" >&2
  exit 2
}

lc_banner() {
  printf '低代码导出包 · %s\n' "$1"
  printf '站点根：%s\n' "$LC_ROOT"
  printf '语言：%s\n' "$(lc_lang)"
}

# ---------------------------------------------------------------- 语言与产物

lc_lang() {
  if [ -n "$LC_LANG" ]; then printf '%s' "$LC_LANG"; return; fi
  if [ -f "$LC_SERVER/package.json" ]; then LC_LANG=node
  elif [ -f "$LC_SERVER/Cargo.toml" ]; then LC_LANG=rust
  elif [ -f "$LC_SERVER/go.mod" ]; then LC_LANG=go
  else LC_LANG=unknown
  fi
  printf '%s' "$LC_LANG"
}

lc_profile() {
  if [ "${LC_DEPLOY_PROFILE:-release}" = debug ]; then printf 'debug'; else printf 'release'; fi
}

lc_binary() {
  case "$(lc_lang)" in
    rust) printf '%s/target/%s/lowcode-server%s' "$LC_SERVER" "$(lc_profile)" "$(lc_exe_suffix)" ;;
    go)   printf '%s/lowcode-server%s' "$LC_SERVER" "$(lc_exe_suffix)" ;;
    *)    printf '' ;;
  esac
}

lc_require_server() {
  [ -d "$LC_SERVER" ] || lc_blocked "缺少 server/ 目录：导出包里必须有后端工程。请重新导出并选择后端语言。"
  lang=$(lc_lang)
  [ "$lang" != unknown ] || lc_blocked "无法识别后端语言（server/ 下没有 package.json / Cargo.toml / go.mod）。请确认导出包完整。"
}

lc_require_tools() {
  case "$(lc_lang)" in
    node) lc_require node; lc_require npm ;;
    rust) lc_require cargo; lc_require rustc ;;
    go) lc_require go ;;
  esac
}

# ---------------------------------------------------------------- 配置读取

lc_config_source() {
  # 优先读用户配置；还没生成时读导出包里的 config.generated.yaml，首次引导的默认值才准。
  if [ -f "$LC_CFG" ]; then printf '%s' "$LC_CFG"; else printf '%s' "$LC_GEN"; fi
}

lc_top_value() {
  # $1 = 顶层键名
  src=$(lc_config_source)
  [ -f "$src" ] || return 0
  awk -v key="$1" '
    $0 ~ "^" key "[[:space:]]*:" {
      v = $0
      sub("^[^:]*:[[:space:]]*", "", v)
      sub("[[:space:]]*#.*$", "", v)
      gsub(/^"|"$/, "", v)
      print v
      exit
    }
  ' "$src"
}

lc_nested_value() {
  # $1 = 顶层段名，$2 = 段内键名
  src=$(lc_config_source)
  [ -f "$src" ] || return 0
  awk -v sec="$1" -v key="$2" '
    $0 ~ "^" sec "[[:space:]]*:" { inSec = 1; next }
    inSec && /^[^[:space:]#]/ { inSec = 0 }
    inSec && $0 ~ "^[[:space:]]+" key "[[:space:]]*:" {
      v = $0
      sub("^[^:]*:[[:space:]]*", "", v)
      sub("[[:space:]]*#.*$", "", v)
      gsub(/^"|"$/, "", v)
      print v
      exit
    }
  ' "$src"
}

lc_effective_host() {
  h=${LC_HOST:-$(lc_top_value host)}
  [ -n "$h" ] || h=127.0.0.1
  case "$h" in 0.0.0.0|::) h=127.0.0.1 ;; esac
  printf '%s' "$h"
}

lc_effective_port() {
  p=${LC_PORT:-$(lc_top_value port)}
  [ -n "$p" ] || p=8080
  printf '%s' "$p"
}

lc_effective_db_driver() {
  d=${LC_DB_DRIVER:-$(lc_nested_value database driver)}
  [ -n "$d" ] || d=sqlite
  printf '%s' "$d"
}

lc_effective_db_url() {
  u=${DATABASE_URL:-$(lc_nested_value database url)}
  printf '%s' "$u"
}

lc_effective_cache_driver() {
  d=${LC_CACHE_DRIVER:-$(lc_nested_value cache driver)}
  [ -n "$d" ] || d=memory
  printf '%s' "$d"
}

lc_effective_cache_url() {
  u=${REDIS_URL:-$(lc_nested_value cache url)}
  printf '%s' "$u"
}

# 只用于展示：把 URL 里的口令替换成 ***，不改变文件内容。
lc_mask() {
  printf '%s' "$1" | sed -E -e 's#(://[^:/@]*):[^@]*@#\1:***@#g' -e 's#([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][[:space:]]*[:=][[:space:]]*)[^[:space:]]+#\1***#g'
}

lc_config_state() {
  if [ ! -f "$LC_CFG" ]; then printf 'missing'; return; fi
  if [ -f "$LC_GEN" ]; then
    if command -v cmp >/dev/null 2>&1; then
      cmp -s "$LC_CFG" "$LC_GEN" && { printf 'identical'; return; }
    else
      [ "$(cat "$LC_CFG")" = "$(cat "$LC_GEN")" ] && { printf 'identical'; return; }
    fi
  fi
  printf 'user'
}

lc_strip_url_password() {
  printf '%s' "$1" | sed -E 's#(://[^:/@]*):[^@]*@#\1@#g'
}

lc_write_config() {
  # 依赖调用方设置：CFG_HOST CFG_PORT DB_DRIVER DB_URL DB_HOST DB_PORT DB_NAME DB_USER CACHE_DRIVER CACHE_URL
  mkdir -p "$LC_DEPLOY/backend"
  {
    printf '# 由 deploy/scripts 首次运行生成（%s）。\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf '# 覆盖链：内置默认 < config.generated.yaml < 本文件 < 环境变量 < 启动参数。\n'
    printf '# 不要把口令写在这里；数据库口令用 LC_DB_PASSWORD，Redis 口令用 REDIS_URL。\n'
    printf '\n'
    printf 'schemaVersion: 1\n'
    printf 'strict: true\n'
    printf 'override: false\n'
    printf 'host: "%s"\n' "$CFG_HOST"
    printf 'port: %s\n' "$CFG_PORT"
    printf '\n'
    printf 'database:\n'
    printf '  driver: "%s"\n' "$DB_DRIVER"
    printf '  url: "%s"\n' "$DB_URL"
    printf '  host: "%s"\n' "$DB_HOST"
    printf '  port: %s\n' "$DB_PORT"
    printf '  name: "%s"\n' "$DB_NAME"
    printf '  user: "%s"\n' "$DB_USER"
    printf '  password: ""\n'
    printf '\n'
    printf 'cache:\n'
    printf '  driver: "%s"\n' "$CACHE_DRIVER"
    printf '  url: "%s"\n' "$CACHE_URL"
    printf '  ttlSeconds: 30\n'
    printf '  keyPrefix: "lc:"\n'
  } > "$LC_CFG"
}

lc_default_db_parts() {
  # 从 config.yaml / 生成底稿里取；没有就用 sqlite 默认值。
  DB_DRIVER=${LC_DEPLOY_DB_DRIVER:-$(lc_nested_value database driver)}
  DB_URL=${LC_DEPLOY_DB:-$(lc_nested_value database url)}
  DB_HOST=${LC_DEPLOY_DB_HOST:-$(lc_nested_value database host)}
  DB_PORT=${LC_DEPLOY_DB_PORT:-$(lc_nested_value database port)}
  DB_NAME=${LC_DEPLOY_DB_NAME:-$(lc_nested_value database name)}
  DB_USER=${LC_DEPLOY_DB_USER:-$(lc_nested_value database user)}
  [ -n "$DB_DRIVER" ] || DB_DRIVER=sqlite
  [ -n "$DB_URL" ] || if [ "$DB_DRIVER" = sqlite ]; then DB_URL='sqlite://data/app.db'; else DB_URL=''; fi
  [ -n "$DB_HOST" ] || DB_HOST=127.0.0.1
  [ -n "$DB_PORT" ] || DB_PORT=0
  [ -n "$DB_NAME" ] || DB_NAME=app
  [ -n "$DB_USER" ] || DB_USER=''
}

lc_apply_db_address() {
  # $1 = 用户输入的数据库地址
  addr=$1
  case "$addr" in
    '')
      DB_DRIVER=sqlite; DB_URL='sqlite://data/app.db'
      ;;
    sqlite|sqlite://*)
      DB_DRIVER=sqlite
      [ "$addr" = sqlite ] && DB_URL='sqlite://data/app.db' || DB_URL=$addr
      ;;
    *'://'*)
      scheme=${addr%%://*}
      case "$scheme" in
        mysql) DB_DRIVER=mysql ;;
        postgres|postgresql) DB_DRIVER=postgres ;;
        sqlite) DB_DRIVER=sqlite ;;
        *) lc_blocked "不认识的数据库地址协议：$scheme（支持 sqlite:// / mysql:// / postgres:// / postgresql://）" ;;
      esac
      stripped=$(lc_strip_url_password "$addr")
      if [ "$stripped" != "$addr" ]; then
        printf '提示：连接串里的口令已从配置中移除；请用 LC_DB_PASSWORD 注入。\n'
      fi
      DB_URL=$stripped
      ;;
    *:*)
      hostpart=${addr%%:*}
      rest=${addr#*:}
      portpart=${rest%%/*}
      namepart=${rest#*/}
      [ "$namepart" = "$rest" ] && namepart=app
      [ -n "$hostpart" ] || lc_blocked '数据库地址格式不对：应为 host:port/库名，或带协议的 URL。'
      DB_HOST=$hostpart
      DB_PORT=$portpart
      DB_NAME=$namepart
      if [ -n "${LC_DEPLOY_DB_DRIVER:-}" ]; then
        DB_DRIVER=$LC_DEPLOY_DB_DRIVER
      else
        DB_DRIVER=mysql
      fi
      DB_URL=''
      ;;
    *)
      lc_blocked "数据库地址格式不对：$addr（示例：sqlite://data/app.db、mysql://user@host:3306/db、postgres://user@host:5432/db）"
      ;;
  esac
  if [ "$DB_DRIVER" = mysql ] || [ "$DB_DRIVER" = postgres ]; then
    [ -n "${LC_DB_PASSWORD:-}" ] || printf '提示：数据库口令请用环境变量 LC_DB_PASSWORD 注入，不要写进 config.yaml。\n'
  fi
}

lc_interactive_config() {
  lc_default_db_parts
  d_port=${LC_DEPLOY_PORT:-$(lc_top_value port)}
  [ -n "$d_port" ] || d_port=8080
  d_cache=${LC_DEPLOY_CACHE:-$(lc_nested_value cache driver)}
  [ -n "$d_cache" ] || d_cache=memory
  d_url=${DB_URL:-sqlite://data/app.db}

  printf '\n首次运行：需要生成 %s\n' "$LC_CFG"
  printf '直接回车使用方括号里的默认值。\n\n'

  printf '1) 后端监听端口 [%s]: ' "$d_port"
  IFS= read -r ans || ans=''
  [ -n "${ans:-}" ] && d_port=$ans

  printf '2) 数据库地址 [%s]\n   可填：sqlite://data/app.db、mysql://user@host:3306/db、postgres://user@host:5432/db，或 host:port/库名\n   > ' "$(lc_mask "$d_url")"
  IFS= read -r ans2 || ans2=''
  if [ -n "${ans2:-}" ]; then
    lc_apply_db_address "$ans2"
  fi

  printf '3) 缓存 none / memory / redis [%s]: ' "$d_cache"
  IFS= read -r ans3 || ans3=''
  [ -n "${ans3:-}" ] && d_cache=$ans3
  case "$d_cache" in
    none|memory) CACHE_DRIVER=$d_cache; CACHE_URL='' ;;
    redis)
      CACHE_DRIVER=redis
      CACHE_URL=${LC_DEPLOY_REDIS_URL:-redis://127.0.0.1:16379/0}
      printf '   Redis 地址 [%s]: ' "$(lc_mask "$CACHE_URL")"
      IFS= read -r ans4 || ans4=''
      [ -n "${ans4:-}" ] && CACHE_URL=$ans4
      stripped=$(lc_strip_url_password "$CACHE_URL")
      [ "$stripped" != "$CACHE_URL" ] && printf '提示：Redis 口令请用 REDIS_URL 注入；配置里已移除口令。\n'
      CACHE_URL=$stripped
      ;;
    *) lc_blocked "缓存只能是 none / memory / redis，收到：$d_cache" ;;
  esac

  CFG_HOST=${LC_DEPLOY_HOST:-$(lc_top_value host)}
  [ -n "$CFG_HOST" ] || CFG_HOST=127.0.0.1
  CFG_PORT=$d_port
  lc_write_config
  printf '\n已写入：%s\n' "$LC_CFG"
}

lc_env_config() {
  lc_default_db_parts
  if [ -n "${LC_DEPLOY_DB:-}" ] || [ -n "${LC_DEPLOY_DB_DRIVER:-}" ]; then
    if [ -n "${LC_DEPLOY_DB:-}" ]; then lc_apply_db_address "$LC_DEPLOY_DB"; else :; fi
  fi
  CFG_HOST=${LC_DEPLOY_HOST:-$(lc_top_value host)}
  [ -n "$CFG_HOST" ] || CFG_HOST=127.0.0.1
  CFG_PORT=${LC_DEPLOY_PORT:-$(lc_top_value port)}
  [ -n "$CFG_PORT" ] || CFG_PORT=8080
  CACHE_DRIVER=${LC_DEPLOY_CACHE:-$(lc_nested_value cache driver)}
  [ -n "$CACHE_DRIVER" ] || CACHE_DRIVER=memory
  case "$CACHE_DRIVER" in
    none|memory) CACHE_URL='' ;;
    redis) CACHE_URL=${LC_DEPLOY_REDIS_URL:-${REDIS_URL:-redis://127.0.0.1:16379/0}} ;;
    *) lc_blocked "LC_DEPLOY_CACHE 只能是 none / memory / redis，收到：$CACHE_DRIVER" ;;
  esac
  lc_write_config
  printf '非交互模式：已用环境变量/默认值生成 %s\n' "$LC_CFG"
}

lc_ensure_config() {
  state=$(lc_config_state)
  if [ "$state" = user ]; then
    printf '使用已有配置：%s\n' "$LC_CFG"
    return 0
  fi
  if { [ -t 0 ] && [ "${LC_DEPLOY_NONINTERACTIVE:-0}" != 1; } || [ "${LC_DEPLOY_INTERACTIVE:-0}" = 1 ]; then
    lc_interactive_config
  else
    lc_env_config
  fi
}

# ---------------------------------------------------------------- 进程与探活

lc_pid_alive() {
  [ -n "${1:-}" ] || return 1
  kill -0 "$1" 2>/dev/null
}

lc_read_pid() {
  [ -f "$LC_PID" ] || return 1
  pid=$(tr -d '[:space:]' < "$LC_PID")
  [ -n "$pid" ] || return 1
  printf '%s' "$pid"
}

lc_process_matches() {
  # $1 = pid；尽量确认真的是我们启动的进程，避免 PID 复用误杀。
  # 兼容两类 ps：GNU/BSD 支持 -o command=；Git Bash(MSYS) 不支持，只能读默认列。
  [ -f "$LC_META" ] || return 0
  lang=$(sed -n 's/^language=//p' "$LC_META" | head -n1)
  binary=$(sed -n 's/^binary=//p' "$LC_META" | head -n1)
  marker=''
  alt=''
  case "$lang" in
    node) marker='src/main.js'; alt='node' ;;
    rust|go) marker=$binary; alt='lowcode-server' ;;
  esac
  if command -v ps >/dev/null 2>&1; then
    cmdline=$(ps -p "$1" -o command= 2>/dev/null || true)
    [ -n "$cmdline" ] || cmdline=$(ps -p "$1" 2>/dev/null || true)
    # 平台 ps 无法查看命令行时退回宽松模式：pid 文件本身属于本次部署。
    [ -n "$cmdline" ] || return 0
    case "$cmdline" in
      *"$marker"*) return 0 ;;
      *"$alt"*) return 0 ;;
    esac
    if [ -n "$binary" ]; then
      base=$(basename "$binary")
      base=${base%.exe}
      case "$cmdline" in *"$base"*) return 0 ;; esac
    fi
    return 1
  fi
  return 0
}

lc_http_code() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-3}" "$1" 2>/dev/null) || code=000
  printf '%s' "$code"
}

lc_wait_health() {
  url=$1
  wait=${2:-${LC_DEPLOY_WAIT:-60}}
  i=0
  while [ "$i" -lt "$wait" ]; do
    code=$(lc_http_code "$url" 3)
    [ "$code" = 200 ] && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

lc_health_url() {
  printf 'http://%s:%s/api/health' "$(lc_effective_host)" "$(lc_effective_port)"
}

lc_print_summary() {
  port=$(lc_effective_port)
  host=$(lc_effective_host)
  driver=$(lc_effective_db_driver)
  dburl=$(lc_effective_db_url)
  cache=$(lc_effective_cache_driver)
  cacheurl=$(lc_effective_cache_url)
  printf '  地址：http://%s:%s\n' "$host" "$port"
  printf '  数据库：%s' "$driver"
  [ -n "$dburl" ] && printf ' %s' "$(lc_mask "$dburl")"
  printf '\n'
  printf '  缓存：%s' "$cache"
  [ -n "$cacheurl" ] && printf ' %s' "$(lc_mask "$cacheurl")"
  printf '\n'
  printf '  日志：%s\n' "$LC_LOG"
  pid=$(lc_read_pid 2>/dev/null || true)
  if [ -n "$pid" ] && lc_pid_alive "$pid"; then
    printf '  进程：运行中（pid %s）\n' "$pid"
  else
    printf '  进程：未运行\n'
  fi
}
