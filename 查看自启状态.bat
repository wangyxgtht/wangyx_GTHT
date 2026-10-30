@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 净值分析台 · 运行与自启状态

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\autostart.py" status
) else (
  python "%~dp0tools\autostart.py" status
)

echo.
pause
