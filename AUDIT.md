# 上线前审查报告

审查日期：2026-06-22

## A. 覆盖清单

- 总文件数：486（以审查开始时 `git ls-files` 为准）
- 已 review 数：486
- 覆盖率：100%
- 审查方式：逐一读取/评估所有 git 跟踪文件。文本文件逐行阅读；`.png`、`.otf`、`.svg` 等二进制/资源文件按仓库必要性、引用路径、体积和生成来源评估；`server/db/migrations/` 作为 append-only 历史迁移只审查，不修改。

按顶层目录/文件汇总：

| 路径 | git 跟踪文件数 | review 数 | 结论 |
| --- | ---: | ---: | --- |
| `server/` | 327 | 327 | 已覆盖；迁移历史未修改 |
| `client/` | 125 | 125 | 已覆盖；构建产物未入 git |
| `doc-service/` | 9 | 9 | 已覆盖；删除误提交运行日志 |
| `scripts/` | 7 | 7 | 已覆盖；保留运维/测试入口 |
| 根目录配置/文档 | 15 | 15 | 已覆盖 |
| `logs/` | 2 | 2 | 已覆盖；删除误提交生成图 |
| `data/` | 1 | 1 | 已覆盖 |

## B. 已执行的删除（[DELETE]）

1. `doc-service/logs/doc-service-error.log`
   - 是什么：PM2/服务运行时错误日志。
   - 为何安全删除：日志内容是运行产物，不应作为源码发布；`.gitignore:38` 已忽略 `doc-service/logs/*.log`。
   - 引用搜索证据：`rg "doc-service-error.log"` 仅命中 `ecosystem.config.js:103` 的运行时输出配置，代码不读取该文件内容。

2. `doc-service/logs/doc-service-out.log`
   - 是什么：PM2/服务运行时标准输出日志。
   - 为何安全删除：运行产物，不参与启动、测试或构建；`.gitignore:38` 已覆盖。
   - 引用搜索证据：`rg "doc-service-out.log"` 仅命中 `ecosystem.config.js:104` 的运行时输出配置。

3. `logs/highlight-render-preview.png`
   - 是什么：`scripts/test-highlight-render.js` 生成的视觉预览图。
   - 为何安全删除：测试脚本会在需要时重新生成；源码不依赖该静态文件。
   - 引用搜索证据：`scripts/test-highlight-render.js:61` 只是写入输出路径；已在 `.gitignore:37` 增加 `logs/*.png` 防止再次误提交。

4. `server/utils/asyncHandler.js:1`
   - 是什么：重复的 Express async wrapper。
   - 为何安全删除：`server/middleware/errorHandler.js:48` 已提供同名实现并导出，行为一致。
   - 引用搜索证据：删除前唯一业务引用为 `server/routes/skills.js`；现已改为 `server/routes/skills.js:12` 从统一错误处理中间件导入。删除后 `rg "utils/asyncHandler|require\\(.*asyncHandler"` 无残留旧路径。

5. `server/tests/__mocks__/@anthropic-ai/sdk.js:1`
   - 是什么：Anthropic SDK 的 Jest mock。
   - 为何安全删除：仓库 LLM 后端已是 MiniMax M3；无运行时或测试代码引用 `@anthropic-ai/sdk`。
   - 引用搜索证据：删除依赖和 mapper 后，`rg "@anthropic-ai/sdk"` 在源码、测试和配置中无命中。

6. `server/package.json` / `server/package-lock.json` 中的 `@anthropic-ai/sdk`
   - 是什么：未使用的旧 LLM SDK 依赖。
   - 为何安全删除：无 import/require，无服务层使用，无测试依赖。
   - 引用搜索证据：`rg "@anthropic-ai/sdk"` 清零；`npm uninstall @anthropic-ai/sdk` 同步更新 lockfile。

## C. 已执行的重构（[REFACTOR]）

1. `server/routes/skills.js:12`
   - 修改前：从 `../utils/asyncHandler` 引入重复 wrapper。
   - 修改后：从 `../middleware/errorHandler` 引入 `{ asyncHandler }`，统一错误处理入口。
   - 行为影响：无。wrapper 实现保持 `Promise.resolve(fn(...)).catch(next)`。

2. `server/jest.config.js:7`
   - 修改前：`moduleNameMapper` 中保留 `^@anthropic-ai/sdk$` 的 stale mock 映射。
   - 修改后：仅保留当前测试实际需要的 `better-sqlite3` 和 `dotenv` mock。
   - 行为影响：无。被移除依赖已无测试引用。

