// 专家证据 → 评分输入 的 JS 推导 + 双路合并测试。
const {
  parseYearsSpan, deriveTeam, deriveMoatFromCompetitor, deriveS1, deriveS3,
  financialToVerdicts, valuationToVerdicts, mergeSpecialistEvidence,
} = require("../../scoringEvidence");

describe("parseYearsSpan", () => {
  test("标准区间", () => { expect(parseYearsSpan("2018-2021")).toBe(3); });
  test("至今", () => { expect(parseYearsSpan("2019-至今", 2024)).toBe(5); });
  test("带年字/破折号变体", () => { expect(parseYearsSpan("2020—2023年")).toBe(3); });
  test("解析失败给 null", () => {
    expect(parseYearsSpan("很多年")).toBeNull();
    expect(parseYearsSpan("")).toBeNull();
    expect(parseYearsSpan("2025-2019")).toBeNull(); // 倒挂
  });
});

describe("deriveTeam", () => {
  test("无 founders → null", () => {
    expect(deriveTeam(null)).toBeNull();
    expect(deriveTeam({ founders: [] })).toBeNull();
  });

  test("角色覆盖 3/3 → 完整性 10；失衡风险扣分", () => {
    const r = deriveTeam({
      founders: [
        { role: "创始人 & CEO", career: [], education: [], past_ventures: [] },
        { role: "CTO", career: [], education: [], past_ventures: [] },
        { role: "销售副总裁", career: [], education: [], past_ventures: [] },
      ],
    });
    expect(r.Team_Completeness_Score).toBe(10);
  });

  test("只有 CEO + 团队失衡风险旗 → 完整性 4-2", () => {
    const r = deriveTeam({
      founders: [{ role: "CEO", career: [], education: [], past_ventures: [] }],
      risk_flags: [{ flag_type: "团队失衡", severity: 4 }],
    });
    expect(r.Team_Completeness_Score).toBe(2); // 4 - 2
  });

  test("经验从 career 年限累加，解析不出给 null（v3 曲线 年数/2.5）", () => {
    // 20 年 → min(10, 20/2.5)=8
    const r = deriveTeam({ founders: [{ role: "CEO", career: [{ years: "2005-2025" }], education: [], past_ventures: [] }] });
    expect(r.Team_Experience_Score).toBe(8);
    const r2 = deriveTeam({ founders: [{ role: "CEO", career: [{ years: "资深" }], education: [], past_ventures: [] }] });
    expect(r2.Team_Experience_Score).toBeNull();
  });

  test("过往成绩：退出→10（v3 满分可达），连续失败→3", () => {
    const exit = deriveTeam({ founders: [{ role: "CEO", career: [], education: [], past_ventures: [{ outcome: "已被收购退出" }] }] });
    expect(exit.Team_Track_Record_Score).toBe(10);
    const fail = deriveTeam({ founders: [{ role: "CEO", career: [], education: [], past_ventures: [{ outcome: "失败" }, { outcome: "清算" }] }] });
    expect(fail.Team_Track_Record_Score).toBe(3);
  });

  test("教育查表取最高档（v3：清北复交 = 满分 10）", () => {
    const r = deriveTeam({ founders: [{ role: "CEO", career: [], education: [{ school: "清华大学" }], past_ventures: [] }] });
    expect(r.Team_Education_Score).toBe(10);
    const unknown = deriveTeam({ founders: [{ role: "CEO", career: [], education: [], past_ventures: [] }] });
    expect(unknown.Team_Education_Score).toBe(6); // 无信息中性
  });

  test("赛道匹配枚举映射（v3：同赛道 = 满分 10）", () => {
    const r = deriveTeam({ founders: [{ role: "CEO", career: [], education: [], past_ventures: [] }], team_assessment: { domain_match: "同赛道" } });
    expect(r.Team_Domain_Match_Score).toBe(10);
  });
});

