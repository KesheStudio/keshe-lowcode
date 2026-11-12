#!/usr/bin/env bash
# 生成 Android 测试用 keystore（Linux）。与 gen-test-keystore.ps1 等价。
# 用法：./gen-test-keystore.sh [outDir] [alias] [validityDays]
# 密码：优先读 LC_KEYSTORE_PASS 环境变量；没有则交互提示（不回显）。
# 不要把密码写在命令行里，也不要写成 `LC_KEYSTORE_PASS='...' ./脚本`——整行都会进 shell 历史。
set -euo pipefail

OUT_DIR="${1:-$HOME/.lc-signing}"
ALIAS="${2:-upload}"
DAYS="${3:-3650}"

if [ -z "${LC_KEYSTORE_PASS:-}" ]; then
  if [ ! -t 0 ]; then
    echo "缺少 LC_KEYSTORE_PASS 环境变量，且当前不是交互终端。CI 里请用 secret 注入该变量。" >&2
    exit 1
  fi
  printf '测试 keystore 密码（>= 8 位，不含空格与双引号）: ' >&2
  read -r -s LC_KEYSTORE_PASS
  printf '\n' >&2
  export LC_KEYSTORE_PASS
fi

if [ "${#LC_KEYSTORE_PASS}" -lt 8 ]; then
  echo "密码至少 8 位。测试 keystore 也别用 123456，它会演变成正式密钥。" >&2
  exit 1
fi

KEYTOOL="$(command -v keytool || true)"
if [ -z "$KEYTOOL" ] && [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  KEYTOOL="$JAVA_HOME/bin/keytool"
fi
if [ -z "$KEYTOOL" ] && [ -x /usr/libexec/java_home ]; then
  KEYTOOL="$(/usr/libexec/java_home 2>/dev/null)/bin/keytool"
fi
if [ -z "$KEYTOOL" ] || [ ! -x "$KEYTOOL" ]; then
  echo "找不到 keytool：装 JDK（或设置 JAVA_HOME）后重试。" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STORE="$OUT_DIR/TEST-SIGNING-ONLY-$ALIAS-keystore.p12"
if [ -f "$STORE" ]; then
  echo "已存在 $STORE，确认覆盖请先手动删除。" >&2
  exit 1
fi

"$KEYTOOL" -genkeypair -v \
  -keystore "$STORE" \
  -storetype PKCS12 \
  -keyalg RSA -keysize 2048 -sigalg SHA256withRSA \
  -validity "$DAYS" \
  -alias "$ALIAS" \
  -dname "CN=Lowcode Test Only, OU=TEST-SIGNING-ONLY, O=Lowcode, C=CN" \
  -storepass:env LC_KEYSTORE_PASS >/dev/null

FINGERPRINT=$("$KEYTOOL" -list -v -keystore "$STORE" -alias "$ALIAS" -storepass:env LC_KEYSTORE_PASS \
  | tr -d '\r' | grep -o 'SHA256:.*' | head -n1 | cut -d' ' -f2-)

cat > "$OUT_DIR/TEST-SIGNING-ONLY-README.txt" <<EOF
TEST SIGNING ONLY —— 仅用于本地安装与内测，不要用于应用商店上架。

keystore：$STORE
别名（alias）：$ALIAS
有效期：$DAYS 天
SHA-256 指纹：$FINGERPRINT

密码不在本文件里，单独存进密码管理器并备份。
EOF

echo "已生成：$STORE"
echo "SHA-256：$FINGERPRINT"
