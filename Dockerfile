# ============================================================
# Dockerfile — GarbageBPFilter v3.0 主应用
# ============================================================

FROM node:20-slim AS frontend-builder

# 中国镜像加速：构建时由 docker-compose 从 .env 透传 build-arg（默认走官方 npm 源）
ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app

COPY client/package*.json ./client/
# react-snap 预渲染依赖 puppeteer，npm ci 时会下载 ~150MB Chromium，国内网络常超时/被墙。
# 国内构建设 SKIP_CHROMIUM=1 跳过（react-snap 预渲染降级，不影响构建产物）；默认 0，海外/CI 不受影响。
ARG SKIP_CHROMIUM=0
RUN cd client && \
    if [ "$SKIP_CHROMIUM" = "1" ]; then export PUPPETEER_SKIP_DOWNLOAD=1 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true; fi && \
    npm ci --registry="$NPM_REGISTRY"

COPY client/ ./client/
RUN cd client && npm run build

FROM node:20-slim

# ── 中国镜像加速（CN_MIRROR=1 时启用，默认 0，不影响海外/CI 构建）──
# 由 docker-compose 从 .env 透传：apt 切腾讯云镜像，npm/pip 由下面两个源指定。
ARG CN_MIRROR=0
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PIP_INDEX=https://pypi.org/simple

# Debian bookworm 源切腾讯云镜像（deb822 .sources 优先，回退旧 sources.list）
RUN if [ "$CN_MIRROR" = "1" ]; then \
      sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
      sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    fi

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
    /app/.venv/bin/pip install --no-cache-dir -i "$PIP_INDEX" -r scripts/requirements.txt

ENV PATH="/app/.venv/bin:$PATH"

COPY package*.json ./
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev --registry="$NPM_REGISTRY"

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
