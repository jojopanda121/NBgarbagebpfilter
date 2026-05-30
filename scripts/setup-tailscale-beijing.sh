#!/usr/bin/env bash
# ============================================================
# scripts/setup-tailscale-beijing.sh
#
# 北京服务器安装 Tailscale 并加入 tailnet，用于连接新加坡 Hermes。
#
# 用法：
#   1. 先在 https://login.tailscale.com 创建 auth key（建议 reusable + ephemeral=false）
#   2. ssh 到北京服务器
#   3. sudo TAILSCALE_AUTHKEY=tskey-auth-xxx bash setup-tailscale-beijing.sh
#
# 完成后：
#   - tailscale ip -4 会显示北京机器的 100.x.x.x 私有 IP
#   - 在 admin 面板能看到新加坡和北京两台机器
#   - 在北京 curl 新加坡 Tailscale IP 的 Hermes 端口应该返回 200
# ============================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "❌ 必须以 root 运行（sudo bash $0）" >&2
  exit 1
fi

if [[ -z "${TAILSCALE_AUTHKEY:-}" ]]; then
  echo "❌ 缺少环境变量 TAILSCALE_AUTHKEY" >&2
  echo "用法: sudo TAILSCALE_AUTHKEY=tskey-auth-xxx bash $0" >&2
  exit 1
fi

echo "==> 检测系统..."
if ! command -v lsb_release >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y lsb-release curl gnupg
fi

DISTRO=$(lsb_release -is | tr '[:upper:]' '[:lower:]')
CODENAME=$(lsb_release -cs)
echo "    系统: $DISTRO $CODENAME"

echo "==> 安装 Tailscale 官方源..."
curl -fsSL "https://pkgs.tailscale.com/stable/${DISTRO}/${CODENAME}.noarmor.gpg" \
  | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL "https://pkgs.tailscale.com/stable/${DISTRO}/${CODENAME}.tailscale-keyring.list" \
  | tee /etc/apt/sources.list.d/tailscale.list >/dev/null

echo "==> 安装 tailscale..."
apt-get update -y
apt-get install -y tailscale

echo "==> 启动并加入 tailnet..."
systemctl enable --now tailscaled
tailscale up \
  --authkey "$TAILSCALE_AUTHKEY" \
  --hostname "nb-beijing" \
  --accept-routes \
  --ssh=false

echo
echo "==> 完成。当前 Tailscale 状态："
tailscale status
echo
echo "==> 本机 Tailscale IP："
tailscale ip -4
echo
echo "下一步："
echo "  1. 拿到新加坡 Hermes 机器的 Tailscale IP（在新加坡机上跑 tailscale ip -4）"
echo "  2. 设置环境变量:"
echo "     HERMES_BASE_URL=http://<sg-tailscale-ip>:8642"
echo "  3. 验证连通:"
echo "     curl -H 'Authorization: Bearer \$HERMES_API_KEY' http://<sg-tailscale-ip>:8642/health"
