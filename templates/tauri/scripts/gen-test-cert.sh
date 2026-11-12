#!/usr/bin/env bash
# 生成自签测试证书（Linux 构建机）。与 scripts/gen-test-cert.mjs 做同一件事，
# 供没有 Node 的构建机使用；参数保持一致：gen-test-cert.sh [outDir] [host] [days]
set -euo pipefail

OUT_DIR="${1:-certs}"
HOST="${2:-localhost}"
DAYS="${3:-365}"

cd "$(dirname "$0")/.."
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/site.crt" ] || [ -f "$OUT_DIR/site.key" ]; then
  echo "已存在 $OUT_DIR/site.crt 或 key；确认覆盖请先手动删除。" >&2
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
  -keyout "$OUT_DIR/site.key" -out "$OUT_DIR/site.crt" \
  -subj "/CN=$HOST/O=Lowcode Test Only" \
  -addext "subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1,IP:::1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 600 "$OUT_DIR/site.key"

openssl x509 -in "$OUT_DIR/site.crt" -noout -subject -dates -fingerprint -sha256 \
  | tee "$OUT_DIR/cert-info.txt"

echo "TEST-ONLY" > "$OUT_DIR/TEST-ONLY.txt"
echo "自签测试证书已生成：$OUT_DIR/site.crt（私钥不进导出包）"
