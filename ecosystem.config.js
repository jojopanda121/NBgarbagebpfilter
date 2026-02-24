// ============================================================
// ecosystem.config.js — PM2 进程管理配置
// GarbageBPFilter v2.0 (client/ + server/ 分离架构)
//
// 前置步骤:
//   1. cp .env.example .env   # 填写 MINIMAX_API_KEY / SERPER_API_KEY
//   2. cd client && npm install && npm run build   # 构建前端到 client/build/
//   3. cd server && npm install                    # 安装后端依赖
//
// 启动命令:
//   pm2 start ecosystem.config.js --env production   # 生产
//   pm2 start ecosystem.config.js --env development  # 开发
//   pm2 logs garbagebpfilter                         # 查看日志
//   pm2 monit                                        # 实时监控
//   pm2 stop garbagebpfilter                         # 停止
//   pm2 restart garbagebpfilter                      # 重启
//   pm2 delete garbagebpfilter                       # 删除进程
//   pm2 save && pm2 startup                          # 设置开机自启
//
// 静态资源路径: client/build/  (react-scripts build 的输出目录)
// 如改用 Vite 构建，请同步修改 server/index.js 中的 clientBuildDir 路径
// ============================================================

module.exports = {
  apps: [
    {
      // ── 进程名称（pm2 list / pm2 logs 中显示的名字）──
      name: 'garbagebpfilter',

      // ── 入口脚本 ──
      script: './server/index.js',

      // ── 工作目录：必须是项目根目录
      //    server/index.js 使用相对路径 ../scripts/ 和 ../client/build/
      //    cwd 决定 __dirname 之外的所有相对路径基准
      cwd: __dirname,

      // ── 运行模式: fork（单实例）
      //    不使用 cluster，避免 multer 上传的临时文件在多工作进程间竞争
      instances: 1,
      exec_mode: 'fork',

      // ── Node.js 堆内存上限（服务器 2GB RAM，为 OS 和 PM2 留 500MB）──
      node_args: '--max-old-space-size=1400',

      // ── 自动重启策略 ──
      autorestart: true,
      watch: false,             // 生产不开 watch
      max_memory_restart: '1400M', // 原 512M 太低，单次分析可达 600MB+，导致请求中途崩溃
      min_uptime: '10s',        // 10s 内崩溃不计入重启次数
      max_restarts: 10,
      restart_delay: 3000,      // 崩溃后等待 3s 再重启

      // ── 日志（相对于 cwd） ──
      error_file: './logs/server-error.log',
      out_file:   './logs/server-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── 生产环境变量 ──
      // 端口对齐 Zeabur/Nginx 约定（8080）；
      // server/index.js 的代码默认值是 3001，ecosystem 显式覆盖
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080,
        // API Key 等敏感变量从 .env 文件加载（server/index.js 第7行自动 dotenv）
        // 不要把真实 Key 写在本文件中
      },

      // ── 开发环境变量 ──
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
  ],
};
