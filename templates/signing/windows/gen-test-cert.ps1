<#
.SYNOPSIS
  生成 Windows 自签代码签名测试证书（仅用于验证「打包 → 签名 → 安装」链路）。

.DESCRIPTION
  - 证书类型：CodeSigningCert，RSA 2048，SHA-256，有效期 3 年，可导出私钥
  - 存放在当前用户证书存储（Cert:\CurrentUser\My），不需要管理员权限
  - 导出 test-codesign.pfx（含私钥，带密码）与 test-codesign.cer（公钥，可分发）
  - 只打印主题、指纹、有效期；不打印密码
  - 自签证书不能解决 SmartScreen：任何没手动信任它的机器都视其为未知发布者

.PARAMETER Password
  PFX 导出密码（SecureString）。不传时依次尝试环境变量 LC_CERT_PASS、交互输入。
  注意：`powershell -File` 无法跨进程传 SecureString，用命令行参数只会得到字符串，
  所以非交互场景请用 LC_CERT_PASS；也不要把明文密码写进命令行。

.PARAMETER Subject
  证书主题，默认 CN=LC Desktop Test Signing（测试机上会显示这个名字）。

.PARAMETER OutDir
  输出目录，默认脚本所在目录。

.EXAMPLE
  # 在 PowerShell 里直接调用（同一进程内可以传 SecureString）
  $pw = Read-Host -AsSecureString "证书密码"
  .\gen-test-cert.ps1 -Password $pw

  # 非交互场景：用环境变量，不要用 -File 传 -Password
  $env:LC_CERT_PASS = '<密码>'; .\gen-test-cert.ps1
#>
[CmdletBinding()]
param(
  [string]$Subject = 'CN=LC Desktop Test Signing',
  [string]$OutDir = $PSScriptRoot,
  [System.Security.SecureString]$Password
)

# keytool 类工具会把中文进度写到 stderr；这里保持 Continue，靠显式检查判断成败，
# 避免本地化输出把正常流程当成终止错误。
$ErrorActionPreference = 'Continue'

function Write-Section([string]$Text) {
  Write-Host ''
  Write-Host "== $Text =="
}

if (-not $Password -or $Password.Length -eq 0) {
  if ($env:LC_CERT_PASS) {
    $Password = ConvertTo-SecureString -String $env:LC_CERT_PASS -AsPlainText -Force
  } else {
    $Password = Read-Host -AsSecureString 'PFX password (>= 8 chars; input is not echoed and never printed)'
  }
}
if ($Password.Length -eq 0) {
  throw 'PFX 密码不能为空。'
}

if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$pfx = Join-Path $OutDir 'test-codesign.pfx'
$cer = Join-Path $OutDir 'test-codesign.cer'

# 覆盖旧私钥等同于静默销毁一份可能还有用的材料，交给用户自己决定。
if ((Test-Path -LiteralPath $pfx) -or (Test-Path -LiteralPath $cer)) {
  throw "$pfx 或 $cer 已存在。确认旧文件是丢弃还是备份后，手动删除再重跑（脚本不替你覆盖私钥）。"
}

Write-Section 'create self-signed code signing certificate'
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -KeyExportPolicy Exportable `
  -HashAlgorithm sha256 `
  -NotAfter (Get-Date).AddYears(3)

if (-not $cert) {
  throw '证书创建失败：New-SelfSignedCertificate 没有返回证书对象。'
}

Write-Section 'export'
# Export-PfxCertificate 直接接收 SecureString，密码在内存里也是加密的，不经过命令行。
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $Password | Out-Null
Export-Certificate -Cert $cert -FilePath $cer -Type CERT | Out-Null

if (-not (Test-Path -LiteralPath $pfx)) { throw "PFX 导出失败：$pfx 不存在。" }
if (-not (Test-Path -LiteralPath $cer)) { throw "CER 导出失败：$cer 不存在。" }

$notBefore = $cert.NotBefore.ToString('yyyy-MM-dd')
$notAfter = $cert.NotAfter.ToString('yyyy-MM-dd')
# .cer 是 DER 编码的公钥证书，文件哈希即证书 DER 哈希，跨 PowerShell 版本都可用。
$sha256 = (Get-FileHash -LiteralPath $cer -Algorithm SHA256).Hash

Write-Section 'certificate'
Write-Host ("Subject      : " + $cert.Subject)
Write-Host ("Thumbprint   : " + $cert.Thumbprint)
Write-Host ("SHA256       : " + $sha256)
Write-Host ("Valid        : " + $notBefore + ' -> ' + $notAfter)
Write-Host ("PFX          : " + $pfx)
Write-Host ("CER          : " + $cer)

$readmePath = Join-Path $OutDir 'TEST-SIGNING-ONLY-README.txt'
$readme = @"
TEST SIGNING ONLY —— 自签代码签名证书，只用于验证「打包 -> 签名 -> 安装」链路。

生成时间 : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Subject  : $($cert.Subject)
Thumbprint: $($cert.Thumbprint)
SHA256   : $sha256
有效期   : $notBefore -> $notAfter

文件：
  test-codesign.pfx  含私钥，带密码。不提交仓库、不打进导出包、不写入日志。
  test-codesign.cer  公钥证书，可分发到测试机导入信任。
  TEST-SIGNING-ONLY-README.txt  本文件，不含密码。

在测试机上信任（两步都要做，少一步 signtool verify 仍会失败）：
  Import-Certificate -FilePath test-codesign.cer -CertStoreLocation Cert:\CurrentUser\Root
  Import-Certificate -FilePath test-codesign.cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher

签名（证书已在 CurrentUser\My 存储中，不需要密码）：
  signtool sign /fd sha256 /sha1 <Thumbprint> /tr http://timestamp.digicert.com /td sha256 app.msi

注意：自签证书不会改善 SmartScreen 信誉；在没导入信任的机器上仍显示未知发布者。
"@
# 写盘时用 UTF-8 BOM，避免 Windows PowerShell 5.1 / 记事本把中文读成乱码。
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($readmePath, $readme, $utf8Bom)

Write-Section 'next'
Write-Host '证书已留在 Cert:\CurrentUser\My 存储中；签名时按 Thumbprint 取用。'
Write-Host ('不需要时删除：Remove-Item Cert:\CurrentUser\My\' + $cert.Thumbprint)
Write-Host 'PFX、证书私钥不得提交仓库、不得进入导出包、不得出现在日志或报错里。'
