@echo off
REM ============================================================
REM 🗑️ 垃圾 BP 过滤器 - Windows 一键启动
REM ============================================================

echo.
echo 🗑️  垃圾 BP 过滤器 - 一键启动中...
echo ==================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 需要安装 Node.js ^(推荐 v18+^)
    echo    下载: https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo 📦 首次运行，安装依赖中...
    npm install
    npm install http-proxy-middleware --save
    echo.
)

echo 🚀 启动 API 代理服务器...
start /b node server.js

timeout /t 2 >nul

echo 🚀 启动前端...
echo.
echo ==================================
echo ✅ 浏览器会自动打开 http://localhost:3000
echo    关闭此窗口停止所有服务
echo ==================================
echo.

npm start
