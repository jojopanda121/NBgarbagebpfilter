#!/bin/bash
# ============================================================
# webhook-server.sh — 轻量级 Webhook 服务器
#
# 监听 GitHub Push 事件，自动触发部署。
# 无需额外依赖，仅需 nc (netcat) 和 bash。
#
# 用法：
#   bash scripts/webhook-server.sh &          # 后台运行
#   WEBHOOK_PORT=9000 bash scripts/webhook-server.sh  # 自定义端口
#
# GitHub 设置：
#   1. 仓库 → Settings → Webhooks → Add webhook
#   2. Payload URL: http://你的服务器IP:9000/deploy
#   3. Content type: application/json
#   4. Secret: 设置一个密钥（与 WEBHOOK_SECRET 环境变量一致）
#   5. 勾选 "Just the push event"
#
# 安全提示：
#   - 建议配合防火墙，仅允许 GitHub IP 访问 webhook 端口
#   - GitHub IP 段: https://api.github.com/meta
# ============================================================

PORT="${WEBHOOK_PORT:-9000}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[webhook] 监听端口 $PORT，项目目录: $PROJECT_DIR"

while true; do
  # 用 nc 监听一次 HTTP 请求
  RESPONSE="HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK"

  REQUEST=$(echo -e "$RESPONSE" | nc -l -p "$PORT" -q 1 2>/dev/null || echo -e "$RESPONSE" | nc -l "$PORT" 2>/dev/null)

  # 检查是否是 deploy 请求
  if echo "$REQUEST" | head -1 | grep -q "/deploy"; then
    echo "[webhook] $(date '+%Y-%m-%d %H:%M:%S') 收到部署请求，开始执行..."
    bash "$PROJECT_DIR/scripts/auto-deploy.sh" >> "$PROJECT_DIR/logs/auto-deploy.log" 2>&1 &
    echo "[webhook] 部署任务已在后台启动。"
  fi
done
