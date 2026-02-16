# 🗑️ 垃圾 BP 过滤器

AI 驱动的商业计划书尽职调查工具。上传 BP，10维评分，秒级出报告。

## 一键启动

### Mac / Linux
```bash
chmod +x start.sh
./start.sh
```

### Windows
双击 `start.bat`

浏览器会自动打开 `http://localhost:3000`

## 手动启动

```bash
# 1. 安装依赖 (首次)
npm install
npm install http-proxy-middleware --save

# 2. 启动后端 API 代理 (新终端)
node server.js

# 3. 启动前端 (新终端)
npm start
```

## 切换 AI 模型

编辑 `server.js` 顶部的 CONFIG：

- **MiniMax** (默认): 已配置好
- **Anthropic Claude**: 取消注释 Anthropic 配置，填入你的 API Key

## 用 Cursor 编辑

1. 用 Cursor 打开整个 `bp-filter-project` 文件夹
2. 主要代码在 `src/App.js`
3. 后端代理在 `server.js`
4. 改完代码会自动热更新

## 项目结构

```
bp-filter-project/
├── start.sh          # Mac/Linux 一键启动
├── start.bat         # Windows 一键启动
├── server.js         # API 代理后端
├── package.json
├── public/
│   └── index.html
└── src/
    ├── index.js      # 入口
    ├── App.js        # 主程序 (所有逻辑和UI)
    └── setupProxy.js # 开发代理配置
```
