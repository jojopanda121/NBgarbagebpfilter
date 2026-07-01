FROM python:3.11-slim

# ── 中国镜像加速（CN_MIRROR=1 时启用，默认 0）──
# 由 docker-compose 从 .env 透传 build-arg。
ARG CN_MIRROR=0
ARG PIP_INDEX=https://pypi.org/simple

RUN if [ "$CN_MIRROR" = "1" ]; then \
      sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
      sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    fi

# OCR 相关系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -i "$PIP_INDEX" -r requirements.txt

COPY *.py ./

# 以非 root 用户运行（安全加固）
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
