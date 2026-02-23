# 使用 slim 版本以获得更好的工具兼容性
FROM node:20-slim

# 核心步骤：安装系统级工具
# - poppler-utils: pdftotext（PDF 文字提取）
# - tesseract-ocr: OCR 识别（pytesseract 依赖）
# - python3 + pip: 运行 scripts/ 下的 Python 脚本
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip \
        tesseract-ocr \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖（pymupdf / pytesseract / pdf2image / akshare 等）
COPY scripts/requirements.txt ./scripts/
RUN pip3 install --no-cache-dir --break-system-packages \
        -r scripts/requirements.txt && \
    pip3 install --no-cache-dir --break-system-packages akshare

# 先只复制 package.json，利用 Docker 层缓存加速重复构建
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
# 安装 client + server 的所有 Node 依赖
RUN npm run install:all

# 复制全部源码
COPY . .
# 在容器内现场生成前端 build 文件夹
RUN cd client && npm run build

EXPOSE 8080
# 启动后端，后端会自动读取 client/build/ 并处理 API 请求
CMD ["node", "server/index.js"]
