# [LC-DEPLOY] 导出包一键部署 · 前台启动（Windows PowerShell）
#
# 用法：powershell -ExecutionPolicy Bypass -File deploy\scripts\start.ps1
# 前台运行，日志直接输出到当前终端；按 Ctrl+C 停止。
# 后台运行请用 start-bg.ps1（pid 文件 + 日志 + 自动探活/冒烟）。
#
# 退出码：0 正常退出；1 启动失败；2 环境/配置不满足。

. "$PSScriptRoot\common.ps1"

LC-RequireServer
LC-EnsureConfig
$lang = LC-Lang

$serverPid = LC-ReadPid
if ($serverPid -and (LC-PidAlive $serverPid)) {
    LC-Die "后台进程已在运行（pid $serverPid）。先执行 stop.ps1，或直接用 health.ps1 查看状态。"
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

LC-Banner '前台启动'
LC-PrintSummary
Write-Host ''
Write-Host '按 Ctrl+C 停止。'
Write-Host ''

Push-Location $LC.Server
try {
    & $exe @cargs
    if ($LASTEXITCODE -ne 0) {
        LC-Die "服务退出，退出码 $LASTEXITCODE。查看上面的输出与 $($LC.LogFile)。"
    }
} finally {
    Pop-Location
}
