# [LC-DEPLOY] 导出包一键部署 · 停止后台实例（Windows PowerShell）
#
# 用法：powershell -ExecutionPolicy Bypass -File deploy\scripts\stop.ps1
# 幂等：未运行时返回 0；pid 文件指向已退出的进程时会清理遗留文件。
# 安全：只停止本脚本启动并记录在 logs\server.meta 的进程；PID 被复用时拒绝误杀。
#
# 退出码：0 已停止/本来就没运行；1 停止失败；2 环境异常。

. "$PSScriptRoot\common.ps1"

$serverPid = LC-ReadPid
if (-not $serverPid) {
    Remove-Item -Force $LC.MetaFile -ErrorAction SilentlyContinue
    Write-Host "未发现 pid 文件（$($LC.PidFile)），服务应该没有在后台运行。"
    Write-Host '如果端口仍被占用，请用系统进程工具确认进程来源后再处理；本脚本不会杀未知进程。'
    exit 0
}

if (-not (LC-PidAlive $serverPid)) {
    Remove-Item -Force $LC.PidFile, $LC.MetaFile -ErrorAction SilentlyContinue
    Write-Host "清理遗留 pid：进程 $serverPid 已不存在（可能异常退出）。"
    Write-Host "日志保留在 $($LC.LogFile)，可查看退出原因。"
    exit 0
}

if (-not (LC-ProcessMatches $serverPid)) {
    LC-Die "pid $serverPid 不属于本次部署启动的进程（可能被系统复用）。为避免误杀，已停止清理；请人工确认后处理。"
}

Write-Host "正在停止 pid $serverPid ..."
try {
    Stop-Process -Id ([int]$serverPid) -ErrorAction Stop
} catch {
    LC-Die "发送停止信号失败（$($_.Exception.Message)）。请用系统进程工具确认 pid $serverPid 后手工处理。"
}

$i = 0
while ($i -lt 10) {
    if (-not (LC-PidAlive $serverPid)) { break }
    Start-Sleep -Seconds 1
    $i++
}
if (LC-PidAlive $serverPid) {
    Write-Host '进程未在 10 秒内退出，发送强制停止。'
    Stop-Process -Id ([int]$serverPid) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

if (LC-PidAlive $serverPid) {
    LC-Die "停止失败：pid $serverPid 仍在运行。请用系统进程工具确认后手工处理。"
}

Remove-Item -Force $LC.PidFile, $LC.MetaFile -ErrorAction SilentlyContinue
Write-Host "已停止。日志保留在 $($LC.LogFile)（下次启动会轮转为 .1）。"
