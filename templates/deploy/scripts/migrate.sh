#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · 建表与升级
#
# 用法：sh deploy/scripts/migrate.sh
# 幂等：已应用的版本会跳过；重复执行输出「无待执行迁移」并退出 0。
# 退出码：0 成功；1 迁移失败；2 环境/配置不满足。

set -eu
. "$(dirname -- "$0")/common.sh"

lc_require_server
lc_ensure_config
lang=$(lc_lang)

case "$lang" in
  node)
    lc_require node
    cmd="node src/main.js --migrate"
    ;;
  rust)
    binary=$(lc_binary)
    [ -x "$binary" ] || lc_blocked "尚未编译：请先运行 sh deploy/scripts/install.sh"
    cmd="\"$binary\" --migrate"
    ;;
  go)
    binary=$(lc_binary)
    [ -x "$binary" ] || lc_blocked "尚未编译：请先运行 sh deploy/scripts/install.sh"
    cmd="\"$binary\" --migrate"
    ;;
  *)
    lc_blocked "无法识别后端语言：$lang"
    ;;
esac

printf '\n[1/1] migrate · %s\n' "$lang"
if ! ( cd "$LC_SERVER" && eval "$cmd" ); then
  lc_die "迁移失败（$lang）。下一步：确认数据库地址与账号权限；数据库口令用 LC_DB_PASSWORD 注入。若提示表已存在或版本已应用，可忽略并重跑本脚本。"
fi
printf '迁移完成（重复执行安全）。\n'
printf '下一步：sh deploy/scripts/start-bg.sh\n'
