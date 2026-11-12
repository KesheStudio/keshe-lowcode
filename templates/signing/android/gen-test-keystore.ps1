<#
生成 Android 测试用 keystore（仅本地/内测，不要用于上架）。

用法（密码只走环境变量或交互输入，不经过命令行）：
  交互：.\gen-test-keystore.ps1
  非交互：$env:LC_KEYSTORE_PASS = '<密码>'; .\gen-test-keystore.ps1

可选：
  -OutDir <目录>            默认 $HOME\.lc-signing
  -Alias <别名>             默认 upload
  -ValidityDays <天数>      默认 3650
  -Force                    覆盖已存在的文件

产物：
  TEST-SIGNING-ONLY-upload-keystore.p12     keystore（含私钥）
  TEST-SIGNING-ONLY-README.txt              别名、有效期、指纹（不含密码）

注意：脚本把密码放进当前进程的环境变量，keytool 用 -storepass:env 读取，
密码不出现在命令行、进程列表和日志里。
#>

[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path $HOME '.lc-signing'),
  [string]$Alias = 'upload',
  [int]$ValidityDays = 3650,
  [string]$DName = 'CN=Lowcode Test Only, OU=TEST-SIGNING-ONLY, O=Lowcode, C=CN',
  [switch]$Force
)

# 密码只从环境变量或交互输入取：命令行参数会留在 shell 历史、进程列表和 CI 日志里。
$plainPassword = $null
$createdEnv = $false
if ($env:LC_KEYSTORE_PASS) {
  $plainPassword = $env:LC_KEYSTORE_PASS
} else {
  $secure = Read-Host -AsSecureString '测试 keystore 密码（>= 8 位，不含空格与双引号）'
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $env:LC_KEYSTORE_PASS = $plainPassword
  $createdEnv = $true
}

# keytool 的中文进度写在 stderr，PS 5.1 在 Stop 模式下会把它当终止错误，
# 所以这里用 Continue，靠 $LASTEXITCODE 判断成败；自己的校验仍然用 throw。
$ErrorActionPreference = 'Continue'

function Find-Keytool {
  $candidates = @()
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
  $candidates += @(
    'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe',
    'C:\Program Files\Java\jdk-21\bin\keytool.exe',
    'C:\Program Files\Java\jdk-17\bin\keytool.exe'
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  throw '找不到 keytool。装 JDK 或 Android Studio，并把 keytool 加进 PATH（或设置 JAVA_HOME）后重试。'
}

if (-not $plainPassword) {
  throw '没有拿到 keystore 密码：设置 LC_KEYSTORE_PASS 环境变量，或在交互提示里输入。'
}
if ($plainPassword.Length -lt 8) {
  throw '密码至少 8 位。测试 keystore 也别用 123456，它会演变成正式密钥。'
}
if ($plainPassword -match '[\s"]') {
  throw '密码里不要有空格或双引号：keystore.properties 与 gradle 解析都会出问题。'
}

$keytool = Find-Keytool
Write-Host "使用 keytool：$keytool"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$storeFile = Join-Path $OutDir 'TEST-SIGNING-ONLY-upload-keystore.p12'
$readmeFile = Join-Path $OutDir 'TEST-SIGNING-ONLY-README.txt'

if ((Test-Path $storeFile) -and -not $Force) {
  throw "已存在 $storeFile；确认要覆盖请加 -Force（覆盖后旧密钥不可恢复）。"
}

# 密码只放进当前进程的环境变量，keytool 用 :env 读取，不进命令行。
try {
  & $keytool -genkeypair -v `
    -keystore $storeFile `
    -storetype PKCS12 `
    -keyalg RSA -keysize 2048 `
    -sigalg SHA256withRSA `
    -validity $ValidityDays `
    -alias $Alias `
    -dname $DName `
    -storepass:env LC_KEYSTORE_PASS 2>&1 | Out-Null

  if ($LASTEXITCODE -ne 0) { throw 'keytool 生成失败，检查上面输出里的错误。' }

  # 只解析 ASCII 字段，不解析本地化文案（不同 JDK 的语言输出不一样）。
  $listing = (& $keytool -list -v -keystore $storeFile -alias $Alias -storepass:env LC_KEYSTORE_PASS 2>&1) -join "`n"
  $fingerprint = ([regex]::Match($listing, 'SHA256:\s*([0-9A-F:]{95})')).Groups[1].Value
  $validLine = ([regex]::Match($listing, 'Valid from:.*?(?=\n)')).Value
  if (-not $fingerprint) { throw '没能从 keytool 输出里解析出 SHA-256 指纹。' }

  $readme = @(
    'TEST SIGNING ONLY —— 仅用于本地安装与内测，不要用于应用商店上架。',
    '',
    "生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "keystore：$storeFile",
    "别名（alias）：$Alias",
    "有效期：$ValidityDays 天",
    "SHA-256 指纹：$fingerprint",
    $(if ($validLine) { $validLine } else { '' }),
    '',
    '密码不在本文件里。请把密码单独存进密码管理器，并把这个 .p12 和密码一起备份。',
    '换一台机器继续发版时必须用同一个 keystore + 同一个别名：换密钥等于换身份，老用户无法覆盖安装。'
  ) -join "`r`n"
  Set-Content -Path $readmeFile -Value $readme -Encoding UTF8

  Write-Host ''
  Write-Host "已生成：$storeFile"
  Write-Host "别名：$Alias    有效期：$ValidityDays 天"
  Write-Host "SHA-256：$fingerprint"
  Write-Host "说明文件：$readmeFile（不含密码）"
  Write-Host '提醒：这是测试签名。文件名带 TEST-SIGNING-ONLY，别误发。'
} finally {
  # 只清理本脚本自己设的变量；用户自己导出的 LC_KEYSTORE_PASS 不动。
  if ($createdEnv) { Remove-Item Env:\LC_KEYSTORE_PASS -ErrorAction SilentlyContinue }
}
