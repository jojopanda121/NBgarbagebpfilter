// ============================================================
// forumScrub.test.js — 论坛脱敏红线 + 快照抽取（纯函数）
//
// 守护两条产品红线：
//   1) 评分快照只取"第一部分"，且 risk_flags 必须全带
//   2) 按披露开关，公司名/项目名/产品名不得泄漏到论坛文本
// ============================================================

const { _internal } = require("../../services/forumService");
const { buildSnapshotFromTask, scrubText, generateCodename } = _internal;

describe("buildSnapshotFromTask", () => {
  const task = {
    result: JSON.stringify({
      verdict: {
        total_score: 87, grade: "A", grade_label: "值得深聊", grade_action: "约管理层",
        grade_color: "green", verdict_summary: "强劲增长",
        strengths: ["a", "b", "c", "d"],
        risk_flags: ["r1", "r2", "r3"],
        dimensions: { team: { score: 90 } },
        claim_verdicts: [{ x: 1 }],
      },
    }),
  };

  test("抽取分数 + 评级 + 一句话结论", () => {
    const s = buildSnapshotFromTask(task);
    expect(s.total_score).toBe(87);
    expect(s.grade).toBe("A");
    expect(s.verdict_summary).toBe("强劲增长");
  });

  test("strengths 截断到 3 条", () => {
    expect(buildSnapshotFromTask(task).strengths).toHaveLength(3);
  });

  test("risk_flags 强制全带，不截断", () => {
    expect(buildSnapshotFromTask(task).risk_flags).toEqual(["r1", "r2", "r3"]);
  });

  test("快照不包含维度拆解/claim 等后续内容", () => {
    const s = buildSnapshotFromTask(task);
    expect(s.dimensions).toBeUndefined();
    expect(s.claim_verdicts).toBeUndefined();
  });

  test("无 verdict 或无分数 → null", () => {
    expect(buildSnapshotFromTask({ result: "{}" })).toBeNull();
    expect(buildSnapshotFromTask({ result: JSON.stringify({ verdict: {} }) })).toBeNull();
  });

  test("result 非法 JSON 不崩", () => {
    expect(buildSnapshotFromTask({ result: "not json" })).toBeNull();
  });
});

describe("scrubText 脱敏红线", () => {
  const ids = { company: "星辰科技", product: "智能风控", title: "星辰科技 - 智能风控" };
  const codename = "Project Helios";

  test("完全匿名：公司名 → 某公司，产品/标题 → 代号", () => {
    const out = scrubText("星辰科技的智能风控很强", ids, { showCompany: false, showProject: false, codename });
    expect(out).not.toContain("星辰科技");
    expect(out).not.toContain("智能风控");
    expect(out).toContain("某公司");
    expect(out).toContain(codename);
  });

  test("半披露：露项目名、藏公司名", () => {
    const out = scrubText("星辰科技的智能风控很强", ids, { showCompany: false, showProject: true, codename });
    expect(out).not.toContain("星辰科技");
    expect(out).toContain("智能风控");      // 项目名保留
    expect(out).toContain("某公司");
  });

  test("完全公开：原样保留", () => {
    const out = scrubText("星辰科技的智能风控很强", ids, { showCompany: true, showProject: true, codename });
    expect(out).toBe("星辰科技的智能风控很强");
  });

  test("多次出现全部替换（全局）", () => {
    const out = scrubText("星辰科技 星辰科技 星辰科技", ids, { showCompany: false, showProject: false, codename });
    expect(out).not.toContain("星辰科技");
  });

  test("含正则特殊字符的公司名不会抛错", () => {
    const tricky = { company: "A+B (科技)", product: "", title: "" };
    const out = scrubText("A+B (科技) 团队", tricky, { showCompany: false, showProject: false, codename });
    expect(out).toContain("某公司");
  });

  test("空文本 / 非字符串原样返回", () => {
    expect(scrubText("", ids, { showCompany: false, showProject: false, codename })).toBe("");
    expect(scrubText(null, ids, { showCompany: false, showProject: false, codename })).toBeNull();
  });
});

describe("generateCodename", () => {
  test("格式为 Project Word-NN", () => {
    expect(generateCodename()).toMatch(/^Project [A-Za-z]+-\d{2}$/);
  });
});
