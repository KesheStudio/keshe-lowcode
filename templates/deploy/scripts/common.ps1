# [LC-DEPLOY] 导出包一键部署 · PowerShell 公共函数
#
# 被 install/migrate/start/start-bg/stop/health/nginx 的 .ps1 共同 dot-source。
# 与 common.sh 行为对齐：相同的语言识别、配置引导、退出码与输出约定。
# 不打印任何数据库/Redis 口令；连接串里的 user:pass 打码为 ***。
#
# 退出码：0 成功；1 运行失败；2 环境/配置不满足（BLOCKED）。

$ErrorActionPreference = 'Stop'

$LC = [ordered]@{}
$LC.Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$LC.Server = Join-Path $LC.Root 'server'
$LC.Deploy = Join-Path $LC.Root 'deploy'
$LC.Config = Join-Path $LC.Deploy 'backend\config.yaml'
$LC.Generated = Join-Path $LC.Deploy 'backend\config.generated.yaml'
$LC.NginxConfig = Join-Path $LC.Deploy 'nginx\nginx.conf'
$LC.NginxGenerated = Join-Path $LC.Deploy 'nginx\nginx.generated.conf'
$LC.Logs = Join-Path $LC.Root 'logs'
$LC.PidFile = Join-Path $LC.Logs 'server.pid'
$LC.MetaFile = Join-Path $LC.Logs 'server.meta'
$LC.LogFile = Join-Path $LC.Logs 'server.log'
$LC.ErrFile = Join-Path $LC.Logs 'server.err.log'

$script:LCLanguage = ''

function LC-Lang {
    if ($script:LCLanguage) { return $script:LCLanguage }
    if (Test-Path (Join-Path $LC.Server 'package.json')) { $script:LCLanguage = 'node' }
    elseif (Test-Path (Join-Path $LC.Server 'Cargo.toml')) { $script:LCLanguage = 'rust' }
    elseif (Test-Path (Join-Path $LC.Server 'go.mod')) { $script:LCLanguage = 'go' }
    else { $script:LCLanguage = 'unknown' }
    return $script:LCLanguage
}

function LC-Profile {
    if ($env:LC_DEPLOY_PROFILE -eq 'debug') { return 'debug' }
    return 'release'
}

function LC-Binary {
    switch (LC-Lang) {
        'rust' { return (Join-Path $LC.Server ("target\{0}\lowcode-server.exe" -f (LC-Profile))) }
        'go' { return (Join-Path $LC.Server 'lowcode-server.exe') }
        default { return '' }
    }
}

function LC-Die([string]$Message) {
    Write-Error $Message -ErrorAction Continue
    exit 1
}

function LC-Blocked([string]$Message) {
    Write-Error $Message -ErrorAction Continue
    exit 2
}

function LC-Require([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        LC-Blocked "缺少命令 $Name：请先安装后再试。"
    }
}

function LC-RequireServer {
    if (-not (Test-Path $LC.Server -PathType Container)) {
        LC-Blocked '缺少 server/ 目录：导出包里必须有后端工程。请重新导出并选择后端语言。'
    }
    if ((LC-Lang) -eq 'unknown') {
        LC-Blocked '无法识别后端语言（server/ 下没有 package.json / Cargo.toml / go.mod）。请确认导出包完整。'
    }
}

function LC-RequireTools {
    switch (LC-Lang) {
        'node' { LC-Require 'node'; LC-Require 'npm' }
        'rust' { LC-Require 'cargo'; LC-Require 'rustc' }
        'go' { LC-Require 'go' }
    }
}

function LC-Banner([string]$Title) {
    Write-Host "低代码导出包 · $Title"
    Write-Host "站点根：$($LC.Root)"
    Write-Host "语言：$(LC-Lang)"
}

function LC-TrimValue([string]$Value) {
    $v = $Value.Trim()
    $v = ($v -replace '\s*#.*$', '').Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
    return $v
}

function LC-ConfigSource {
    # 优先读用户配置；还没生成时读导出包里的 config.generated.yaml，首次引导的默认值才准。
    if (Test-Path $LC.Config) { return $LC.Config }
    return $LC.Generated
}

