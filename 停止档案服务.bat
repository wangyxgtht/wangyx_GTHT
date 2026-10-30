@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 净值分析台 · 停止后台档案服务

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\autostart.py" stop
) else (
  python "%~dp0tools\autostart.py" stop
)

echo.
pause
