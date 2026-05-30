# 北京服务器：接入 Hermes 部署步骤

前提：新加坡 Hermes + shim 已经跑起来（systemd 守护、Tailscale 上线、ufw 锁死）。

## 你需要的两个值

从新加坡服务器上拿：

```bash
# 在新加坡跑：
echo "SHIM_API_KEY = $(grep SHIM_API_KEY ~/nb-hermes-shim/.env | cut -d= -f2)"
echo "Tailscale IP = $(tailscale ip -4)"
```

把两个值记下（API key 不要贴到任何不安全的地方）。

---

## 北京服务器上跑

### 1. 装 Tailscale（如果还没装）

```bash
curl -fsSL https://tailscale.com/install.sh | sh

# 用同一个 reusable auth key（新加坡那次用过的）
sudo tailscale up \
  --authkey=tskey-auth-xxxxxxxx \
  --hostname=beijing-prod \
  --accept-routes

# 测试能不能连到新加坡
tailscale status
ping -c 3 100.76.17.16   # 新加坡的 Tailscale IP
```

### 2. 拉最新代码

```bash
cd <你的项目目录>
git pull origin main
```

新增/改动文件：

- `server/services/hermesClient.js`（新）
- `server/services/agentRuntimeRouter.js`（新）
- `server/services/hermesHealth.js`（新）
- `server/services/hermesToolGateway.js`（新）
- `server/routes/hermesTools.js`（新）
- `server/middleware/redactor.js` / `unredactor.js`（新）
- `server/config/featureFlags.js`（新，默认 `legacy`，需要显式 opt-in）
- `server/db/migrations/052-055_*.sql`（4 条新 migration）
- `server/routes/workspace.js`（改：走 `agentRuntimeRouter`）
- `server/services/pipelineService.js`（改：BP pipeline 走 router）
- `hermes/shim/*`（新加坡用的，北京不用管）

### 3. 跑新 migration

```bash
# 假设你的 migration 是启动时自动跑的，跳过本步
# 如果是手动跑：
node server/db/migrate.js   # 或者你项目里的对应命令
```

期望看到 4 条新表创建成功：

- `runtime_fallback_log`
- `redaction_maps`
- `tool_call_audit`
- `shared_skill_approvals`

### 4. 改 .env（关键 + 必做）

在生产 `.env` 末尾追加（注意把 `<填> ` 替换成真值）：

```env
# ── Hermes Runtime ──────────────────────────────
AGENT_RUNTIME=hermes
HERMES_ENABLED=1
HERMES_FALLBACK_TO_LEGACY=1
HERMES_BASE_URL=http://<新加坡 Tailscale IP>:8642
HERMES_API_KEY=<新加坡 SHIM_API_KEY 的值>
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=180000
HERMES_STREAMING=1
HERMES_HEALTH_CHECK_INTERVAL_MS=30000
HERMES_HEALTH_CACHE_MS=10000
```

`HERMES_FALLBACK_TO_LEGACY=1` 是保险——Hermes 不可达时自动退回原有 3-步链路，
用户看不出来后端切了。

### 5. 重启 Node

```bash
# 看你怎么管：
pm2 restart NBgarbagebpfilter
# 或者
sudo systemctl restart nbgarbagebpfilter
# 或者
# 看 ecosystem.config.js / supervisor 配置
```

### 6. 启动自检

启动日志里应该有这一行：

```
Agent runtime: hermes (Hermes enabled, fallback on)
Hermes endpoint: http://100.x.x.x:8642
```

跑一条手动 health：

```bash
# 从北京本地：
curl -s -H "Authorization: Bearer <SHIM_API_KEY>" http://100.76.17.16:8642/health
```

应该返回 `{"ok":true,"service":"nb-hermes-shim","version":"0.2.0",...}`。

---

## 验收：跑一条真实对话

1. 浏览器登录网站
2. 进任意一个 task 的 workspace
3. 发一条消息："这个项目你怎么看"
4. 在新加坡 `tail -f ~/nb-hermes-shim/shim.log` 应该看到 `hermes call resume=... prompt_len=...`
5. 北京数据库里 `runtime_fallback_log` 表应该有一行 `runtime=hermes, reason=null, phase=pre_stream`
6. 前端拿到的回复应该是 PE/VC 投资负责人语气

如果验收失败，往这几个地方查：

| 症状 | 查哪里 |
|---|---|
| 前端报 "AI 服务暂时不可用" | `runtime_fallback_log` 的 `reason` 列 |
| 前端有回复但风格不对（客服腔） | 走的是 legacy fallback，看 `runtime_fallback_log` |
| Shim 收到请求但 hermes 报错 | 新加坡 `shim.log` 看 `hermes exit N: <msg>` |
| 完全连不上 | `tailscale ping 100.76.17.16` / `curl :8642/health` |

---

## 回滚（如果出问题）

最快回滚：把 `.env` 里 `AGENT_RUNTIME` 改成 `legacy`，重启 node。

```env
AGENT_RUNTIME=legacy
HERMES_ENABLED=0
```

代码本身的 legacy 路径完全保留，回滚秒级生效，不需要 git revert。
