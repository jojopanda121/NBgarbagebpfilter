# NB-Hermes Shim

北京 NBgarbagebpfilter ↔ 新加坡 Hermes 桥。

## 是什么

一个 FastAPI 小服务，部署在 Hermes 所在的新加坡服务器，对外暴露
OpenAI Responses 兼容协议（北京 `server/services/hermesClient.js` 直接说）。
内部 subprocess 调本机 `hermes -z` 命令，自动加载 SOUL/skills/memory/MiniMax。

## 文件

- `main.py` — shim 主程序
- `nb-hermes-shim.service` — systemd unit
- `README.md` — 本文件

## 部署（在新加坡服务器上跑）

```bash
# 1) 工作目录
mkdir -p ~/nb-hermes-shim && cd ~/nb-hermes-shim

# 2) venv
python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q "fastapi==0.115.6" "uvicorn[standard]==0.32.1" "pydantic==2.9.2"

# 3) 拷贝 main.py（从北京 repo 同步过来）

# 4) 生成 .env
KEY=$(openssl rand -hex 32)
umask 077
cat > .env <<EOF
SHIM_API_KEY=$KEY
HERMES_BIN=/home/ubuntu/.local/bin/hermes
HERMES_TIMEOUT_SECONDS=180
HERMES_MODEL_LABEL=hermes-agent
SHIM_HOST=0.0.0.0
SHIM_PORT=8642
EOF
chmod 600 .env

# 5) 装 systemd
sudo cp nb-hermes-shim.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nb-hermes-shim
sudo systemctl status nb-hermes-shim
```

## 自检

```bash
source ~/nb-hermes-shim/.env

# health
curl -sf -H "Authorization: Bearer $SHIM_API_KEY" http://127.0.0.1:8642/health | jq

# non-stream
curl -sf -X POST http://127.0.0.1:8642/v1/responses \
  -H "Authorization: Bearer $SHIM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"你是谁？","stream":false,"conversation":"smoke_001"}' | jq

# 第二次问，验证 session 延续
curl -sf -X POST http://127.0.0.1:8642/v1/responses \
  -H "Authorization: Bearer $SHIM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"我刚问你的是什么？","stream":false,"conversation":"smoke_001"}' | jq
```

第二次响应里应该提到"你是谁"。

## 北京端配置

把 `.env` 加上：

```env
AGENT_RUNTIME=hermes
HERMES_ENABLED=1
HERMES_FALLBACK_TO_LEGACY=1
HERMES_BASE_URL=http://<新加坡-tailscale-ip>:8642
HERMES_API_KEY=<新加坡 .env 里 SHIM_API_KEY 的值>
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=180000
HERMES_STREAMING=1
HERMES_HEALTH_CHECK_INTERVAL_MS=30000
HERMES_HEALTH_CACHE_MS=10000
```

## 已知限制（MVP）

- **假流式**：等 hermes 跑完才一次性 emit delta。真流式 = Phase 2。
- **单租户**：所有用户共享同一个 Hermes 大脑/记忆。多租户隔离 = Phase 2，用 `hermes profile`。
- **session_id 探测**：跑完 `hermes -z` 后读 `~/.hermes/sessions/` 最新文件。
  全局锁保证安全，但首次创建串行（~7s/请求）。
- **不转发 function_call**：Hermes 内部用工具时北京暂时看不到中间步骤。

## 重启 / 查看日志

```bash
sudo systemctl restart nb-hermes-shim
sudo systemctl status nb-hermes-shim
tail -f ~/nb-hermes-shim/shim.log
journalctl -u nb-hermes-shim -f
```

## 重置某个对话的 session

```bash
curl -sf -X DELETE http://127.0.0.1:8642/v1/sessions/<conversation_id> \
  -H "Authorization: Bearer $SHIM_API_KEY"
```