function LC-TopValue([string]$Key) {
    $src = LC-ConfigSource
    if (-not (Test-Path $src)) { return '' }
    foreach ($line in Get-Content -LiteralPath $src) {
        if ($line -match ('^' + [regex]::Escape($Key) + '\s*:\s*(.*)$')) {
            return (LC-TrimValue $matches[1])
        }
    }
    return ''
}

function LC-NestedValue([string]$Section, [string]$Key) {
    $src = LC-ConfigSource
    if (-not (Test-Path $src)) { return '' }
    $inSection = $false
    foreach ($line in Get-Content -LiteralPath $src) {
        if (-not $inSection) {
            if ($line -match ('^' + [regex]::Escape($Section) + '\s*:')) { $inSection = $true }
            continue
        }
        if ($line -match '^\S') { break }
        if ($line -match ('^\s+' + [regex]::Escape($Key) + '\s*:\s*(.*)$')) {
            return (LC-TrimValue $matches[1])
        }
    }
    return ''
}

function LC-EffectiveHost {
    $h = if ($env:LC_HOST) { $env:LC_HOST } else { LC-TopValue 'host' }
    if (-not $h) { $h = '127.0.0.1' }
    if ($h -in @('0.0.0.0', '::')) { $h = '127.0.0.1' }
    return $h
}

function LC-EffectivePort {
    $p = if ($env:LC_PORT) { $env:LC_PORT } else { LC-TopValue 'port' }
    if (-not $p) { $p = '8080' }
    return $p
}

function LC-EffectiveDbDriver {
    $d = if ($env:LC_DB_DRIVER) { $env:LC_DB_DRIVER } else { LC-NestedValue 'database' 'driver' }
    if (-not $d) { $d = 'sqlite' }
    return $d
}

function LC-EffectiveDbUrl {
    if ($env:DATABASE_URL) { return $env:DATABASE_URL }
    return (LC-NestedValue 'database' 'url')
}

function LC-EffectiveCacheDriver {
    $d = if ($env:LC_CACHE_DRIVER) { $env:LC_CACHE_DRIVER } else { LC-NestedValue 'cache' 'driver' }
    if (-not $d) { $d = 'memory' }
    return $d
}

function LC-EffectiveCacheUrl {
    if ($env:REDIS_URL) { return $env:REDIS_URL }
    return (LC-NestedValue 'cache' 'url')
}

function LC-Mask([string]$Value) {
    if (-not $Value) { return '' }
    $v = $Value -replace '(://[^:/@]*):[^@]*@', '$1:***@'
    $v = $v -replace '(?i)(password\s*[:=]\s*)\S+', '${1}***'
    return $v
}

function LC-ConfigState {
    if (-not (Test-Path $LC.Config)) { return 'missing' }
    if (Test-Path $LC.Generated) {
        $a = [System.IO.File]::ReadAllText($LC.Config)
        $b = [System.IO.File]::ReadAllText($LC.Generated)
        if ($a -eq $b) { return 'identical' }
    }
    return 'user'
}

function LC-StripUrlPassword([string]$Value) {
    return ($Value -replace '(://[^:/@]*):[^@]*@', '$1@')
}

function LC-WriteConfig {
    $nl = [Environment]::NewLine
    $text = @(
        "# 由 deploy/scripts 首次运行生成（$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')）。",
        '# 覆盖链：内置默认 < config.generated.yaml < 本文件 < 环境变量 < 启动参数。',
        '# 不要把口令写在这里；数据库口令用 LC_DB_PASSWORD，Redis 口令用 REDIS_URL。',
        '',
        'schemaVersion: 1',
        'strict: true',
        'override: false',
        "host: `"$($LC.CfgHost)`"",
        "port: $($LC.CfgPort)",
        '',
        'database:',
        "  driver: `"$($LC.DbDriver)`"",
        "  url: `"$($LC.DbUrl)`"",
        "  host: `"$($LC.DbHost)`"",
        "  port: $($LC.DbPort)",
        "  name: `"$($LC.DbName)`"",
        "  user: `"$($LC.DbUser)`"",
        '  password: ""',
        '',
        'cache:',
        "  driver: `"$($LC.CacheDriver)`"",
        "  url: `"$($LC.CacheUrl)`"",
        '  ttlSeconds: 30',
        '  keyPrefix: "lc:"'
    ) -join $nl
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LC.Config) | Out-Null
    [System.IO.File]::WriteAllText($LC.Config, $text + $nl, (New-Object System.Text.UTF8Encoding($false)))
}

