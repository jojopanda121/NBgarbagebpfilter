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
    buildEvidencePack: require("./_factPack").buildEvidencePack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    semanticGroundingAudit: require("./_groundingAudit").semanticGroundingAudit,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
  };
}

const SYSTEM = `你是顶级早期 VC 的尽调主导(Lead),正在为创始人会议准备追问清单。
你不是在写综述报告,而是在写"老板会带去会议室的 1 页弹药"——每条问题都要尖锐、可追溯、不可糊弄。

【硬性要求】
- 问题必须基于输入数据中的具体信号(claim_verdicts 已标记夸大/证伪、red_flags、估值偏离、维度低分等),不能凭空生造。
- 每条问题给一句 "evidence" 说明触发依据(指向哪条声明/哪个 finding),让被追问方知道你不是在 fishing。
- 每条问题必须给 verification_method 和 decision_standard, 让团队知道怎么验证、什么结果会影响投决。
- 每条问题 source_refs 必须引用 Fact Pack 的 F 或 D 编号,不得虚构编号。
- **D 编号** 是 BP 深度解析的 schema-validated 数字 (财务三表 / 单位经济 / 客户清单)；**来源本质仍是 BP 自报**，
  可信度低于上传材料和外部检索。两个用法：
    (1) 看到 D 编号里 confidence=missing 的字段 → **必须**衍生一条 financial / commercial 类追问
        (如 "BP 未披露 LTV/CAC，请提供 cohort 数据" / "前 3 大客户合同能否核验")。
    (2) 看到 D 编号有数字但与上传材料 / 外部检索冲突 → 衍生一条交叉验证追问
        ("BP 财报披露收入 X 亿，但外部公告口径为 Y 亿，差异请说明")。
- priority: 1 表示"不问就不能投",2 表示"重点问",3 表示"补强信息"。
- 5 大类至少 cover 4 类;数据完全空白的类目可以 0 条,不要硬凑。
- 中文输出,问题用第二人称("你们…")口吻,简洁,单条 ≤80 字。`;

const CATEGORY_INFO = {
  commercial: {
    label: "商业/市场",
    focus: "客户、市场空间、销售转化与商业化证据",
    owner: "投资经理",
    expected_format: "数据",
    verification_method: "核对客户清单、合同、订单、访谈纪要与第三方市场数据",
    decision_standard: "关键商业指标能被底层材料或客户访谈交叉验证",
  },
  technical: {
    label: "产品/技术",
    focus: "产品成熟度、技术指标、交付能力与可复制性",
    owner: "技术尽调",
    expected_format: "演示",
    verification_method: "查看产品演示、测试报告、专利材料与交付案例",
    decision_standard: "核心技术指标可复测,且与客户使用场景匹配",
  },
  financial: {
    label: "财务/估值",
    focus: "收入质量、成本结构、回款、融资需求与估值假设",
    owner: "财务尽调",
    expected_format: "文件",
    verification_method: "核对合同、发票、流水、审计报表、预测模型与估值参数",
    decision_standard: "收入和估值假设有可追溯凭证支撑,重大差异可解释",
  },
  legal: {
    label: "法务/合规",
    focus: "资质、知识产权、重大合同、监管合规与潜在纠纷",
    owner: "法务",
    expected_format: "文件",
    verification_method: "核验营业资质、知识产权、合同条款、诉讼记录与监管文件",
    decision_standard: "不存在影响交易推进的重大权属或合规瑕疵",
  },
  founder: {
    label: "团队/创始人",
    focus: "创始人履历、组织能力、关键岗位完整度与激励机制",
    owner: "合伙人",
    expected_format: "口头说明",
    verification_method: "访谈创始团队、核验履历、股权结构、期权池与关键岗位背景",
    decision_standard: "团队能力与当前阶段关键任务匹配,核心成员稳定",
  },
};

