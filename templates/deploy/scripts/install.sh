#!/bin/sh
# [LC-DEPLOY] 导出包一键部署 · 安装依赖并编译
#
# 用法：sh deploy/scripts/install.sh
# 幂等：重复执行不会报错；Rust/Go 走增量构建，Node 重新跑 npm ci。
# 退出码：0 成功；1 安装失败；2 环境/配置不满足。

set -eu
. "$(dirname -- "$0")/common.sh"

lc_require_server
lc_require_tools
lc_ensure_config

lang=$(lc_lang)
started=$(date +%s)
printf '\n[1/1] install · %s\n' "$lang"

case "$lang" in
  node)
    if ! ( cd "$LC_SERVER" && npm ci --omit=dev ); then
      lc_die "安装失败：npm ci 未通过。下一步：确认 Node ≥ 22.5、网络或 npm 源可用；也可在 server/ 里执行 npm install --omit=dev 后重跑本脚本。"
    fi
    ;;
  rust)
    if [ "$(lc_profile)" = release ]; then
      if ! ( cd "$LC_SERVER" && cargo build --release ); then
        lc_die "安装失败：cargo build --release 未通过。下一步：确认 Rust ≥ 1.80、crates 可访问；先在 server/ 里单独运行 cargo build 查看完整错误。"
      fi
    else
      if ! ( cd "$LC_SERVER" && cargo build ); then
        lc_die "安装失败：cargo build 未通过。下一步：确认 Rust ≥ 1.80、crates 可访问；先在 server/ 里单独运行 cargo build 查看完整错误。"
      fi
    fi
    [ -x "$(lc_binary)" ] || lc_die "安装失败：没有找到编译产物 $(lc_binary)。请检查 cargo 输出。"
    ;;
  go)
    if ! ( cd "$LC_SERVER" && go build -o "lowcode-server$(lc_exe_suffix)" . ); then
      lc_die "安装失败：go build 未通过。下一步：确认 Go ≥ 1.22 与 GOFLAGS/GOPROXY 可用；先在 server/ 里执行 go build ./... 查看完整错误。"
    fi
    [ -x "$(lc_binary)" ] || lc_die "安装失败：没有找到编译产物 $(lc_binary)。请检查 go build 输出。"
    ;;
  *)
    lc_blocked "无法识别后端语言：$lang"
    ;;
esac

finished=$(date +%s)
printf '安装完成（%s，耗时 %ss）\n' "$lang" "$((finished - started))"
printf '下一步：sh deploy/scripts/migrate.sh\n'
