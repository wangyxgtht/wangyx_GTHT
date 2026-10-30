@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 净值分析台 · 安装开机自启（无窗口）

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\autostart.py" install
) else (
  python "%~dp0tools\autostart.py" install
)

echo.
pause
