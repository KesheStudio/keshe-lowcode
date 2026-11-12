# [LC-DEPLOY] 导出包一键部署 · 探活 + 关键配置摘要（Windows PowerShell）
#
# 用法：powershell -ExecutionPolicy Bypass -File deploy\scripts\health.ps1 [-Wait 秒数] [-Json]
#   -Wait   最多等待多少秒（每秒重试），默认 0（只探一次）
#   -Json   只输出 /api/health 的原始 JSON，便于 CI 解析
# 输出中的连接串口令会打码成 ***；不会打印任何密钥。
#
# 退出码：0 健康；1 不健康/连不上；2 环境不满足。

param(
    [int]$Wait = 0,
    [switch]$Json
)

. "$PSScriptRoot\common.ps1"

New-Item -ItemType Directory -Force -Path $LC.Logs | Out-Null
$body = Join-Path $LC.Logs '.health-body'
$url = LC-HealthUrl

$code = '000'
$i = 0
while ($true) {
    $code = LC-HttpCode $url $body 5
    if ($code -eq '200') { break }
    if ($i -ge $Wait) { break }
    Start-Sleep -Seconds 1
    $i++
}

if ($Json) {
    if (Test-Path $body) { Get-Content -LiteralPath $body -Raw }
    Remove-Item -Force $body -ErrorAction SilentlyContinue
    if ($code -eq '200') { exit 0 }
    exit 1
}

Write-Host 'LC health'
Write-Host "  URL：$url"
Write-Host "  HTTP：$code"

if ($code -eq '000') {
    Write-Host '  状态：连不上（进程可能未启动）'
    Write-Host "  下一步：先运行 start-bg.ps1；再看 $($LC.LogFile)"
    Remove-Item -Force $body -ErrorAction SilentlyContinue
    exit 1
}

$text = if (Test-Path $body) { Get-Content -LiteralPath $body -Raw } else { '' }
function LCJStr([string]$Key) {
    $m = [regex]::Match($text, '"' + [regex]::Escape($Key) + '"\s*:\s*"([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}
function LCJRaw([string]$Key) {
    $m = [regex]::Match($text, '"' + [regex]::Escape($Key) + '"\s*:\s*([^,}]*)')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return ''
}

if ($code -eq '200') {
    $status = LCJStr 'status'
    $language = LCJStr 'language'
    $maturity = LCJStr 'maturity'
    $version = LCJStr 'version'
    $uptime = LCJRaw 'uptimeSeconds'
    $database = LCJStr 'database'
    $cache = LCJStr 'cache'
    $fallback = LCJRaw 'cacheFallback'
    $static = LCJRaw 'static'
    Write-Host "  状态：ok（language=$language maturity=$maturity version=$version uptime=${uptime}s）"
    Write-Host "  存储：database=$database cache=$cache cacheFallback=$fallback static=$static"
} else {
    $errCode = LCJStr 'code'
    $errMsg = LCJStr 'message'
    Write-Host "  状态：不健康（error=$errCode $errMsg）"
    if ($code -eq '503') {
        Write-Host "  说明：服务活着但存储不可用。下一步：确认数据库地址/账号，口令用 LC_DB_PASSWORD 注入；查看 $($LC.LogFile)"
    }
}

Write-Host ''
Write-Host '配置摘要（口令已打码）'
Write-Host "  配置文件：$($LC.Config)"
Write-Host "  监听：$(LC-EffectiveHost):$(LC-EffectivePort)"
$driver = LC-EffectiveDbDriver
$dbUrl = LC-Mask (LC-EffectiveDbUrl)
Write-Host ("  数据库：{0}{1}" -f $driver, $(if ($dbUrl) { " $dbUrl" } else { '' }))
$cacheDriver = LC-EffectiveCacheDriver
$cacheUrl = LC-Mask (LC-EffectiveCacheUrl)
Write-Host ("  缓存：{0}{1}" -f $cacheDriver, $(if ($cacheUrl) { " $cacheUrl" } else { '' }))
$tokenMode = LC-NestedValue 'auth' 'tokenMode'
if (-not $tokenMode) { $tokenMode = 'jwt' }
Write-Host "  认证：tokenMode=$tokenMode"
$staticEnabled = LC-NestedValue 'static' 'enabled'
if (-not $staticEnabled) { $staticEnabled = 'false' }
Write-Host "  静态站：$staticEnabled"
Write-Host "  日志：$($LC.LogFile)"
$serverPid = LC-ReadPid
if ($serverPid -and (LC-PidAlive $serverPid)) {
    Write-Host "  进程：运行中（pid $serverPid）"
} else {
    Write-Host '  进程：未运行'
}

Remove-Item -Force $body -ErrorAction SilentlyContinue
if ($code -eq '200') { exit 0 }
exit 1
