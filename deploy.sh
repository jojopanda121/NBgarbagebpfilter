#!/bin/bash
# ============================================================
# deploy.sh — GarbageBPFilter 一键部署脚本
#
# 用法：
#   首次部署：  bash deploy.sh
#   更新部署：  bash deploy.sh update
#   查看状态：  bash deploy.sh status
#   查看日志：  bash deploy.sh logs
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检测系统和 Docker
check_prerequisites() {
  if ! command -v docker &>/dev/null; then
    error "Docker 未安装。请先安装 Docker："
    echo "  curl -fsSL https://get.docker.com | sh"
    exit 1
  fi

  if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose 未安装。"
    exit 1
  fi

  # 检测 docker compose 命令格式
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE="docker compose"
  else
    COMPOSE="docker-compose"
  fi
}

# 生成随机字符串
random_string() {
  cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w "${1:-32}" | head -n 1
}

# 首次部署：交互式生成 .env
setup_env() {
  if [ -f .env ]; then
    warn ".env 文件已存在，跳过配置向导。"
    return
  fi

  info "开始配置环境变量..."
  cp .env.example .env

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  GarbageBPFilter 部署配置向导"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # MiniMax API Key
  echo ""
  read -p "请输入 MiniMax API Key (必填): " MINIMAX_KEY
  if [ -z "$MINIMAX_KEY" ]; then
    error "MiniMax API Key 不能为空！"
    exit 1
  fi
  sed -i "s|MINIMAX_API_KEY=.*|MINIMAX_API_KEY=${MINIMAX_KEY}|" .env

  # JWT Secret
  JWT=$(random_string 48)
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  info "JWT Secret 已自动生成"

  # Serper API Key (可选)
  echo ""
  read -p "请输入 Serper API Key (可选，回车跳过): " SERPER_KEY
  if [ -n "$SERPER_KEY" ]; then
    sed -i "s|SERPER_API_KEY=.*|SERPER_API_KEY=${SERPER_KEY}|" .env
  fi

  # 管理员账号
  echo ""
  read -p "管理员用户名 (默认 admin): " ADMIN_USER
  ADMIN_USER=${ADMIN_USER:-admin}
  read -s -p "管理员密码 (至少6位): " ADMIN_PASS
  echo ""
  if [ ${#ADMIN_PASS} -lt 6 ]; then
    error "密码不能少于6位！"
    exit 1
  fi

  # 追加管理员配置
  echo "" >> .env
  echo "# 管理员账号" >> .env
  echo "ADMIN_USERNAME=${ADMIN_USER}" >> .env
  echo "ADMIN_PASSWORD=${ADMIN_PASS}" >> .env

  # CORS 配置
  echo ""
  read -p "前端域名 (如 https://bp.example.com，回车跳过): " FRONTEND_DOMAIN
  if [ -n "$FRONTEND_DOMAIN" ]; then
    echo "ALLOWED_ORIGINS=${FRONTEND_DOMAIN}" >> .env
  fi

  info "配置完成！"
}

# 备份数据库
backup_db() {
  if [ -f ./data/app.db ]; then
    mkdir -p ./data/backups
    BACKUP_FILE="./data/backups/app_$(date +%Y%m%d_%H%M%S)_pre_update.db"
    cp ./data/app.db "$BACKUP_FILE"
    info "数据库已备份到: ${BACKUP_FILE}"
  fi
}

# 部署
deploy() {
  info "开始构建和部署..."
  $COMPOSE up -d --build
  info "部署完成！等待服务启动..."

  # 等待健康检查
  for i in $(seq 1 30); do
    if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
      echo ""
      info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      info "  部署成功！"
      info "  访问: http://localhost:3001"
      info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      return 0
    fi
    printf "."
    sleep 2
  done

  warn "服务可能仍在启动中，请查看日志："
  echo "  $COMPOSE logs -f app"
}

# 更新部署
update() {
  info "开始更新部署..."

  # 1. 自动备份数据库
  backup_db

  # 2. 拉取最新代码（如果是 git 仓库）
  if [ -d .git ]; then
    info "拉取最新代码..."
    git pull || warn "Git pull 失败，使用本地代码继续"
  fi

  # 3. 重新构建和部署（数据库不会被删除，迁移系统只做增量）
  info "重新构建并部署（数据库保留，仅运行新迁移）..."
  $COMPOSE up -d --build

  info "更新完成！"
  info "数据库安全：迁移系统仅执行 CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN"
  info "所有历史数据已完整保留。"
}

# 查看状态
status() {
  $COMPOSE ps
  echo ""
  if curl -sf http://localhost:3001/api/health 2>/dev/null | python3 -m json.tool 2>/dev/null; then
    info "服务运行正常"
  else
    warn "服务可能未启动"
  fi
}

# 查看日志
logs() {
  $COMPOSE logs -f --tail=100 app
}

# ── 主逻辑 ──
check_prerequisites

case "${1:-}" in
  update)
    update
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  backup)
    backup_db
    ;;
  *)
    # 首次部署
    setup_env
    deploy
    ;;
esac
