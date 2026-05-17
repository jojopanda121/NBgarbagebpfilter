const { validate } = require("../../utils/jsonSchema");

describe("standardized workspace tools · registry and routing", () => {
  test("new standardized skills are registered", () => {
    const skills = require("../../skills");
    skills.init();
    const ids = skills.registry.list().map((s) => s.id);
    expect(ids).toContain("founder_interview_docx");
    expect(ids).toContain("competitor_matrix_xlsx");
    expect(ids).toContain("ic_questions_xlsx");
  });

  test("Host native tool schema exposes standardized tools", () => {
    const ws = require("../../services/workspaceService");
    const names = ws.HOST_TOOL_SCHEMAS.map((t) => t.name);
    expect(names).toContain("founder_interview_docx");
    expect(names).toContain("competitor_matrix_xlsx");
    expect(names).toContain("ic_questions_xlsx");
  });

  test("routing maps user intent to standardized skills", () => {
    const ws = require("../../services/workspaceService");

    expect(ws.inferRoutingFromText("生成一份创始人访谈提纲 Word").tools).toEqual(["founder_interview_docx"]);
    expect(ws.inferRoutingFromText("帮我做竞品对比矩阵 Excel").tools).toEqual(["competitor_matrix_xlsx"]);
    expect(ws.inferRoutingFromText("生成 IC 投委问题清单，左右脑互搏").tools).toEqual(["ic_questions_xlsx"]);

    expect(ws.taskTypeToTool("generate_founder_interview")).toBe("founder_interview_docx");
    expect(ws.taskTypeToTool("generate_competitor_matrix")).toBe("competitor_matrix_xlsx");
    expect(ws.taskTypeToTool("generate_ic_questions")).toBe("ic_questions_xlsx");
  });

  test("workspace registry allows host to call standardized tools", () => {
    const reg = require("../../utils/workspaceRegistry");
    expect(() => reg.assertToolAllowed("founder_interview_docx", "host")).not.toThrow();
    expect(() => reg.assertToolAllowed("competitor_matrix_xlsx", "host")).not.toThrow();
    expect(() => reg.assertToolAllowed("ic_questions_xlsx", "host")).not.toThrow();
  });
});

