#!/bin/bash
# ============================================================
# 🗑️ 垃圾 BP 过滤器 - 一键启动
# ============================================================

echo ""
echo "🗑️  垃圾 BP 过滤器 - 一键启动中..."
echo "=================================="
echo ""

# 检查 node
if ! command -v node &> /dev/null; then
    echo "❌ 需要安装 Node.js (推荐 v18+)"
    echo "   下载: https://nodejs.org"
    exit 1
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，安装依赖中..."
    npm install
    npm install http-proxy-middleware --save
    echo ""
fi

# 安装 Python 依赖（PyMuPDF 等 PDF 解析库）
echo "🐍 检查 Python 依赖..."
if ! python3 -c "import fitz" > /dev/null 2>&1; then
    echo "📦 安装 Python 依赖（scripts/requirements.txt）..."
    pip3 install --break-system-packages -r scripts/requirements.txt 2>/dev/null || \
    pip3 install -r scripts/requirements.txt
    echo ""
fi

# 启动后端 (后台)
echo "🚀 启动 API 代理服务器 (端口 3001)..."
node server.js &
BACKEND_PID=$!

# 等一秒让后端起来
sleep 1

# 启动前端
echo "🚀 启动前端开发服务器 (端口 3000)..."
echo ""
echo "=================================="
echo "✅ 浏览器会自动打开 http://localhost:3000"
echo "   按 Ctrl+C 停止所有服务"
echo "=================================="
echo ""

# 前端在前台运行
npm start

# 清理: 前端退出时也关掉后端
kill $BACKEND_PID 2>/dev/null
