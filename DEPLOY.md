# GarbageBPFilter 腾讯云部署指南

> 适用版本：`package.json` v3.0.0 · 数据库迁移到 `050_vip_grants_audit.sql`
> 部署方式：**Docker（推荐）** / PM2（备选）

---

## 0. 一句话总结

代码全部容器化，宿主机只挂载 `./data`、`./logs`、`./nginx-certs` 三个目录。**只要不删 `./data`、不加 `-v` 参数，数据库永远不会丢。** 每次更新 = git pull + 重建镜像，迁移系统自动跑增量 SQL，绝不重置已有数据。

---

## 1. 数据安全的三条不可变规则

1. **数据库位置** ── `./data/app.db`（宿主机），通过 `./data:/app/data` 挂载进容器。`./data` 已在 `.gitignore` 中，git 操作不会动它。
2. **迁移系统** ── `server/db/migrations/` 下 51 个增量 SQL（000–050），启动时自动跑未执行过的，**只前进不回退**，已有数据不动。所有迁移要么 `CREATE TABLE IF NOT EXISTS`、要么 `ALTER TABLE ADD COLUMN`，没有 `DROP TABLE` 或无 `WHERE` 的 `DELETE`。
3. **Docker 卷绑定** ── `docker-compose.yml` 用的是 bind mount（宿主机目录直挂），不是匿名 volume。**`docker-compose down` 安全，`docker-compose down -v` 危险**（`-v` 会删除任何匿名卷）。

---

## 2. 系统要求

| 项 | 要求 |
| --- | --- |
| 操作系统 | Linux（Ubuntu 20.04+ / CentOS 7+ / 腾讯云轻量应用服务器均可） |
| CPU | ≥ 2 核（应用 2 核 + doc-service 1.5 核） |
| 内存 | ≥ 4 GB（应用 2GB 上限、doc-service 1.5GB 上限） |
| 磁盘 | ≥ 20 GB（镜像 + 数据库 + 备份 + 日志） |
| Docker | ≥ 20.10，含 `docker-compose` 或 `docker compose` 插件 |
| 端口 | 80 / 443（Nginx）；3001 默认只绑 `127.0.0.1`，不直接对外 |

安装 Docker（如未装）：
```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
```

---

## 3. 环境变量

复制模板：
```bash
cp .env.example .env
```

### 3.1 生产环境**必填**（缺失或不合法 → 启动直接 `exit(1)`）

| 变量 | 校验规则 | 说明 |
| --- | --- | --- |
| `MINIMAX_API_KEY` | 不为空 | MiniMax LLM API key |
| `JWT_SECRET` | 长度 ≥ 32，不含 "请修改 / change me / placeholder / example" 等占位文案 | JWT 签名密钥，用 `openssl rand -hex 32` 生成 |
| `ALLOWED_ORIGINS` | 不为空、**不能是 `*`** | CORS 白名单，逗号分隔多个域名 |

> 用 `bash deploy.sh`（首次部署）会自动生成合规的 `JWT_SECRET` 并提示填入其余两项。

### 3.2 常用可选项

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3001` | 应用监听端口 |
| `APP_BIND_HOST` | `127.0.0.1` | 应用端口宿主机绑定地址；**对外裸暴露请改成 `0.0.0.0`，但建议保持默认 + 走 Nginx** |
| `DB_PATH` | `./data/app.db` | SQLite 文件路径（容器内为 `/app/data/app.db`） |
| `JWT_EXPIRES_IN` | `12h` | Token 有效期 |
| `DEFAULT_FREE_QUOTA` | `3` | 新用户注册赠送的分析次数 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | 启动时自动创建/升级该账号为管理员（密码 ≥ 6 位） |
| `DOC_SERVICE_URL` | – | 文档提取微服务地址；Docker 部署时由 compose 自动设为 `http://doc-service:8001`，**不需要在 .env 里填** |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | `300000` (5 min) | 优雅关闭最大等待时间，与 PM2 `kill_timeout` 对齐 |

### 3.3 LLM / 搜索（按需）

| 变量 | 用途 |
| --- | --- |
| `MINIMAX_MODEL` | 默认模型名，默认 `MiniMax-M2.7` |
| `MINIMAX_MODEL_HEAVY` | 重型任务（IC 问题、Deck）模型 |
| `MINIMAX_MODEL_LIGHT` | 轻型任务（一页纸、快照）模型 |
| `MINIMAX_CODE_PLAN_KEY` / `MINIMAX_CODING_API_KEY` | 启用 MiniMax 内置 `web_search` 工具的 token |
| `MINIMAX_API_HOST` | 默认 `https://api.minimaxi.com`（国内 Token Plan）。**不要带 `/anthropic` 后缀** |
| `MINIMAX_IMAGE_MODEL` | 默认 `image-01`，图片生成 |
| `MINIMAX_SEARCH_REGION` | 默认 `global` |