function LC-DefaultDbParts {
    $LC.DbDriver = if ($env:LC_DEPLOY_DB_DRIVER) { $env:LC_DEPLOY_DB_DRIVER } else { LC-NestedValue 'database' 'driver' }
    $LC.DbUrl = if ($env:LC_DEPLOY_DB) { $env:LC_DEPLOY_DB } else { LC-NestedValue 'database' 'url' }
    $LC.DbHost = if ($env:LC_DEPLOY_DB_HOST) { $env:LC_DEPLOY_DB_HOST } else { LC-NestedValue 'database' 'host' }
    $LC.DbPort = if ($env:LC_DEPLOY_DB_PORT) { $env:LC_DEPLOY_DB_PORT } else { LC-NestedValue 'database' 'port' }
    $LC.DbName = if ($env:LC_DEPLOY_DB_NAME) { $env:LC_DEPLOY_DB_NAME } else { LC-NestedValue 'database' 'name' }
    $LC.DbUser = if ($env:LC_DEPLOY_DB_USER) { $env:LC_DEPLOY_DB_USER } else { LC-NestedValue 'database' 'user' }
    if (-not $LC.DbDriver) { $LC.DbDriver = 'sqlite' }
    if (-not $LC.DbUrl -and $LC.DbDriver -eq 'sqlite') { $LC.DbUrl = 'sqlite://data/app.db' }
    if (-not $LC.DbHost) { $LC.DbHost = '127.0.0.1' }
    if (-not $LC.DbPort) { $LC.DbPort = '0' }
    if (-not $LC.DbName) { $LC.DbName = 'app' }
    if (-not $LC.DbUser) { $LC.DbUser = '' }
}

function LC-ApplyDbAddress([string]$Address) {
    $addr = $Address
    $LC.DbUrl = ''
    if (-not $addr) {
        $LC.DbDriver = 'sqlite'; $LC.DbUrl = 'sqlite://data/app.db'
        return
    }
    if ($addr -eq 'sqlite' -or $addr -like 'sqlite://*') {
        $LC.DbDriver = 'sqlite'
        $LC.DbUrl = if ($addr -eq 'sqlite') { 'sqlite://data/app.db' } else { $addr }
        return
    }
    if ($addr -match '^([a-zA-Z0-9]+)://') {
        $scheme = $matches[1].ToLower()
        switch ($scheme) {
            'mysql' { $LC.DbDriver = 'mysql' }
            'postgres' { $LC.DbDriver = 'postgres' }
            'postgresql' { $LC.DbDriver = 'postgres' }
            'sqlite' { $LC.DbDriver = 'sqlite' }
            default { LC-Blocked "不认识的数据库地址协议：$scheme（支持 sqlite:// / mysql:// / postgres:// / postgresql://）" }
        }
        $stripped = LC-StripUrlPassword $addr
        if ($stripped -ne $addr) { Write-Host '提示：连接串里的口令已从配置中移除；请用 LC_DB_PASSWORD 注入。' }
        $LC.DbUrl = $stripped
        return
    }
    if ($addr -match '^([^:]+):([0-9]+)/(.+)$') {
        $LC.DbHost = $matches[1]
        $LC.DbPort = $matches[2]
        $LC.DbName = $matches[3]
        $LC.DbDriver = 'mysql'
        $LC.DbUrl = ''
        Write-Host '提示：地址未带协议，按 mysql 处理；如用 PostgreSQL 请写 postgres://user@host:5432/db。'
        return
    }
    LC-Blocked "数据库地址格式不对：$addr（示例：sqlite://data/app.db、mysql://user@host:3306/db、postgres://user@host:5432/db）"
}

