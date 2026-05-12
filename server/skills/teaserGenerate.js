// ============================================================
// skills/teaserGenerate.js — 脱敏 Teaser 内容生成
//
// Teaser ≠ 一页 PPT。Teaser 是发给"还没签 NDA 的潜在 LP/共投方"的诱饵:
//   - 公司名 → 代号(Project Cipher-7A)
//   - 创始人 → "连续创业者,前 X 行业 Y 年"
//   - 收入/估值 → 区间("ARR 区间 1000-2000 万")
//   - 客户 → 行业(把"招商银行"换成"Top-3 国有股份行")
// 目标:对方看完愿意签 NDA / 上桌细聊,但拿不到任何能反向定位公司的数据。
//
// 输出严格 JSON,后续由 teaserShare.js 加密成可分享链接。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildContext: require("./_projectContext").buildContext,
  };
}

const SYSTEM = `你正在为一家早期项目撰写"匿名 Teaser"——发给还没签 NDA 的潜在投资方,目的是把对方钓到桌上来。

【最关键的纪律】
1. **绝对禁止**输出能反向定位公司的信息:
   - 公司全名 / 任何包含公司名的产品名
   - 创始人真名 / 公司具体地址 / 域名 / 邮箱 / 电话
   - 已合作客户的具体公司名(改成行业 + 规模描述)
   - 投资方名字(若 BP 提到老股东)
2. **数字必须区间化**:
   - ARR / 估值 / 用户数 → 落到合理区间(如"1000-2000 万 ARR"、"Pre-A 1.5-2.5 亿估值")
   - 团队规模 → 区间(如"30-50 人")
   - 时间 → 季度精度(如"2024 H2 上线",不是"2024 年 9 月 13 日")
3. **可以保留的**:行业 / 商业模式 / 技术路线类别 / TRL / 商业进展形容(早期/PMF 验证中/规模化)
4. **codename**: 你来起一个"投行风格"的项目代号,如 "Project Helios"、"Project Aurora"。
5. **why_now**: 为什么"现在"是投这个赛道的窗口——这是 teaser 钓鱼的核心。
6. **investor_fit**: 这家项目最适合什么样的 LP/GP 来谈(产业方/财务投资人/特定阶段基金),帮收件人自我筛选。

输出语气专业克制,英文表述里夹中文也可以(投行习惯)。`;

const SCHEMA = {
  type: "object",
  required: ["codename", "headline", "sector", "stage", "why_now", "highlights", "metrics_band", "ask", "investor_fit"],
  additionalProperties: false,
  properties: {
    codename: { type: "string", minLength: 4, maxLength: 40 },
    headline: { type: "string", minLength: 10, maxLength: 200 },
    sector: { type: "string", maxLength: 80 },
    stage: { type: "string", maxLength: 40 },
    geo: { type: "string", maxLength: 60 },
    why_now: { type: "string", minLength: 20, maxLength: 500 },
    highlights: {
      type: "array", minItems: 3, maxItems: 5,
      items: {
        type: "object",
        required: ["title", "desc"],
        additionalProperties: false,
        properties: {
          title: { type: "string", maxLength: 40 },
          desc: { type: "string", maxLength: 200 },
        },
      },
    },
    metrics_band: {
      type: "object",
      additionalProperties: false,
      properties: {
        arr_band_rmb: { type: "string" },
        valuation_band_rmb: { type: "string" },
        team_size_band: { type: "string" },
        traction_note: { type: "string", maxLength: 200 },
      },
    },
    team_brief: { type: "string", maxLength: 300 },
    ask: {
      type: "object",
      required: ["round", "amount_band_rmb"],
      additionalProperties: false,
      properties: {
        round: { type: "string" },
        amount_band_rmb: { type: "string" },
        use_of_funds: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", maxLength: 100 } },
      },
    },
    investor_fit: {
      type: "array", minItems: 1, maxItems: 4, items: { type: "string", maxLength: 150 },
    },
    redacted_disclaimer: { type: "string", maxLength: 200 },
  },
};

module.exports = {
  id: "teaser_generate",
  title: "脱敏 Teaser 内容",
  description: "生成可发给未签 NDA 投资方的匿名项目 teaser,自动脱敏公司/创始人/客户/具体数字",
  category: "share",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      tone: {
        type: "string",
        enum: ["concise", "narrative"],
        description: "concise = 投行点列体, narrative = 略加故事化叙事",
      },
      hide_geo: { type: "boolean", description: "true 时连地区也脱敏(只写'境内/境外')" },
    },
    additionalProperties: false,
  },

  async run({ project, params }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildContext } = _deps();
    const projectCtx = buildContext(project);

    const userMsg = JSON.stringify({
      project_context: projectCtx,
      tone: params.tone || "concise",
      hide_geo: !!params.hide_geo,
      instructions: "请按 schema 产出脱敏 teaser。所有可识别信息必须替换或区间化。",
    }, null, 2);

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, { maxTokens: 4096, maxRepairs: 2 });

    // 服务端二次脱敏兜底:扫描 highlights/why_now 里如果意外出现了 project.name,直接替换
    if (project.name) {
      const reName = new RegExp(escapeRegex(project.name), "g");
      const replaceLeak = (s) => typeof s === "string" ? s.replace(reName, data.codename) : s;
      data.headline = replaceLeak(data.headline);
      data.why_now = replaceLeak(data.why_now);
      data.team_brief = replaceLeak(data.team_brief);
      data.highlights = data.highlights.map((h) => ({
        title: replaceLeak(h.title),
        desc: replaceLeak(h.desc),
      }));
    }

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `Teaser — ${data.codename}`,
        payload: data,
      },
      metadata: { llm_repairs: repairs },
    };
  },
};

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
