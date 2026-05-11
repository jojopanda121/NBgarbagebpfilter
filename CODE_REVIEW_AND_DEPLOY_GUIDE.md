# GarbageBPFilter v3.0 代码审核报告 & 部署指南

> 审核日期：2026-03-10
> 审核范围：全栈代码（React 前端 + Express 后端 + Python 文档微服务 + Docker 部署）

---

## 一、整体评价

### 总结：代码质量良好，可以上线，但有若干建议修复项

Codex 写的这套代码**架构清晰、模块化合理**，整体质量在中上水平。具体来说：

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | ★★★★☆ | 清晰的三层架构（routes → controllers → services），前后端分离，微服务拆分合理 |
| 代码规范 | ★★★★☆ | 注释充分（中文），模块职责清晰，命名一致 |
| 安全性 | ★★★☆☆ | 基础安全做得好（JWT/bcrypt/参数化SQL），但有几个中风险问题需修复 |
| 数据库设计 | ★★★★☆ | 迁移系统完善，SQLite WAL 模式配置正确，事务使用得当 |
| 部署配置 | ★★★★☆ | Docker Compose 完善，含自动备份、健康检查、非 root 运行 |
| 错误处理 | ★★★★☆ | LLM 调用有重试降级机制，额度扣减失败有退还，生产环境隐藏堆栈 |

---

## 二、优点（做得好的地方）

### 2.1 后端架构
- **三层分离**：`routes/` → `controllers/` → `services/`，职责清晰
- **集中配置**：所有环境变量在 `server/config/index.js` 统一管理，其他模块不直接读 `process.env`
- **生产环境强制检查**：`JWT_SECRET` 和 `ALLOWED_ORIGINS` 未配置时直接 `process.exit(1)`，避免裸奔上线

### 2.2 安全措施
- **密码**：bcryptjs 12 轮哈希，符合行业标准
- **JWT**：明确指定 `HS256` 算法，防止算法混淆攻击
- **SQL 注入**：全部使用 `better-sqlite3` 参数化查询，无拼接 SQL
- **Rate Limit**：登录 5次/15分钟，注册 10次/小时
- **Helmet**：安全响应头已配置
- **非 root Docker**：创建 `appuser` 运行应用

### 2.3 数据持久化
- **迁移系统**：16 个增量迁移文件，有 `schema_migrations` 表跟踪版本
- **向后兼容**：`ensureColumnsExist()` 处理旧数据库缺列问题
- **备份**：Docker Compose 含定时备份容器（每天凌晨3点，保留30天）

### 2.4 LLM 调用
- **三层降级**：DeepThink → 普通模式 → 精简模式，确保结果可用
- **批次并发**：声明核查分3批并发，失败批次自动重试，再失败逐条降级
- **深度研究与评分并行**：`Promise.all` 并行执行，缩短总耗时

### 2.5 前端
- **统一 API 层**：`ApiService` 自动注入 token，全局拦截 401/4031/4032
- **Zustand 状态管理**：轻量级，比 Redux 更简洁
- **渐进式注册**：先使用后绑定邮箱，降低注册门槛

---

## 三、问题与建议（按优先级排序）

### 🔴 高优先级（上线前建议修复）

#### 3.1 用户封禁检查不完整
**文件**：`server/middleware/auth.js`
**问题**：`requireAuth()` 只验证 JWT 有效性，不检查 `is_banned` 字段。被封禁的用户只要 token 未过期，仍可正常使用所有功能。
**修复建议**：
```javascript
// auth.js 中 requireAuth 增加封禁检查
const user = db.prepare("SELECT is_banned FROM users WHERE id = ?").get(payload.sub);
if (user?.is_banned) {
  return res.status(403).json({ error: "账号已被封禁" });
}
```

#### 3.2 分析接口缺少请求频率限制
**文件**：`server/routes/analyze.js`
**问题**：`/api/analyze` 仅靠额度控制，没有请求频率限制。恶意用户可以高频发送请求（即使额度耗尽也会消耗服务器资源解析文件）。
**修复建议**：添加 rate-limit 中间件，如每 IP 每分钟最多 5 次。

#### 3.3 迁移失败被静默跳过
**文件**：`server/db/index.js:75-78`
**问题**：迁移失败时只 `console.log` 而不记录到 `schema_migrations`，但也不中断启动。如果某个迁移部分执行成功（多条 SQL 中间失败），数据库会处于不一致状态。
**修复建议**：迁移失败时应抛出异常阻止启动，而非静默跳过。

### 🟡 中优先级（上线后尽快修复）

#### 3.4 管理后台无 MFA/IP 白名单
**问题**：管理员登录仅靠密码，一旦密码泄露就是全系统沦陷。
**建议**：至少在 nginx 层添加管理端 IP 白名单限制。

#### 3.5 文件上传 MIME 类型可伪造
**问题**：`multer` 只检查 MIME type，不检查文件魔术字节。攻击者可将恶意文件伪装成 PDF 上传。
**建议**：添加 `file-type` 库做 magic number 校验。

