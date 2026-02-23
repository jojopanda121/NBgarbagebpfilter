# ═══════════════════════════════════════════════════════════
# Stage 1 — 构建 React 前端
# 只需要 Node 和 devDependencies，不会进入最终镜像
# ═══════════════════════════════════════════════════════════
FROM node:20-slim AS frontend-builder

WORKDIR /app

# 先复制 package.json，最大化利用层缓存
COPY client/package*.json ./client/
RUN cd client && npm ci

# 复制源码并构建
COPY client/ ./client/
RUN cd client && npm run build

# ═══════════════════════════════════════════════════════════
# Stage 2 — 生产运行镜像
# 只包含运行时必需的内容，体积最小
# ═══════════════════════════════════════════════════════════
FROM node:20-slim

# 安装系统工具（仅运行时需要）
#   poppler-utils → pdftotext (PDF 文字提取)
#   tesseract-ocr → OCR 识别 (pytesseract)
#   python3 + venv → 运行 scripts/ 下的 Python 脚本
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        tesseract-ocr \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 依赖安装在独立 venv，避免污染系统 Python
COPY scripts/requirements.txt ./scripts/
RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir \
        -r scripts/requirements.txt && \
    /app/.venv/bin/pip install --no-cache-dir akshare

# 让 venv 内的命令优先被找到
ENV PATH="/app/.venv/bin:$PATH"

# 安装服务端 Node 依赖（仅 production，跳过 devDependencies）
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# 复制服务端源码和 Python 脚本
COPY server/ ./server/
COPY scripts/ ./scripts/

# 从 Stage 1 拷贝编译好的前端（不需要 React 构建工具进入此镜像）
COPY --from=frontend-builder /app/client/build ./client/build

# 以非 root 用户运行，减少安全风险
RUN useradd --system --uid 1001 appuser && \
    chown -R appuser /app
USER appuser

EXPOSE 8080

# 健康检查：GET / 返回 < 500 即视为健康
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/',(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js"]
