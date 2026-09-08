# GarbageBPFilter · 腾讯云北京 CVM 更新部署手册

> 面向**已有老版本在腾讯云 CVM（北京）跑、用 Docker 部署**的更新场景，把历次踩过的坑全部固化成流程，照抄即可，不用每次现想。
> 配套通用文档见 `DEPLOY.md`；本文是其腾讯云特化 + 增量更新版。

---

## 0. 这台服务器的既定事实（先记住）

| 项           | 值                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| 项目目录     | `/root/NBgarbagebpfilter`（在 root 家目录下，**普通用户进不去**）                                     |
| 操作身份     | **必须 root**：先 `sudo -i` 再操作，Docker 也需要 root                                                |
| compose 命令 | `docker compose` 或 `docker-compose` 都可能，脚本里自动探测                                           |
| 对外入口     | **宿主机 apt 装的 nginx（nginx/1.24.0）**反代到 `127.0.0.1:3001`，**不是** compose 里的 nginx 容器    |
| 运行容器     | 只有 `bp-filter-app` + `bp-filter-doc`（**没有** nginx/backup 容器，即未启用 `--profile production`） |
| 镜像加速     | 腾讯内网可达：apt/pip 走 `mirrors.tencentyun.com`，npm 走 `registry.npmmirror.com`                    |
| 构建器       | 经典构建器（未装 buildx）；想更快可选装 buildx（见 §6）                                               |

> **502 Bad Gateway 的含义**：宿主机 nginx 正常，但 app 没监听 3001（多半在崩溃重启）。先看 `docker logs bp-filter-app`，app 起来 502 自动消失。

---

## 1. 一次性准备（首台机器配一次，以后免）

### ① 宿主机 Docker registry 镜像（加速基础镜像 node/python/nginx/alpine）

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
JSON
sudo systemctl restart docker
docker info | grep -A3 "Registry Mirrors"   # 确认生效
```

### ② `.env` 里的镜像与跳过开关（构建依赖加速 + 跳过 Chromium）

确认 `/root/NBgarbagebpfilter/.env` 含这四行（没有就加）：

```bash
CN_MIRROR=1
NPM_REGISTRY=https://registry.npmmirror.com
PIP_INDEX=https://mirrors.tencentyun.com/pypi/simple
SKIP_CHROMIUM=1
```

> `SKIP_CHROMIUM=1` 跳过 react-snap/puppeteer 的 ~150MB Chromium 下载（国内常卡死）。代价：SEO 预渲染降级，**不影响站点功能与构建**。

### ③ `.env` 生产必填项（缺任一 → app 启动即 `exit(1)`、网站 502）

| 变量                                   | 规则                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY`（或 `LLM_API_KEY`） | 非空。**⚠️ 本项已由 `MINIMAX_API_KEY` 更名**：LLM 后端已全量切到 DeepSeek，老 `.env` 只有 MiniMax 的 key 会直接 `exit(1)` → 502。**例外**：配了 `ENCRYPTION_KEY`（BYOK 可用）时本项可留空，站点进入「纯自带模型模式」照常启动，见 §9 |
| `JWT_SECRET`                           | ≥32 字符，无占位文案；`openssl rand -hex 32`                                                                                                                                                                                         |
| `ALLOWED_ORIGINS`                      | 非空、**不能是 `*`**；如 `https://www.你的域名`                                                                                                                                                                                      |
| `PII_SALT`                             | **≥16 字符**（安全加固后新增，老 .env 常缺）；`openssl rand -hex 24`                                                                                                                                                                 |

强烈建议同时配置（不配不会崩，但功能会缺）：

| 变量             | 不配的后果                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `BOCHA_API_KEY`  | 联网检索全程返回空 → 任何声明都拿不到 verified 证据，**诚信度对低覆盖的真公司会被系统性压低** |
| `ENCRYPTION_KEY` | 「我的模型」(用户自带 API Key) 整体不可用；创始人姓名加密退化为 hash。`openssl rand -hex 32`  |

一把生成：

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "PII_SALT=$(openssl rand -hex 24)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

> **从 MiniMax 版本升级过来的机器**，`.env` 里请把 `MINIMAX_API_KEY=` 那行换成
> `DEEPSEEK_API_KEY=`（申请：https://platform.deepseek.com/api_keys ）。
> 旧行留着无害，但不会被读取。
>
> 换主力厂商不需要改代码：`LLM_PROVIDER` + `LLM_API_KEY` + `LLM_MODEL` 三个变量即可
> 在 deepseek / anthropic / openai / gemini / minimax / moonshot / qwen / zhipu 之间切换。

---

## 2. 日常更新流程（核心，按顺序复制）

> 原则：**先备份 → 可回滚 → 先构建后切换（零停机构建）→ 验证**。数据库在 `./data` 目录挂载，全程不动。

