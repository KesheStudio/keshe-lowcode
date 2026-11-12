# [LC-DEPLOY] 导出包一键部署 · 后台启动 + pid + 日志 + 自动冒烟（Windows PowerShell）
#
# 用法：powershell -ExecutionPolicy Bypass -File deploy\scripts\start-bg.ps1 [-NoSmoke]
# 行为与 start-bg.sh 对齐：已在运行且健康则幂等返回；等待 health 200；
# 默认再跑一条只读集合查询，没有集合或集合要求登录时说明并跳过。
#
# 退出码：0 成功/已在运行；1 启动或冒烟失败；2 环境/配置不满足。

param([switch]$NoSmoke)

. "$PSScriptRoot\common.ps1"

LC-RequireServer
LC-EnsureConfig
$lang = LC-Lang

$url = LC-HealthUrl
$serverPid = LC-ReadPid
if ($serverPid -and (LC-PidAlive $serverPid)) {
    if ((LC-HttpCode $url '' 3) -eq '200') {
        Write-Host "已在运行且健康：pid $serverPid，$url"
        Write-Host '如需重启：先 stop.ps1，再执行本脚本。'
        exit 0
    }
    LC-Die "进程存在（pid $serverPid）但健康检查未通过。先执行 stop.ps1，再查看 $($LC.LogFile)。"
}

switch ($lang) {
    'node' {
        LC-Require 'node'
        $exe = (Get-Command node).Source
        $cargs = @('src/main.js')
    }
    'rust' {
        $binary = LC-Binary
        if (-not (Test-Path $binary)) { LC-Blocked '尚未编译：请先运行 install.ps1' }
        $exe = $binary
        $cargs = @()
    }
    'go' {
        $binary = LC-Binary
        if (-not (Test-Path $binary)) { LC-Blocked '尚未编译：请先运行 install.ps1' }
        $exe = $binary
        $cargs = @()
    }
    default { LC-Blocked "无法识别后端语言：$lang" }
}

New-Item -ItemType Directory -Force -Path $LC.Logs | Out-Null
if (Test-Path $LC.LogFile) { Move-Item -Force $LC.LogFile ($LC.LogFile + '.1') }
if (Test-Path $LC.ErrFile) { Move-Item -Force $LC.ErrFile ($LC.ErrFile + '.1') }

$sp = @{
    FilePath               = $exe
    WorkingDirectory       = $LC.Server
    RedirectStandardOutput = $LC.LogFile
    RedirectStandardError  = $LC.ErrFile
    PassThru               = $true
    NoNewWindow            = $true
}
if ($cargs) { $sp.ArgumentList = $cargs }
$proc = Start-Process @sp

if (-not $proc) {
    LC-Die '启动失败：Start-Process 没有返回进程对象。'
}
$proc.Id | Set-Content -LiteralPath $LC.PidFile -Encoding ASCII
@(
    "pid=$($proc.Id)",
    "language=$lang",
    $(if ($lang -in @('rust', 'go')) { "binary=$binary" }),
    "port=$(LC-EffectivePort)",
    "started=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
) | Where-Object { $_ -ne $null -and $_ -ne '' } | Set-Content -LiteralPath $LC.MetaFile -Encoding UTF8

Write-Host "已启动：pid $($proc.Id)，日志 $($LC.LogFile)（stderr：$($LC.ErrFile)）"
Write-Host "等待健康检查：$url"
$waitSeconds = if ($env:LC_DEPLOY_WAIT) { [int]$env:LC_DEPLOY_WAIT } else { 60 }
if (-not (LC-WaitHealth $url $waitSeconds)) {
    Write-Host '健康检查超时。日志尾部：' -ForegroundColor Red
    foreach ($f in @($LC.LogFile, $LC.ErrFile)) {
        if (Test-Path $f) {
            Write-Host "--- $f ---"
            Get-Content -LiteralPath $f -Tail 30
        }
    }
    LC-Die '启动失败或未就绪。下一步：health.ps1 重试；端口被占用时改 deploy\backend\config.yaml 的 port 或设置 LC_PORT；停止用 stop.ps1。'
}

Write-Host 'health 200 OK'

if ($NoSmoke -or $env:LC_DEPLOY_SKIP_SMOKE -eq '1') {
    Write-Host '冒烟：已跳过'
    Write-Host '完成。查看配置摘要：health.ps1'
    exit 0
}

$collectionDir = Join-Path $LC.Root 'web\data\collections'
$collectionId = ''
$collectionFile = $null
if (Test-Path $collectionDir) {
    $files = @(Get-ChildItem -LiteralPath $collectionDir -Filter '*.json' -File | Sort-Object Name)
    if ($files.Count -gt 0) {
        $collectionFile = $files[0]
        try {
            $json = Get-Content -LiteralPath $collectionFile.FullName -Raw | ConvertFrom-Json
            if ($json.id) { $collectionId = [string]$json.id }
        } catch { }
        if (-not $collectionId) { $collectionId = [System.IO.Path]::GetFileNameWithoutExtension($collectionFile.Name).ToLower() }
    }
}

if (-not $collectionId) {
    Write-Host "冒烟：未找到集合快照（$collectionDir），跳过集合查询。"
    Write-Host '完成。查看配置摘要：health.ps1'
    exit 0
}

$base = $url -replace '/api/health$', ''
$queryUrl = "$base/api/collections/$collectionId/rows?page=1&pageSize=1"
$bodyPath = Join-Path $LC.Logs '.smoke-body'
$code = LC-HttpCode $queryUrl $bodyPath 5
$bodyText = if (Test-Path $bodyPath) { Get-Content -LiteralPath $bodyPath -Raw } else { '' }

switch ($code) {
    '200' {
        $total = ''
        if ($bodyText -match '"total"\s*:\s*([0-9]+)') { $total = $matches[1] }
        Write-Host "冒烟：集合 $collectionId 只读查询 200（total=$($total)）"
    }
    '401' { Write-Host "冒烟：集合 $collectionId 需要登录（HTTP 401），跳过匿名查询。" }
    '403' { Write-Host "冒烟：集合 $collectionId 需要登录（HTTP 403），跳过匿名查询。" }
    default {
        Write-Host "冒烟失败：集合 $collectionId 返回 HTTP $code" -ForegroundColor Red
        if ($bodyText) { Write-Host $bodyText.Substring(0, [Math]::Min(300, $bodyText.Length)) }
        Remove-Item -Force $bodyPath -ErrorAction SilentlyContinue
        LC-Die '冒烟失败。下一步：health.ps1 看服务状态；检查 web\data\collections\ 与 dataApi 配置。'
    }
}
Remove-Item -Force $bodyPath -ErrorAction SilentlyContinue
Write-Host '完成。查看配置摘要：health.ps1'