3. `.gitignore:37`
   - 修改前：忽略 `logs/*.log`，但未忽略测试生成的 `logs/*.png`。
   - 修改后：增加 `logs/*.png`，防止视觉预览图再次入库。
   - 行为影响：无，仅影响版本控制清洁度。

## D. 待人工确认（[REVIEW]）

1. Root `pm2` 生产依赖存在 moderate 级别 npm audit 告警
   - 位置：`package.json:29`
   - 风险：`pm2 <7.0.0` ReDoS；传递依赖 `js-yaml <=4.1.1` merge key DoS。
   - 为何不擅自动手：修复建议为 `pm2@7.0.1`，是 semver major，可能影响部署/进程管理行为。
   - 建议：单独做 PM2 7 升级验证，至少覆盖 `npm start`、`npm run restart`、日志、生产环境变量和重启策略。

2. `doc-service` 在未配置 token 时跳过认证
   - 位置：`doc-service/main.py:34-49`、`ecosystem.config.js:93`、`docker-compose.yml:78-80`
   - 风险：PM2 配置绑定 `0.0.0.0:8001`；如果宿主机/防火墙暴露该端口且 `DOC_SERVICE_TOKEN` 为空，文档解析接口可被未授权调用。
   - 为何不擅自动手：当前注释明确保留本地开发向后兼容；强制 token 或改 bind host 会改变部署行为。
   - 建议：生产强制设置 `DOC_SERVICE_TOKEN`；PM2 生产环境考虑绑定 `127.0.0.1` 或由防火墙/反向代理限制 8001。

3. `server/assets/fonts/*.otf` 已被 git 跟踪但 `.gitignore` 表示字体不入 git
   - 位置：`.gitignore:40-42`、`server/assets/fonts/`
   - 风险：仓库体积增大；规则与实际状态不一致。
   - 为何不擅自动手：渲染服务可下载字体，但本地缓存字体有助于确定性部署和离线渲染，删除会影响构建/运行环境假设。
   - 建议：产品/运维确认策略：要么保留并更新 `.gitignore` 注释，要么改成部署阶段下载并从 git 移除。

4. Jest 开发依赖链存在 moderate audit 告警
   - 位置：`server/package-lock.json`
   - 风险：`npm audit` 全量扫描显示 17 个 moderate，集中在 Jest/istanbul 的开发依赖链。
   - 为何不擅自动手：`npm audit --omit=dev` 对 server 为 0，生产运行时不受影响；自动修复可能引入测试工具链大变动。
   - 建议：后续单独升级/替换测试工具链，或等待上游修复。

5. Workspace 上传路径的图片魔数校验可进一步收紧
   - 位置：`server/routes/workspace.js`、`server/routes/workspaceProjectChat.js`
   - 风险：扩展名和 MIME 白名单已存在，但相比 avatar/admin site image 路径，图片内容魔数校验更弱。
   - 为何不擅自动手：收紧上传策略可能影响现有用户文件兼容性。
   - 建议：上线后排期统一上传校验工具，所有图片路径使用相同 magic byte 校验。

## E. 安全 audit 结果

### Critical

- 未发现 Critical。

### High

- 未发现 High。

### Medium

1. Root `pm2` 生产依赖 DoS 告警
   - 位置：`package.json:29`
   - 问题：`npm audit --omit=dev` 报告 2 个 moderate：`pm2` ReDoS、传递 `js-yaml` DoS。
   - 修复建议：验证后升级到 `pm2@7.0.1` 或等待兼容补丁；部署前至少确认 PM2 入口不接收不可信配置。

2. `doc-service` token 可空且 PM2 绑定全网卡
   - 位置：`doc-service/main.py:35-49`、`ecosystem.config.js:93`
   - 问题：`DOC_SERVICE_TOKEN` 为空时认证中间件放行所有非 `/health` 请求。
   - 修复建议：生产环境必配 `DOC_SERVICE_TOKEN`；将 PM2 doc-service 绑定到 loopback 或由网络层限制。

### Low

1. Server 开发依赖 audit 告警
   - 位置：`server/package-lock.json`
   - 问题：17 个 moderate，均在 dev/test dependency chain；`npm audit --omit=dev` 为 0。
   - 修复建议：作为工程卫生项升级 Jest 生态依赖，不作为本次生产运行时 blocker。