```bash
# ── 0. 切 root + 进项目目录 ──
sudo -i
cd /root/NBgarbagebpfilter

# ── 1. 备份数据库（WAL 安全热备）──
command -v sqlite3 >/dev/null || apt-get install -y sqlite3
mkdir -p data/backups
sqlite3 data/app.db ".backup data/backups/app_$(date +%Y%m%d_%H%M%S)_pre_update.db"
ls -lh data/backups/ | tail -3      # 确认备份大小正常（几十 MB，不是 0）

# ── 2. 给当前镜像打回滚标签 ──
docker tag "$(docker inspect --format '{{.Image}}' bp-filter-app)" bp-filter-app:last-known-good
docker tag "$(docker inspect --format '{{.Image}}' bp-filter-doc)" bp-filter-doc:last-known-good

# ── 3. 清掉本地对 tracked 文件的临时改动（避免 pull 冲突）──
git status -sb                       # 看有没有 M 标记（.env 是 gitignore，不受影响）
git restore Dockerfile doc-service/Dockerfile 2>/dev/null || true

# ── 4. 拉最新代码 ──
git fetch origin && git pull --ff-only origin main
git log --oneline -1                 # 记下新 HEAD

# ── 5. 先构建（零停机，老服务继续跑）──
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
$DC build                            # 镜像里已内置 mirror/SKIP_CHROMIUM 开关，自动读 .env

# ── 6. 切换到新镜像 ──
$DC up -d
# 若报 "container name bp-filter-app is already in use"（重名冲突），执行：
#   docker rm -f bp-filter-app && $DC up -d
```

### 验证（必做）

```bash
$DC ps                               # app/doc 都应 Up ... (healthy)
$DC logs --tail=40 app               # 看迁移执行、"后端已启动"、无 [FATAL]
curl -s http://127.0.0.1:3001/api/health; echo   # 期望 {"status":"ok","version":"3.0.0",...}
```

然后**刷新网站**确认 502 消失、功能正常。

---

## 3. 踩坑速查表（出现 ↓ 现象 → 照 ↓ 处理）

| 现象 / 报错                                                   | 原因                                         | 处理                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 网站 **502 Bad Gateway**                                      | app 崩溃没监听 3001（宿主机 nginx 转不过去） | `docker logs bp-filter-app` 看最后的 `[FATAL]`；按下面对症修，app 起来即恢复                                                                               |
| `[FATAL] ... PII_SALT（≥ 16 字符）`                           | 老 `.env` 缺 `PII_SALT`                      | `echo "PII_SALT=$(openssl rand -hex 24)" >> .env` 后 `$DC up -d --force-recreate app`                                                                      |
| `[FATAL] ... JWT_SECRET / ALLOWED_ORIGINS / LLM_API_KEY`      | 必填项缺失/不合规                            | 补 `.env`（见 §1③）后 `$DC up -d --force-recreate app`                                                                                                     |
| `[FATAL] 生产环境必须设置 LLM_API_KEY（或 DEEPSEEK_API_KEY）` | 老 `.env` 里还是 `MINIMAX_API_KEY`           | 改成 `DEEPSEEK_API_KEY=...` 后 `$DC up -d --force-recreate app`                                                                                            |
| `[WARN] ... 服务以「纯自带模型模式」启动`                     | 没配平台 LLM key，但 BYOK 可用               | **不是错误**：站点正常，只是分析必须由用户自带模型。想恢复平台模型就补 `LLM_API_KEY`                                                                       |
| 用户反馈「自带模型」入口不出现 / 提示未配置加密密钥           | `.env` 缺 `ENCRYPTION_KEY`                   | `echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env` 后重建 app；**注意该密钥一旦更换，已保存的用户 API Key 全部失效需重填**                            |
| `container name "/bp-filter-app" is already in use`           | 旧同名容器占用                               | `docker rm -f bp-filter-app && $DC up -d`（app 无状态，删容器不丢数据）                                                                                    |
| 构建卡在 `npm ci` 一动不动（前端阶段）                        | puppeteer 在下 Chromium，国内被墙            | 确认 `.env` 有 `SKIP_CHROMIUM=1`，重新 `$DC build`                                                                                                         |
| `COPY ... destination must be a directory and end with /`     | 经典构建器对 `COPY *.py .` 严格              | 新版仓库已修为 `COPY *.py ./`；若仍遇到，`git pull` 取最新                                                                                                 |
| `npm ci ... package-lock.json ... Missing: xxx`               | lock 与 package.json 不同步                  | 新版仓库已同步；临时修：`docker run --rm -v "$PWD/client":/w -w /w node:20-slim npm install --package-lock-only --registry=https://registry.npmmirror.com` |
| 构建很慢、且无进度条                                          | 经典构建器（没 buildx）                      | 见 §6 选装 buildx；另：只改源码不改依赖时，下次构建会命中缓存快很多                                                                                        |
| `permission denied ... docker.sock`                           | 当前不是 root                                | `sudo -i` 切 root 再操作                                                                                                                                   |
| `not a git repository` / `No such file`                       | 不在项目目录或掉回 ubuntu 用户               | `sudo -i; cd /root/NBgarbagebpfilter`（看提示符是不是 `root@...#`）                                                                                        |

