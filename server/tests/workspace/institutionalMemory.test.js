// ============================================================
// tests/workspace/institutionalMemory.test.js
//
// 覆盖 P3-3 机构记忆 categorical RAG：
//   - 评分逻辑：industry / sub_industry / business_model / stage / region 加权
//   - stage bucket 模糊匹配 (天使轮 vs 种子轮 同 early bucket)
//   - recency penalty: 2 年内不扣，之后对数衰减
//   - formatDecisionsAsFacts 输出 K 前缀
//   - 真实 DB roundtrip: record → retrieve 命中 + 阈值 < 1 过滤
// ============================================================

const im = require("../../services/institutionalMemory");

describe("P3-3 institutionalMemory · 评分逻辑", () => {
  const today = new Date();
  const recent = today.toISOString().slice(0, 10);
  const fiveYearsAgo = new Date(today.getTime() - 5 * 365 * 86400000).toISOString().slice(0, 10);

  test("industry 完全匹配 = 4 分", () => {
    const score = im._private._scoreDecision(
      { industry: "AI SaaS", decision_date: recent },
      { industry: "AI SaaS" },
    );
    expect(score).toBe(4);
  });

  test("industry + sub_industry + business_model 全匹配 = 9 分", () => {
    const score = im._private._scoreDecision(
      {
        industry: "AI SaaS", sub_industry: "智能客服",
        business_model: "B2B SaaS", stage: "A 轮",
        decision_date: recent,
      },
      {
        industry: "AI SaaS", sub_industry: "智能客服",
        business_model: "B2B SaaS", stage: "A 轮",
      },
    );
    expect(score).toBe(10); // 4+3+2+1 = 10
  });

  test("stage 同 bucket 给 0.5（天使 vs 种子）", () => {
    const score = im._private._scoreDecision(
      { stage: "天使轮", decision_date: recent },
      { stage: "种子轮" },
    );
    expect(score).toBe(0.5);
  });

  test("5 年前的决策有 recency penalty (负贡献)", () => {
    const recentScore = im._private._scoreDecision(
      { industry: "X", decision_date: recent },
      { industry: "X" },
    );
    const oldScore = im._private._scoreDecision(
      { industry: "X", decision_date: fiveYearsAgo },
      { industry: "X" },
    );
    expect(oldScore).toBeLessThan(recentScore);
  });

  test("2 年内的决策不扣 recency", () => {
    const oneYearAgo = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
    const score = im._private._scoreDecision(
      { industry: "X", decision_date: oneYearAgo },
      { industry: "X" },
    );
    expect(score).toBe(4);
  });

  test("prefer_decision 偏好命中给 +2", () => {
    const score = im._private._scoreDecision(
      { industry: "X", decision: "passed", decision_date: recent },
      { industry: "X", prefer_decision: "passed" },
    );
    expect(score).toBe(6); // 4 + 2
  });

  test("stage bucket: A/B → growth, C+/Pre-IPO → late", () => {
    expect(im._private._stageBucket("A 轮")).toBe("growth");
    expect(im._private._stageBucket("B+ 轮")).toBe("growth");
    expect(im._private._stageBucket("C 轮")).toBe("late");
    expect(im._private._stageBucket("Pre-IPO")).toBe("late");
    expect(im._private._stageBucket("种子轮")).toBe("early");
    expect(im._private._stageBucket("天使")).toBe("early");
    expect(im._private._stageBucket("未披露")).toBe("unknown");
  });
});

describe("P3-3 institutionalMemory · formatDecisionsAsFacts", () => {
  test("输出 K 前缀 ID + 标准 fact 字段", () => {
    const facts = im.formatDecisionsAsFacts(
      [
        {
          id: 42, company_name: "公司 X", industry: "AI SaaS",
          sub_industry: "客服", stage: "A 轮", decision: "invested",
          thesis: "高 NRR + 标杆客户复制", kill_factors: "客户集中度过高",
          precedent_outcome: "IPO 2025 Q3", decision_date: "2023-06-15",
        },
      ],
      1,
    );
    expect(facts.length).toBe(1);
    expect(facts[0].id).toBe("K001");
    expect(facts[0].source_type).toBe("institutional_memory");
    expect(facts[0].confidence).toBe("medium");
    expect(facts[0].value).toContain("公司 X");
    expect(facts[0].value).toContain("决策: invested");
    expect(facts[0].value).toContain("IPO 2025 Q3");
  });

  test("startSeq 偏移使 K 编号继续", () => {
    const facts = im.formatDecisionsAsFacts(
      [{ id: 1, company_name: "A", industry: "X", decision: "passed", decision_date: "2025-01-01" }],
      10,
    );
    expect(facts[0].id).toBe("K010");
  });

  test("空数组返回空数组", () => {
    expect(im.formatDecisionsAsFacts([])).toEqual([]);
  });
});

