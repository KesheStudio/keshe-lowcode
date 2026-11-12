# [LC-DEPLOY] 导出包一键部署 · 建表与升级（Windows PowerShell）
#
# 用法：powershell -ExecutionPolicy Bypass -File deploy\scripts\migrate.ps1
# 幂等：已应用的版本会跳过；重复执行输出「无待执行迁移」并退出 0。
# 退出码：0 成功；1 迁移失败；2 环境/配置不满足。

. "$PSScriptRoot\common.ps1"

LC-RequireServer
LC-EnsureConfig
$lang = LC-Lang

switch ($lang) {
    'node' {
        LC-Require 'node'
        $exe = (Get-Command node).Source
        $cargs = @('src/main.js', '--migrate')
    }
    'rust' {
        $binary = LC-Binary
        if (-not (Test-Path $binary)) { LC-Blocked '尚未编译：请先运行 install.ps1' }
        $exe = $binary
        $cargs = @('--migrate')
    }
    'go' {
        $binary = LC-Binary
        if (-not (Test-Path $binary)) { LC-Blocked '尚未编译：请先运行 install.ps1' }
        $exe = $binary
        $cargs = @('--migrate')
    }
    default { LC-Blocked "无法识别后端语言：$lang" }
}

Write-Host ''
Write-Host "[1/1] migrate · $lang"
Push-Location $LC.Server
try {
    & $exe @cargs
    if ($LASTEXITCODE -ne 0) {
        LC-Die "迁移失败（$lang）。下一步：确认数据库地址与账号权限；数据库口令用 LC_DB_PASSWORD 注入。若提示表已存在或版本已应用，可忽略并重跑本脚本。"
    }
} finally {
    Pop-Location
}
Write-Host '迁移完成（重复执行安全）。'
Write-Host '下一步：powershell -ExecutionPolicy Bypass -File deploy\scripts\start-bg.ps1'
