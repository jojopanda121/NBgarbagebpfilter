# NBgarbageBPFilter 改造框架 v1.0

> 基于对 tyb（二级市场招股书分析）架构的借鉴，结合一级市场 BP 分析业务本质差异，
> 起草的本 repo 的分阶段改造蓝图。
>
> **核心定位**：tyb 在「读」海量信息，我们在「验」片面陈述。
> 不做"简化版 tyb"，而是把 tyb 的**工程成熟度**嫁接到完全不同的业务场景。

---

## 0. 现状 & 问题诊断

当前代码路径：

```
doc-service/main.py                    文档整体抽文→文本过少降级OCR→一次性返回全文
server/services/extractionService.js   HTTP 调 doc-service，返回字符串
server/services/pipelineService.js     Agent A 提取 → Agent B 声明核查 → 三路并行
server/scoring.js                      LLM 给 TAM/CAGR/TRL 等原始值 → JS 公式打分
server/utils/prompts.js                一套 prompt 走天下，无赛道差异
server/services/qccService.js          QCC CLI 封装已存在，但未接入 pipeline
server/services/ddService.js           针对存疑声明生成"核实方法"，由用户手工填
```

**三个结构性短板**：

1. **单一模板、跨赛道通吃** — SaaS 和硬科技用同一 prompt、同一打分公式，违反一级市场"赛道决定一切"的常识。
2. **证据链断裂** — 分数落地到维度层级，但**上游的 claim 既不持久化也不带来源页、stance、外部验证状态**，不可追溯。
3. **外部交叉缺位** — qccService 存在但未并入 pipeline，没有 Serper/LinkedIn/公开研报的并发验证层，导致"BP 自述 → LLM 打分"这一链路的专业性上限被锁死。

---

## 1. 目标架构（8 阶段流水线）

