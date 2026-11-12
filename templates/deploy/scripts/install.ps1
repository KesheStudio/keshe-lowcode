# [LC-DEPLOY] 导出包一键部署 · 安装依赖并编译（Windows PowerShell）
#
# 用法：powershell -ExecutionPolicy Bypass -File deploy\scripts\install.ps1
# 幂等：重复执行不会报错；Rust/Go 增量构建，Node 重跑 npm ci。
# 退出码：0 成功；1 安装失败；2 环境/配置不满足。

. "$PSScriptRoot\common.ps1"

LC-RequireServer
LC-RequireTools
LC-EnsureConfig

$lang = LC-Lang
$started = Get-Date
Write-Host ''
Write-Host "[1/1] install · $lang"

Push-Location $LC.Server
try {
    switch ($lang) {
        'node' {
            & npm ci --omit=dev
            if ($LASTEXITCODE -ne 0) {
                LC-Die '安装失败：npm ci 未通过。下一步：确认 Node >= 22.5、网络或 npm 源可用；也可在 server\ 里执行 npm install --omit=dev 后重跑本脚本。'
            }
        }
        'rust' {
            if ((LC-Profile) -eq 'release') {
                & cargo build --release
            } else {
                & cargo build
            }
            if ($LASTEXITCODE -ne 0) {
                LC-Die '安装失败：cargo build 未通过。下一步：确认 Rust >= 1.80、crates 可访问；先在 server\ 里单独运行 cargo build 查看完整错误。'
            }
            if (-not (Test-Path (LC-Binary))) {
                LC-Die "安装失败：没有找到编译产物 $(LC-Binary)。请检查 cargo 输出。"
            }
        }
        'go' {
            & go build -o lowcode-server.exe .
            if ($LASTEXITCODE -ne 0) {
                LC-Die '安装失败：go build 未通过。下一步：确认 Go >= 1.22 与 GOFLAGS/GOPROXY 可用；先在 server\ 里执行 go build ./... 查看完整错误。'
            }
            if (-not (Test-Path (LC-Binary))) {
                LC-Die "安装失败：没有找到编译产物 $(LC-Binary)。请检查 go build 输出。"
            }
        }
        default { LC-Blocked "无法识别后端语言：$lang" }
    }
} finally {
    Pop-Location
}

$seconds = [int]((Get-Date) - $started).TotalSeconds
Write-Host "安装完成（$lang，耗时 ${seconds}s）"
Write-Host '下一步：powershell -ExecutionPolicy Bypass -File deploy\scripts\migrate.ps1'
