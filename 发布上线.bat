@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

echo ==================================================
echo   净值分析台 · 发布到线上
echo ==================================================
echo.

echo [1/4] 刷新缓存版本号并自检...
py -3 tools/bump_version.py
if errorlevel 1 goto fail

echo.
echo [2/4] 生成在线发布包 dist/（本地私有内容不打包）...
py -3 tools/build_dist.py
if errorlevel 1 goto fail

echo.
echo [3/4] 检查 Git 仓库...
if not exist ".git" (
  git init
  git branch -M main
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo.
  echo 还没有配置远程仓库。请先在 GitHub 建好仓库，然后执行：
  echo   git remote add origin https://github.com/你的账号/你的仓库名.git
  echo 再重新运行本脚本。
  goto fail
)

echo.
echo [4/4] 提交并推送...
git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo 没有文件变化，跳过提交。
) else (
  git commit -m "update: %date% %time%"
)
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1
if errorlevel 1 (
  git push -u origin HEAD
) else (
  git push
)
if errorlevel 1 goto fail

echo.
echo 推送完成。Cloudflare Pages 收到后会重新构建，约 1 分钟上线。
echo 部署进度： https://dash.cloudflare.com/  ^>  Workers ^& Pages ^>  你的项目
goto end

:fail
echo.
echo 发布中止，请按上面的提示处理后再试。
pause
exit /b 1

:end
echo.
pause