function LC-InteractiveConfig {
    LC-DefaultDbParts
    $dPort = if ($env:LC_DEPLOY_PORT) { $env:LC_DEPLOY_PORT } else { LC-TopValue 'port' }
    if (-not $dPort) { $dPort = '8080' }
    $dCache = if ($env:LC_DEPLOY_CACHE) { $env:LC_DEPLOY_CACHE } else { LC-NestedValue 'cache' 'driver' }
    if (-not $dCache) { $dCache = 'memory' }
    $dUrl = if ($LC.DbUrl) { $LC.DbUrl } else { 'sqlite://data/app.db' }

    Write-Host ''
    Write-Host "首次运行：需要生成 $($LC.Config)"
    Write-Host '直接回车使用方括号里的默认值。'
    Write-Host ''

    $ans = Read-Host "1) 后端监听端口 [$dPort]"
    if ($ans) { $dPort = $ans }

    Write-Host "2) 数据库地址 [$(LC-Mask $dUrl)]"
    Write-Host '   可填：sqlite://data/app.db、mysql://user@host:3306/db、postgres://user@host:5432/db，或 host:port/库名'
    $ans2 = Read-Host '   >'
    if ($ans2) { LC-ApplyDbAddress $ans2 }

    $ans3 = Read-Host "3) 缓存 none / memory / redis [$dCache]"
    if ($ans3) { $dCache = $ans3 }
    switch ($dCache) {
        'none' { $LC.CacheDriver = 'none'; $LC.CacheUrl = '' }
        'memory' { $LC.CacheDriver = 'memory'; $LC.CacheUrl = '' }
        'redis' {
            $LC.CacheDriver = 'redis'
            $LC.CacheUrl = if ($env:LC_DEPLOY_REDIS_URL) { $env:LC_DEPLOY_REDIS_URL } else { 'redis://127.0.0.1:16379/0' }
            $ans4 = Read-Host "   Redis 地址 [$(LC-Mask $LC.CacheUrl)]"
            if ($ans4) { $LC.CacheUrl = $ans4 }
            $stripped = LC-StripUrlPassword $LC.CacheUrl
            if ($stripped -ne $LC.CacheUrl) { Write-Host '提示：Redis 口令请用 REDIS_URL 注入；配置里已移除口令。' }
            $LC.CacheUrl = $stripped
        }
        default { LC-Blocked "缓存只能是 none / memory / redis，收到：$dCache" }
    }

    $LC.CfgHost = if ($env:LC_DEPLOY_HOST) { $env:LC_DEPLOY_HOST } else { LC-TopValue 'host' }
    if (-not $LC.CfgHost) { $LC.CfgHost = '127.0.0.1' }
    $LC.CfgPort = $dPort
    LC-WriteConfig
    Write-Host ''
    Write-Host "已写入：$($LC.Config)"
}

function LC-EnvConfig {
    LC-DefaultDbParts
    if ($env:LC_DEPLOY_DB) { LC-ApplyDbAddress $env:LC_DEPLOY_DB }
    if ($env:LC_DEPLOY_DB_DRIVER -and -not $env:LC_DEPLOY_DB) {
        $LC.DbDriver = $env:LC_DEPLOY_DB_DRIVER
        $LC.DbUrl = ''
    }
    $LC.CfgHost = if ($env:LC_DEPLOY_HOST) { $env:LC_DEPLOY_HOST } else { LC-TopValue 'host' }
    if (-not $LC.CfgHost) { $LC.CfgHost = '127.0.0.1' }
    $LC.CfgPort = if ($env:LC_DEPLOY_PORT) { $env:LC_DEPLOY_PORT } else { LC-TopValue 'port' }
    if (-not $LC.CfgPort) { $LC.CfgPort = '8080' }
    $LC.CacheDriver = if ($env:LC_DEPLOY_CACHE) { $env:LC_DEPLOY_CACHE } else { LC-NestedValue 'cache' 'driver' }
    if (-not $LC.CacheDriver) { $LC.CacheDriver = 'memory' }
    switch ($LC.CacheDriver) {
        'none' { $LC.CacheUrl = '' }
        'memory' { $LC.CacheUrl = '' }
        'redis' {
            $LC.CacheUrl = if ($env:LC_DEPLOY_REDIS_URL) { $env:LC_DEPLOY_REDIS_URL } elseif ($env:REDIS_URL) { $env:REDIS_URL } else { 'redis://127.0.0.1:16379/0' }
        }
        default { LC-Blocked "LC_DEPLOY_CACHE 只能是 none / memory / redis，收到：$($LC.CacheDriver)" }
    }
    LC-WriteConfig
    Write-Host "非交互模式：已用环境变量/默认值生成 $($LC.Config)"
}

