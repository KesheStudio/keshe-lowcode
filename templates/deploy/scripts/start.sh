#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · 前台启动
#
# 用法：sh deploy/scripts/start.sh
# 前台运行，日志直接输出到当前终端；按 Ctrl+C 停止。
# 后台运行请用 start-bg.sh（pid 文件 + 日志 + 自动探活/冒烟）。
#
# 退出码：0 正常退出；1 启动失败；2 环境/配置不满足。

set -eu
. "$(dirname -- "$0")/common.sh"

lc_require_server
lc_ensure_config
lang=$(lc_lang)

pid=$(lc_read_pid 2>/dev/null || true)
if [ -n "$pid" ] && lc_pid_alive "$pid"; then
  lc_die "后台进程已在运行（pid $pid）。先执行 sh deploy/scripts/stop.sh，或直接用 health.sh 查看状态。"
fi

case "$lang" in
  node)
    lc_require node
    ;;
  rust|go)
    binary=$(lc_binary)
    [ -x "$binary" ] || lc_blocked "尚未编译：请先运行 sh deploy/scripts/install.sh"
    ;;
  *)
    lc_blocked "无法识别后端语言：$lang"
    ;;
esac

lc_banner '前台启动'
lc_print_summary
printf '\n按 Ctrl+C 停止。\n\n'

cd "$LC_SERVER"
case "$lang" in
  node) exec node src/main.js "$@" ;;
  rust|go) exec "$(lc_binary)" "$@" ;;
esac
