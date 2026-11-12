# [LC-GENERATED] Platform-generated area: regenerating replaces this file.
#
# Import a user-provided certificate: validate cert/key/domain/expiry/chain, then copy into
# <OutDir>\site.crt, <OutDir>\site.key, and optional <OutDir>\site.chain.crt.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\import-cert.ps1 `
#       -Cert C:\path\fullchain.pem -Key C:\path\privkey.pem `
#       [-Chain C:\path\chain.pem] [-Domain example.com] [-OutDir certs] [-Force] `
#       [-AllowIncompleteChain]
#
# Red lines:
#   - never prints certificate/key material; only subject / validity / SHA-256 fingerprint.
#   - restricts site.key ACL to the current user.
#   - private key must be unencrypted so nginx can read it unattended.
param(
    [Parameter(Mandatory = $true)][string]$Cert,
    [Parameter(Mandatory = $true)][string]$Key,
    [string]$Chain = "",
    [string]$Domain = "",
    [string]$OutDir = "certs",
    [switch]$Force,
    [switch]$AllowIncompleteChain
)

$ErrorActionPreference = "Stop"

$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
    Write-Error "openssl not found. Install OpenSSL 1.1.1+ and add it to PATH."
    exit 2
}
foreach ($file in @($Cert, $Key, $Chain)) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    if (-not (Test-Path -Path $file -PathType Leaf)) {
        Write-Error "File not found: $file"
        exit 2
    }
}

# 1) certificate parses
& $openssl x509 -in $Cert -noout 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Certificate cannot be parsed (expected PEM X.509)."
    exit 1
}

# 2) private key parses and is not encrypted (avoid interactive password prompts)
& $openssl pkey -in $Key -noout -passin "pass:" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Private key cannot be parsed or is encrypted. nginx needs an unencrypted key."
    exit 1
}

# 3) certificate and key match (compare public key DER digests only)
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lc-cert-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
    $pubPemPath = Join-Path $tmpDir "cert-pub.pem"
    $certDerPath = Join-Path $tmpDir "cert-pub.der"
    $keyDerPath = Join-Path $tmpDir "key-pub.der"
    Set-Content -Path $pubPemPath -Value ((& $openssl x509 -in $Cert -noout -pubkey) -join "`n") -Encoding Ascii
    & $openssl pkey -pubin -in $pubPemPath -outform DER -out $certDerPath 2>$null
    & $openssl pkey -in $Key -pubout -outform DER -out $keyDerPath 2>$null
    $certPub = (((& $openssl dgst -sha256 $certDerPath) -join " ") -split "=")[-1].Trim()
    $keyPub = (((& $openssl dgst -sha256 $keyDerPath) -join " ") -split "=")[-1].Trim()
} finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
if ($certPub -ne $keyPub) {
    Write-Error "Certificate and private key do not match."
    exit 1
}

# 4) at least 30 days of validity
& $openssl x509 -in $Cert -noout -checkend 2592000 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Certificate is expired or expires within 30 days."
    exit 1
}

# 5) hostname match (optional, strongly recommended)
if (-not [string]::IsNullOrWhiteSpace($Domain)) {
    & $openssl x509 -in $Cert -noout -checkhost $Domain 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Certificate SAN does not include domain: $Domain"
        exit 1
    }
}

# 6) chain parses and best-effort verification against the system trust store
if (-not [string]::IsNullOrWhiteSpace($Chain)) {
    & $openssl crl2pkcs7 -nocrl -certfile $Chain 2>$null | & $openssl pkcs7 -print_certs -noout 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Chain cannot be parsed (expected PEM intermediate CA chain)."
        exit 1
    }
    & $openssl verify -untrusted $Chain $Cert 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        if ($AllowIncompleteChain) {
            Write-Host "Warning: chain verification failed (system roots may be missing); continuing due to -AllowIncompleteChain."
        } else {
            Write-Error "Chain verification failed. Provide the full intermediate chain, or pass -AllowIncompleteChain (at your own risk)."
            exit 1
        }
    } else {
        Write-Host "Chain verification: passed"
    }
}

$certOut = Join-Path $OutDir "site.crt"
$keyOut = Join-Path $OutDir "site.key"
$chainOut = Join-Path $OutDir "site.chain.crt"
if ((Test-Path $certOut) -or (Test-Path $keyOut) -or (Test-Path $chainOut)) {
    if (-not $Force) {
        Write-Error "$OutDir already contains site.crt / site.key / site.chain.crt. Re-run with -Force to overwrite."
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -Force $Cert $certOut
Copy-Item -Force $Key $keyOut
if (-not [string]::IsNullOrWhiteSpace($Chain)) {
    Copy-Item -Force $Chain $chainOut
} elseif (Test-Path $chainOut) {
    Remove-Item -Force $chainOut
}
& icacls.exe $keyOut /inheritance:r /grant:r "$($env:USERNAME):(R,W,D)" | Out-Null

$subject = ((& $openssl x509 -in $certOut -noout -subject -nameopt RFC2253) -join " ").Trim()
$dates = ((& $openssl x509 -in $certOut -noout -dates) -join " ").Trim()
$fingerprint = (((& $openssl x509 -in $certOut -noout -fingerprint -sha256) -join " ") -split "=")[-1].Trim()

Write-Host "Import completed:"
Write-Host "  $subject"
Write-Host "  $dates"
Write-Host "  SHA-256 fingerprint: $fingerprint"
Write-Host "  certificate: $certOut"
Write-Host "  private key: $keyOut (ACL restricted to current user)"
if (Test-Path $chainOut) {
    Write-Host "  intermediate chain: $chainOut"
}
Write-Host ""
Write-Host "Reminder: never commit certs/ or *.key; exported zip must not contain the private key."
