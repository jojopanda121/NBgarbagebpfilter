#!/bin/bash
# 快速测试脚本 - 验证修复是否生效

echo "========================================="
echo "垃圾 BP 过滤器 - 快速测试"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_step() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1"
        return 1
    fi
}

# 1. 检查 Node.js
echo "1. 检查 Node.js 环境..."
node --version > /dev/null 2>&1
check_step "Node.js 已安装"

# 2. 检查 Python
echo ""
echo "2. 检查 Python 环境..."
python3 --version > /dev/null 2>&1
check_step "Python3 已安装"

# 3. 检查 .env 文件
echo ""
echo "3. 检查配置文件..."
if [ -f .env ]; then
    if grep -q "MINIMAX_API_KEY=sk-" .env; then
        check_step ".env 文件存在且已配置 API Key"
    else
        echo -e "${YELLOW}⚠${NC} .env 文件存在但 API Key 未配置"
        echo "   请编辑 .env 文件，填入你的 MINIMAX_API_KEY"
    fi
else
    echo -e "${RED}✗${NC} .env 文件不存在"
    echo "   请复制 .env.example 为 .env 并填入配置"
    exit 1
fi

# 4. 检查依赖
echo ""
echo "4. 检查 Node.js 依赖..."
if [ -d "node_modules" ] && [ -d "server/node_modules" ]; then
    check_step "Node.js 依赖已安装"
else
    echo -e "${YELLOW}⚠${NC} 依赖未完全安装，正在安装..."
    npm install > /dev/null 2>&1
    cd server && npm install > /dev/null 2>&1 && cd ..
    check_step "依赖安装完成"
fi

# 5. 检查 Python 依赖
echo ""
echo "5. 检查 Python 依赖..."
python3 -c "import fitz" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    check_step "PyMuPDF (fitz) 已安装"
else
    echo -e "${YELLOW}⚠${NC} PyMuPDF 未安装，正在安装..."
    pip3 install pymupdf > /dev/null 2>&1
    check_step "PyMuPDF 安装完成"
fi

# 6. 测试 JSON 解析功能
echo ""
echo "6. 测试 JSON 解析功能..."
node test_json_parse.js > /dev/null 2>&1
check_step "JSON 解析测试通过"

# 7. 检查服务器语法
echo ""
echo "7. 检查服务器代码语法..."
node -c server/index.js
check_step "服务器代码语法正确"

# 8. 测试 PDF 提取（如果有测试文件）
echo ""
echo "8. 测试 PDF 提取功能..."
if [ -f "test_bp.pdf" ]; then
    python3 scripts/extract_pdf.py test_bp.pdf > /tmp/test_extract.txt 2>&1
    if [ $? -eq 0 ]; then
        CHAR_COUNT=$(wc -c < /tmp/test_extract.txt)
        if [ $CHAR_COUNT -gt 100 ]; then
            check_step "PDF 提取成功（提取了 $CHAR_COUNT 字符）"
        else
            echo -e "${YELLOW}⚠${NC} PDF 提取成功但内容较少（$CHAR_COUNT 字符）"
        fi
    else
        echo -e "${YELLOW}⚠${NC} PDF 提取失败，请检查 test_bp.pdf"
    fi
else
    echo -e "${YELLOW}⚠${NC} 未找到 test_bp.pdf，跳过 PDF 测试"
fi

# 9. 检查端口占用
echo ""
echo "9. 检查端口占用..."
if lsof -i :3001 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC} 端口 3001 已被占用"
    echo "   如果是本服务占用，可以忽略"
    echo "   否则请先关闭占用端口的程序"
else
    check_step "端口 3001 可用"
fi

# 总结
echo ""
echo "========================================="
echo "测试完成！"
echo "========================================="
echo ""
echo "下一步："
echo "  1. 启动服务：./start.sh"
echo "  2. 访问：http://localhost:3000"
echo "  3. 上传 BP 文件进行测试"
echo ""
echo "如果遇到问题："
echo "  - 查看 BUGFIX_解析异常修复说明.md"
echo "  - 查看 测试指南.md"
echo "  - 查看服务器终端日志"
echo ""