### 3.4 第三方集成（按需）

| 变量组 | 用途 |
| --- | --- |
| `QCC_API_KEY` | 企查查 Agent，企业追踪数据源 |
| `TENCENT_SES_*`（SECRET_ID/SECRET_KEY/FROM_EMAIL/REGION/TEMPLATE_ID） | 腾讯云 SES 邮件验证码（发信域名需在腾讯云 SES 控制台验证） |
| `TENCENT_SMS_*` | 腾讯云短信验证码（备用通道） |
| `OSS_*`（ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY） | 对象存储（当前代码已留接口但未启用） |

### 3.5 PII 加密（可选高级特性）

| 变量 | 说明 |
| --- | --- |
| `ENABLE_PII_ENCRYPTION` | `1` 启用；启用后下面两项必填且校验长度 |
| `ENCRYPTION_KEY` | 64 位十六进制（即 32 字节 AES-256 key）；生成：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PII_SALT` | 至少 16 字符随机串，用于手机/邮箱 SHA-256 hash 加盐 |

### 3.6 仅本地开发用，**生产严禁开启**

| 变量 | 行为 |
| --- | --- |
| `ALLOW_ANON_ANALYZE` | `1` + `NODE_ENV !== production` 时，允许 `/api/analyze` 匿名访问。生产环境即使误设也会被忽略。 |

---

## 4. 首次部署

### 方式 A：一键脚本（推荐）

```bash
git clone <repo> /opt/NBgarbagebpfilter
cd /opt/NBgarbagebpfilter

bash deploy.sh
# 脚本会交互式询问：
#   - MiniMax API Key
#   - 管理员用户名 / 密码（≥6位）
#   - 前端域名（用于 ALLOWED_ORIGINS，可跳过）
# 自动：生成 JWT_SECRET、写 .env、创建 ./data ./logs ./nginx-certs、docker-compose up -d --build、轮询 /api/health
```

完成后访问 `http://<服务器内网IP>:3001/api/health`（默认仅本地回环可达，外网走 Nginx）。

### 方式 B：手动 Docker

```bash
cd /opt/NBgarbagebpfilter

cp .env.example .env
# 编辑 .env，至少填上 MINIMAX_API_KEY / JWT_SECRET / ALLOWED_ORIGINS / ADMIN_USERNAME / ADMIN_PASSWORD

mkdir -p ./data ./logs ./data/backups ./nginx-certs

# 仅启动应用 + doc-service（不含 Nginx，不含定时备份）
docker-compose up -d --build

# 或：包含 Nginx + 定时备份（生产推荐）
docker-compose --profile production up -d --build
```

### 启用 HTTPS（生产推荐）

```bash
# 将证书放入：
./nginx-certs/fullchain.pem
./nginx-certs/privkey.pem

# 编辑 nginx.conf，取消 HTTPS server 块的注释（默认仅 HTTP）
# 重启 nginx：
docker-compose restart nginx
```

`nginx.conf` 已设：`client_max_body_size 100m`、HSTS、X-Frame-Options DENY、Permissions-Policy 等安全头。

---

## 5. 日常更新部署

### 5.1 一键更新（推荐）

```bash
cd /opt/NBgarbagebpfilter
bash deploy.sh update
```

脚本会依次：
1. 把 `./data/app.db` 复制到 `./data/backups/app_<时间戳>_pre_update.db`
2. `git pull`
3. `docker-compose up -d --build`（数据卷不动，迁移自动跑）

### 5.2 手动更新（更可控，推荐先用这条）

```bash
cd /opt/NBgarbagebpfilter

# 1. 备份（冷拷 + 热备双保险）
mkdir -p ./data/backups
cp ./data/app.db ./data/backups/app.db.cold_$(date +%Y%m%d_%H%M%S)
sqlite3 ./data/app.db ".backup ./data/backups/app.db.hot_$(date +%Y%m%d_%H%M%S).db"

# 2. 给当前镜像打 rollback tag（关键！）
IMG=$(docker-compose images -q app | head -1)
docker tag "$IMG" bp-filter-app:rollback-$(date +%Y%m%d)
docker tag "$IMG" bp-filter-app:last-known-good
# doc-service 同理
DOC=$(docker-compose images -q doc-service | head -1)
docker tag "$DOC" bp-filter-doc:rollback-$(date +%Y%m%d)
docker tag "$DOC" bp-filter-doc:last-known-good

# 3. 记录当前 git 提交（回滚用）
git rev-parse HEAD > .rollback-commit
git rev-parse --abbrev-ref HEAD > .rollback-branch

# 4. 拉取新代码
git fetch origin
git pull origin <你的分支>           # 通常是 main

# 5. 重建并启动（不删卷！）
docker-compose up -d --build

# 6. 观察迁移与启动日志
docker-compose logs -f app | grep -iE "migration|warn|error"
# Ctrl+C 退出

# 7. 健康检查
curl -sf http://127.0.0.1:3001/api/health && echo OK
```