#### 3.6 验证码明文存储
**文件**：`server/services/verificationStore.js`
**问题**：OTP 验证码明文存入 SQLite。数据库泄露 = 验证码泄露。
**缓解**：OTP 5 分钟过期，风险有限，但最好哈希存储。

#### 3.7 `SES_CONFIG` 被导出
**文件**：`server/services/emailService.js:186`
**问题**：`module.exports` 中包含 `SES_CONFIG`，其中含 `secretKey`。虽然目前无外部模块引用，但暴露了接口。
**建议**：移除 `SES_CONFIG` 的导出。

### 🟢 低优先级（优化建议）

#### 3.8 SQLite 并发写入瓶颈
**问题**：SQLite 同一时刻只允许一个写入者。高并发场景（如多用户同时分析）可能出现 `SQLITE_BUSY`。
**缓解**：已设 `busy_timeout = 5000`，当前量级可接受。如日活超过几百考虑换 PostgreSQL。

#### 3.9 前端 token 存 localStorage
**问题**：XSS 攻击可读取 localStorage 中的 JWT。
**缓解**：已有 Helmet + DOMPurify，XSS 风险较低。如需进一步加固可改用 httpOnly cookie。

#### 3.10 `trust proxy` 硬编码
**文件**：`server/index.js:48`
**问题**：`app.set("trust proxy", 1)` 假设只有一层代理。如果 nginx 前面还有 CDN，IP 获取可能不准。
**建议**：通过环境变量配置。

---

## 四、数据库问题：旧版数据会被覆盖吗？

### 结论：**不会覆盖旧数据库**

关键证据：

1. **SQLite 数据库位于 `./data/app.db`**，这是一个 bind mount 目录：
   ```yaml
   # docker-compose.yml
   volumes:
     - ./data:/app/data   # 宿主机 ./data 映射到容器 /app/data
   ```
   `docker-compose up --build` 或 `docker-compose down` **都不会删除宿主机的 `./data` 目录**。

2. **迁移系统是增量式的**：
   - `schema_migrations` 表记录已执行的迁移版本
   - 新版本启动时，只运行 `schema_migrations` 表中不存在的迁移
   - 所有迁移都使用 `CREATE TABLE IF NOT EXISTS` 和 `ALTER TABLE ADD COLUMN`（幂等操作）

3. **`ensureColumnsExist()` 做了兼容处理**：即使旧数据库缺少 `role`、`is_banned` 等列，也会自动补全而非报错。

### 唯一危险操作

```bash
# ❌ 绝对不要执行这个！ -v 会删除所有数据卷
docker-compose down -v
```

### 安全部署步骤

```bash
# 1. 备份旧数据库（强烈建议）
cp ./data/app.db ./data/app.db.backup.$(date +%Y%m%d)

# 2. 更新代码
git pull origin main

# 3. 重新构建并启动（数据不会丢失）
docker-compose up -d --build

# 4. 验证数据库迁移日志
docker-compose logs app | grep "\[DB\]"
```

---

## 五、腾讯云 SES 邮件服务配置指南

### 5.1 前置条件

- 腾讯云账号（已完成实名认证）
- 一个已备案的域名（如 `garbagebpfilter.cn`）

### 5.2 腾讯云控制台配置

