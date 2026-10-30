@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

echo ==================================================
echo   净值分析台 · 发布到线上（Cloudflare Pages）
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
echo [3/4] 上传到 Cloudflare Pages...
npx --yes wrangler@4 pages deploy dist --project-name nav-excel --branch main --commit-dirty=true
if errorlevel 1 (
  echo.
  echo 部署失败。若是登录过期，先运行： npx wrangler login
  goto fail
)

echo.
echo [4/4] 备份到 GitHub...
if not exist ".git" (
  echo 未检测到 git 仓库，跳过。
  goto done
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo 未配置远程仓库，跳过。
  goto done
)
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

:done
echo.
echo 完成。线上地址： https://nav-excel.pages.dev
echo 手机若看着是旧版，下拉刷新或关掉再开一次即可。
goto end

:fail
echo.
echo 发布中止，请按上面的提示处理后再试。
pause
exit /b 1

:end
echo.
pause
