# ============================================================
# Dockerfile — GarbageBPFilter v2.0
# Multi-stage build: React frontend + Node.js backend + Python scripts
# ============================================================

# ── Stage 1: Build React frontend ──────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY client/package*.json ./client/
RUN cd client && npm install --legacy-peer-deps

COPY client/ ./client/
RUN cd client && npm run build

# ── Stage 2: Production image ───────────────────────────────
FROM node:20-slim

WORKDIR /app

# Install system dependencies for Python PDF processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    tesseract-ocr \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# Install Python packages
COPY scripts/requirements.txt ./scripts/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
      -r scripts/requirements.txt \
    && pip3 install --no-cache-dir --break-system-packages akshare

# Install Node.js server dependencies (production only)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy source
COPY server/ ./server/
COPY scripts/ ./scripts/

# Copy built React app from stage 1
COPY --from=frontend-builder /app/client/build ./client/build

EXPOSE 8080

CMD ["node", "server/index.js"]
