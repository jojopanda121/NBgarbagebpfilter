// ============================================================
// materialPrecheck — 纯规则测试, 不依赖 LLM / doc-service.
// ============================================================

const { precheck } = require("../../../agents/quality/materialPrecheck");

describe("materialPrecheck · 边界用例", () => {
  test("空材料 → ok=false, errors 含字数和公司主体两类", () => {
    const r = precheck("");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("字数"))).toBe(true);
    expect(r.errors.some((e) => e.includes("公司主体"))).toBe(true);
  });

  test("过短 (50 字) 但带公司词 → 字数 error 触发, 公司词 error 不触发", () => {
    const short = "ABC 科技有限公司是一家做 AI 存储的公司, 总部在北京. 拿了 A 轮融资.";
    const r = precheck(short);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("字数"))).toBe(true);
    expect(r.errors.some((e) => e.includes("公司主体"))).toBe(false);
  });

  test("足够长但无公司主体词 → ok=false, 公司主体 error 触发", () => {
    const noCo = "这是一段很长的介绍文字, 描述了一个 AI 项目。".repeat(20);
    const r = precheck(noCo);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("公司主体"))).toBe(true);
  });

  test("覆盖 4 维度 + 足够字数 + 数字 ≥3 → ok=true, 无 warning", () => {
    const full =
      "北京星辰天合科技股份有限公司是国内独立分布式 AI 存储供应商, 服务超百家中国 500 强企业. " +
      "公司主营产品包括 AI 数据湖存储与 AI 训推存储解决方案, 解决方案覆盖训练 / 推理 / 数据湖全流程. " +
      "创始人胥昕来自前 EMC 中国研究院, CTO 贾东东曾深耕开源存储社区 Ceph, 团队整体技术背景扎实. " +
      "2023 年营业收入 1.66 亿, 2024 年 1.72 亿, 2025 年前三季度 1.95 亿, 毛利率 63.7%, 净利率由 -48.8% 转正至 4.2%. " +
      "2024 年完成 D 轮融资, 主要股东包括君联资本与招商局创投, Pre-money 估值约 80 亿人民币.";
    const r = precheck(full);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.stats.chars).toBeGreaterThan(200);
    expect(r.stats.numbers).toBeGreaterThan(3);
  });

  test("缺 3+ 维度 → ok=false (核心维度缺失 error)", () => {
    // 只讲产品, 不讲团队/财务/融资
    const productOnly = (
      "ABC 科技公司打造了一款企业级 AI 平台, 支持多协议数据访问. " +
      "我们的产品已经在数十家客户中部署, 解决方案稳定. " +
      "技术架构基于自研引擎, 与异构芯片兼容. " +
      "平台覆盖训练 / 推理 / 数据湖全流程."
    ).repeat(2);
    const r = precheck(productOnly);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("核心维度"))).toBe(true);
    expect(r.stats.missingTopics).toEqual(
      expect.arrayContaining(["team", "finance", "funding"])
    );
  });

  test("覆盖 3 维度 (缺 1 个) → ok=true 但有 warning", () => {
    const noFunding = (
      "北京 ABC 科技股份有限公司是一家做 AI 平台的企业, 总部位于北京, 在全国设有研发中心. " +
      "公司创始人来自 BAT, 有 10 年技术经验, CTO 来自清华, COO 曾任职大厂多年. " +
      "2024 年营业收入 1.2 亿, 毛利率 50.4%, 净利润 1500 万, 同比增长 78%. " +
      "团队稳定, 业务增长强劲, 团队覆盖全国, 客户数超过 50 家. "
    ).repeat(2);
    const r = precheck(noFunding);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("funding"))).toBe(true);
  });

  test("数字过少 → warning 但不阻止生成", () => {
    const fewNumbers =
      "ABC 科技公司是一家创业公司. 主要做 AI 平台. " +
      "创始人是前 BAT 工程师. CTO 来自清华. 公司今年增长. " +
      "已完成种子轮融资.".repeat(3);
    const r = precheck(fewNumbers);
    // 字数 / 主体 / 维度都过, 仅可能数字不足
    expect(r.warnings.some((w) => w.includes("数字"))).toBe(true);
  });

  test("templateName 仅影响错误信息文案", () => {
    const r = precheck("", { templateName: "investment_snapshot" });
    expect(r.errors.some((e) => e.includes("investment_snapshot"))).toBe(true);
  });

  test("minChars / minNumbers 可调", () => {
    const text = "ABC 科技股份有限公司, 创始人, 营收, 融资.";
    const tight = precheck(text, { minChars: 10, minNumbers: 0 });
    expect(tight.ok).toBe(true);
  });
});