describe("deriveMoatFromCompetitor", () => {
  test("密度公式：重量级对手压低分", () => {
    const r = deriveMoatFromCompetitor({
      competitors: [
        { type: "直接竞品", latest_round_stage: "已上市", knowledge_confidence: 5 },
        { type: "直接竞品", latest_round_stage: "B轮", knowledge_confidence: 4 },
        { type: "直接竞品", latest_round_stage: "种子天使", knowledge_confidence: 4 },
      ],
      positioning: { tier: "第二梯队" },
      chokepoint_assessment: "非咽喉型",
    });
    // H=2(已上市+B轮), light=1 → 100-24-4=72
    expect(r.competitive_density.score).toBe(72);
    expect(r.traction_position.score).toBe(65);
    expect(r.chokepoint.score).toBe(50);
  });

  test("低 knowledge_confidence 竞品不计入密度", () => {
    const r = deriveMoatFromCompetitor({
      competitors: [{ type: "直接竞品", latest_round_stage: "已上市", knowledge_confidence: 1 }],
      positioning: {},
    });
    expect(r?.competitive_density).toBeUndefined();
  });

  test("非对象 → null", () => { expect(deriveMoatFromCompetitor(null)).toBeNull(); });
});

describe("deriveS1", () => {
  test("自下而上 TAM 复算（百万）", () => {
    const r = deriveS1({ TAM_Source: { type: "自下而上", customer_count: 500000, arpu: 1200 }, CAGR: 20 }, {});
    expect(r.TAM_Million_RMB).toBe(600); // 5e5*1200/1e6
  });
  test("CAGR 被赛道成熟度上限掐住", () => {
    const r = deriveS1({ CAGR: 35 }, { track_definition: { track_maturity: "红海" } });
    expect(r.CAGR).toBe(15);
    expect(r.conflicts.length).toBe(1);
  });
  test("增速在上限内不动", () => {
    const r = deriveS1({ CAGR: 10 }, { track_definition: { track_maturity: "红海" } });
    expect(r.CAGR).toBeUndefined();
  });
});

describe("deriveS3", () => {
  test("枚举映射 + 高毛利 +1", () => {
    const r = deriveS3({ Capital_Archetype: "软硬结合", Scale_Mechanism: "数据飞轮" }, { financial_snapshot: { gross_margin: 0.75 } });
    expect(r.Industry_Capital_Score).toBe(7); // 6 + 1
    expect(r.Industry_Scale_Score).toBe(8);
  });
  test("低毛利 -1", () => {
    const r = deriveS3({ Capital_Archetype: "纯软件SaaS" }, { financial_snapshot: { gross_margin: 0.3 } });
    expect(r.Industry_Capital_Score).toBe(9); // 10 - 1
  });
});

describe("financialToVerdicts — 对称奖惩 + 缺失给及格", () => {
  test("数学矛盾→证伪；增速异常 sev5→夸大", () => {
    const v = financialToVerdicts({
      consistency_check: { math_errors: [{ description: "收入×毛利率≠毛利", evidence: "P12" }] },
      anomalies: [{ anomaly_type: "增速异常", description: "年增300%", evidence: "P8", severity: 5 }],
    });
    expect(v.find((x) => x.claim.includes("收入")).verdict).toBe("证伪");
    expect(v.find((x) => x.claim.includes("年增")).verdict).toBe("夸大");
  });

  test("缺数据/无证据的 math_error 降为存疑（不再硬编码证伪→不触发否决）", () => {
    const v = financialToVerdicts({
      consistency_check: { math_errors: [
        { description: "BP全文零财务数据，无任何收入、毛利、烧钱、融资额披露", evidence: "" },
      ] },
    });
    expect(v[0].verdict).toBe("存疑");
  });

  test("真实数字矛盾（带冲突证据）仍判证伪", () => {
    const v = financialToVerdicts({
      consistency_check: { math_errors: [
        { description: "毛利对不上", evidence: "收入1亿×30%=3000万，但BP写毛利5000万" },
      ] },
    });
    expect(v[0].verdict).toBe("证伪");
  });

  test("hidden_signals 只有带证据且 sev≥4 才记信息不对称（缺失不罚）", () => {
    const v = financialToVerdicts({
      hidden_signals: [
        { signal: "未披露Churn", concern: "x", evidence: "", severity: 2 },     // 不入
        { signal: "只给GMV不给净收入", concern: "x", evidence: "P3", severity: 5 }, // 入
      ],
    });
    expect(v.filter((x) => x.verdict === "信息不对称").length).toBe(1);
  });

  test("conservative_signals → 保守低估（加分）", () => {
    const v = financialToVerdicts({ conservative_signals: [{ signal: "预测增速低于行业基准", evidence: "P5" }] });
    expect(v.some((x) => x.verdict === "保守低估")).toBe(true);
  });

  test("负面封顶5、正面封顶3", () => {
    const v = financialToVerdicts({
      anomalies: Array.from({ length: 8 }, (_, i) => ({ anomaly_type: "数学矛盾", description: `e${i}`, severity: 5 })),
      conservative_signals: Array.from({ length: 5 }, (_, i) => ({ signal: `c${i}` })),
    });
    expect(v.filter((x) => x.verdict !== "保守低估").length).toBeLessThanOrEqual(5);
    expect(v.filter((x) => x.verdict === "保守低估").length).toBeLessThanOrEqual(3);
  });
});