// ── 强监管赛道合规追问 ─────────────────────────────────────
// 不依赖 LLM 自由发挥：识别到强监管赛道关键词时，把对应赛道的合规追问 池
// 注入到 userMsg，强制 LLM 至少各引 1 条到 legal 类别。
// 编辑这张表时：keywords 用小写 + 中英文常见叫法；questions 写"投资人会真在
// 会议里问的句子"，不要写"是否合规"这种 yes/no 式问题。
const SECTOR_COMPLIANCE_PACKS = {
  cross_border_data: {
    label: "数据出境 / 个人信息",
    keywords: ["数据出境", "跨境数据", "海外用户", "海外客户", "personal data", "gdpr", "ccpa", "个保法", "pipl", "个人信息", "海外业务", "出海"],
    questions: [
      "你们处理的个人信息是否触发数据出境安全评估 / 标准合同 / 个保认证？走的是哪条路径？审批拿到了吗？",
      "境外 SaaS / 数据中心 / 子公司之间的数据流是否做过 PIPL + GDPR 双合规映射？映射表能否提供？",
      "对欧/美用户是否已经按 GDPR / CCPA 提供 DSR (Data Subject Request) 通道？响应 SLA 与样本日志能否调阅？",
    ],
  },
  medical_device: {
    label: "医疗器械 / 创新药",
    keywords: ["医疗器械", "创新药", "ivd", "nmpa", "三类证", "二类证", "ce 认证", "fda", "ind", "nda", "临床试验", "gcp", "gmp", "医保", "集采"],
    questions: [
      "核心产品 NMPA / FDA / CE 的注册路径与当前阶段（受理 / 临床 / 审评 / 拿证）能否提供官方回执号？预计取证时点？",
      "临床试验 GCP 合规与伦理委员会批件、知情同意书样本能否提供？是否有 SAE / SUSAR 报告？",
      "GMP / GSP 生产 / 流通资质是否已落地？最近 1 次药监飞检结果 + 整改记录？",
      "进入医保 / 集采的路径与预期降价幅度评估？若集采价 < 当前售价 X%，毛利率影响测算？",
    ],
  },
  ai_genai: {
    label: "AI 生成式 / 大模型",
    keywords: ["大模型", "llm", "生成式", "aigc", "foundation model", "训练数据", "生成式 ai", "deepseek", "embedding", "chatbot"],
    questions: [
      "训练数据来源中是否包含未授权版权 / 个人信息 / 开源协议冲突的部分？数据清单与授权链能否提供？",
      "国内是否完成《生成式 AI 服务管理暂行办法》安全评估备案 + 算法备案？备案号与上线时间？",
      "开源模型 / 第三方权重 / 数据集的 license 兼容性（Apache / MIT / Llama Custom / OpenRAIL）是否做过法律审查？",
      "你们对幻觉 / 偏见 / 越狱风险的红队测试报告 + 上线后人工审核 SLA？",
    ],
  },
  export_controlled: {
    label: "出口管制 / 半导体",
    keywords: ["半导体", "芯片", "光刻", "egfr", "出口管制", "实体清单", "eccn", "bis", "epp", "wassenaar", "管控物项", "国产替代"],
    questions: [
      "核心 BOM 中受 EAR / Wassenaar / 实体清单管制的物项清单？替代方案与替代时点？",
      "客户 / 销售对象中是否包含实体清单实体 / 军方背景客户？KYC 流程与禁运国筛查机制？",
      "美国设备 / IP / 软件被替换的进度（FAB / EDA / 光刻胶等）？关键节点 single-source 风险？",
    ],
  },
  fintech_licensed: {
    label: "金融 / 持牌",
    keywords: ["支付", "持牌", "银行", "保险", "信贷", "证券", "基金销售", "信用卡", "消费金融", "小贷", "财富管理", "反洗钱", "央行", "银保监"],
    questions: [
      "业务对应的金融牌照（支付 / 小贷 / 保险中介 / 基金销售）状态与年检结果？牌照主体与运营主体是否一致？",
      "反洗钱 (AML) + 客户身份识别 (KYC) 制度与近 1 年监管检查 / 处罚记录？",
      "若涉及助贷 / 联合贷，资金合作机构清单与资金成本 / 利率上限是否符合最新监管口径（24% / 36%）？",
    ],
  },
  edu_after_school: {
    label: "教育培训 / 双减",
    keywords: ["k12", "学科培训", "双减", "教培", "课后", "学前", "教育部"],
    questions: [
      "业务是否落在《双减》文件定义的学科 / 非学科范围内？最近 1 次教育主管部门核查结果？",
      "课时费 / 预收款政策是否符合『一次性收费不超过 3 个月或 60 课时』的硬性约束？合规调整方案？",
    ],
  },
  autonomous_driving: {
    label: "自动驾驶 / 出行",
    keywords: ["自动驾驶", "robotaxi", "l4", "高级辅助", "无人配送", "工信部", "智能驾驶"],
    questions: [
      "测试与示范运营牌照（工信部 / 各城市试点）的覆盖范围与有效期？跨城拓展的牌照 roadmap？",
      "数据安全分级保护（按《汽车数据安全管理若干规定》）落实情况？车载摄像头 / 高精地图测绘资质？",
    ],
  },
};

