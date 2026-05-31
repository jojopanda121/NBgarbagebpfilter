# Skill: BP Pipeline Playbook

## 触发场景
当北京后端通过 `runBpPipeline` 入口调用，请求"对这份 BP 做完整投研拆解"时加载本 skill。

输入：
- `bpText` —— BP 全文（脱敏后；公司名/收入/估值等商业字段保留）
- `extractedData` —— 北京 Agent A 的结构化抽取（含 TAM / CAGR / TRL / 等数字）

输出：**严格按下面的 JSON schema** 回复一个 JSON 对象，不要 markdown wrap。

## 工作流

执行以下 6 个分析视角，可并行思考，但最终汇成一个 JSON：

1. **project_summary** — 标的一句话定位 / 行业 / 阶段 / 商业模式 / 护城河
2. **founder_profile** — 创始团队履历、过往业绩、关键岗位缺口、风险标签
3. **financial_analysis** — 收入质量 / Unit Economics / Burn & Runway / 异常项 / 可信度评级
4. **competitor_analysis** — 已确认竞品 + 待确认假设竞品（分开列）/ 赛道定义 / 差异化判断
5. **valuation_analysis** — 声称估值 / 共识区间 / 隐含稀释 / 偏贵/合理/便宜的 verdict
6. **red_flags** — 红旗清单（critical/major/minor 三级）+ 最终 Go/Follow-up/Pass/Archive

## JSON Schema（必须严格遵守）

```json
{
  "project_summary": {
    "one_liner": "string",
    "project_name": "string",
    "industry": "string",
    "stage": "string",
    "business_model": "string",
    "moat_summary": "string"
  },
  "founder_profile": {
    "founders": [
      { "name": "string", "title": "string", "past_ventures": [], "strengths": "string", "gaps": "string" }
    ],
    "team_assessment": "string",
    "risk_flags": []
  },
  "financial_analysis": {
    "revenue": { "...": "..." },
    "unit_economics": { "...": "..." },
    "burn_runway": { "...": "..." },
    "anomalies": [],
    "overall_credibility": "high|medium|low"
  },
  "competitor_analysis": {
    "competitors": [
      { "name": "string", "confirmed": true, "positioning": "string" }
    ],
    "track_definition": "string",
    "differentiation": "string"
  },
  "valuation_analysis": {
    "claimed_valuation": { "...": "..." },
    "consensus_range": { "...": "..." },
    "implied_dilution": { "...": "..." },
    "verdict": { "position": "expensive|fair|cheap", "reasoning": "string" }
  },
  "red_flags": {
    "red_flags": [
      { "category": "string", "severity": "critical|major|minor", "description": "string", "evidence": "string" }
    ],
    "overall_recommendation": {
      "verdict": "Go|Follow-up|Pass|Archive",
      "deal_breaker_count": 0,
      "reasoning": "string"
    }
  }
}
```

## 硬约束

- **必须**返回完整 6 个字段，缺一个都会导致北京端回退到 legacy orchestrator
- **不要**加 markdown code fence（北京端解析的是裸 JSON）
- **不要**输出"以下是分析"这种说明性前缀
- 数字缺失时填 `null`，**不要**编造
- `red_flags.overall_recommendation.verdict` 必须是 4 选 1，不能空
- 引用 BP 原文事实时，原文里出现的占位符（如 [FOUNDER_1]、[PHONE_3]）原样保留，北京端会反脱敏

## 失败处理
- 如果 BP 文本不可解析或字段大量缺失，**仍然**返回完整 6 字段对象，把无法判断的部分填 `null` 或简短"信息不足"字符串
- 北京端 schema 校验失败时会 fallback 到旧 orchestrator