---

## 4. 回滚（新版不对劲时）

```bash
cd /root/NBgarbagebpfilter
$DC down                                         # ⚠️ 绝不加 -v
cp data/backups/app_<更新前时间戳>_pre_update.db data/app.db   # 数据回到更新前
docker tag bp-filter-app:last-known-good nbgarbagebpfilter-app:latest
docker tag bp-filter-doc:last-known-good nbgarbagebpfilter-doc-service:latest
$DC up -d                                        # 用旧镜像启动（不带 --build）
curl -s http://127.0.0.1:3001/api/health; echo
```

---

## 5. 清理构建垃圾（更新成功并验证后再做）

```bash
docker image prune -f          # 只删 <none> 悬空镜像（不碰带标签的回滚镜像/新镜像）
docker builder prune -f        # 清构建缓存
docker system df               # 复核回收效果
```

**红线**：永远别 `docker system prune -a`（会删回滚镜像）、别 `docker volume prune` / 别加 `--volumes`。回滚镜像 `*:last-known-good` 建议留几天确认稳定再删。

---

## 6.（可选）装 buildx 让以后构建更快、有进度条

经典构建器串行、无进度条。装 buildx 后 `docker compose build` 自动走 BuildKit（并行 + 缓存更强 + 实时进度）：

```bash
# 方式 A：若有 Docker 官方 apt 源
apt-get update && apt-get install -y docker-buildx-plugin && docker buildx version

# 方式 B：手动装二进制（A 不行时；amd64 架构）
mkdir -p ~/.docker/cli-plugins
curl -fsSL -o ~/.docker/cli-plugins/docker-buildx \
  https://registry.npmmirror.com/-/binary/buildx/latest/buildx-latest.linux-amd64 || \
curl -fsSL -o ~/.docker/cli-plugins/docker-buildx \
  https://github.com/docker/buildx/releases/latest/download/buildx-linux-amd64
chmod +x ~/.docker/cli-plugins/docker-buildx && docker buildx version
```

> 装好后无需改流程，`$DC build` 自动用 BuildKit。

---

## 7.（可选）开启每天自动备份

你当前没有自动备份。启动备份容器（每天 03:00 热备、自动清理 30 天前），**只起 backup、不碰你的宿主机 nginx**：

```bash
cd /root/NBgarbagebpfilter
docker compose --profile production up -d backup   # 仅 backup 服务，不会拉起 compose 的 nginx
docker logs bp-filter-backup
```

备份产物在 `./data/backups/app_YYYYMMDD_HHMMSS.db`，日志 `./data/backups/backup.log`。

---

## 8. 禁止操作

| 操作                                                     | 后果                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `docker compose down -v`                                 | 删数据卷                                                     |
| `rm -rf ./data` / 覆盖 `./data/app.db`                   | 清/毁数据库                                                  |
| `docker system prune -a`                                 | 删掉回滚镜像                                                 |
| `ALLOWED_ORIGINS=*` / `JWT_SECRET=占位文案`              | 生产启动被拒、网站 502                                       |
| 直接 `docker compose --profile production up -d`（全量） | 会拉起 compose 的 nginx，和你宿主机 nginx **抢 80/443 端口** |

---

## 9. 纯自带模型模式（平台不再续费 API 时）

站点不依赖平台自己的 LLM key 才能活着。只要 `ENCRYPTION_KEY` 已配（BYOK 可用），把 `.env` 里的 `LLM_API_KEY` / `DEEPSEEK_API_KEY` 留空或删掉，服务照常启动：

- 启动日志出现 `[WARN] ... 服务以「纯自带模型模式」启动`，**不是错误**
- 用户在「用户中心 → 我的模型」填自己的 API Key（DeepSeek / Claude / GPT / Gemini 等），照常分析，费用走他自己的账户
- 没配自己模型的用户，上传页会直接显示「需要先配置你自己的模型」并禁用分析按钮，不会白扣额度、也不会跑到一半失败
- 论坛、报告、工作台等不调模型的功能完全不受影响

想恢复平台模型，把 key 加回 `.env` 再 `$DC up -d --force-recreate app` 即可。

⚠️ `ENCRYPTION_KEY` 和 `LLM_API_KEY` 同时缺失才是真的启动失败——那种情况下没有任何模型可跑，站点起来也没意义。