function LC-EnsureConfig {
    $state = LC-ConfigState
    if ($state -eq 'user') {
        Write-Host "使用已有配置：$($LC.Config)"
        return
    }
    $interactive = ((-not [Console]::IsInputRedirected) -and ($env:LC_DEPLOY_NONINTERACTIVE -ne '1')) -or ($env:LC_DEPLOY_INTERACTIVE -eq '1')
    if ($interactive) { LC-InteractiveConfig } else { LC-EnvConfig }
}

function LC-PidAlive([string]$Id) {
    if (-not $Id) { return $false }
    return [bool](Get-Process -Id ([int]$Id) -ErrorAction SilentlyContinue)
}

function LC-ReadPid {
    if (-not (Test-Path $LC.PidFile)) { return '' }
    $v = Get-Content -LiteralPath $LC.PidFile -Raw
    if (-not $v) { return '' }
    return $v.Trim()
}

function LC-ProcessMatches([string]$Id) {
    if (-not (Test-Path $LC.MetaFile)) { return $true }
    $binary = (Select-String -LiteralPath $LC.MetaFile -Pattern '^binary=' | Select-Object -First 1).Line
    if (-not $binary) { return $true }
    $binary = $binary -replace '^binary=', ''
    try {
        $proc = Get-Process -Id ([int]$Id) -ErrorAction Stop
        if ($proc.Path -and ($proc.Path -ieq $binary)) { return $true }
        return $false
    } catch { return $false }
}

function LC-Curl {
    # 只认真正的 curl 可执行文件；Windows PowerShell 里 curl 可能是 Invoke-WebRequest 别名。
    $c = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if (-not $c) { $c = Get-Command 'curl' -CommandType Application -ErrorAction SilentlyContinue }
    return $c
}

function LC-HttpCode([string]$Url, [string]$OutFile, [int]$TimeoutSec = 5) {
    $curl = LC-Curl
    if ($curl) {
        $sink = $OutFile
        $tempSink = $false
        if (-not $sink) {
            $sink = [System.IO.Path]::GetTempFileName()
            $tempSink = $true
        }
        try {
            $cargs = @('-s', '-o', $sink, '-w', '%{http_code}', '--max-time', "$TimeoutSec", $Url)
            $code = & $curl.Source @cargs 2>$null
            if (-not $code) { return '000' }
            return ([string]$code)
        } finally {
            if ($tempSink -and (Test-Path -LiteralPath $sink)) { Remove-Item -LiteralPath $sink -Force -ErrorAction SilentlyContinue }
        }
    }
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($OutFile) { [System.IO.File]::WriteAllText($OutFile, $resp.Content) }
        return ([string]$resp.StatusCode)
    } catch {
        $r = $_.Exception.Response
        if ($r) { return ([string]$r.StatusCode.value__) }
        return '000'
    }
}

function LC-HealthUrl {
    return "http://$(LC-EffectiveHost):$(LC-EffectivePort)/api/health"
}

function LC-WaitHealth([string]$Url, [int]$WaitSeconds = 0) {
    $i = 0
    while ($true) {
        $code = LC-HttpCode $Url '' 3
        if ($code -eq '200') { return $true }
        if ($i -ge $WaitSeconds) { return $false }
        Start-Sleep -Seconds 1
        $i++
    }
}

function LC-PrintSummary {
    Write-Host "  地址：http://$(LC-EffectiveHost):$(LC-EffectivePort)"
    $db = LC-EffectiveDbDriver
    $dbUrl = LC-Mask (LC-EffectiveDbUrl)
    Write-Host ("  数据库：{0}{1}" -f $db, $(if ($dbUrl) { " $dbUrl" } else { '' }))
    $cache = LC-EffectiveCacheDriver
    $cacheUrl = LC-Mask (LC-EffectiveCacheUrl)
    Write-Host ("  缓存：{0}{1}" -f $cache, $(if ($cacheUrl) { " $cacheUrl" } else { '' }))
    Write-Host "  日志：$($LC.LogFile)"
    $pid = LC-ReadPid
    if ($pid -and (LC-PidAlive $pid)) {
        Write-Host "  进程：运行中（pid $pid）"
    } else {
        Write-Host '  进程：未运行'
    }
}
