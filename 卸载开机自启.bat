@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 净值分析台 · 卸载开机自启

choice /c yn /n /m "是否同时停止正在运行的后台服务？(Y=停止 / N=保留) "
if errorlevel 2 (set STOPARG=--keep) else set STOPARG=--stop

echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0tools\autostart.py" uninstall %STOPARG%
) else (
  python "%~dp0tools\autostart.py" uninstall %STOPARG%
)

echo.
pause
