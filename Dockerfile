# 使用 slim 版本以获得更好的工具兼容性
FROM node:20-slim

# 核心步骤：安装系统级工具
# - python3 + pip: 运行 scripts/ 下的 Python 脚本
# - libgl1 / libglib2.0-0: rapidocr_onnxruntime 和 Pillow 所需的图形库依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip \
        libgl1 \
        libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖（pymupdf / rapidocr_onnxruntime / pillow 等）
COPY scripts/requirements.txt ./scripts/
RUN pip3 install --no-cache-dir --break-system-packages \
        -r scripts/requirements.txt

# 先只复制 package.json，利用 Docker 层缓存加速重复构建
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# 安装 client + server 的所有 Node 依赖
# 注意：这里我们通过 npm install 显式安装，避免 npm run install:all 可能存在的路径问题
RUN cd client && npm install && \
    cd ../server && npm install

# 复制全部源码
COPY . .

# 在容器内现场生成前端 build 文件夹
RUN cd client && npm run build

# 暴露端口（默认 3001）
EXPOSE 3001

# 启动后端，后端会自动读取 client/build/ 并处理 API 请求
CMD ["node", "server/index.js"]