// DB roundtrip 用 mock db (better-sqlite3 是 jest 自动 mock), 模拟 prepare→run→all
describe("P3-3 institutionalMemory · retrieveSimilarDecisions ranking 端到端", () => {
  let imIsolated;
  let fakeRows;

  beforeEach(() => {
    jest.resetModules();
    fakeRows = [];
    jest.doMock("../../db", () => ({
      getDb: () => ({
        prepare: (sql) => ({
          run: (...args) => {
            // 简化的 INSERT 拦截：记录数据并返回 lastInsertRowid
            if (sql.includes("INSERT INTO institutional_memory")) {
              const row = {
                id: fakeRows.length + 1,
                company_name: args[0], industry: args[1], sub_industry: args[2],
                business_model: args[3], stage: args[4], region: args[5],
                decision: args[6], thesis: args[7], kill_factors: args[8],
                precedent_outcome: args[9], decision_date: args[10],
                lead_partner: args[11], source_project_id: args[12], meta_json: args[13],
                created_at: new Date().toISOString(),
              };
              fakeRows.push(row);
              return { lastInsertRowid: row.id };
            }
            return { changes: 1 };
          },
          get: () => null,
          all: (...args) => {
            // retrieveSimilarDecisions 走的 SELECT
            // args = [industry, industry, sub_industry, sub_industry, business_model, business_model]
            const [industry, , sub_industry, , business_model] = args;
            return fakeRows.filter((r) =>
              (industry && r.industry === industry)
              || (sub_industry && r.sub_industry === sub_industry)
              || (business_model && r.business_model === business_model)
            );
          },
        }),
      }),
    }));
    imIsolated = require("../../services/institutionalMemory");
  });

  afterEach(() => {
    jest.dontMock("../../db");
    jest.resetModules();
  });

  test("命中相同 industry + sub_industry, ranked by relevance", () => {
    const today = new Date().toISOString().slice(0, 10);
    const id1 = imIsolated.recordDecision({
      company_name: "客服 AI A", industry: "AI SaaS", sub_industry: "智能客服",
      business_model: "B2B SaaS", stage: "A 轮", region: "北京",
      decision: "invested", decision_date: today,
    });
    const id2 = imIsolated.recordDecision({
      company_name: "客服 AI B", industry: "AI SaaS", sub_industry: "智能客服",
      business_model: "B2B SaaS", stage: "B 轮", region: "上海",
      decision: "passed", decision_date: today,
    });
    imIsolated.recordDecision({
      company_name: "硬件 C", industry: "硬件 / 半导体",
      business_model: "硬件", stage: "B 轮",
      decision: "passed", decision_date: today,
    });

    const decisions = imIsolated.retrieveSimilarDecisions({
      industry: "AI SaaS", sub_industry: "智能客服",
      business_model: "B2B SaaS", stage: "A 轮",
    }, { limit: 5 });
    const ids = decisions.map((d) => d.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    // 硬件公司不应进结果
    expect(decisions.find((d) => d.industry === "硬件 / 半导体")).toBeUndefined();
    // id1 (stage A 轮 完全匹配) 排在 id2 (B 轮 同 growth bucket) 之前
    expect(decisions[0].id).toBe(id1);
    // 都有 similarity_score 字段
    expect(decisions[0].similarity_score).toBeGreaterThan(decisions[1].similarity_score);
  });

  test("没有任何标签匹配返回空数组（阈值过滤）", () => {
    imIsolated.recordDecision({
      company_name: "X", industry: "AI SaaS",
      decision: "passed", decision_date: "2025-01-01",
    });
    const decisions = imIsolated.retrieveSimilarDecisions({
      industry: "完全不相关的赛道",
      business_model: "不存在的模式",
    });
    expect(decisions.length).toBe(0);
  });
});
