# Hermes 端配置（新加坡服务器）

本目录的文件是新加坡 Hermes 实例需要的 profile 配置。北京 repo 是 source of truth，通过 scp/git 同步到新加坡。

## 目录结构

```
hermes/
├── SOUL.md            # host 投资负责人系统人格（Phase 1 已就绪）
├── roles/             # 专家角色 instructions（Phase 2 添加）
│   ├── market_deal.md
│   ├── finance_valuation.md
│   └── product_team_risk.md
├── skills/            # 复用 skill / playbook（Phase 2 添加）
└── config.example.yaml
```

## Phase 1 部署步骤

### 1. 同步 SOUL 到新加坡 Hermes 默认 profile

```bash
# 在北京本地
scp hermes/SOUL.md sg-server:~/.hermes/SOUL.md
```

### 2. 配置 Hermes API server（如果还没起）

在新加坡服务器 `~/.hermes/config.yaml` 确保：

```yaml
api_server:
  host: 0.0.0.0           # 监听所有接口（Tailscale 会限制访问源）
  port: 8642
  key: <强随机串>          # 北京要用同一个值作 HERMES_API_KEY
```

启动 Hermes API server（按 Hermes 文档命令，通常类似）：
```bash
hermes api-server start
```

### 3. 验证从北京能调通

在北京服务器：
```bash
# 拿到新加坡的 Tailscale IP（在新加坡机上跑 tailscale ip -4）
SG_IP=100.x.x.x
HERMES_API_KEY=<上面那个强随机串>

curl -H "Authorization: Bearer $HERMES_API_KEY" http://$SG_IP:8642/health
# 期望: 200 OK
```

### 4. 配置北京环境变量

把以下加到北京 `.env`：

```env
AGENT_RUNTIME=hermes
HERMES_ENABLED=1
HERMES_FALLBACK_TO_LEGACY=1
HERMES_BASE_URL=http://100.x.x.x:8642
HERMES_API_KEY=<强随机串>
HERMES_MODEL=hermes-agent
HERMES_TIMEOUT_MS=120000
HERMES_STREAMING=1
HERMES_HEALTH_CHECK_INTERVAL_MS=30000
HERMES_HEALTH_CACHE_MS=10000
HERMES_SHARED_LEARNING=off
```

### 5. 启动北京后端，验收

```bash
# 北京
npm start

# 期望启动日志：
#   Agent runtime: hermes (Hermes enabled, fallback on)
#   Hermes endpoint: http://100.x.x.x:8642
```

打开 workspace，发一条消息——主路径应该走 Hermes。

### 6. fallback 演练

```bash
# 在新加坡 kill Hermes 进程，或在北京 tailscale down
# 再发一条消息，期望前端无感切到 legacy
# 检查 runtime_fallback_log 表：
sqlite3 data/app.db "SELECT runtime, reason, phase, target, latency_ms, created_at FROM runtime_fallback_log ORDER BY id DESC LIMIT 10;"
```

## Phase 2/3 todo

- [ ] Phase 2 W1: 加 `roles/*.md`（市场 / 财务 / 产品&风险）
- [ ] Phase 2 W2: 加初始 skill 集（task_decomposition / red_flag_scan / memo_generation 等）
- [ ] Phase 2 W2: 反向工具调用走 `POST /api/hermes/tools/call` —— 在 Hermes profile 注册北京 gateway URL 作为 function endpoint
- [ ] Phase 3: 加 `memory_curator` 和 `skill_reviewer` skill
