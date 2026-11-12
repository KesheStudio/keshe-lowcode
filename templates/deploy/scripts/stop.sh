#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · 停止后台实例
#
# 用法：sh deploy/scripts/stop.sh
# 幂等：未运行时返回 0；pid 文件指向已退出的进程时会清理遗留文件。
# 安全：只停止本脚本启动并记录在 logs/server.meta 的进程；PID 被复用时拒绝误杀。
#
# 退出码：0 已停止/本来就没运行；1 停止失败；2 环境异常。

set -eu
. "$(dirname -- "$0")/common.sh"

pid=$(lc_read_pid 2>/dev/null || true)
if [ -z "$pid" ]; then
  rm -f "$LC_META"
  printf '未发现 pid 文件（%s），服务应该没有在后台运行。\n' "$LC_PID"
  printf '如果端口仍被占用，请用系统进程工具确认进程来源后再处理；本脚本不会杀未知进程。\n'
  exit 0
fi

if ! lc_pid_alive "$pid"; then
  rm -f "$LC_PID" "$LC_META"
  printf '清理遗留 pid：进程 %s 已不存在（可能异常退出）。\n' "$pid"
  printf '日志保留在 %s，可查看退出原因。\n' "$LC_LOG"
  exit 0
fi

if ! lc_process_matches "$pid"; then
  lc_die "pid $pid 不属于本次部署启动的进程（可能被系统复用）。为避免误杀，已停止清理；请人工确认后处理。"
fi

printf '正在停止 pid %s ...\n' "$pid"
if ! kill "$pid" 2>/dev/null; then
  lc_die "发送停止信号失败（权限不足？）。请用系统进程工具确认 pid $pid 后手工处理。"
fi

i=0
while [ "$i" -lt 10 ]; do
  lc_pid_alive "$pid" || break
  sleep 1
  i=$((i + 1))
done
if lc_pid_alive "$pid"; then
  printf '进程未在 10 秒内退出，发送强制停止。\n'
  kill -9 "$pid" 2>/dev/null || true
  sleep 1
fi

if lc_pid_alive "$pid"; then
  lc_die "停止失败：pid $pid 仍在运行。请用系统进程工具确认后手工处理。"
fi

rm -f "$LC_PID" "$LC_META"
printf '已停止。日志保留在 %s（下次启动会继续追加）。\n' "$LC_LOG"
