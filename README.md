# 垃圾 BP 过滤器

AI 驱动的商业计划书尽职调查工具。上传 BP，5维评分，秒级出报告。

## Docker 一键启动（推荐）

```bash
# 1. 复制并填写环境变量
cp .env.example .env

# 2. 启动所有服务
docker-compose up -d --build

# 3. 查看日志
docker-compose logs -f app
```

浏览器打开 `http://localhost:3001`

## 本地开发启动

```bash
# 1. 安装依赖（首次）
npm run install:all

# 2. 启动后端（server/ 目录，新终端）
cd server && npm run dev

# 3. 启动前端（client/ 目录，新终端）
cd client && npm start
```

## 切换 AI 模型

编辑 `.env` 文件中的 `MINIMAX_API_KEY`（或 `MINIMAX_API_KEY`）字段。
后端默认使用 MiniMax 开放平台 的 `MiniMax-M3`。
MiniMax API 支持 Chat Completion、Tool Calling 和 `coding_plan/search`；同花顺/天眼查等 MiniMax 内部专业数据源不开放结构化 API。工作区 Host 主攻低成本 MiniMax Chat 路线：通过 `minimax_professional_research` 做间接研究，结果按自然语言证据处理；拿不到的数据标为待上传材料、公开检索或人工补充核验，不默认依赖昂贵第三方 API。

## 项目结构

```
NBgarbagebpfilter/
├── client/               # React 前端
│   └── src/
│       ├── index.js      # 入口
│       └── App.jsx       # 主界面
├── server/               # Express 后端
│   ├── config/           # 统一环境变量配置
│   ├── controllers/      # 路由处理器
│   ├── db/               # SQLite 数据库 & 迁移
│   ├── middleware/       # 认证、配额等中间件
│   ├── routes/           # API 路由定义
│   ├── services/         # 核心业务逻辑
│   └── index.js          # 服务器入口
├── doc-service/          # Python FastAPI 文档提取微服务
├── scripts/              # 本地辅助脚本（PDF/DOCX 提取）
├── data/                 # SQLite 数据库文件（自动创建，已 gitignore）
├── logs/                 # 运行日志（已 gitignore）
├── docker-compose.yml    # Docker 编排
├── ecosystem.config.js   # PM2 进程管理（非 Docker 部署用）
└── .env.example          # 环境变量模板
```

## 设置管理员账号

部署后需要手动设置管理员账号，方法有两种：

### 方法一：环境变量（推荐，部署时设置）

在 `.env` 中添加：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
```

重启服务后自动创建管理员。

### 方法二：命令行工具

```bash
# 进入容器
docker exec -it bp-filter-app sh

# 设置管理员
node scripts/set-admin.js your_username
```

详细说明见 [DEPLOY.md](DEPLOY.md)
