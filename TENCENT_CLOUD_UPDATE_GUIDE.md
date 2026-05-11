# 腾讯云服务器更新部署指南

> 本指南适用于：服务器上已有旧版本运行中，需要 git pull 拉取最新代码并重新部署。

## 前置条件

- 服务器已安装 Docker 和 Docker Compose
- 项目目录中已有 `.env` 配置文件（旧版部署时已配置）
- 服务器已配置 Git 并能访问 GitHub 仓库

---

## 更新步骤

### 第 1 步：进入项目目录

```bash
cd /root/NBgarbagebpfilter
```

> 如果你的项目在其他路径，替换为实际路径。

### 第 2 步：备份数据库

```bash
mkdir -p data/backups
cp data/app.db data/backups/app_$(date +%Y%m%d_%H%M%S).db
echo "数据库备份完成"
```

### 第 3 步：查看当前状态

```bash
git status
```

如果有本地修改（比如手动改过配置文件），先暂存：

```bash
git stash
```

### 第 4 步：拉取最新代码

```bash
git pull origin main
```

如果第 3 步执行了 `git stash`，拉取完成后恢复本地修改：

```bash
git stash pop
```

> 如果出现冲突，优先保留远程版本，`.env` 文件除外（`.env` 已在 `.gitignore` 中，不会被覆盖）。

### 第 5 步：重新构建并启动容器

```bash
docker compose up -d --build
```

> 如果你的服务器用的是旧版 Docker Compose，使用 `docker-compose up -d --build`。

这个命令会：
- 重新构建主应用镜像（Node.js 后端 + React 前端）
- 重新构建文档提取微服务镜像（Python FastAPI）
- 自动重启所有服务
- **不会删除数据库和日志**（数据在 `./data` 目录中持久化）

### 第 6 步：检查服务状态

```bash
docker compose ps
```

确认所有服务的 STATUS 列显示为 `Up` 或 `healthy`。

### 第 7 步：查看日志确认无报错

```bash
docker compose logs -f --tail=50 app
```

看到类似 `Server running on port 3001` 的日志表示启动成功。按 `Ctrl+C` 退出日志查看。

如果需要同时看文档服务的日志：

```bash
docker compose logs -f --tail=20 doc-service
```

### 第 8 步：验证服务可用

```bash
curl http://localhost:3001/api/health
```

返回正常的 JSON 响应即表示更新成功。

---

## 如果使用了 Nginx（生产环境带 SSL）

如果你之前用 `--profile production` 启动了 Nginx 反向代理，更新时也要加上：

```bash
docker compose --profile production up -d --build
```

---

## 快速命令（一键更新）

如果你确认没有本地修改，可以一键执行：

```bash
cd /root/NBgarbagebpfilter && \
mkdir -p data/backups && \
cp data/app.db data/backups/app_$(date +%Y%m%d_%H%M%S).db && \
git pull origin main && \
docker compose up -d --build && \
echo "更新完成！等待服务启动..." && \
sleep 10 && \
docker compose ps
```

---

## 回滚方法

如果更新后出现问题，需要回滚：

```bash
# 查看之前的版本
git log --oneline -10

# 回滚到指定版本（替换 <commit-hash> 为目标提交哈希）
git checkout <commit-hash> -- .
docker compose up -d --build

# 如果需要恢复数据库备份
cp data/backups/app_YYYYMMDD_HHMMSS.db data/app.db
docker compose restart app
```

---

## 常见问题

| 问题 | 解决方法 |
|------|----------|
| `docker compose` 命令不存在 | 使用 `docker-compose`（带连字符的旧版命令） |
| 端口 3001 被占用 | `docker compose down` 先停止旧容器再启动 |
| 构建时网络超时 | 重试一次，或配置 Docker 镜像加速源 |
| git pull 提示冲突 | `git stash && git pull origin main && git stash pop` |
| 数据库迁移失败 | 查看 `docker compose logs app` 中的具体报错 |