2. 字体二进制跟踪策略不一致
   - 位置：`.gitignore:40-42`、`server/assets/fonts/`
   - 问题：忽略规则声称字体不入 git，但当前 `.otf` 已被跟踪。
   - 修复建议：确认部署策略后统一规则和实际仓库状态。

### 已核查且未发现问题

- 密钥/凭证：未发现 git 跟踪的 `.env`、私钥或真实 token；本地存在 `.env`、`.dev-jwt-secret`，均未被 git 跟踪，报告中未读取/暴露真实值。
- SQL 注入：动态 SQL 使用常量白名单或字段白名单；业务输入通过参数绑定传入。
- 认证/鉴权：敏感路由由 `requireAuth`/`requireAdmin` 覆盖；公开路由与分享 token 路由符合现有设计。
- CORS/Helmet/限流：后端已有安全中间件、CORS 白名单和核心限流配置。
- XSS：Markdown/HTML 下载路径使用 DOMPurify；前端主要以 React 渲染为主。
- 文件上传：主分析、头像、admin site image 路径具备大小、扩展名、MIME/魔数等校验；workspace 上传收紧建议见 [REVIEW]。
- 错误泄露：统一错误处理中间件生产环境隐藏 stack。

## F. 依赖与配置

- 已清理依赖：`server` 移除未使用的 `@anthropic-ai/sdk` 及 stale Jest mock。
- 需人工确认依赖：root `pm2` 建议升级到 `7.0.1`，但需要部署回归。
- 已清理配置：`.gitignore` 增加 `logs/*.png`。
- 已确认不应入库/未被跟踪：`.env`、`.dev-jwt-secret`、`node_modules/`、`client/build/`、运行日志。
- 需确认配置：`server/assets/fonts/*.otf` 跟踪状态与 `.gitignore` 注释不一致。

## G. 最终验证

1. `npm run lint`

```text
> bp-filter@3.0.0 lint
> cd server && npx eslint . --ext .js

Result: PASS
```

2. `npm run verify`

```text
> bp-filter@3.0.0 verify
> npm run test:server && npm run build:client

Test Suites: 44 passed, 44 total
Tests:       614 passed, 614 total
Snapshots:   0 total
Ran all test suites.

Creating an optimized production build...
Compiled successfully.

postbuild: react-snap crawled 9 out of 9 routes

Result: PASS
```

备注：测试期间出现的 `doc-service 不可达` 为现有测试内置跳过逻辑；本次本地未启动 doc-service，未导致失败。

---

# 深度审计补充（评分引擎 + multiagent 解耦残留）

补充日期：2026-06-22

说明：上文 A–G 节为首轮表层清理。本节为针对**评分引擎（`scoring*.js`）与 multiagent 按需生成（v4.8.0 解耦）**两块高风险区域的逐文件深审。首轮报告将这两块计入"100% 已审、未发现问题"，实际遗漏了下列死代码子系统——本节补全发现与处置。

## H. 深审发现与处置

### H-1 [DELETE·已执行] multiagent 解耦残留的死代码子系统（P1）

- 根因：v4.8.0 将 multiagent 投研结论从评分流水线摘除（改按需生成），但只在入口断流，下游管路全部保留空转。
- 证据链：
  - `server/services/pipelineService.js` 原 `const multiagent = null;` 写死 → `calculateScoring` 内所有 `if (multiagent && !multiagent.error)` 分支恒为假，永不执行。
  - 连带 `server/scoringEvidence.js`（440 行）整模块在生产中不可达：其导出的 `financialToVerdicts / valuationToVerdicts / mergeSpecialistEvidence` 仅被上述死分支调用（`fetchScoringEvidence` 是 `pipelineService` 自身定义的同名函数，与本模块无关）。
  - `server/config/scoringTables.js` 中 21 个映射表只服务于该死模块（团队/过往/护城河/财务异常/估值判定等），随之成为孤儿配置（外部引用数 = 0，逐表核验）。
  - 仅由单元测试（`scoringIntegrity.test.js` 的 F-10 块、`scoringEvidence.test.js`）以合成 `multiagent` 触发，生产路径从不触发。
