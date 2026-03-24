#!/bin/bash
# ============================================================
# auto-deploy.sh — 服务器端自动部署脚本
#
# 功能：拉取最新代码并自动部署（支持 Docker / PM2 两种模式）
#
# 用法：
#   bash scripts/auto-deploy.sh              # 自动检测部署方式
#   bash scripts/auto-deploy.sh docker       # 强制使用 Docker
#   bash scripts/auto-deploy.sh pm2          # 强制使用 PM2
#
# 建议配合 crontab 或 webhook 使用：
#   # 每5分钟检查并自动部署（crontab -e 添加）：
#   */5 * * * * cd /opt/NBgarbagebpfilter && bash scripts/auto-deploy.sh >> logs/auto-deploy.log 2>&1
#
#   # 或用 webhook 触发（见 scripts/webhook-server.sh）
# ============================================================

set -e

# 项目根目录（脚本所在目录的上一级）
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

DEPLOY_MODE="${1:-auto}"
BRANCH="${DEPLOY_BRANCH:-main}"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

log()  { echo "$LOG_PREFIX [INFO] $1"; }
warn() { echo "$LOG_PREFIX [WARN] $1"; }
err()  { echo "$LOG_PREFIX [ERROR] $1"; }

# ── 检查是否有新代码 ──
check_updates() {
  log "检查远程更新 (branch: $BRANCH)..."
  git fetch origin "$BRANCH" 2>/dev/null

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")

  if [ "$LOCAL" = "$REMOTE" ]; then
    log "已是最新版本，无需更新。"
    exit 0
  fi

  log "发现新版本: ${REMOTE:0:8} (当前: ${LOCAL:0:8})"
}

# ── 拉取最新代码 ──
pull_code() {
  log "拉取最新代码..."
  git pull origin "$BRANCH" --ff-only || {
    err "Git pull 失败，可能存在本地修改冲突。"
    err "请手动处理: cd $PROJECT_DIR && git status"
    exit 1
  }
  log "代码更新完成。"
}

# ── 备份数据库 ──
backup_db() {
  if [ -f ./data/app.db ]; then
    mkdir -p ./data/backups
    BACKUP_FILE="./data/backups/app_$(date +%Y%m%d_%H%M%S)_auto.db"
    cp ./data/app.db "$BACKUP_FILE"
    log "数据库已备份: $BACKUP_FILE"

    # 保留最近30天的备份
    find ./data/backups -name "*.db" -mtime +30 -delete 2>/dev/null || true
  fi
}

# ── Docker 部署 ──
deploy_docker() {
  log "使用 Docker 方式部署..."

  if docker compose version &>/dev/null 2>&1; then
    COMPOSE="docker compose"
  else
    COMPOSE="docker-compose"
  fi

  $COMPOSE up -d --build

  # 等待健康检查
  for i in $(seq 1 30); do
    if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
      log "Docker 部署成功，服务已就绪。"
      return 0
    fi
    sleep 2
  done

  warn "服务启动较慢，请检查日志: $COMPOSE logs -f app"
}

# ── PM2 部署 ──
deploy_pm2() {
  log "使用 PM2 方式部署..."

  # 安装依赖（如果 package-lock.json 有变化）
  if git diff HEAD~1 --name-only 2>/dev/null | grep -q "package-lock.json\|server/package-lock.json\|client/package-lock.json"; then
    log "检测到依赖变化，重新安装..."
    cd client && npm install && cd ..
    cd server && npm install && cd ..
  fi

  # 重新构建前端
  log "构建前端..."
  cd client && npm run build && cd ..

  # 重启 PM2
  if pm2 describe garbagebpfilter &>/dev/null; then
    pm2 restart garbagebpfilter
    log "PM2 进程已重启。"
  else
    pm2 start ecosystem.config.js --env production
    log "PM2 进程已启动。"
  fi
}

# ── 自动检测部署方式 ──
detect_mode() {
  if [ "$DEPLOY_MODE" != "auto" ]; then
    echo "$DEPLOY_MODE"
    return
  fi

  # 如果有运行中的 Docker 容器，用 Docker
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "bp-filter-app"; then
    echo "docker"
  # 如果有 PM2 进程，用 PM2
  elif pm2 describe garbagebpfilter &>/dev/null 2>&1; then
    echo "pm2"
  # 默认用 Docker（如果 Docker 可用）
  elif command -v docker &>/dev/null; then
    echo "docker"
  else
    echo "pm2"
  fi
}

# ── 主流程 ──
main() {
  log "========== 自动部署开始 =========="

  check_updates
  backup_db
  pull_code

  MODE=$(detect_mode)
  log "部署方式: $MODE"

  case "$MODE" in
    docker) deploy_docker ;;
    pm2)    deploy_pm2 ;;
    *)      err "未知部署方式: $MODE"; exit 1 ;;
  esac

  log "========== 自动部署完成 =========="
}

main
