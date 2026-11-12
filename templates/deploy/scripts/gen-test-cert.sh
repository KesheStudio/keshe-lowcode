#!/usr/bin/env sh
# [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
#
# 生成自签测试证书（仅用于本地/内网测试，浏览器会提示不受信任）。
# 产出：certs/site.crt（自签证书链，1 张）、certs/site.key（私钥，权限 600）。
#
# 用法：
#   sh deploy/scripts/gen-test-cert.sh [--domain example.com] [--days 365]
#                                      [--out certs] [--force]
#
# 红线：
#   - 本脚本从不打印私钥内容；只打印主题、有效期、SHA-256 指纹（都是公开信息）。
#   - site.key 权限强制收紧为 600；不要把 certs/ 提交到仓库。
#   - 生产环境请用 import-cert.sh 导入正规证书，不要用自签证书对外服务。
set -eu

DOMAIN=localhost
DAYS=365
OUT=certs
FORCE=0

usage() {
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN=${2:-}; shift 2 ;;
        --days)   DAYS=${2:-};   shift 2 ;;
        --out)    OUT=${2:-};    shift 2 ;;
        --force)  FORCE=1; shift ;;
        --help|-h) usage ;;
        *) echo "未知参数：$1" >&2; usage ;;
    esac
done

if [ -z "$DOMAIN" ] || [ -z "$OUT" ]; then
    echo "错误：--domain / --out 不能为空" >&2
    exit 2
fi
case "$DAYS" in
    ''|*[!0-9]*) echo "错误：--days 必须是正整数" >&2; exit 2 ;;
esac
if [ "$DAYS" -lt 1 ]; then
    echo "错误：--days 至少为 1" >&2
    exit 2
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "错误：找不到 openssl。请先安装 OpenSSL 1.1.1+（Windows 可用 Git Bash 自带的 openssl）。" >&2
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

CERT="$OUT/site.crt"
KEY="$OUT/site.key"
if [ -e "$CERT" ] || [ -e "$KEY" ]; then
    if [ "$FORCE" -ne 1 ]; then
        echo "错误：$CERT 或 $KEY 已存在。确认要覆盖请加 --force。" >&2
        exit 1
    fi
fi

# IP 形式的域名放进 SAN 的 IP 字段，DNS 字段只放域名。
case "$DOMAIN" in
    *[!0-9.]*|'') SAN="DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1" ;;
    *)           SAN="IP:$DOMAIN,DNS:localhost,IP:127.0.0.1" ;;
esac

umask 077
mkdir -p "$OUT"
chmod 700 "$OUT" 2>/dev/null || true

echo "生成自签测试证书：domain=$DOMAIN days=$DAYS out=$OUT"
# -nodes：私钥不加密，nginx 可无人值守启动；因此权限必须 600，且只放在本机。
# -addext 需要 OpenSSL 1.1.1+；老版本请改用临时 openssl.cnf 的 [v3_req]。
# Git Bash/MSYS 会把 /CN=... 当成本地路径改写；显式关闭参数路径转换。
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
    -keyout "$KEY" -out "$CERT" \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=$SAN" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth" \
    -addext "basicConstraints=critical,CA:FALSE" >/dev/null 2>&1

restrict_key "$KEY"
chmod 644 "$CERT"

SUBJECT=$(openssl x509 -in "$CERT" -noout -subject -nameopt RFC2253 | sed 's/^.*subject=/subject=/')
DATES=$(openssl x509 -in "$CERT" -noout -dates | tr '\n' ' ')
FINGERPRINT=$(openssl x509 -in "$CERT" -noout -fingerprint -sha256 | awk -F= '{print $2}')

CERT_PUB=$(openssl x509 -in "$CERT" -noout -pubkey | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')
KEY_PUB=$(openssl pkey -in "$KEY" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')
if [ "$CERT_PUB" = "$KEY_PUB" ]; then
    MATCH=yes
else
    MATCH=no
fi

echo "完成："
echo "  $SUBJECT"
echo "  $DATES"
echo "  SHA-256 指纹：$FINGERPRINT"
echo "  证书与私钥匹配：$MATCH"
echo "  证书：$CERT（644）"
echo "  私钥：$KEY（仅当前用户可读；Unix 600 / Windows ACL）"
echo ""
echo "下一步："
echo "  1. 把 certs/ 和 *.key 加入站点根 .gitignore："
echo "       certs/"
echo "       *.key"
echo "  2. 浏览器/系统需要手动信任这张自签证书（仅测试环境）。"
echo "  3. 启动 nginx：nginx -p \"\$(pwd)\" -c \"\$(pwd)/deploy/nginx/nginx.conf\""
echo "  4. 生产环境请改用 import-cert.sh 导入正规证书。"
