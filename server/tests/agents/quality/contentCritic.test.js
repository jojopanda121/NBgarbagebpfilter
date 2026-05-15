// ============================================================
// contentCritic — 单元测试.
//
// 通过 jest.mock 注入 fake callLLMJson, 验证 critic 模块对各类返回的处理.
// 同时覆盖 blockerInstructions 文本拼接.
// ============================================================

jest.mock("../../../services/llmService", () => ({
  callLLMJson: jest.fn(),
}));

const { callLLMJson } = require("../../../services/llmService");
const {
  critique,
  blockerInstructions,
  CRITIC_OUTPUT_SCHEMA,
} = require("../../../agents/quality/contentCritic");

describe("contentCritic.critique", () => {
  beforeEach(() => {
    callLLMJson.mockReset();
  });

  test("LLM 返回 pass=true / 空 issues → critique 返回相同结构", async () => {
    callLLMJson.mockResolvedValueOnce({ data: { pass: true, issues: [] } });
    const out = await critique({
      json: { foo: "bar" },
      materials: "公司材料",
      templateName: "test_tpl",
    });
    expect(out.pass).toBe(true);
    expect(out.issues).toEqual([]);
    expect(callLLMJson).toHaveBeenCalledTimes(1);
    // 调用时第 3 个参数是 CRITIC_OUTPUT_SCHEMA
    expect(callLLMJson.mock.calls[0][2]).toBe(CRITIC_OUTPUT_SCHEMA);
    // critic 不应使用 search
    expect(callLLMJson.mock.calls[0][3].useSearch).toBe(false);
  });

  test("LLM 返回 block 类 issue → critique 透传", async () => {
    callLLMJson.mockResolvedValueOnce({
      data: {
        pass: false,
        issues: [
          {
            severity: "block",
            field: "pe_snapshot.pre_valuation",
            kind: "fabricated_fact",
            detail: "材料未提到 15 亿, JSON 自造数字",
            suggested_fix: "改为 '未披露'",
          },
        ],
      },
    });
    const out = await critique({
      json: { pe_snapshot: { pre_valuation: "15 亿" } },
      materials: "公司 ABC 完成 B 轮融资.",
      templateName: "snap",
    });
    expect(out.pass).toBe(false);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].severity).toBe("block");
    expect(out.issues[0].kind).toBe("fabricated_fact");
  });

  test("LLM 抛错时 critique 抛同样错 (由上游决定容错)", async () => {
    callLLMJson.mockRejectedValueOnce(new Error("network down"));
    await expect(
      critique({ json: {}, materials: "x".repeat(50), templateName: "tpl" })
    ).rejects.toThrow("network down");
  });

  test("LLM 返回 data:undefined 时 critique 返回 pass=true / 空", async () => {
    callLLMJson.mockResolvedValueOnce({ data: undefined });
    const out = await critique({
      json: {}, materials: "...", templateName: "tpl",
    });
    expect(out.pass).toBe(true);
    expect(out.issues).toEqual([]);
  });
});

describe("contentCritic.blockerInstructions", () => {
  test("把 block-级 issue 序列化为可塞回 LLM 的修复指令", () => {
    const issues = [
      { severity: "block", field: "a", kind: "fabricated_fact", detail: "DD", suggested_fix: "改 X" },
      { severity: "warn",  field: "b", kind: "no_comparator", detail: "WW" },
      { severity: "block", field: "c", kind: "inconsistent_number", detail: "ZZ" },
    ];
    const out = blockerInstructions(issues);
    expect(out).toContain("a (fabricated_fact): DD");
    expect(out).toContain("c (inconsistent_number): ZZ");
    // warn 不应进入
    expect(out).not.toContain("b (no_comparator)");
    // suggested_fix 在则附带
    expect(out).toContain("建议: 改 X");
  });

  test("空数组 / undefined 时返回空字符串", () => {
    expect(blockerInstructions([])).toBe("");
    expect(blockerInstructions(undefined)).toBe("");
  });
});
