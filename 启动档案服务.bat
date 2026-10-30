@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 净值分析台 · 本地档案服务

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0server\archive_server.py" %*
) else (
  python "%~dp0server\archive_server.py" %*
)

if not %errorlevel%==0 (
  echo.
  echo 服务未能启动。请确认已安装 Python 3（命令行可执行 py -3 --version）。
  pause
)
