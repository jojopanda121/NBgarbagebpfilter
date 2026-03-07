# GarbageBPFilter 腾讯云部署指南

## 核心原则：数据库安全

SQLite 数据库存储在 `./data/app.db`，与代码目录分离。更新代码时**绝对不会覆盖数据库**，只要遵循以下规则：

1. **数据库路径**: `./data/` 目录已在 `.gitignore` 中，不会被 git 操作影响
2. **Docker 持久化**: `docker-compose.yml` 通过 `./data:/app/data` 挂载宿主机目录，容器重建不影响数据
3. **迁移系统**: 数据库使用增量迁移（`server/db/migrations/`），每次启动自动运行未执行的迁移，不会重置已有数据

---

## 腾讯云更新代码操作步骤

### 方式一：Docker 部署（推荐）

```bash
# 1. 进入项目目录
cd /path/to/NBgarbagebpfilter

# 2. 备份数据库（重要！每次更新前必做）
cp ./data/app.db ./data/app.db.bak.$(date +%Y%m%d_%H%M%S)

# 3. 拉取最新代码（不会影响 ./data/ 目录）
git pull origin main

# 4. 重新构建并启动（--build 重建镜像，数据在宿主机 ./data/ 不受影响）
docker-compose up -d --build

# 5. 检查服务状态
docker-compose ps
docker-compose logs -f app
```

### 方式二：PM2 部署

```bash
# 1. 进入项目目录
cd /path/to/NBgarbagebpfilter

# 2. 备份数据库
cp ./data/app.db ./data/app.db.bak.$(date +%Y%m%d_%H%M%S)

# 3. 拉取最新代码
git pull origin main

# 4. 安装依赖
npm run install:all

# 5. 重新构建前端
cd client && npm run build && cd ..

# 6. 重启服务
pm2 restart ecosystem.config.js
```

---

## 腾讯云 AI 操作指令模板

如果你需要指导腾讯云 AI 助手执行更新，可以直接发送以下指令：

```
请按以下步骤更新我的 GarbageBPFilter 应用：

1. 进入项目目录：cd /path/to/NBgarbagebpfilter
2. 备份数据库：cp ./data/app.db ./data/app.db.bak.$(date +%Y%m%d_%H%M%S)
3. 拉取最新代码：git pull origin main
4. 重新构建并启动：docker-compose up -d --build
5. 检查服务是否正常：docker-compose ps && curl http://localhost:3001/api/health

注意事项：
- 绝对不要执行 docker-compose down -v（-v 会删除数据卷！）
- 绝对不要删除 ./data/ 目录
- 绝对不要执行 rm -rf 删除整个项目目录后重新 clone
- 如果需要停止服务，只用 docker-compose down（不加 -v）
```

---

## 禁止操作清单

| 操作 | 后果 | 替代方案 |
|------|------|---------|
| `docker-compose down -v` | 删除所有数据卷，丢失数据库 | `docker-compose down` (不加 -v) |
| `rm -rf /path/to/project` | 删除所有文件包括数据 | `git pull` 更新代码 |
| 直接覆盖 `./data/app.db` | 丢失所有用户数据 | 使用迁移系统更新表结构 |
| `docker volume prune` | 可能清除数据卷 | 仅在确认无关卷时使用 |

---

## 数据库备份与恢复

### 自动备份（已配置）
Docker Compose 的 `backup` 服务会在每天凌晨 3 点自动备份，文件保存在 `./data/backups/`，自动清理 30 天前的备份。

启用自动备份：
```bash
docker-compose --profile production up -d
```

### 手动备份
```bash
# SQLite 在线备份（安全，不锁库）
sqlite3 ./data/app.db ".backup ./data/backups/manual_$(date +%Y%m%d).db"
```

### 恢复
```bash
# 1. 停止服务
docker-compose down

# 2. 替换数据库文件
cp ./data/backups/app_20260307.db ./data/app.db

# 3. 重新启动
docker-compose up -d
```

---

## 环境配置

首次部署时复制并编辑环境变量：
```bash
cp .env.example .env
# 必须配置：
#   JWT_SECRET=<至少32位随机字符串>
#   ALLOWED_ORIGINS=https://your-domain.com
#   ADMIN_USERNAME=admin
#   ADMIN_PASSWORD=<强密码>
#   MINIMAX_API_KEY=<你的API密钥>
```

## 购买模式说明

本系统使用**线下兑换码**模式：
1. 用户联系管理员微信购买兑换码
2. 管理员通过后台生成兑换码（管理面板 > 兑换码管理）
3. 用户在「设置 > 兑换额度」页面输入兑换码获取分析次数

生成兑换码命令：
```bash
# Docker 环境
docker exec bp-filter-app node scripts/generate-tokens.js --count 10 --quota 5

# PM2 环境
node scripts/generate-tokens.js --count 10 --quota 5
```
