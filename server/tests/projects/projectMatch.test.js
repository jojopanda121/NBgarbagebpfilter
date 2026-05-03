// Sprint 2: projectMatchService 单元测试（纯算法，不依赖 DB）
const {
  similarity,
  maxFounderSimilarity,
} = require("../../services/projectMatchService");

describe("projectMatchService.similarity", () => {
  test("完全相同的项目名 → 1", () => {
    expect(similarity("智答 AI", "智答 AI")).toBe(1);
  });

  test("空白和大小写归一化", () => {
    expect(similarity("  Foo  ", "foo")).toBe(1);
  });

  test("完全不同的项目名 → 偏低", () => {
    expect(similarity("智答 AI", "无关项目")).toBeLessThan(0.3);
  });

  test("近似名 → 中等相似度（应触发 ask_user 区间）", () => {
    const score = similarity("智答 AI", "智答 AI Pro");
    expect(score).toBeGreaterThanOrEqual(0.5);
    expect(score).toBeLessThan(0.9);
  });

  test("一方为空 → 0", () => {
    expect(similarity("", "abc")).toBe(0);
    expect(similarity(null, "abc")).toBe(0);
  });
});

describe("projectMatchService.maxFounderSimilarity", () => {
  test("有共同人名 → 高", () => {
    expect(maxFounderSimilarity(["张三", "李四"], ["张三"])).toBe(1);
  });
  test("无交集 → 低", () => {
    expect(
      maxFounderSimilarity(["张三"], ["王五"])
    ).toBeLessThan(0.3);
  });
  test("空数组 → 0", () => {
    expect(maxFounderSimilarity([], ["张三"])).toBe(0);
  });
});
