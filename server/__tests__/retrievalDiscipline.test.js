const {
  classifySource, filterAndRankResults, pickConservative, createRetrievalBudget, makeSearchLog,
} = require("../services/retrievalDiscipline");

describe("retrievalDiscipline — 来源分层", () => {
  test("官方/监管 = T1 最高分", () => {
    expect(classifySource({ url: "https://www.miit.gov.cn/x", title: "工信部公告" }).tier).toBe(1);
    expect(classifySource({ title: "招股说明书摘要" }).tier).toBe(1);
  });
  test("一线财经媒体 = T2", () => {
    expect(classifySource({ url: "https://www.caixin.com/a", title: "财新报道" }).tier).toBe(2);
  });
  test("行研机构 = T3", () => {
    expect(classifySource({ title: "艾瑞咨询行业报告" }).tier).toBe(3);
  });
  test("命理/玄学/SEO 农场 → drop", () => {
    expect(classifySource({ title: "公司命理运势分析" }).drop).toBe(true);
    expect(classifySource({ url: "https://baijiahao.baidu.com/seo" }).drop).toBe(true);
  });
  test("未知来源 → 其他 T4（不丢弃但低分）", () => {
    const c = classifySource({ url: "https://random-blog.example/post" });
    expect(c.tier).toBe(4);
    expect(c.drop).toBe(false);
  });
});

describe("retrievalDiscipline — 过滤排序去重", () => {
  test("丢 junk、按可信度排序、按 url 去重", () => {
    const ranked = filterAndRankResults([
      { url: "u1", title: "某博客观点" },
      { url: "u2", title: "财新独家" },
      { url: "u3", title: "命理预测" },        // drop
      { url: "u4", title: "工信部数据" },
      { url: "u2", title: "财新独家（重复）" }, // dedupe
    ]);
    expect(ranked.map((r) => r.title)).toEqual(["工信部数据", "财新独家", "某博客观点"]);
    expect(ranked[0]._source.tier).toBe(1);
  });
});

describe("retrievalDiscipline — 冲突取保守值", () => {
  test("数字打架取偏小（保守）", () => {
    expect(pickConservative([120, 100, 150])).toBe(100);
    expect(pickConservative(["x", null])).toBeNull();
  });
});

describe("retrievalDiscipline — 调用预算（每条≤2 / 单项目≤14）", () => {
  test("每条声明硬上限 2 次", () => {
    const b = createRetrievalBudget({ perClaim: 2, perProject: 14 });
    expect(b.canSearch("c1")).toBe(true); b.record("c1");
    expect(b.canSearch("c1")).toBe(true); b.record("c1");
    expect(b.canSearch("c1")).toBe(false); // 第 3 次被拦
    expect(b.canSearch("c2")).toBe(true);  // 另一条不受影响
  });

  test("单项目硬上限 14 次", () => {
    const b = createRetrievalBudget({ perClaim: 99, perProject: 14 });
    for (let i = 0; i < 14; i++) { expect(b.canSearch("c")).toBe(true); b.record("c"); }
    expect(b.canSearch("c")).toBe(false);
    expect(b.snapshot().remaining).toBe(0);
  });
});

describe("retrievalDiscipline — search_log", () => {
  test("逐条记录核查点/query/采用/填入字段", () => {
    const log = makeSearchLog();
    log.add({ check_point: "市场规模", query: "DRAM 市场规模 2025 亿元", calls: 1, source_type: "官方/监管", used: true, filled_field: "TAM_Million_RMB" });
    log.add({ check_point: "团队履历", query: "张三 履历", calls: 2, used: false, note: "2次未命中可信源→降coverage" });
    const e = log.get();
    expect(e).toHaveLength(2);
    expect(e[0].used).toBe(true);
    expect(e[0].filled_field).toBe("TAM_Million_RMB");
    expect(e[1].used).toBe(false);
  });
});