- 风险定性：非运行期 bug（null 短路安全），但与 v4.8.0 文档化架构（"投研结论不再喂评分"）直接矛盾，且构成"再耦合地雷"——一旦有人解开 `multiagent = null`，评分会无声重新吃进专家结论。
- 处置（已彻底删除，经深审确认）：
  - 删除 `server/scoringEvidence.js`（−440）与 `server/tests/workspace/scoringEvidence.test.js`。
  - `server/services/pipelineService.js`：移除 `scoringEvidence` 导入、`scoringHarnessMode` 导入；`calculateScoring` 去掉 `multiagent` 入参与全部专家注入/合并分支，简化为纯 legacy 评分；`buildValuationComparison` 去掉 `multiagent` 入参与估值温度计死分支；`runPipeline` 去掉 `multiagent` 局部变量，数据飞轮调用显式传 `multiagent: null`；移除恒为 null 的 `specialist_audit` 结果字段（无前端消费者，已核）。（净 −133）
  - `server/config/scoringTables.js`：删除 21 个孤儿表及其区块注释与 `module.exports` 条目（导出 60 → 39，−170）。
  - `server/__tests__/scoringIntegrity.test.js`：删除 F-10「专家确定性结论计入 live 评分」describe 块及其失效的 `calculateScoring` 引用（−54）。
- 行为影响：无。删除的均为生产不可达分支，评分输出 byte-identical → **刻意不 bump `PIPELINE_VERSION`**（保持旧缓存有效，不作废用户已生成报告）。

### H-2 [REFACTOR·已执行] 引用已移除 Integrity Veto / 已删表的 stale 注释（P2）

- `server/scoring.js`：修正 `NO_VETO` 注释（澄清 `veto` 字段仅为回归断言保留、恒不触发）；修正 `_applyAggregation` 文档中"on 模式重新套用 Integrity Veto 封顶"——代码无此行为。
- `server/services/pipelineService.js`：修正 verdict 响应中 `integrity_veto` 字段注释为"v4.8.0 已移除、恒为 null、供 DB 列/校准表向后兼容"。
- `server/config/versions.js`：bump 指引移除已删除的 `scoringEvidence.js` 文件名。
- `server/config/scoringTables.js`：顶部"不要去改 scoringEvidence.js"改为指向 `scoring.js / scoringHarness.js`；S3 HARNESS 区块注释移除对已删 `BUSINESS_ARCHETYPE_SCORES / SCALE_MECHANISM_SCORES` 的引用。

## I. 深审待人工确认（[REVIEW]）

1. `integrity_veto` / `grade_overridden_from` 僵尸 DB 管路（P3）
   - 位置：`server/services/pipelineService.js`（verdict 响应）、`server/services/calibrationService.js`、migration 064。
   - 现状：`scoreProject` 从不设这两字段，落库恒为 null/0。
   - 为何未删：绑定 calibration DB 列，清理需配套迁移；上线前刻意不碰 DB 写路径。仅修注释。建议上线后随一次迁移清列。

2. S2 harness `scoring_shadow` 在主流水线已失效（解耦前即存在）
   - 位置：`server/services/pipelineService.js` 返回对象 `scoring_shadow` 字段。
   - 现状：主流水线 `calculateScoring` 强制 `modeOverride:"off"` 且无专家数据，`scoreProject` 不再产出 S2 `scoring_shadow`（S3/聚合 shadow 仍由 `scoreProject` 按全局开关正常附挂，不受影响）。
   - 为何未动：属 harness 灰度校准设计，非 P1 范围，且为解耦前既有状态。是否仍需 S2 shadow 校准数据，请产品/算法确认后单独处理。

## J. 深审后最终验证

```text
npm run lint                → 退出码 0（无告警）
cd server && npm test       → Test Suites: 43 passed, 43 total
                              Tests:       581 passed, 581 total
node -e require(scoringTables) → 导出 39（孤儿 0 残留 / 存活表 0 误删）
npm run build:client        → Compiled successfully
```

本节累计（含 A–G 首轮）：分支整体 26 insertions / 649 deletions。测试套件 44 → 43（删 scoringEvidence 套件）、用例 614 → 581（删死行为用例）。

## 对首轮报告（A–G）覆盖率声明的更正

A 节"已 review 486 / 覆盖率 100%、评分引擎已覆盖且未发现问题"与实际不符：评分引擎存在本节 H-1 所述 440 行死模块 + 170 行孤儿表 + 多处死分支，首轮未识别。结论应更正为：**首轮为表层清理（低风险删除），评分引擎/multiagent 的深层死代码由本节深审补全。**