### 5.3 回滚

如果新版本不好用：

```bash
cd /opt/NBgarbagebpfilter

# 1. 停服（不加 -v）
docker-compose down

# 2. 代码切回旧分支
git checkout $(cat .rollback-branch)

# 3. 数据库回到部署前
cp ./data/backups/app.db.cold_<时间戳> ./data/app.db

# 4. 把旧镜像 tag 顶回 latest
docker tag bp-filter-app:last-known-good $(docker-compose images -q app | head -1) 2>/dev/null || \
  docker tag bp-filter-app:last-known-good bp-filter-app:latest

# 5. 用现有镜像启动（注意：不带 --build）
docker-compose up -d

curl -sf http://127.0.0.1:3001/api/health && echo "ROLLBACK OK"
```

---

## 6. 服务架构（docker-compose.yml）

| 服务 | 镜像 / 构建 | 端口 | Profile | 资源上限 | 健康检查 |
| --- | --- | --- | --- | --- | --- |
| `app` | 本地 `Dockerfile`（Node 20-slim） | `${APP_BIND_HOST:-127.0.0.1}:${PORT:-3001}:3001` | 默认 | CPU 2 / RAM 2GB | `wget /api/health` 每 30s |
| `doc-service` | `./doc-service/Dockerfile`（Python 3.11-slim） | 仅容器网络 `8001`，**不对宿主机暴露** | 默认 | CPU 1.5 / RAM 1.5GB | Python urllib 探活 |
| `nginx` | `nginx:alpine` | `80:80`, `443:443` | **production** | 无 | 无 |
| `backup` | Alpine 3.19 + sqlite | – | **production** | 无 | cron 每天 03:00 备份，自动清理 30 天前 |

启动命令：
```bash
docker-compose up -d                               # app + doc-service
docker-compose --profile production up -d --build  # 全部（含 Nginx + 定时备份）
```

---

## 7. 数据库迁移说明

启动时 `server/db/index.js` 会扫描 `server/db/migrations/`，按文件名顺序跑未执行过的 SQL。已执行的会记录在 `migrations` 表里，**不会重复跑**。

当前迁移分组（仅供参考）：

- `000–007` 基础表：users / tokens / roles / settings / verification_codes
- `008–025` 业务字段：tasks 增强、推荐、软删除、workspace、onepager 缓存
- `026–034` 数据飞轮：agent_runs / projects_datalake / founders_datalake / agent_results
- `035–044` 工作台 v2：workspace_projects / project_versions / project_notes / revoked_tokens / 索引优化 / skill_runs / teaser_shares
- `045–050` VIP + 制度记忆 + 证据库：VIP grants / institutional_memory / structured_extracts / project_evidence_store / vip_grants_audit

**所有迁移都是新增表或加列，零破坏性。** 老代码遇到多余的新表也不会报错（select 不查就行）。

---

## 8. 数据库备份与恢复

### 自动备份（启用 `production` profile 后生效）

定时任务在 `backup` 容器内：
- 每天凌晨 3:00 执行 `sqlite3 .backup`（在线热备，不锁库）
- 输出到宿主机 `./data/backups/app_YYYYMMDD_HHMMSS.db`
- 备份文件 < 1KB 自动判定失败并删除
- 30 天前的备份自动清理
- 日志：`./data/backups/backup.log`

### 手动备份

```bash
# 冷拷
cp ./data/app.db ./data/backups/manual_$(date +%Y%m%d_%H%M%S).db

# 在线热备（推荐，不会锁库）
sqlite3 ./data/app.db ".backup ./data/backups/hot_$(date +%Y%m%d_%H%M%S).db"
```

或：`bash deploy.sh backup`

### 恢复

```bash
docker-compose down                  # 不加 -v
cp ./data/backups/app_<时间戳>.db ./data/app.db
docker-compose up -d
```

---

## 9. 兑换码（线下购买模式）

本系统**不接入在线支付**，使用线下兑换码：

