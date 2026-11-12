@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo 用法：migrate.cmd ^<站点目录^> [--dry-run] [--force] [--yes]
  echo 用途：把同版本站点目录导入到当前数据目录（换机器、换目录搬家）
  echo 示例：migrate.cmd D:\backup\my-site --dry-run
  pause
  exit /b 1
)
node scripts\migrate.mjs %*
if errorlevel 1 (
  echo.
  echo 导入未全部完成，窗口保留以便查看上面的原因。按任意键关闭。
  pause >nul
)
endlocal