function detectSectors(factPack, project, params) {
  const corpus = [
    project?.industry, project?.name, params?.stage_context,
    ...(Array.isArray(factPack?.facts) ? factPack.facts.map((f) => `${f.label || ""} ${f.value || ""}`) : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hits = [];
  for (const [key, pack] of Object.entries(SECTOR_COMPLIANCE_PACKS)) {
    if (pack.keywords.some((kw) => corpus.includes(kw.toLowerCase()))) {
      hits.push(key);
    }
  }
  return hits;
}

function buildComplianceInjection(sectorKeys) {
  if (!sectorKeys.length) return "";
  const lines = [
    "",
    "【自动注入：强监管赛道合规追问】",
    "你的输入材料触发了以下赛道关键词。最终 questions[] **必须**至少各引 1 条（category 设为 legal），并把对应内容改写成结合项目具体情况的版本（保留事实定位，更换占位措辞）。priority 至少 ≤2。",
  ];
  for (const k of sectorKeys) {
    const p = SECTOR_COMPLIANCE_PACKS[k];
    lines.push("", `— ${p.label} —`);
    for (const q of p.questions) lines.push(`  · ${q}`);
  }
  return lines.join("\n");
}

function inferCategory(fact = {}) {
  const text = `${fact.field || ""} ${fact.label || ""} ${fact.value || ""}`.toLowerCase();
  if (/valuation|revenue|score|财务|估值|收入|融资|金额|评分/.test(text)) return "financial";
  if (/tech|product|trl|patent|产品|技术|专利|成熟度|研发/.test(text)) return "technical";
  if (/legal|compliance|standard|合同|法务|合规|资质|标准|诉讼/.test(text)) return "legal";
  if (/founder|team|创始|团队|履历|股权/.test(text)) return "founder";
  return "commercial";
}

function compactText(value, max = 110) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function buildRuleBasedChecklist(factPack) {
  const facts = Array.isArray(factPack?.facts) ? factPack.facts.filter((f) => f?.id) : [];
  if (facts.length === 0) return null;
  const targetCount = Math.min(12, Math.max(8, facts.length));
  const questions = [];

  for (let i = 0; i < targetCount; i++) {
    const fact = facts[i % facts.length];
    const category = inferCategory(fact);
    const info = CATEGORY_INFO[category];
    const evidence = `${fact.label || "事实信号"}: ${compactText(fact.value)}`;
    questions.push({
      category,
      question: `你们能否补充说明并提供材料验证: ${compactText(fact.label || fact.field || "关键事实", 36)}?`,
      priority: i < 3 ? 1 : (i < 8 ? 2 : 3),
      evidence,
      expected_format: info.expected_format,
      verification_method: info.verification_method,
      decision_standard: info.decision_standard,
      owner: info.owner,
      status: i < 4 ? "待收集" : "待访谈",
      source_refs: [fact.id],
    });
  }

  const usedCategories = [...new Set(questions.map((q) => q.category))];
  return {
    summary: "LLM 结构化输出校验失败,已基于事实包生成保守尽调问题清单。",
    categories: usedCategories.map((key) => ({
      key,
      label: CATEGORY_INFO[key].label,
      focus: CATEGORY_INFO[key].focus,
    })),
    questions,
  };
}

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
      minItems: 8,
      maxItems: 30,
      items: {
        type: "object",
        required: [
          "category", "question", "priority", "evidence", "expected_format",
          "verification_method", "decision_standard", "owner", "status", "source_refs",
        ],
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
      enable_semantic_audit: {
        type: "boolean",
        description: "可选。开启后，对生成的问题做语义抽样校验。默认走 env ENABLE_SEMANTIC_AUDIT。",
      },
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选。开启后并行跑 3 个 BP 深度解析 agent (财务三表/单位经济/客户清单)，结构化数字 (D-prefixed) 用于财务稽核点抽取。默认走 env ENABLE_BP_DEEP_PARSING。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {} }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const {
      callLLMJson, buildEvidencePack, formatFactPackForPrompt, assertGrounded,
      semanticGroundingAudit, summarizeFallback,
    } = _deps();
    const { LLMJsonValidationError } = require("../services/llmService");
    const { factPack, searchUsed, uploadCount, bpDeepUsed, bpDeepCount } = await buildEvidencePack(project, {
      ctx,
      skillId: "dd_questions",
      useSearch: true,
      materialsHint: params.stage_context || "",
      enableBpDeepParsing: params.enable_bp_deep_parsing,
    });

    const sectorHits = detectSectors(factPack, project, params);
    const complianceInjection = buildComplianceInjection(sectorHits);

    const userMsg = [
      formatFactPackForPrompt(factPack),
      "",
      "【focus_areas】",
      JSON.stringify(params.focus_areas || ["commercial", "technical", "financial", "legal", "founder"]),
      "",
      "【stage_context】",
      params.stage_context || "首次面谈前",
      complianceInjection,
      "",
      "请基于上述真实事实包,产出尽调追问清单 JSON。",
    ].filter(Boolean).join("\n");

    let data;
    let repairs = 0;
    let usedRuleBasedFallback = false;
    try {
      const r = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
        maxTokens: 8192, maxRepairs: 3,
        skillId: "dd_questions",
      });
      data = r.data;
      repairs = r.repairs;
    } catch (err) {
      if (err instanceof LLMJsonValidationError || err?.name === "LLMJsonValidationError") {
        data = buildRuleBasedChecklist(factPack);
        if (!data) {
          return {
            ok: false,
            error: `尽调问题生成未通过结构化校验,且事实包为空无法兜底：${(err.validationErrors || []).slice(0, 3).map((e) => `${e.path} ${e.message}`).join("；") || err.message}`,
            metadata: { validation_errors: err.validationErrors },
          };
        }
        repairs = 3;
        usedRuleBasedFallback = true;
      }
      if (!data) return { ok: false, error: `尽调问题生成失败：${err.message}` };
    }
    let audit;
    try {
      audit = assertGrounded(data, factPack, { requiredPaths: ["questions"] });
    } catch (groundingErr) {
      return {
        ok: false,
        error: `事实溯源审计失败：${groundingErr.audit?.errors?.join("；") || groundingErr.message}`,
        metadata: { grounding: groundingErr.audit },
      };
    }

    // 语义抽样校验 (opt-in)
    const enableSemantic = params.enable_semantic_audit === true
      || (params.enable_semantic_audit !== false && process.env.ENABLE_SEMANTIC_AUDIT === "1");
    let semanticAudit = null;
    if (enableSemantic) {
      semanticAudit = await semanticGroundingAudit(data, factPack, {
        sampleRate: 0.3, maxSamples: 12, skillId: "dd_questions",
      });
    }
    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `${data.questions.length} 条尽调问题`,
        payload: data,
      },
      metadata: {
        llm_repairs: repairs,
        grounding: audit,
        rule_based_fallback: usedRuleBasedFallback,
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        sector_compliance_hits: sectorHits,
        bp_deep_parsing_used: !!bpDeepUsed,
        bp_deep_fact_count: bpDeepCount || 0,
        semantic_audit: semanticAudit,
      },
    };
  },
  _private: { SCHEMA, buildRuleBasedChecklist, detectSectors, buildComplianceInjection, SECTOR_COMPLIANCE_PACKS },
};
