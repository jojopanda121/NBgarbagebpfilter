# ============================================================
# Dockerfile — GarbageBPFilter v3.0 主应用
# ============================================================

FROM node:20-slim AS frontend-builder

WORKDIR /app

COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

FROM node:20-slim

# 系统依赖：Python fallback + better-sqlite3 构建工具 + OCR/PDF 依赖 + wget 健康检查
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-dev \
        python3-venv \
        build-essential \
        libgl1 \
        libglib2.0-0 \
        tesseract-ocr \
        poppler-utils \
        wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY scripts/requirements.txt ./scripts/
RUN python3 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir -r scripts/requirements.txt

ENV PATH="/app/.venv/bin:$PATH"

COPY package*.json ./
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY scripts/ ./scripts/
COPY --from=frontend-builder /app/client/build ./client/build

RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser && \
    mkdir -p /app/data /app/logs && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD wget -q --spider http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
