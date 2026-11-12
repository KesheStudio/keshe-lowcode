#!/usr/bin/env sh
# [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
#
# 导入用户自有证书：校验证书/私钥/域名/有效期/链，然后放到 certs/site.crt 与 certs/site.key。
# 产出：site.crt（叶子证书）、site.chain.crt（若提供中间 CA 链）、site.key（权限 600）。
#
# 用法：
#   sh deploy/scripts/import-cert.sh --cert /path/fullchain.pem --key /path/privkey.pem \
#        [--chain /path/chain.pem] [--domain example.com] [--out certs] [--force] \
#        [--allow-incomplete-chain]
#
# 红线：
#   - 不打印证书/私钥内容；只打印主题、有效期、SHA-256 指纹（公开信息）。
#   - 私钥权限强制 600；不提交仓库。
#   - 私钥必须可由 nginx 直接读取（未加密）。加密私钥请先自行解密到安全位置。
set -eu

CERT=""
KEY=""
CHAIN=""
DOMAIN=""
OUT=certs
FORCE=0
ALLOW_INCOMPLETE_CHAIN=0

usage() {
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
}

while [ $# -gt 0 ]; do
    case "$1" in
        --cert)  CERT=${2:-};  shift 2 ;;
        --key)   KEY=${2:-};   shift 2 ;;
        --chain) CHAIN=${2:-}; shift 2 ;;
        --domain) DOMAIN=${2:-}; shift 2 ;;
        --out)   OUT=${2:-};   shift 2 ;;
        --force) FORCE=1; shift ;;
        --allow-incomplete-chain) ALLOW_INCOMPLETE_CHAIN=1; shift ;;
        --help|-h) usage ;;
        *) echo "未知参数：$1" >&2; usage ;;
    esac
done

if [ -z "$CERT" ] || [ -z "$KEY" ]; then
    echo "错误：--cert 与 --key 必填" >&2
    exit 2
fi
for f in "$CERT" "$KEY" ${CHAIN:+"$CHAIN"}; do
    if [ ! -f "$f" ]; then
        echo "错误：文件不存在：$f" >&2
        exit 2
    fi
done

if ! command -v openssl >/dev/null 2>&1; then
    echo "错误：找不到 openssl。请先安装 OpenSSL 1.1.1+。" >&2
    exit 2
fi

# 收紧私钥权限：Unix 用 chmod 600；Windows/MSYS 的 chmod 不改 NTFS ACL，改用 icacls。
restrict_key() {
    chmod 600 "$1" 2>/dev/null || true
    if command -v icacls >/dev/null 2>&1; then
        icacls "$(cygpath -w "$1" 2>/dev/null || printf '%s' "$1")" \
            /inheritance:r /grant:r "${USERNAME:-$(whoami)}:(R,W,D)" >/dev/null 2>&1 || true
    fi
}

# 1) 证书可解析
if ! openssl x509 -in "$CERT" -noout >/dev/null 2>&1; then
    echo "错误：证书无法解析（需要 PEM 格式的 X.509 证书）。" >&2
    exit 1
fi

# 2) 私钥可解析且未加密（不向终端提示密码，避免交互卡住）
if ! openssl pkey -in "$KEY" -noout -passin pass: >/dev/null 2>&1; then
    echo "错误：私钥无法解析，或已加密。nginx 需要未加密私钥；请先解密到安全位置。" >&2
    exit 1
fi

# 3) 证书与私钥配对（只比较公钥摘要，不输出密钥内容）
CERT_PUB=$(openssl x509 -in "$CERT" -noout -pubkey | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')
KEY_PUB=$(openssl pkey -in "$KEY" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')
if [ "$CERT_PUB" != "$KEY_PUB" ]; then
    echo "错误：证书与私钥不配对（公钥摘要不一致）。" >&2
    exit 1
fi

# 4) 有效期至少 30 天（2592000 秒）
if ! openssl x509 -in "$CERT" -noout -checkend 2592000 >/dev/null 2>&1; then
    echo "错误：证书将在 30 天内过期或已过期，请续期后再导入。" >&2
    exit 1
fi

# 5) 域名匹配（可选，但强烈建议传 --domain）
if [ -n "$DOMAIN" ]; then
    if ! openssl x509 -in "$CERT" -noout -checkhost "$DOMAIN" >/dev/null 2>&1; then
        echo "错误：证书 SAN 不包含域名 $DOMAIN。" >&2
        exit 1
    fi
fi

# 6) 证书链可解析，并尽量验证完整性（依赖系统根证书库）
if [ -n "$CHAIN" ]; then
    if ! openssl crl2pkcs7 -nocrl -certfile "$CHAIN" 2>/dev/null | openssl pkcs7 -print_certs -noout >/dev/null 2>&1; then
        echo "错误：证书链无法解析（需要 PEM 格式的中间 CA 链）。" >&2
        exit 1
    fi
    if openssl verify -untrusted "$CHAIN" "$CERT" >/dev/null 2>&1; then
        echo "证书链校验：通过"
    else
        if [ "$ALLOW_INCOMPLETE_CHAIN" -eq 1 ]; then
            echo "警告：证书链校验未通过（可能是系统缺少根证书）；已按 --allow-incomplete-chain 继续。"
        else
            echo "错误：证书链校验未通过。请提供完整的中间 CA 链，或确认系统根证书库可用；" >&2
            echo "      确实无法校验时可加 --allow-incomplete-chain（风险自负）。" >&2
            exit 1
        fi
    fi
fi

CERT_OUT="$OUT/site.crt"
KEY_OUT="$OUT/site.key"
CHAIN_OUT="$OUT/site.chain.crt"
if [ -e "$CERT_OUT" ] || [ -e "$KEY_OUT" ] || [ -e "$CHAIN_OUT" ]; then
    if [ "$FORCE" -ne 1 ]; then
        echo "错误：$OUT 下已存在 site.crt / site.key / site.chain.crt。确认覆盖请加 --force。" >&2
        exit 1
    fi
fi

umask 077
mkdir -p "$OUT"
chmod 700 "$OUT" 2>/dev/null || true
cp "$CERT" "$CERT_OUT"
cp "$KEY" "$KEY_OUT"
if [ -n "$CHAIN" ]; then
    cp "$CHAIN" "$CHAIN_OUT"
elif [ -e "$CHAIN_OUT" ]; then
    rm -f "$CHAIN_OUT"
fi
restrict_key "$KEY_OUT"
chmod 644 "$CERT_OUT"
if [ -e "$CHAIN_OUT" ]; then
    chmod 644 "$CHAIN_OUT"
fi

SUBJECT=$(openssl x509 -in "$CERT_OUT" -noout -subject -nameopt RFC2253 | sed 's/^.*subject=/subject=/')
DATES=$(openssl x509 -in "$CERT_OUT" -noout -dates | tr '\n' ' ')
FINGERPRINT=$(openssl x509 -in "$CERT_OUT" -noout -fingerprint -sha256 | awk -F= '{print $2}')

echo "导入完成："
echo "  $SUBJECT"
echo "  $DATES"
echo "  SHA-256 指纹：$FINGERPRINT"
echo "  证书：$CERT_OUT（644）"
echo "  私钥：$KEY_OUT（仅当前用户可读；Unix 600 / Windows ACL）"
if [ -e "$CHAIN_OUT" ]; then
    echo "  中间链：$CHAIN_OUT（644）"
fi
echo ""
echo "提醒：certs/ 与 *.key 不应提交到仓库；导出 zip 中不包含私钥。"
