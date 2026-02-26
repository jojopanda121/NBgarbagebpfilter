# ============================================================
# Dockerfile — GarbageBPFilter v3.0 主应用
#
# 架构变更（v3.0）：
#   - Python 文档提取已移至独立微服务（doc-service），
#     此镜像保留 Python fallback（DOC_SERVICE_URL 未配置时使用本地提取）
#   - SQLite 数据库持久化到 /app/data 目录
#   - better-sqlite3 需要 build 工具
# ============================================================

FROM node:20-slim

# 系统依赖：Python（fallback）+ 构建工具（better-sqlite3 native addon）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip python3-dev \
        build-essential \
        libgl1 \
        libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 依赖（fallback 文档提取）
COPY scripts/requirements.txt ./scripts/
RUN pip3 install --no-cache-dir --break-system-packages \
        -r scripts/requirements.txt

# Node 依赖（利用 Docker 层缓存）
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

RUN cd client && npm install && \
    cd ../server && npm install

# 复制全部源码
COPY . .

# 构建前端
RUN cd client && npm run build

# 创建数据和日志目录
RUN mkdir -p /app/data /app/logs

# 暴露端口（默认 3001）
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 启动后端
CMD ["node", "server/index.js"]
