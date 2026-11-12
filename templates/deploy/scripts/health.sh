#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · 探活 + 关键配置摘要
#
# 用法：sh deploy/scripts/health.sh [--wait 秒数] [--json]
#   --wait   最多等待多少秒（每秒重试），默认 0（只探一次）
#   --json   只输出 /api/health 的原始 JSON，便于 CI 解析
# 输出中的连接串口令会打码成 ***；不会打印任何密钥。
#
# 退出码：0 健康；1 不健康/连不上；2 环境不满足。

set -eu
. "$(dirname -- "$0")/common.sh"

lc_require curl
wait=0
json_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait=${2:-0}; shift 2 ;;
    --json) json_only=1; shift ;;
    *) lc_blocked "未知参数：$1（支持 --wait N / --json）" ;;
  esac
done

mkdir -p "$LC_LOGS"
body="$LC_LOGS/.health-body"
url=$(lc_health_url)

code=000
i=0
while :; do
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 5 "$url" 2>/dev/null) || code=000
  [ "$code" = 200 ] && break
  [ "$i" -lt "$wait" ] || break
  sleep 1
  i=$((i + 1))
done

if [ "$json_only" = 1 ]; then
  cat "$body" 2>/dev/null || true
  printf '\n'
  [ "$code" = 200 ] && { rm -f "$body"; exit 0; }
  rm -f "$body"
  exit 1
fi

printf 'LC health\n'
printf '  URL：%s\n' "$url"
printf '  HTTP：%s\n' "$code"

if [ "$code" = 000 ]; then
  printf '  状态：连不上（进程可能未启动）\n'
  printf '  下一步：先运行 sh deploy/scripts/start-bg.sh；再看 %s\n' "$LC_LOG"
  rm -f "$body"
  exit 1
fi

json_str() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$body" 2>/dev/null | head -n 1 | sed -E 's/.*:[[:space:]]*"([^"]*)"$/\1/'
}
json_raw() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*[^,}]*" "$body" 2>/dev/null | head -n 1 | sed -E 's/.*:[[:space:]]*//'
}

if [ "$code" = 200 ]; then
  status=$(json_str status)
  language=$(json_str language)
  maturity=$(json_str maturity)
  version=$(json_str version)
  uptime=$(json_raw uptimeSeconds)
  database=$(json_str database)
  cache=$(json_str cache)
  fallback=$(json_raw cacheFallback)
  static=$(json_raw static)
  printf '  状态：ok（language=%s maturity=%s version=%s uptime=%ss）\n' "$language" "$maturity" "$version" "$uptime"
  printf '  存储：database=%s cache=%s cacheFallback=%s static=%s\n' "$database" "$cache" "$fallback" "$static"
else
  err_code=$(json_str code)
  err_msg=$(json_str message)
  printf '  状态：不健康（error=%s %s）\n' "${err_code:-未知}" "${err_msg:-无消息}"
  if [ "$code" = 503 ]; then
    printf '  说明：服务活着但存储不可用。下一步：确认数据库地址/账号，口令用 LC_DB_PASSWORD 注入；查看 %s\n' "$LC_LOG"
  fi
fi

printf '\n配置摘要（口令已打码）\n'
printf '  配置文件：%s\n' "$LC_CFG"
printf '  监听：%s:%s\n' "$(lc_effective_host)" "$(lc_effective_port)"
driver=$(lc_effective_db_driver)
dburl=$(lc_effective_db_url)
printf '  数据库：%s' "$driver"
[ -n "$dburl" ] && printf ' %s' "$(lc_mask "$dburl")"
printf '\n'
cache_driver=$(lc_effective_cache_driver)
cache_url=$(lc_effective_cache_url)
printf '  缓存：%s' "$cache_driver"
[ -n "$cache_url" ] && printf ' %s' "$(lc_mask "$cache_url")"
printf '\n'
token_mode=$(lc_nested_value auth tokenMode)
[ -n "$token_mode" ] || token_mode=jwt
printf '  认证：tokenMode=%s\n' "$token_mode"
static_enabled=$(lc_nested_value static enabled)
[ -n "$static_enabled" ] || static_enabled=false
printf '  静态站：%s\n' "$static_enabled"
printf '  日志：%s\n' "$LC_LOG"
pid=$(lc_read_pid 2>/dev/null || true)
if [ -n "$pid" ] && lc_pid_alive "$pid"; then
  printf '  进程：运行中（pid %s）\n' "$pid"
else
  printf '  进程：未运行\n'
fi

rm -f "$body"
[ "$code" = 200 ] && exit 0
exit 1
