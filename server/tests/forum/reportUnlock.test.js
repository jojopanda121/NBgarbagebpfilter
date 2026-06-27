// ============================================================
// reportUnlock.test.js — 完整报告「授权解锁」的纯函数红线
//
// 守护:
//   1) 递归脱敏 scrubDeep —— verdict 任意嵌套层的标识串都要被擦,
//      但风险旗标不能被丢、数值/结构不能被破坏。
//   2) 表情白名单 isValidReaction —— 防注入。
// (DB 路径(grant/getUnlockedReport)因 jest mock 走真实 better-sqlite3 冒烟验证)
// ============================================================

const { _internal: reportInternal } = require("../../services/forumReportService");
const { _internal: forumInternal } = require("../../services/forumService");

const { scrubDeep } = reportInternal;
const { isValidReaction } = forumInternal;

describe("scrubDeep 递归脱敏红线", () => {
  const ids = { company: "星辰科技", product: "智能风控", title: "星辰科技 - 智能风控" };
  const opts = { showCompany: false, showProject: false, codename: "Project Helios" };

  const verdict = {
    total_score: 87,
    verdict_summary: "星辰科技增长强劲，智能风控壁垒高",
    dimensions: {
      team: { note: "星辰科技团队优秀", score: 90 },
      moat: { evidence: ["智能风控 专利 12 项"] },
    },
    strengths: ["智能风控 客户留存高"],
    risk_flags: ["星辰科技 现金流紧张", "智能风控 获客成本上升"],
    claim_verdicts: [{ claim: "智能风控 收入翻倍", verdict: "存疑" }],
  };

  test("各层字符串里的公司名/产品名都被擦除", () => {
    const out = scrubDeep(verdict, ids, opts);
    const dump = JSON.stringify(out);
    expect(dump).not.toContain("星辰科技");
    expect(dump).not.toContain("智能风控");
    expect(dump).toContain("某公司");
    expect(dump).toContain("Project Helios");
  });

  test("风险旗标全带不丢(脱敏只改文本,不删条目)", () => {
    const out = scrubDeep(verdict, ids, opts);
    expect(out.risk_flags).toHaveLength(2);
  });

  test("数值与嵌套结构原样保留", () => {
    const out = scrubDeep(verdict, ids, opts);
    expect(out.total_score).toBe(87);
    expect(out.dimensions.team.score).toBe(90);
    expect(Array.isArray(out.dimensions.moat.evidence)).toBe(true);
    expect(out.claim_verdicts[0].verdict).toBe("存疑");
  });

  test("完全公开时原样返回", () => {
    const out = scrubDeep(verdict, ids, { showCompany: true, showProject: true, codename: "Project Helios" });
    expect(out.verdict_summary).toBe("星辰科技增长强劲，智能风控壁垒高");
  });

  test("null / 数字 / 布尔等原始值不崩", () => {
    expect(scrubDeep(null, ids, opts)).toBeNull();
    expect(scrubDeep(42, ids, opts)).toBe(42);
    expect(scrubDeep(true, ids, opts)).toBe(true);
  });
});

describe("isValidReaction 白名单防注入", () => {
  test("白名单内的 emoji / 贴纸通过", () => {
    expect(isValidReaction("emoji:👍")).toBe(true);
    expect(isValidReaction("sticker:bullish")).toBe(true);
    expect(isValidReaction("sticker:old-leek")).toBe(true);
  });

  test("白名单外一律拒绝", () => {
    expect(isValidReaction("sticker:unknown")).toBe(false);
    expect(isValidReaction("emoji:<script>")).toBe(false);
    expect(isValidReaction("bullish")).toBe(false);
    expect(isValidReaction("")).toBe(false);
    expect(isValidReaction(null)).toBe(false);
    expect(isValidReaction("emoji:")).toBe(false);
  });
});
