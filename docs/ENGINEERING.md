# 工程约定与架构决策记录（ADR）

> 本文档把原先只存在于代码注释中的不变量显式化。修改下列任何一条前，先读对应的"为什么"。
> 最后更新：2026-07-04（全面工程化修复）

## 1. 不可变约定（Invariants）

### 1.1 CSP 严格度是 XSS 防线的底线

JWT 存储在 localStorage（见 §2.1 决策），前提是 [server/middleware/security.js](../server/middleware/security.js) 中的 CSP **不放行 `unsafe-inline` script**。任何人不得为了"图省事引入第三方脚本"而放宽 `scriptSrc`。

### 1.2 认证检查 fail-closed

[server/middleware/auth.js](../server/middleware/auth.js)：吊销/封禁检查依赖 DB，DB 故障时**拒绝（503）而非放行**。不要"优化"成降级放行。

### 1.3 schema 变更只走迁移文件

新表/新列一律新建 `server/db/migrations/NNN_*.sql`。`ensureColumnsExist()` 已冻结（只服务迁移体系建立前的历史库），禁止往里加 ALTER。迁移失败时的幂等降级路径是**逐语句重放**（见 db/index.js `applyMigrationStatementwise`），绝不允许把回滚了的迁移标记为已应用。含 TRIGGER 的迁移必须写成单语句文件。

### 1.4 单实例约束（横向扩展前必读）

以下三处进程内状态使 `instances: 1` 成为**架构约束而非配置选择**：

- `services/taskQueue.js` — p-limit 内存队列
- `services/sseService.js` — SSE 订阅表
- SQLite 单文件 + 本地 `data/uploads`

扩容顺序（仅在单机指标真实逼近瓶颈时启动）：uploads→OSS → SQLite→Postgres → 内存队列→BullMQ。在此之前不要加第二个实例。

### 1.5 评分引擎灰度流程

S2/S3/聚合层的 `off/shadow/on` 开关在 [server/config/featureFlags.js](../server/config/featureFlags.js)。任何评分改动先走 shadow 对照，校准报告确认后才切 on。

## 2. 已做出的权衡决策

### 2.1 JWT 存 localStorage（2026-07 确认保留）

评估过 httpOnly cookie 方案：代价是 Capacitor iOS 端需单独处理 cookie 域，且现有 CSP 已消除内联脚本注入面。**决策：保留 localStorage，以 §1.1 为前提。** 若论坛 UGC 引入富文本渲染，重新评估。

### 2.2 console 桥接而非全量替换

存量 44 个文件使用 `console.*`。为避免大规模机械替换的回归风险，运行时在 `server/index.js` 入口安装 `installConsoleBridge()`（见 utils/logger.js），把所有 console 输出统一为结构化 JSON。**新代码请直接用 `utils/logger`**。

### 2.3 环境变量读取规则

- 静态配置/调优参数 → `server/config/index.js`（启动时读一次）
- 运行时可切换的行为开关（灰度、测试会动态改的）→ `server/config/featureFlags.js`（动态读取）
- 除上述两处、logger（避免循环依赖）和独立脚本外，**禁止直读 `process.env`**

## 3. 测试策略

| 层   | 配置                                | 范围                                                         | 命令                       |
| ---- | ----------------------------------- | ------------------------------------------------------------ | -------------------------- |
| 单元 | `server/jest.config.js`             | 纯逻辑，sqlite/dotenv 用 `tests/stubs/` 替身                 | `npm test`                 |
| 集成 | `server/jest.integration.config.js` | 真 SQLite `:memory:` 跑**全部迁移** + supertest 完整 HTTP 栈 | `npm run test:integration` |

注意：jest 会自动应用任何 `__mocks__/` 目录下与 node 模块同名的文件（哪怕配置里没映射），因此替身目录刻意命名为 `tests/stubs/`，**不要改回 `__mocks__`**。

新增 API 端点时，至少在集成测试中补一条"权限边界"用例（未登录/越权应得 401/403）。

## 4. 部署与回滚

- CI（`.github/workflows/ci.yml`）：lint → 单测 → 集成测试 → 前端构建 → Docker 构建；配置 `DOCKER_REGISTRY`/`DOCKER_USERNAME`/`DOCKER_PASSWORD` 三个 secrets 后自动推送 sha+latest 双 tag 镜像，回滚 = 拉上一个 sha。
- 备份：backup 容器每日 3 点本地备份；配置 `BACKUP_RCLONE_REMOTE` 后自动异地上传（见 .env.example）。**异地备份配置属于上线检查清单项。**
- 日志：docker json-file 已配轮转（20m×5）；PM2 路径建议另装 pm2-logrotate。

## 5. 已知待办（需要外部账号，代码侧已就绪）

- **错误追踪**：errorHandler 已输出结构化 stack+requestId；接 Sentry 只需注册账号后在 index.js 初始化 SDK（约 10 行）。
- **可用性告警**：`/api/health` 已具备 200/503 语义，接 UptimeRobot 级别的探活即可。
- **镜像推送**：CI 已就绪，等 registry secrets。

## 6. 大型重构排期（独立 PR，勿混入日常改动）

1. **SettingsPage.jsx 拆分**（3097 行，用户设置与管理后台耦合）— 按 `settingsTabs.js` 拆 tab，admin 系移至 `pages/admin/*`
2. **CRA → Vite 迁移** — react-scripts 已停止维护且携带 48 个依赖漏洞；迁移时一并决定 react-snap 去留（其预渲染职责已部分被 server/seo/forumSeo.js 取代，需验证 demo/landing 页面）