describe("standardized workspace tools · schemas and sheets", () => {
  test("founder interview schema requires source_refs on questions", () => {
    const skill = require("../../skills/founderInterview");
    const sample = {
      title: "创始人访谈提纲",
      opening: [1, 2, 3].map((i) => ({
        question: `请校准公司当前核心目标 ${i}`,
        why_ask: "确认创始人与材料口径是否一致",
        good_answer_signal: "能给出量化里程碑",
        red_flag_signal: "只给方向不给数据",
        follow_up: "请提供对应证明材料",
        source_refs: ["F001"],
      })),
      sections: ["创始人动机", "市场判断", "产品技术", "商业化", "财务融资", "团队治理"].map((name) => ({
        name,
        objective: "验证该模块是否支撑投资判断",
        questions: [1, 2].map((i) => ({
          question: `${name} 的关键问题 ${i}`,
          why_ask: "验证材料中的核心假设",
          good_answer_signal: "回答有数据和案例",
          red_flag_signal: "无法解释关键假设",
          follow_up: "请给出底层数据",
          source_refs: ["F001"],
        })),
      })),
      closing_checks: [1, 2, 3].map((i) => ({
        question: `结束前确认事项 ${i}`,
        why_ask: "避免遗漏投决阻断项",
        good_answer_signal: "有明确责任人与时间表",
        red_flag_signal: "无法承诺补充材料",
        follow_up: "何时提供",
        source_refs: ["F001"],
      })),
    };
    expect(validate(sample, skill._private.SCHEMA).valid).toBe(true);
  });

  test("competitor matrix workbook contains confirmed and hypothesis groups", () => {
    const skill = require("../../skills/competitorMatrix");
    const sheets = skill._private.buildSheets({
      target_company: { name: "A", positioning: "B", core_product: "C", source_refs: ["F001"] },
      matrix_summary: "这是一段足够长的竞品矩阵摘要，用于说明差异。",
      confirmed_competitors: [{
        name: "竞品1", competitor_type: "直接竞品", positioning: "同赛道", target_customer: "企业客户",
        core_product: "产品", pricing_or_model: "未披露", scale_signal: "未披露",
        strength: "渠道强", weakness: "数据待核实", difference_vs_target: "定位不同",
        confidence: "中", source_refs: ["F001"],
      }],
      hypothesis_competitors: [{
        name: "假设竞品", competitor_type: "待确认假设竞品", positioning: "潜在替代", target_customer: "企业客户",
        core_product: "产品", pricing_or_model: "待检索", scale_signal: "待检索",
        strength: "待确认", weakness: "待确认", difference_vs_target: "待确认",
        confidence: "待确认", source_refs: [],
      }],
      verification_backlog: [{ item: "价格", why_needed: "判断替代成本", suggested_source: "官网/访谈" }],
    });
    expect(sheets[0].rows[0][0]).toBe("已确认竞品");
    expect(sheets[0].rows[1][0]).toBe("待确认假设竞品");
  });

  test("IC questions workbook has Bull/Bear/Top question sheets (3-step pipeline)", () => {
    const skill = require("../../skills/icQuestions");
    const sheets = skill._private.buildSheets({
      bull_thesis_statement: "这是一条投资核心逻辑",
      bull_theses: [{ point: "论点", evidence: "证据", confidence: "中", source_refs: ["F001"] }],
      bear_objections: [{ attack_target: "论点", objection: "反驳", objection_type: "事实缺口", severity: "高", killer_question: "追问", data_gap: "缺口", source_refs: ["F001"] }],
      ic_questions: [{
        priority: 1,
        question: "投委问题",
        question_type: "事实缺口型",
        why_asked: "为什么问",
        assumption_basis: "事实基础",
        suggested_answer: "建议回答",
        materials_needed: "补充材料",
        decision_impact: "影响投决",
        owner: "投资经理",
        source_refs: ["F001"],
      }],
      preparation_summary: "准备摘要",
    });
    expect(sheets.map((s) => s.name)).toEqual(["IC Top问题", "Bull论点", "Bear反驳", "准备摘要"]);
    // Bull sheet now has point/evidence/confidence/source_refs columns
    expect(sheets[1].headers).toEqual(["支持投资论点", "证据", "置信度", "事实来源"]);
    // Bear sheet now has attack_target/objection/type/severity/killer_question/data_gap/source_refs
    expect(sheets[2].headers).toEqual(["攻击目标", "反驳点", "类型", "严重度", "致命追问", "数据缺口", "事实来源"]);
  });

  test("IC questions 3-step schemas validate independently", () => {
    const skill = require("../../skills/icQuestions");
    const { SCHEMA_BULL, SCHEMA_BEAR, SCHEMA_SYNTH } = skill._private;

    const bullSample = {
      thesis_statement: "这个项目值得投资，因为 TAM 超 200 亿、团队有连续创业经验、产品已有标杆客户验证且毛利率高",
      key_strengths: [
        { point: "TAM 200 亿", evidence: "来自 IDC 报告", confidence: "强", source_refs: ["F001"] },
        { point: "团队有连续创业经验", evidence: "CEO 曾创办 X 公司", confidence: "中", source_refs: ["F002"] },
        { point: "产品已有标杆客户", evidence: "签约 3 家 500 强", confidence: "强", source_refs: ["F003"] },
        { point: "毛利率 70%+", evidence: "SaaS 订阅模式", confidence: "中", source_refs: ["F004"] },
      ],
    };
    expect(validate(bullSample, SCHEMA_BULL).valid).toBe(true);

    const bearSample = {
      counter_arguments: [
        { attack_target: "TAM 200 亿", objection: "TAM 计算包含了不可达的政府市场", objection_type: "假设脆弱", severity: "高", killer_question: "去掉政府市场后 SAM 是多少", data_gap: "缺少 SAM/SOM 拆分", source_refs: [] },
        { attack_target: "团队有连续创业经验", objection: "CEO 上次创业以失败告终且未公开退出原因", objection_type: "事实缺口", severity: "中", killer_question: "上次退出的具体原因是什么", data_gap: "缺少退出细节", source_refs: ["F005"] },
        { attack_target: "产品已有标杆客户", objection: "3 家标杆客户是否有复购数据未披露", objection_type: "数字冲突", severity: "高", killer_question: "客户的 NDR 和续约率分别是多少", data_gap: "无复购率数据", source_refs: ["F003"] },
        { attack_target: "毛利率 70%+", objection: "毛利率是否含定制化项目收入未明确拆分", objection_type: "财务压力", severity: "中", killer_question: "纯 SaaS 订阅收入占总收入比例是多少", data_gap: "收入结构拆分", source_refs: ["F004"] },
      ],
    };
    expect(validate(bearSample, SCHEMA_BEAR).valid).toBe(true);

    const synthSample = {
      ic_questions: Array.from({ length: 10 }, (_, i) => ({
        priority: (i % 3) + 1,
        question: `投委会第 ${i + 1} 个关键追问内容`,
        question_type: ["事实缺口型", "假设挑战型", "财务压力型", "竞争格局型", "团队治理型", "退出路径型"][i % 6],
        why_asked: "因为材料中存在关键信息缺口",
        assumption_basis: i % 2 === 0 ? "基于 Bull 的市场规模假设" : "",
        suggested_answer: "建议准备详细的 SAM/SOM 拆分数据",
        materials_needed: "需要补充市场调研报告",
        decision_impact: "影响估值判断",
        owner: ["投资经理", "财务尽调", "技术尽调", "法务", "合伙人"][i % 5],
        source_refs: i % 2 === 0 ? ["F001"] : [],
      })),
      preparation_summary: "重点准备市场规模拆分、客户复购数据、收入结构三个方向的材料",
    };
    expect(validate(synthSample, SCHEMA_SYNTH).valid).toBe(true);
  });
});
