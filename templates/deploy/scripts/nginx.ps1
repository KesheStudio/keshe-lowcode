# [LC-DEPLOY] 导出包一键部署 · nginx 反代配置渲染 / 测试 / 启停（Windows PowerShell）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\nginx.ps1 render -Mode http
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\nginx.ps1 render -Mode https -Domain example.com
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\nginx.ps1 test | start | reload | stop
#
# 可选参数：-Mode http|https、-Domain、-HttpPort、-HttpsPort、-Upstream、-Cert、-Key、-Force
# 渲染结果：deploy\nginx\nginx.generated.conf（https 以 nginx.conf 为底稿替换端口/域名/upstream/证书）。
#
# 退出码：0 成功；1 执行失败；2 环境/配置不满足。

param(
    [Parameter(Position = 0)]
    [string]$Action = 'render',
    [ValidateSet('http', 'https')]
    [string]$Mode = 'https',
    [string]$Domain = $env:LC_DEPLOY_DOMAIN,
    [string]$HttpPort = $env:LC_DEPLOY_HTTP_PORT,
    [string]$HttpsPort = $env:LC_DEPLOY_HTTPS_PORT,
    [string]$Upstream = $env:LC_DEPLOY_UPSTREAM,
    [string]$Cert = $env:LC_DEPLOY_CERT,
    [string]$Key = $env:LC_DEPLOY_KEY,
    [switch]$Force
)

. "$PSScriptRoot\common.ps1"

if (-not $Domain) { $Domain = 'localhost' }
if (-not $HttpPort) { $HttpPort = '80' }
if (-not $HttpsPort) { $HttpsPort = '443' }
if (-not $Upstream) { $Upstream = "127.0.0.1:$(LC-EffectivePort)" }
if (-not $Cert) { $Cert = Join-Path $LC.Root 'certs\site.crt' }
if (-not $Key) { $Key = Join-Path $LC.Root 'certs\site.key' }

$nginx = Get-Command nginx -ErrorAction SilentlyContinue
if (-not $nginx) {
    if ($Action -eq 'render') {
        Write-Host '提示：本机没有 nginx，仍可渲染配置。执行 test/start 前请先安装 nginx 1.25.3+。'
    } else {
        LC-Blocked '找不到 nginx。下一步：安装 nginx 1.25.3+ 并加入 PATH；仅需后端时可跳过本脚本。'
    }
}

New-Item -ItemType Directory -Force -Path (Join-Path $LC.Deploy 'nginx') | Out-Null
New-Item -ItemType Directory -Force -Path $LC.Logs | Out-Null
# nginx 的临时目录默认相对 prefix；缺了临时目录时 -t/启动都会报 CreateDirectory 失败。
foreach ($sub in @('client_body_temp', 'proxy_temp', 'fastcgi_temp', 'uwsgi_temp', 'scgi_temp')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $LC.Root "temp\$sub") | Out-Null
}
# nginx 配置里用正斜杠，避免 Windows 反斜杠被当成转义符。
$CertCfg = $Cert -replace '\\', '/'
$KeyCfg = $Key -replace '\\', '/'

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Render-Http {
    $text = @'
# 由 deploy/scripts/nginx.ps1 render 生成（http 形态）。重新 render 会覆盖本文件。
worker_processes  auto;
pid        logs/nginx.pid;
error_log  logs/error.log warn;

events {
    worker_connections  1024;
}

http {
    types {
        text/html                    html htm;
        text/css                     css;
        application/javascript       js mjs;
        application/json             json map;
        image/svg+xml                svg;
        image/png                    png;
        image/jpeg                   jpg jpeg;
        image/webp                   webp;
        image/gif                    gif;
        image/x-icon                 ico;
        font/woff2                   woff2;
        font/woff                    woff;
        font/ttf                     ttf;
        text/plain                   txt;
        application/pdf              pdf;
        application/xml              xml;
        video/mp4                    mp4;
        application/octet-stream     bin;
    }
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    keepalive_timeout  65;
    server_tokens   off;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" rt=$request_time req=$request_id';
    access_log  logs/access.log  main;

    gzip              on;
    gzip_vary         on;
    gzip_comp_level   5;
    gzip_min_length   1024;
    gzip_proxied      any;
    gzip_types        text/plain text/css text/xml application/json
                      application/javascript application/xml image/svg+xml;

    server {
        listen       {{HTTP_PORT}};
        server_name  {{SERVER_NAME}};

        add_header X-Content-Type-Options  nosniff                         always;
        add_header X-Frame-Options         SAMEORIGIN                     always;
        add_header Referrer-Policy         strict-origin-when-cross-origin always;

        client_max_body_size  10m;
        root   web;
        index  index.html;
        {{BASE_PATH_REWRITE}}

        location /api/ {
            proxy_pass  http://{{UPSTREAM}};
            proxy_http_version  1.1;
            proxy_set_header  Host               $host;
            proxy_set_header  X-Real-IP          $remote_addr;
            proxy_set_header  X-Forwarded-For    $proxy_add_x_forwarded_for;
            proxy_set_header  X-Forwarded-Proto  $scheme;
            proxy_set_header  X-Forwarded-Host   $host;
            proxy_connect_timeout  5s;
            proxy_send_timeout     60s;
            proxy_read_timeout     60s;
        }

        location ~* \.(?:css|js|mjs|json|map|woff2?|ttf|png|jpe?g|webp|gif|svg|ico|mp4)$ {
            try_files  $uri =404;
            add_header Cache-Control          "public, max-age=31536000, immutable" always;
            add_header X-Content-Type-Options  nosniff                         always;
            add_header X-Frame-Options         SAMEORIGIN                     always;
            add_header Referrer-Policy         strict-origin-when-cross-origin always;
        }

        location ~* \.html?$ {
            try_files  $uri =404;
            add_header Cache-Control          "no-cache"                      always;
            add_header X-Content-Type-Options  nosniff                         always;
            add_header X-Frame-Options         SAMEORIGIN                     always;
            add_header Referrer-Policy         strict-origin-when-cross-origin always;
        }

        location / {
            try_files  $uri $uri/ =404;
        }

        location ~ /\.(?!well-known) {
            deny  all;
        }
    }
}
'@
    $text = $text.Replace('{{HTTP_PORT}}', $HttpPort)
    $text = $text.Replace('{{SERVER_NAME}}', "$Domain localhost 127.0.0.1")
    $text = $text.Replace('{{UPSTREAM}}', $Upstream)
    Write-Utf8 $LC.NginxGenerated $text
}

