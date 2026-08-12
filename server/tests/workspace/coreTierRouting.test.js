// ============================================================
// tests/workspace/coreTierRouting.test.js
//
// 锁死"任务 → 模型档位 + 思考开关"的分工。
//
// 依据是 2026-08 用真实 DeepSeek API 实测的结果，不是文档推测：
//   · 机械活（BP 抽取）：思考开关对结果无影响，但开思考贵 2.7 倍慢 2.7 倍
//   · 判断题（声明核查）：关思考会把无佐证自报数据判成"诚实"——对过滤器
//     产品是致命方向的错误；开思考才会判"存疑/夸大"
//   · pro vs flash：同一组核查任务 pro 慢 1 倍贵 3 倍，无可见质量优势
//   → 所以核心链路 = flash + 强制思考，而不是上 pro
// ============================================================

describe("任务 → 模型 + 思考开关", () => {
  let llm;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../../config", () => ({
      deepseekApiKey: "test-key",
      deepseekApiHost: "https://api.deepseek.test/v1",
      deepseekModel: "flash-model",
      deepseekModelHeavy: "pro-model",
      deepseekModelLight: "light-model",
    }));
    llm = require("../../services/llmService");
  });

  afterEach(() => {
    jest.dontMock("../../config");
    jest.resetModules();
  });

  test.each([
    ["claim_verdict", "声明证伪/夸大 → 诚信度 → 评级"],
    ["scoring_judge", "S1-S5 评分裁判 → 评级"],
    ["dimension_analysis", "五维分析"],
    ["deep_research", "深度研究报告"],
  ])("判断题 %s：走 flash 但必须开思考（%s）", (taskHint) => {
    const p = llm.getTaskProfile({ taskHint });
    expect(p.thinking).toBe(true);
    expect(p.model).toBe("flash-model");
    expect(p.minTokens).toBe(12000); // 思考算进 max_tokens，必须留够正文预算
  });

  test.each([
    ["bp_extraction", "照原文填 JSON"],
    ["upload_structured_extraction", "上传结构化抽取"],
    ["semantic_audit", "语义抽样校验"],
  ])("机械活 %s：关思考（%s）", (taskHint) => {
    expect(llm.getTaskProfile({ taskHint }).thinking).toBe(false);
  });

  test("多步对抗推理留在 heavy 且开思考", () => {
    for (const skillId of ["ic_questions_xlsx", "ic_memo", "investment_deck_pptx"]) {
      const p = llm.getTaskProfile({ skillId });
      expect(p.tier).toBe("heavy");
      expect(p.model).toBe("pro-model");
      expect(p.thinking).toBe(true);
    }
  });

  test("模板填充：light 档 + 关思考（版式已锁死，模型只填内容）", () => {
    for (const skillId of ["onepager_pptx", "investment_snapshot", "project_brief", "deal_screening"]) {
      const p = llm.getTaskProfile({ skillId });
      expect(p.tier).toBe("light");
      expect(p.thinking).toBe(false);
    }
  });

  test("调用方可显式覆盖思考开关", () => {
    expect(llm.getTaskProfile({ taskHint: "bp_extraction", thinking: true }).thinking).toBe(true);
    expect(llm.getTaskProfile({ taskHint: "claim_verdict", thinking: false }).thinking).toBe(false);
  });

  test("未声明任务 → 不强制思考，沿用服务端默认", () => {
    expect(llm.getTaskProfile({}).thinking).toBeNull();
    expect(llm.getTaskProfile({}).minTokens).toBeNull();
  });
});
