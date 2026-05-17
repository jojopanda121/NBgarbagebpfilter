// ============================================================
// skills/ddQuestions.js — 尽调问题清单生成
//
// 一级市场最常用的"项目当面交流前给老板的弹药":
// 基于已识别的 red_flag / claim_verdicts / 估值差距,反向构造 15-25 条
// 切中要害的尽调追问,按 commercial / technical / financial / legal /
// founder 五大类组织,每条带 priority 和"为什么问"的依据。
// ============================================================

// 懒加载:服务模块依赖 config/db,注册阶段不触发
function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildFactPack: require("./_factPack").buildFactPack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
  };
}

const SYSTEM = `你是顶级早期 VC 的尽调主导(Lead),正在为创始人会议准备追问清单。
你不是在写综述报告,而是在写"老板会带去会议室的 1 页弹药"——每条问题都要尖锐、可追溯、不可糊弄。

【硬性要求】
- 问题必须基于输入数据中的具体信号(claim_verdicts 已标记夸大/证伪、red_flags、估值偏离、维度低分等),不能凭空生造。
- 每条问题给一句 "evidence" 说明触发依据(指向哪条声明/哪个 finding),让被追问方知道你不是在 fishing。
- 每条问题必须给 verification_method 和 decision_standard, 让团队知道怎么验证、什么结果会影响投决。
- 每条问题 source_refs 必须引用 Fact Pack 的 F 编号,不得虚构编号。
- priority: 1 表示"不问就不能投",2 表示"重点问",3 表示"补强信息"。
- 5 大类至少 cover 4 类;数据完全空白的类目可以 0 条,不要硬凑。
- 中文输出,问题用第二人称("你们…")口吻,简洁,单条 ≤80 字。`;

const SCHEMA = {
  type: "object",
  required: ["categories", "questions", "summary"],
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 10, maxLength: 300 },
    categories: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        required: ["key", "label", "focus"],
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: ["commercial", "technical", "financial", "legal", "founder"] },
          label: { type: "string" },
          focus: { type: "string", maxLength: 200 },
        },
      },
    },
    questions: {
      type: "array",
      minItems: 12,
      maxItems: 30,
      items: {
        type: "object",
        required: [
          "category", "question", "priority", "evidence", "expected_format",
          "verification_method", "decision_standard", "owner", "status", "source_refs",
        ],
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["commercial", "technical", "financial", "legal", "founder"] },
          question: { type: "string", minLength: 5, maxLength: 200 },
          priority: { type: "integer", minimum: 1, maximum: 3 },
          evidence: { type: "string", maxLength: 300 },
          expected_format: {
            type: "string",
            enum: ["数据", "文件", "演示", "案例", "口头说明"],
          },
          verification_method: { type: "string", minLength: 4, maxLength: 240 },
          decision_standard: { type: "string", minLength: 4, maxLength: 240 },
          owner: { type: "string", enum: ["投资经理", "财务尽调", "技术尽调", "法务", "合伙人"] },
          status: { type: "string", enum: ["待收集", "待访谈", "待第三方验证", "已完成"] },
          source_refs: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string" },
          },
        },
      },
    },
  },
};

module.exports = {
  id: "dd_questions",
  title: "尽调追问清单",
  description: "基于已识别风险与夸大声明,生成 15-25 条会议级尽调问题,按主题分类带依据",
  category: "research",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      focus_areas: {
        type: "array",
        items: { type: "string", enum: ["commercial", "technical", "financial", "legal", "founder"] },
        description: "可选,只生成指定类目;空表示全部",
      },
      stage_context: {
        type: "string",
        description: "可选,如 '种子轮首谈' / 'A 轮投决前' — 影响问题侧重",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildFactPack, formatFactPackForPrompt, assertGrounded } = _deps();
    const { factPack } = buildFactPack(project);

    const userMsg = [
      formatFactPackForPrompt(factPack),
      "",
      "【focus_areas】",
      JSON.stringify(params.focus_areas || ["commercial", "technical", "financial", "legal", "founder"]),
      "",
      "【stage_context】",
      params.stage_context || "首次面谈前",
      "",
      "请基于上述真实事实包,产出尽调追问清单 JSON。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, { maxTokens: 4096, maxRepairs: 2 });
    const audit = assertGrounded(data, factPack, { requiredPaths: ["questions"] });

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `${data.questions.length} 条尽调问题`,
        payload: data,
      },
      metadata: { llm_repairs: repairs, grounding: audit },
    };
  },
};
