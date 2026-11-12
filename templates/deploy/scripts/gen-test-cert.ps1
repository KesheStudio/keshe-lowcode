# [LC-GENERATED] Platform-generated area: regenerating replaces this file.
#
# Generate a self-signed TEST certificate (local / intranet only).
# Output: <OutDir>\site.crt (self-signed chain, 1 cert), <OutDir>\site.key (private key, restricted ACL).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\gen-test-cert.ps1
#   powershell ... -File ... -Domain example.com -Days 365 -OutDir certs -Force
#
# Red lines:
#   - never prints private key material; only subject / validity / SHA-256 fingerprint (public).
#   - restricts site.key ACL to the current user.
#   - do NOT commit certs/ or *.key; production must use import-cert.ps1.
param(
    [string]$Domain = "localhost",
    [ValidateRange(1, 3650)]
    [int]$Days = 365,
    [string]$OutDir = "certs",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
    Write-Error "openssl not found. Install OpenSSL 1.1.1+ and add it to PATH (Git for Windows ships one)."
    exit 2
}
if ([string]::IsNullOrWhiteSpace($Domain) -or [string]::IsNullOrWhiteSpace($OutDir)) {
    Write-Error "Domain and OutDir must not be empty."
    exit 2
}

$certPath = Join-Path $OutDir "site.crt"
$keyPath = Join-Path $OutDir "site.key"
if ((Test-Path $certPath) -or (Test-Path $keyPath)) {
    if (-not $Force) {
        Write-Error "$certPath or $keyPath already exists. Re-run with -Force to overwrite."
        exit 1
    }
}

# IP-like domain goes into the SAN IP field; otherwise DNS field.
if ($Domain -match '^[0-9.]+$') {
    $san = "IP:$Domain,DNS:localhost,IP:127.0.0.1"
} else {
    $san = "DNS:$Domain,DNS:localhost,IP:127.0.0.1"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Generating self-signed test certificate: domain=$Domain days=$Days out=$OutDir"
$opensslArgs = @(
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "$Days", "-nodes",
    "-keyout", $keyPath, "-out", $certPath,
    "-subj", "/CN=$Domain",
    "-addext", "subjectAltName=$san",
    "-addext", "keyUsage=critical,digitalSignature,keyEncipherment",
    "-addext", "extendedKeyUsage=serverAuth",
    "-addext", "basicConstraints=critical,CA:FALSE"
)
& $openssl @opensslArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "openssl failed to create the certificate."
    exit 1
}

# Restrict the private key: remove inheritance, grant only current user read/write/delete.
# D (delete) is required so keys can be rotated or removed; without it unlink fails with EPERM.
& icacls.exe $keyPath /inheritance:r /grant:r "$($env:USERNAME):(R,W,D)" | Out-Null

$subject = ((& $openssl x509 -in $certPath -noout -subject -nameopt RFC2253) -join " ").Trim()
$dates = ((& $openssl x509 -in $certPath -noout -dates) -join " ").Trim()
$fingerprint = (((& $openssl x509 -in $certPath -noout -fingerprint -sha256) -join " ") -split "=")[-1].Trim()

# Compare public keys via DER digest. Do not pipe PEM text into openssl (CRLF breaks parsing);
# write temporary files instead, then delete them.
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lc-cert-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
    $pubPemPath = Join-Path $tmpDir "cert-pub.pem"
    $certDerPath = Join-Path $tmpDir "cert-pub.der"
    $keyDerPath = Join-Path $tmpDir "key-pub.der"
    Set-Content -Path $pubPemPath -Value ((& $openssl x509 -in $certPath -noout -pubkey) -join "`n") -Encoding Ascii
    & $openssl pkey -pubin -in $pubPemPath -outform DER -out $certDerPath 2>$null
    & $openssl pkey -in $keyPath -pubout -outform DER -out $keyDerPath 2>$null
    $certPub = (((& $openssl dgst -sha256 $certDerPath) -join " ") -split "=")[-1].Trim()
    $keyPub = (((& $openssl dgst -sha256 $keyDerPath) -join " ") -split "=")[-1].Trim()
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
$match = if ($certPub -eq $keyPub) { "yes" } else { "no" }

Write-Host "Done:"
Write-Host "  $subject"
Write-Host "  $dates"
Write-Host "  SHA-256 fingerprint: $fingerprint"
Write-Host "  certificate matches private key: $match"
Write-Host "  certificate: $certPath"
Write-Host "  private key: $keyPath (ACL restricted to current user)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Add to the site-root .gitignore:"
Write-Host "       certs/"
Write-Host "       *.key"
Write-Host "  2. Trust this self-signed certificate manually (test environments only)."
Write-Host "  3. Start nginx with prefix = site root:"
Write-Host "       nginx -p `"<site-root>`" -c `"<site-root>\deploy\nginx\nginx.conf`""
Write-Host "  4. Production: use import-cert.ps1 with a CA-issued certificate."