1. 用户线下联系管理员购买
2. 管理员在后台 `兑换码管理` 生成（或用脚本批量生成）
3. 用户在 `设置 > 兑换额度` 输入兑换码

批量生成命令：
```bash
# Docker 部署
docker exec bp-filter-app node scripts/generate-tokens.js --count 10 --quota 5

# PM2 部署
node scripts/generate-tokens.js --count 10 --quota 5
```

默认有效期 30 天，可通过 `--expires` 参数调整。

---

## 10. PM2 替代方案（不推荐，但保留）

如果不能用 Docker，可以走 PM2：

```bash
# 1. 装依赖（包括 Python 端）
npm run install:all     # 等价于：client npm i + server npm i + scripts/requirements.txt + doc-service/requirements.txt

# 2. 构建前端
npm run build:client

# 3. 启动
npm start               # 等价于：pm2 start ecosystem.config.js --env production
```

`ecosystem.config.js` 关键参数：
- 应用进程：`./server/index.js`，Node 堆上限 1400 MB，端口 `8080`（注意：与 Docker 默认 3001 不同）
- doc-service：`python3 -m uvicorn main:app --host 0.0.0.0 --port 8001`
- 优雅关闭：300 秒
- 日志：`./logs/server-*.log`、`./logs/doc-service-*.log`，50MB 滚动、保留 14 天

⚠️ 走 PM2 时端口默认是 **8080**，不是 3001；记得反向代理改对。

---

## 11. 禁止操作清单

| 操作 | 后果 | 替代方案 |
| --- | --- | --- |
| `docker-compose down -v` | 删除所有 docker 卷 | `docker-compose down`（不加 -v） |
| `rm -rf ./data` | 清空数据库 | 永远不要碰 `./data/app.db` |
| `rm -rf /opt/NBgarbagebpfilter` | 删全部 | `git pull` + `docker-compose up -d --build` |
| 手动 `INSERT/UPDATE` `migrations` 表 | 跳过迁移 → schema 损坏 | 让系统自己跑 |
| `docker volume prune` | 可能清掉数据 | 仅在确认无关卷时使用 |
| `ALLOWED_ORIGINS=*` | 启动会被拒绝 | 列出真实域名 |
| `JWT_SECRET=请修改` 等占位 | 启动会被拒绝 | `openssl rand -hex 32` |
| 把 `APP_BIND_HOST=0.0.0.0` 同时不用 Nginx | 应用直接裸暴露公网 | 加 Nginx，或腾讯云安全组只放 80/443 |

---

## 12. 常见排查

| 现象 | 检查 |
| --- | --- |
| 启动立刻 exit(1) | 看日志最后一行 `[BOOT]` / `[Security]`：通常是 `JWT_SECRET`、`MINIMAX_API_KEY`、`ALLOWED_ORIGINS` 校验失败 |
| `/api/health` 503 | 数据库无法访问，多半是 `./data` 权限问题。`chown -R 999:999 ./data ./logs` 或 `chmod -R u+rwX ./data ./logs` |
| 上传 BP 报「文档解析失败」 | doc-service 没起来或健康检查没通过：`docker-compose logs doc-service`。本地 PM2 模式下还可能是 Python 依赖缺失：`npm run install:python` |
| 邮件验证码发不出去 | 检查 `TENCENT_SES_*` 五项是否齐全，发信域名是否已在腾讯云 SES 控制台验证 |
| 浏览器跨域被拦截 | `.env` 中 `ALLOWED_ORIGINS` 是否包含**完整 scheme** `https://your-domain.com`（不是 `your-domain.com`） |
| 重启后管理员密码没生效 | `.env` 里 `ADMIN_USERNAME/ADMIN_PASSWORD` 同时存在时，启动会创建/更新管理员；只改其中一个不会触发 |
| Nginx 502 | 应用没起来或健康检查没过；`docker-compose ps` 看 app 状态是不是 `healthy` |

---

## 13. 给腾讯云 AI 助手的指令模板

如果让腾讯云控制台的 AI 帮你执行更新：

```
请按以下步骤更新 GarbageBPFilter，绝不要删除任何数据：

1. cd /opt/NBgarbagebpfilter
2. mkdir -p ./data/backups
3. cp ./data/app.db ./data/backups/app.db.before_$(date +%Y%m%d_%H%M%S)
4. git fetch origin && git pull
5. docker-compose up -d --build
6. docker-compose ps
7. curl -sf http://127.0.0.1:3001/api/health

严禁执行：
- docker-compose down -v
- rm -rf ./data 或 rm -rf 整个项目目录
- 直接覆盖 ./data/app.db
- 修改 server/db/migrations/ 下任何已有 SQL 文件
```