```
┌──────────────────────────────────────────────────────────────┐
│ Stage 1: 文档接入（page-level + SHA256 缓存）                │
│  doc-service/main.py 改造 + extractionService.js 兼容        │
│  - 逐页独立判决：文本 < 50 字的页单独 OCR，其余页直提         │
│  - 返回 { pages: [{idx, text, mode}], full_text, sha256 }    │
│  - 文件指纹级缓存（同文件不重复解析）                         │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 2: 赛道识别（轻量 LLM）                                │
│  NEW: server/services/industryClassifier.js                  │
│  - 单次 LLM 调用（<1k token）返回 industry_slug              │
│  - industry_slug ∈ {saas, hardtech, consumer, biotech,       │
│                     b2b_enterprise, fintech, default}        │
│  - 加载对应 YAML 模板进入 Stage 3                             │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 3: BP 内部抽取（模板驱动，按条作答）                    │
│  NEW: server/services/claimExtractor.js                      │
│  - 读取 templates/{industry_slug}.yaml 里 30-50 个 claim_slot │
│  - 一次 LLM 调用，对每个 slot 返回：                          │
│      { claim_id, content, source_pages, stance, missing }    │
│  - 落入 Claim Registry（见 §3），此时全部 self_reported_only │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 4: 外部验证（并发 + 指数退避兜底）                      │
│  NEW: server/services/externalVerifier.js  （编排器）        │
│  ├─ qccService.js（已存在，接入）→ 工商/股东/融资/诉讼       │
│  ├─ NEW: serperService.js → 公司/产品/创始人 Google 搜索     │
│  ├─ NEW: linkedinService.js（经 Serper site: 或第三方）     │
│  └─ NEW: marketDataService.js → 艾瑞/灼识/公开研报 TAM       │
│  - 每个 claim 最多并发查 3-5 个源；单源失败退下一源           │
│  - 全失败兜底为 verification_status = "no_external_data"     │
│  - claim 维度查询结果 24h 缓存（按 company + claim_type）    │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 5: 夸大检测（BP 特有）                                  │
│  NEW: server/services/inflationDetector.js                   │
│  - TAM 自述 vs marketDataService 返回的第三方口径 → 倍数     │
│  - 增速自述 vs 行业中位数                                     │
│  - 团队"前 XX VP / P8 / 负责过 YY" vs LinkedIn/工商任职记录  │
│  - 产出 inflation_risk ∈ {low, medium, high} + 证据链        │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 6: 赛道特化打分（改造 scoring.js）                      │
│  - 读 templates/{industry_slug}.yaml 的 weights + formulas   │
│  - 每个维度只喂与之关联的 claim（见模板 dimension.claims）   │
│  - 每条打分必须引用 claim_id，不引用则按"不可验证"扣分       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 7: DD 问题生成（改造 ddService.js）                     │
│  - missing claim → "BP 未说明 X，建议会面确认"               │
│  - contradicted claim → "自述 X，外部显示 Y，需解释差异"     │
│  - high inflation_risk → "核实 TAM 口径是否包含 ..."         │
│  - 每条问题绑定 claim_id，用户答复后触发 Stage 8 重算         │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ Stage 8: 增量合并（后期补材料）                               │
│  - 同一 project_id 下新上传财务表/访谈纪要/尽调材料           │
│  - 指向同一个 Claim Registry，追加 claim 或更新               │
│    verification_status + external_evidence                   │
│  - 自动重跑 Stage 6-7，得到新分数 + 新 DD 问题清单            │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Claim Registry 数据模型（跨阶段唯一事实源）

单一真相表：`claims`（新建 migration `020_claim_registry.sql`）

```sql
CREATE TABLE claims (
  claim_id              TEXT PRIMARY KEY,         -- C_TEAM_003 / C_MKT_001
  project_id            INTEGER NOT NULL,
  task_id               TEXT,                     -- 首次产生该 claim 的分析任务
  category              TEXT NOT NULL,            -- market | team | tech | product | competition | financial | valuation
  slot_key              TEXT,                     -- 来自 YAML 模板，用于重跑对齐
  content               TEXT NOT NULL,
  stance                TEXT NOT NULL,            -- fact | judgment | projection
  source_doc            TEXT NOT NULL,            -- bp_v2.pdf / 访谈_20260417.docx
  source_pages          TEXT,                     -- JSON [12, 13]
  verification_status   TEXT NOT NULL,            -- self_reported_only | verified | contradicted | no_external_data
  confidence            REAL,                     -- 0.0 - 1.0
  inflation_risk        TEXT,                     -- low | medium | high | null
  external_evidence     TEXT,                     -- JSON array
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_claims_project ON claims(project_id);
CREATE INDEX idx_claims_task ON claims(task_id);
```

代码侧封装：`NEW server/services/claimRegistry.js`

```js
createClaims(projectId, taskId, claims[])            // Stage 3 批量插入
updateVerification(claimId, status, evidence[])      // Stage 4 回写
updateInflation(claimId, risk, evidence)             // Stage 5 回写
listByProject(projectId, { categories, statuses })   // Stage 6-8 读
getByClaimIds(ids[])
```

---

## 3. 赛道模板（YAML 驱动，确定性 planning）

目录：`server/templates/`

```
server/templates/
  ├─ saas.yaml
  ├─ hardtech.yaml
  ├─ consumer.yaml
  ├─ biotech.yaml
  ├─ b2b_enterprise.yaml
  ├─ fintech.yaml
  └─ default.yaml          # 兜底：对齐现有 5 维
```

**YAML 结构**（以 saas.yaml 为骨架示例）：

```yaml
industry_slug: saas
version: 1
claim_slots:
  - key: arr_current
    category: financial
    prompt_hint: "当前 ARR（Annualized Recurring Revenue），单位：万元人民币"
    required: true
    stance: fact
  - key: ndr
    category: financial
    prompt_hint: "Net Dollar Retention，百分比数字（120 表示 120%）"
    required: true
    stance: fact
  - key: cac_payback_months
    category: financial
    prompt_hint: "CAC 回本周期，月"
    required: true
    stance: fact
  - key: logo_expansion_rate
    category: business_validation
    prompt_hint: "Logo 扩张：过去 12 个月新增付费客户数"
    required: false
    stance: fact
  - key: founder_saas_years
    category: team
    prompt_hint: "创始人在 SaaS/B2B 领域的直接从业年数"
    required: true
    stance: fact
  # ... 共 30-50 条

external_sources:
  qcc: true
  serper: true
  linkedin: true
  market_data: true

dimensions:
  timing_ceiling:
    weight: 0.20
    claims: [arr_current, tam_bottom_up, cagr]
    formula: |
      log_tam = min(60, 17.5 * log10(max(1, TAM_Million_RMB)))
      cagr_score = min(40, cagr)
      score = log_tam + cagr_score
  product_moat:
    weight: 0.25
    claims: [product_differentiators, trl, moat_type]
    formula: "0.4 * trl/9*100 + 0.6 * rank*10"
  business_validation:
    weight: 0.25
    claims: [arr_current, ndr, cac_payback_months, logo_expansion_rate]
    formula: |
      ndr_score = clamp((ndr - 80) * 2, 0, 50)
      payback_score = clamp((24 - cac_payback_months) / 24 * 50, 0, 50)
      score = ndr_score + payback_score
  team:
    weight: 0.20
    claims: [founder_saas_years, team_completeness, track_record]
    formula: "..."
  external_risk:                     # 诚信度：claim registry 聚合
    weight: 0.10
    source: claim_registry_aggregate
```

**关键原则**：
- 模板一旦加载，确定 pipeline 所有下游的 prompt 占位符、维度权重、DD 问题模板。
- **不让 LLM 决定"分析什么"，LLM 只填空**。（tyb v0.3 最成熟的思想）
- 新增赛道 = 加一个 YAML，不改代码。

---

## 4. 服务层改造清单（文件级）

### 4.1 改造（Modify）

| 文件 | 改动 |
|---|---|
| `doc-service/main.py` | 逐页独立判决（页文本 <50 字再单独 OCR），返回 `{pages, full_text, sha256}`；新增 `/health` 已有，保持。 |
| `server/services/extractionService.js` | 返回结构从 `string` 改为 `{pages, full_text, sha256}`；对调用方保持 `extracted.full_text` 向后兼容。 |
| `server/services/pipelineService.js` | 拆为 `orchestrator` 骨架：调用 classifier → claimExtractor → externalVerifier → inflationDetector → scoring。批次核查 / 三路并行的旧逻辑迁到 `default.yaml` 兜底分支。 |
| `server/scoring.js` | 增加 `scoreFromTemplate(template, claims)`：遍历 dimensions，按 formula 求值，每条分数附带 `evidence_claim_ids`。保留旧函数（default 模板调用）。 |
| `server/services/qccService.js` | 接入 externalVerifier；把返回结构规范为 `{ source:"qcc", evidence_type, raw, normalized }`。 |
| `server/services/ddService.js` | `generateDDMethods` 的触发源从 `claim_verdicts` 改为 claim registry 的 `contradicted / no_external_data / high inflation_risk`。 |
| `server/utils/prompts.js` | 保留 `AGENT_A_PROMPT` 为 default.yaml 兜底；新赛道的 prompt 由 templateLoader 动态拼装。 |

### 4.2 新增（Create）

| 文件 | 职责 |
|---|---|
| `server/services/templateLoader.js` | 读 YAML → 内存缓存 → 对外提供 `getTemplate(slug)` / `renderPrompt(slug, vars)`。 |
| `server/services/industryClassifier.js` | 一次轻量 LLM 调用，输出 industry_slug。 |
| `server/services/claimExtractor.js` | 按模板 slot 抽取，产出 Claim Registry 记录。 |
| `server/services/externalVerifier.js` | 并发编排 qcc + serper + linkedin + marketData；pLimit + 指数退避 + 兜底。 |
| `server/services/serperService.js` | Google 搜索（已有 SERPER_API_KEY），返回结构化证据。 |
| `server/services/linkedinService.js` | 先走 `site:linkedin.com` 经 serper，未来可接第三方 API。 |
| `server/services/marketDataService.js` | TAM 第三方口径查询（MVP 用 serper + 关键词 + LLM 摘要）。 |
| `server/services/inflationDetector.js` | 数字对比 + 履历对比，产出 `inflation_risk`。 |
| `server/services/claimRegistry.js` | SQLite CRUD，跨阶段唯一数据出入口。 |
| `server/templates/*.yaml` | P1 先 SaaS，P3 扩充其它赛道。 |
| `server/db/migrations/020_claim_registry.sql` | 见 §2。 |
| `server/db/migrations/021_doc_hash_cache.sql` | SHA256 → parsed_text 缓存表。 |

### 4.3 保留不动

`authController / adminService / emailService / quotaService / tokenService / trackingService / userService` — 与业务流水线正交，无需触动。

---

## 5. 分阶段落地优先级

### P0（本周）— 稳住解析入口
- [ ] `doc-service/main.py` 逐页独立判决 + OCR 兜底
- [ ] `021_doc_hash_cache.sql` 文件 SHA256 缓存表
- [ ] `extractionService.js` 命中缓存直接返回
- [ ] 保留现有 pipeline 不改

**验收**：同一个 PDF 二次上传 < 200ms 返回；单页 OCR 失败不影响其他页。

### P1（下周）— SaaS 赛道闭环 = "不专业" 问题的根治
- [ ] `saas.yaml` 模板（30-50 claim_slot + 5 dimension 公式）+ `default.yaml` 兜底
- [ ] `templateLoader.js` / `industryClassifier.js` / `claimExtractor.js`
- [ ] `claimRegistry.js` + migration 020
- [ ] `scoring.js` 新增 `scoreFromTemplate`
- [ ] pipelineService 判断 industry_slug：SaaS 走新链路，其它继续走老链路
- [ ] **此阶段不接外部 API**，输出依然是"BP → 结构化 claim → 分数"，质量靠模板本身逼 LLM 按条作答

**验收**：同一份 SaaS BP，新链路输出的每条维度分数能点开看到所引用的 3-8 条 claim_id 及其原文页码。

### P2（两周内）— 接入外部验证 = 市面上 95% 工具做不到的点
- [ ] `serperService.js`（含 pLimit 并发 + 指数退避 + 启发式兜底）
- [ ] `externalVerifier.js` 编排器
- [ ] `qccService.js` 接入（现有 CLI 封装已存在，补 Normalized 层）
- [ ] `linkedinService.js`（MVP：site:linkedin.com）
- [ ] `marketDataService.js`（MVP：serper + LLM 摘要）
- [ ] Claim 维度结果 24h 缓存

**验收**：SaaS BP 的每条 fact 类 claim 带上 `verified / contradicted / no_external_data` 之一；可追溯到外部证据链接。

### P3（一个月内）— 产品化深度
- [ ] `inflationDetector.js`（TAM、增速、团队履历三路）
- [ ] `ddService.js` 重构：从 claim registry 生成 DD 问题 + 用户答复触发重算
- [ ] 扩充模板：`hardtech.yaml` / `consumer.yaml` / `biotech.yaml`
- [ ] Stage 8 增量合并：新增 doc（访谈/财务/尽调）→ 追加 claim → 重跑 6-7

**验收**：同一个项目二次上传财务 Excel，系统不重做 Stage 3，仅追加 financial 类 claim，分数和 DD 问题同步更新。

---

## 6. 兼容与迁移策略

- **前端接口零变更**：`runPipeline` 的最终 return 结构（`verdict.total_score / dimensions / claim_verdicts` 等）保持不变。新字段（`claim_ids / verification_status / inflation_risk`）只是**追加**，旧前端忽略即可。
- **灰度切换**：pipelineService 内 `if (template.industry_slug === "saas")` 走新链路，否则走老链路；每完成一个赛道模板打开一个 flag。
- **数据迁移**：`claims` 表为新建，历史任务不补；从 P1 上线日期开始建立事实源。

---

## 7. 风险 & 非目标

**风险**：
1. YAML 模板质量 = 系统质量。SaaS 模板需要真正懂 SaaS 的人 review（不是 LLM 自己生成了事）。
2. 外部 API 失败率不可控 — 必须严格执行"全失败不伪造事实，标 no_external_data"。
3. Claim registry 一旦建起来，schema 变更成本变高，020 migration 设计要谨慎。

**非目标（明确不做）**：
- ❌ 不搬 tyb 的页级 topic 索引（BP 20-80 页塞得下全文）
- ❌ 不搬 tyb 的 7 个 research sub-crew（外部验证才是一级市场的重点）
- ❌ 不产出长篇 Markdown 研究报告（投资人要的是决策卡 + DD 清单）
- ❌ 不加 gate agent（tyb v0.3 已废弃）

---

## 8. 下一步

优先产出 **`server/templates/saas.yaml` 草案** — 这是 P1 的全部基石，模板一确定其它代码改造都顺着它走。SaaS 模板评审通过后再启动 P1 编码。