describe("valuationToVerdicts", () => {
  test("远高于→夸大，偏低→保守低估，合理→无条目", () => {
    expect(valuationToVerdicts({ verdict: { position: "远高于" } })[0].verdict).toBe("夸大");
    expect(valuationToVerdicts({ verdict: { position: "偏低" } })[0].verdict).toBe("保守低估");
    expect(valuationToVerdicts({ verdict: { position: "合理" } }).length).toBe(0);
  });
});

describe("mergeSpecialistEvidence — 双路取平均 + 容错", () => {
  const agentBData = {
    TAM_Million_RMB: 5000, CAGR: 20, TRL: 7, Competitor_Rank_Score: 7,
    Industry_Capital_Score: 5, Industry_Scale_Score: 5,
    Team_Completeness_Score: 8, Team_Experience_Score: 6, Team_Track_Record_Score: 6,
    Team_Education_Score: 7, Team_Domain_Match_Score: 6,
  };

  test("专家全缺（{}）→ 整体 no-op，回退 Agent B", () => {
    const { enrichedInput, specialist_audit } = mergeSpecialistEvidence({
      agentBData, claimVerdicts: [], specialists: {},
    });
    expect(enrichedInput.Team_Completeness_Score).toBe(8); // 未变
    expect(specialist_audit.verdicts.total).toBe(0);
  });

  test("团队双路取平均；差>3 记冲突，差≤3 不记", () => {
    const { enrichedInput, specialist_audit } = mergeSpecialistEvidence({
      agentBData, // Team_Completeness_Score=8, Team_Education_Score=6
      claimVerdicts: [],
      specialists: {
        founder_profile: {
          // 只有 CEO → 派生完整性 4（与 AgentB 8 差 4 >3 → 冲突）
          founders: [{ role: "CEO", career: [], education: [{ school: "清华大学" }], past_ventures: [] }],
          team_assessment: { domain_match: "同赛道" },
        },
      },
    });
    // 完整性：AgentB 8 与 派生 4 → 平均 6，差 4>3 → 冲突
    expect(enrichedInput.Team_Completeness_Score).toBe(6);
    expect(specialist_audit.conflicts.some((c) => c.includes("Completeness"))).toBe(true);
    // 教育：AgentB 7 与 派生 10（v3 清华满分）→ 平均 8.5，差=3 → 一致，不记冲突
    expect(enrichedInput.Team_Education_Score).toBe(8.5);
    expect(specialist_audit.conflicts.some((c) => c.includes("Education"))).toBe(false);
  });

  test("skill 咽喉分覆盖快速估计", () => {
    const { enrichedInput, specialist_audit } = mergeSpecialistEvidence({
      agentBData, claimVerdicts: [],
      specialists: { competitor_analysis: { chokepoint_assessment: "弱咽喉", competitors: [], positioning: {} } },
      chokepointScore: 88,
    });
    expect(enrichedInput.Chokepoint_Score).toBe(88);
    expect(specialist_audit.moat.chokepoint_source).toBe("skill");
  });

  test("财务+估值 verdict 并入 claim_verdicts", () => {
    const { enrichedInput } = mergeSpecialistEvidence({
      agentBData,
      claimVerdicts: [{ verdict: "诚实" }],
      specialists: {
        financial_analysis: { anomalies: [{ anomaly_type: "数学矛盾", description: "x", severity: 5 }] },
        valuation_analysis: { verdict: { position: "远高于" } },
      },
    });
    expect(enrichedInput.claim_verdicts.length).toBe(3); // 1 原有 + 1 财务 + 1 估值
  });
});