function Render-Https {
    if (-not (Test-Path $LC.NginxConfig)) {
        LC-Blocked "缺少 $($LC.NginxConfig)。导出时未包含 nginx 配置：请重新导出并勾选 nginx，或把 nginx.conf 放到 deploy\nginx\ 后重试。"
    }
    $text = [System.IO.File]::ReadAllText($LC.NginxConfig)
    $text = [regex]::Replace($text, 'listen\s+80;', "listen       $HttpPort;")
    $text = [regex]::Replace($text, 'listen\s+443\s+ssl;', "listen       $HttpsPort ssl;")
    $text = [regex]::Replace($text, 'server_name\s+[^;]+;', "server_name  $Domain localhost 127.0.0.1;")
    $text = [regex]::Replace($text, 'proxy_pass\s+http://127\.0\.0\.1:8080;', "proxy_pass  http://$Upstream;")
    $text = [regex]::Replace($text, 'ssl_certificate\s+\.\./\.\./certs/site\.crt;', "ssl_certificate      $CertCfg;")
    $text = [regex]::Replace($text, 'ssl_certificate_key\s+\.\./\.\./certs/site\.key;', "ssl_certificate_key  $KeyCfg;")
    if ($HttpsPort -ne '443') {
        $old = 'return 301 https://$host$request_uri;'
        $new = 'return 301 https://$host:' + $HttpsPort + '$request_uri;'
        $text = $text.Replace($old, $new)
    }
    $header = "# 由 deploy/scripts/nginx.ps1 render 生成（https 形态，底稿 deploy\nginx\nginx.conf）。`r`n# 重新 render 会覆盖本文件；要自定义请改 nginx.conf 后重新 render。`r`n"
    Write-Utf8 $LC.NginxGenerated ($header + $text)
    foreach ($probe in @($Upstream, $CertCfg, $KeyCfg)) {
        if (-not $text.Contains($probe)) {
            Write-Host "警告：渲染结果里没有找到 $probe，请确认底稿 deploy\nginx\nginx.conf 是否被改过。" -ForegroundColor Yellow
        }
    }
}

function Do-Render {
    if ($Mode -eq 'http') {
        Render-Http
        Write-Host "已生成 http 反代配置：$($LC.NginxGenerated)（listen $HttpPort，upstream $Upstream）"
    } else {
        Render-Https
        Write-Host "已生成 https 反代配置：$($LC.NginxGenerated)（listen $HttpsPort，upstream $Upstream）"
        if (-not (Test-Path $Cert) -or -not (Test-Path $Key)) {
            Write-Host "提示：证书或私钥还不存在（$Cert / $Key）。"
            Write-Host "下一步：gen-test-cert.ps1 -Domain $Domain（测试）或 import-cert.ps1（正式证书）。"
        }
    }
    Write-Host '校验：nginx.ps1 test'
}

