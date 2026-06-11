// ============================================================
// tests/workspace/modelRouting.test.js
//
// 覆盖 P2-4 per-skill 模型路由：
//   - 未配置 heavy/light 环境变量 → 全部 fall back 到 default
//   - 配置后，skillId / taskHint / 显式 modelTier 都能正确路由
//   - getModelName / getModelTier 可作为观测入口
// ============================================================

describe("P2-4 per-skill 模型路由", () => {
  let llm;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../../config", () => ({
      kimiApiKey: "test-key",
      kimiApiHost: "https://api.moonshot.test/v1",
      kimiModel: "default-model",
      kimiModelHeavy: "heavy-model",
      kimiModelLight: "light-model",
    }));
    llm = require("../../services/llmService");
  });

  afterEach(() => {
    jest.dontMock("../../config");
    jest.resetModules();
  });

  test("无 opts → default", () => {
    expect(llm.getModelName()).toBe("default-model");
    expect(llm.getModelTier()).toBe("default");
  });

  test("skillId 命中 heavy/light/default 表", () => {
    expect(llm.getModelTier({ skillId: "ic_questions_xlsx" })).toBe("heavy");
    expect(llm.getModelName({ skillId: "ic_questions_xlsx" })).toBe("heavy-model");

    expect(llm.getModelTier({ skillId: "investment_deck" })).toBe("heavy"); // pptxTemplate 名
    expect(llm.getModelName({ skillId: "investment_deck" })).toBe("heavy-model");

    expect(llm.getModelTier({ skillId: "investment_snapshot" })).toBe("light");
    expect(llm.getModelName({ skillId: "investment_snapshot" })).toBe("light-model");

    expect(llm.getModelTier({ skillId: "competitor_matrix_xlsx" })).toBe("default");
    expect(llm.getModelName({ skillId: "competitor_matrix_xlsx" })).toBe("default-model");
  });

  test("taskHint 命中表 (semantic_audit → light)", () => {
    expect(llm.getModelTier({ taskHint: "semantic_audit" })).toBe("light");
    expect(llm.getModelName({ taskHint: "semantic_audit" })).toBe("light-model");
  });

  test("显式 modelTier 优先级最高", () => {
    expect(llm.getModelTier({ skillId: "ic_questions_xlsx", modelTier: "light" })).toBe("light");
    expect(llm.getModelName({ skillId: "ic_questions_xlsx", modelTier: "light" })).toBe("light-model");
  });

  test("未知 skillId → default", () => {
    expect(llm.getModelTier({ skillId: "nonexistent_skill" })).toBe("default");
    expect(llm.getModelName({ skillId: "nonexistent_skill" })).toBe("default-model");
  });
});

describe("P2-4 模型路由 · 未配置 heavy/light 时回落 default", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../../config", () => ({
      kimiApiKey: "test-key",
      kimiApiHost: "https://api.moonshot.test/v1",
      kimiModel: "only-default",
      kimiModelHeavy: "", // 未配
      kimiModelLight: "", // 未配
    }));
  });
  afterEach(() => {
    jest.dontMock("../../config");
    jest.resetModules();
  });

  test("即使 tier 是 heavy/light，未配置时也走 default model", () => {
    const llm = require("../../services/llmService");
    expect(llm.getModelTier({ skillId: "ic_questions_xlsx" })).toBe("heavy"); // tier 仍是 heavy
    expect(llm.getModelName({ skillId: "ic_questions_xlsx" })).toBe("only-default"); // 但 model 回落
    expect(llm.getModelName({ skillId: "investment_snapshot" })).toBe("only-default");
  });
});