#### Step 1：开通 SES 服务

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 搜索 **"邮件推送"** 或直接访问 [SES 控制台](https://console.cloud.tencent.com/ses)
3. 点击 **开通服务**（免费开通，按量付费）

#### Step 2：配置发信域名

1. 在 SES 控制台左侧菜单 → **发信域名**
2. 点击 **新建发信域名**
3. 输入域名，如：`www.garbagebpfilter.cn`（建议用子域名 `mail.garbagebpfilter.cn`）
4. 系统会生成 **3 条 DNS 记录**（SPF、DKIM、DMARC），需要到域名 DNS 管理处添加：

| 类型 | 主机记录 | 记录值（示例） | 用途 |
|------|---------|--------------|------|
| TXT | `@` 或 `mail` | `v=spf1 include:qcloudmail.com ~all` | SPF 验证 |
| TXT | `qcloud._domainkey.mail` | `v=DKIM1; k=rsa; p=MIGf...` | DKIM 签名 |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none` | DMARC 策略 |

5. 添加 DNS 记录后，回到 SES 控制台点击 **验证**
6. DNS 生效通常需要 **5-30 分钟**，状态变为 ✅ **已验证** 即可

#### Step 3：配置发信地址

1. 左侧菜单 → **发信地址**
2. 点击 **新建发信地址**
3. 填写：
   - 发信地址：`noreply@mail.garbagebpfilter.cn`
   - 发信人别名：`垃圾BP过滤机`
4. 点击确定

#### Step 4：获取 API 密钥

1. 访问 [API 密钥管理](https://console.cloud.tencent.com/cam/capi)
2. 点击 **新建密钥**（如果没有的话）
3. 记录 **SecretId** 和 **SecretKey**

> ⚠️ **安全建议**：不要使用主账号密钥。建议创建子用户，仅授予 `QcloudSESFullAccess` 权限。

操作步骤：
1. 访问 [CAM 用户管理](https://console.cloud.tencent.com/cam/user)
2. 新建用户 → 快速创建 → 用户名如 `ses-sender`
3. 授权策略：`QcloudSESFullAccess`
4. 创建该子用户的 API 密钥

#### Step 5：申请发送量（可选）

新开通的 SES 账号有**每日发送限额**（通常 100 封/天）。如需更多：
1. 左侧菜单 → **用量统计**
2. 确认当前限额
3. 如不够，提交工单申请提升

### 5.3 服务器 `.env` 配置

在服务器的 `.env` 文件中添加以下配置：

```bash
# ══════════════════════════════════════════════════════════════
# 腾讯云 SES 邮件服务配置
# ══════════════════════════════════════════════════════════════

# API 密钥（建议使用子用户密钥）
TENCENT_SES_SECRET_ID=your_secret_id_here
TENCENT_SES_SECRET_KEY=your_secret_key_here

# 发信地址（格式：显示名 <邮箱地址>）
TENCENT_SES_FROM_EMAIL=垃圾BP过滤机 <noreply@mail.garbagebpfilter.cn>

# 区域（ap-hongkong 或 ap-guangzhou）
# ap-hongkong：适合发往海外/港澳台
# ap-guangzhou：适合发往国内
TENCENT_SES_REGION=ap-hongkong
```

### 5.4 配置验证

部署后验证邮件服务是否正常：

```bash
# 1. 重启服务使配置生效
docker-compose restart app

# 2. 查看日志确认无报错
docker-compose logs app | grep -i "email\|ses\|mail"

# 3. 功能验证：注册一个测试账号，触发绑定邮箱流程
#    - 登录后使用 3 次免费额度
#    - 第 4 次使用时系统弹出邮箱绑定框
#    - 输入邮箱，点击发送验证码
#    - 检查邮箱是否收到验证码邮件

# 4. 如果邮件未收到，检查以下几点：
#    a. SES 控制台 → 发信域名是否已验证
#    b. .env 中 SecretId/SecretKey 是否正确
#    c. 发信地址的域名部分是否与已验证域名一致
#    d. 检查垃圾邮件文件夹
#    e. SES 控制台 → 数据统计 → 查看发送状态
```

### 5.5 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `邮箱服务未配置，请联系管理员设置腾讯云 SES` | `.env` 中 SES 相关配置为空 | 按 5.3 填写配置并重启 |
| `邮件发送失败，请稍后重试` | API 调用出错 | 查看 `docker-compose logs app` 中的 `[SES Error]` 日志 |
| `AuthFailure.SecretIdNotFound` | SecretId 错误 | 检查 `.env` 中的 `TENCENT_SES_SECRET_ID` |
| `AuthFailure.SignatureFailure` | SecretKey 错误 | 检查 `.env` 中的 `TENCENT_SES_SECRET_KEY` |
| `InvalidParameter.FromEmailAddress` | 发信地址未配置 | 在 SES 控制台添加发信地址 |
| `FailedOperation.FrequencyLimit` | 发送频率太快 | 等 60 秒重试（代码已有冷却机制） |
| `FailedOperation.ExceedSendLimit` | 超过每日限额 | 提交工单提升限额 |
| 收件人收不到邮件 | 进了垃圾箱或 DNS 未配置 | 检查 SPF/DKIM/DMARC 记录 |

### 5.6 费用参考

腾讯云 SES 计费（2026 年参考价格）：
- **免费额度**：每月 1000 封
- **超出部分**：约 0.035 元/封
- 对于验证码场景，日均百封以内基本免费

---

## 六、上线检查清单

```
[ ] 备份旧数据库：cp ./data/app.db ./data/app.db.backup.$(date +%Y%m%d)
[ ] 配置 .env（从 .env.example 复制并填写）
    [ ] JWT_SECRET（至少 32 位随机字符串）
    [ ] ALLOWED_ORIGINS（你的域名）
    [ ] MINIMAX_API_KEY（MiniMax API 密钥）
    [ ] ADMIN_USERNAME / ADMIN_PASSWORD
    [ ] TENCENT_SES_* （邮件服务，参照第五节）
[ ] SSL 证书放入 nginx-certs/ 目录
[ ] nginx.conf 切换为 nginx-ssl.conf（HTTPS）
[ ] docker-compose --profile production up -d --build
[ ] 验证健康检查：curl http://localhost:3001/api/health
[ ] 验证 CORS：从你的域名访问 API
[ ] 验证管理后台：用 ADMIN 账号登录
[ ] 验证邮件服务：触发验证码发送
[ ] 验证分析功能：上传一个测试 PDF
[ ] 监控日志：docker-compose logs -f app
```

---

## 七、总结

**可以上线**。Codex 产出的代码质量整体良好，架构合理，安全基线达标。主要需要注意：

1. **上线前**：修复用户封禁检查（3.1）和分析接口限流（3.2）
2. **数据安全**：旧数据库**不会被覆盖**，迁移系统是增量式的。部署前备份即可
3. **邮件服务**：按第五节步骤配置腾讯云 SES，约 30 分钟可完成