function Read-PidFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $value = Get-Content -LiteralPath $Path -Raw
    if (-not $value) { return '' }
    return $value.Trim()
}

function Require-Rendered {
    if (-not (Test-Path $LC.NginxGenerated) -or $Force) { Do-Render }
    if ($Mode -eq 'https' -and ((-not (Test-Path $Cert)) -or (-not (Test-Path $Key)))) {
        LC-Blocked "证书缺失，nginx 无法启动：$Cert / $Key。下一步：gen-test-cert.ps1 -Domain $Domain，或 import-cert.ps1。"
    }
}

switch ($Action) {
    'render' { Do-Render }
    'test' {
        Require-Rendered
        & $nginx.Source -t -p $LC.Root -c $LC.NginxGenerated
        if ($LASTEXITCODE -ne 0) {
            LC-Die 'nginx 配置校验失败。下一步：按上面的行号修改 deploy\nginx\nginx.conf 或重新 render；端口 <1024 需要特权。'
        }
    }
    'start' {
        Require-Rendered
        $nginxPidFile = Join-Path $LC.Logs 'nginx.pid'
        $oldPid = Read-PidFile $nginxPidFile
        if ($oldPid -and (LC-PidAlive $oldPid)) {
            Write-Host "nginx 似乎已在运行（pid $oldPid，$nginxPidFile）。需要重载用：nginx.ps1 reload"
            exit 0
        }
        if (Test-Path $nginxPidFile) {
            Write-Host "清理遗留 pid：$nginxPidFile"
            Remove-Item -LiteralPath $nginxPidFile -Force -ErrorAction SilentlyContinue
        }
        # Windows 版 nginx 默认前台运行，必须后台拉起，否则脚本会一直阻塞。
        $proc = Start-Process -FilePath $nginx.Source `
            -ArgumentList @('-p', $LC.Root, '-c', $LC.NginxGenerated) `
            -WindowStyle Hidden -PassThru
        if (-not $proc) {
            LC-Die 'nginx 启动失败：Start-Process 没有返回进程对象。'
        }
        Start-Sleep -Seconds 1
        $newPid = Read-PidFile $nginxPidFile
        if (-not $newPid -or -not (LC-PidAlive $newPid)) {
            $errLog = Join-Path $LC.Logs 'error.log'
            if (Test-Path $errLog) {
                Write-Host 'nginx 退出。错误日志尾部：'
                Get-Content -LiteralPath $errLog -Tail 20
            }
            LC-Die 'nginx 没有保持运行。下一步：按上面的错误改配置或端口后重试；端口被占用时换 -HttpPort/-HttpsPort。'
        }
        $scheme = if ($Mode -eq 'https') { 'https' } else { 'http' }
        Write-Host "nginx 已启动：${scheme}://$Domain（upstream $Upstream）"
    }
    { $_ -in @('reload', 'stop') } {
        $nginxPidFile = Join-Path $LC.Logs 'nginx.pid'
        if ($Action -eq 'reload') {
            if (-not (Test-Path $LC.NginxGenerated)) { LC-Blocked '还没有生成配置：先执行 nginx.ps1 render' }
            & $nginx.Source -p $LC.Root -c $LC.NginxGenerated -s reload
            if ($LASTEXITCODE -ne 0) { LC-Die 'nginx reload 失败：确认 nginx 正在运行（nginx.ps1 start），再重试。' }
            Write-Host 'nginx 已重载。'
        } else {
            $npid = Read-PidFile $nginxPidFile
            if (-not $npid) {
                Remove-Item -LiteralPath $nginxPidFile -Force -ErrorAction SilentlyContinue
                Write-Host 'nginx 未运行（没有有效 logs\nginx.pid）。'
                exit 0
            }
            if (Test-Path $LC.NginxGenerated) {
                & $nginx.Source -p $LC.Root -c $LC.NginxGenerated -s quit 2>$null
                if ($LASTEXITCODE -ne 0) {
                    & $nginx.Source -p $LC.Root -c $LC.NginxGenerated -s stop 2>$null
                }
            }
            if (LC-PidAlive $npid) {
                Stop-Process -Id ([int]$npid) -Force -ErrorAction SilentlyContinue
            }
            Remove-Item -LiteralPath $nginxPidFile -Force -ErrorAction SilentlyContinue
            Write-Host 'nginx 已停止。'
        }
    }
    default { LC-Blocked "未知动作：$Action（支持 render/test/start/reload/stop）" }
}
