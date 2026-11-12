#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · 后台启动 + pid + 日志 + 自动冒烟
#
# 用法：sh deploy/scripts/start-bg.sh [--no-smoke]
# 行为：
#   1) 已有实例且健康 → 直接返回 0（幂等，不重复启动）。
#   2) 写 logs/server.pid 与 logs/server.meta，日志追加到 logs/server.log。
#   3) 等待 /api/health 变 200（默认 60 秒），超时打印日志尾部与下一步。
#   4) 默认再跑一条只读集合查询；没有集合或集合要求登录时说明并跳过。
#
# 退出码：0 成功/已在运行；1 启动或冒烟失败；2 环境/配置不满足。

set -eu
. "$(dirname -- "$0")/common.sh"

lc_require_server
lc_require curl
lc_ensure_config
lang=$(lc_lang)
no_smoke=${LC_DEPLOY_SKIP_SMOKE:-0}
[ "${1:-}" = '--no-smoke' ] && no_smoke=1

url=$(lc_health_url)
pid=$(lc_read_pid 2>/dev/null || true)
if [ -n "$pid" ] && lc_pid_alive "$pid"; then
  if [ "$(lc_http_code "$url" 3)" = 200 ]; then
    printf '已在运行且健康：pid %s，%s\n' "$pid" "$url"
    printf '如需重启：sh deploy/scripts/stop.sh 后再执行本脚本。\n'
    exit 0
  fi
  lc_die "进程存在（pid $pid）但健康检查未通过。先执行 sh deploy/scripts/stop.sh，再查看 logs/server.log。"
fi

case "$lang" in
  node) lc_require node ;;
  rust|go) [ -x "$(lc_binary)" ] || lc_blocked "尚未编译：请先运行 sh deploy/scripts/install.sh" ;;
  *) lc_blocked "无法识别后端语言：$lang" ;;
esac

mkdir -p "$LC_LOGS"
printf '\n=== %s start-bg (%s) ===\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$lang" >> "$LC_LOG"

has_nohup=0
command -v nohup >/dev/null 2>&1 && has_nohup=1

case "$lang" in
  node)
    if [ "$has_nohup" = 1 ]; then
      ( cd "$LC_SERVER" && exec nohup node src/main.js ) >> "$LC_LOG" 2>&1 &
    else
      ( cd "$LC_SERVER" && exec node src/main.js ) >> "$LC_LOG" 2>&1 &
    fi
    ;;
  rust|go)
    if [ "$has_nohup" = 1 ]; then
      ( cd "$LC_SERVER" && exec nohup "$(lc_binary)" ) >> "$LC_LOG" 2>&1 &
    else
      ( cd "$LC_SERVER" && exec "$(lc_binary)" ) >> "$LC_LOG" 2>&1 &
    fi
    ;;
esac

pid=$!
printf '%s\n' "$pid" > "$LC_PID"
{
  printf 'pid=%s\n' "$pid"
  printf 'language=%s\n' "$lang"
  if [ "$lang" = rust ] || [ "$lang" = go ]; then printf 'binary=%s\n' "$(lc_binary)"; fi
  printf 'port=%s\n' "$(lc_effective_port)"
  printf 'started=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
} > "$LC_META"

printf '已启动：pid %s，日志 %s\n' "$pid" "$LC_LOG"
printf '等待健康检查：%s\n' "$url"
if ! lc_wait_health "$url"; then
  printf '健康检查超时。日志尾部（最后 30 行）：\n' >&2
  tail -n 30 "$LC_LOG" >&2 2>/dev/null || true
  lc_die "启动失败或未就绪。下一步：sh deploy/scripts/health.sh 重试；端口被占用时改 deploy/backend/config.yaml 的 port 或设置 LC_PORT；停止用 sh deploy/scripts/stop.sh。"
fi

printf 'health 200 OK\n'

if [ "$no_smoke" = 1 ]; then
  printf '冒烟：已按 --no-smoke 跳过\n'
  printf '完成。查看配置摘要：sh deploy/scripts/health.sh\n'
  exit 0
fi

collection_dir="$LC_ROOT/web/data/collections"
collection_id=''
collection_file=''
for f in "$collection_dir"/*.json; do
  [ -f "$f" ] || continue
  id=$(grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -n 1 | sed -E 's/.*"([^"]*)"$/\1/')
  [ -n "$id" ] || id=$(basename "$f" .json | tr 'A-Z' 'a-z')
  collection_id=$id
  collection_file=$f
  break
done

if [ -z "$collection_id" ]; then
  printf '冒烟：未找到集合快照（%s/），跳过集合查询。\n' "$collection_dir"
  printf '完成。查看配置摘要：sh deploy/scripts/health.sh\n'
  exit 0
fi

tmp_body="$LC_LOGS/.smoke-body"
base=${url%/api/health}
query_url="$base/api/collections/$collection_id/rows?page=1&pageSize=1"
code=$(curl -sS -o "$tmp_body" -w '%{http_code}' --max-time 5 "$query_url" 2>/dev/null) || code=000
case "$code" in
  200)
    total=$(grep -o '"total"[[:space:]]*:[[:space:]]*[0-9]*' "$tmp_body" 2>/dev/null | head -n 1 | grep -o '[0-9]*$' || true)
    printf '冒烟：集合 %s 只读查询 200（total=%s）\n' "$collection_id" "${total:-未知}"
    ;;
  401|403)
    printf '冒烟：集合 %s 需要登录（HTTP %s），跳过匿名查询。\n' "$collection_id" "$code"
    ;;
  *)
    printf '冒烟失败：集合 %s 返回 HTTP %s\n' "$collection_id" "$code" >&2
    head -c 300 "$tmp_body" >&2 2>/dev/null || true
    printf '\n' >&2
    lc_die "冒烟失败。下一步：sh deploy/scripts/health.sh 看服务状态；检查 web/data/collections/ 与 dataApi 配置。"
    ;;
esac
rm -f "$tmp_body"
printf '完成。查看配置摘要：sh deploy/scripts/health.sh\n'
