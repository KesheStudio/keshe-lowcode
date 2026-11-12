@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node scripts\start.mjs %*
if errorlevel 1 (
  echo.
  echo 启动失败，窗口保留以便查看上面的原因。按任意键关闭。
  pause >nul
)
endlocal
