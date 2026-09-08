// ============================================================
// tests/llm/platformKeyOptional.test.js
//
// 「平台不再续费 API，用户拿自己的 Key 还能继续用」这条兜底路径。
//
// 守两件事：
//  1. 平台 LLM key 缺失时，只要 BYOK 可用，进程就不许退出 —— 整站起不来
//     是最坏结果，用户连填自己 Key 的页面都打不开。BYOK 也关着才算致命。
//  2. 此时 ensureLLMConfigured 给用户的话必须是他能照做的（去配自己的 Key），
//     而不是一句只有运维看得懂的 "请在 .env 中设置"。
// ============================================================

const HEX64 = "a".repeat(64);

function loadConfig({ env = "production", llmKey = "", encryptionKey = HEX64, byokEnabled = true } = {}) {
  jest.resetModules();
  const prev = { ...process.env };
  process.env.NODE_ENV = env;
  process.env.JWT_SECRET = "x".repeat(40);
  process.env.ALLOWED_ORIGINS = "https://example.com";
  process.env.PII_SALT = "s".repeat(32);
  process.env.LLM_PROVIDER = "deepseek";
  process.env.LLM_API_KEY = llmKey;
  process.env.DEEPSEEK_API_KEY = "";
  process.env.ENCRYPTION_KEY = encryptionKey;
  if (byokEnabled) delete process.env.BYOK_ENABLED;
  else process.env.BYOK_ENABLED = "0";
  try {
    return require("../../config");
  } finally {
    process.env = prev;
  }
}

describe("平台 LLM key 缺失时的启动行为", () => {
  let exitSpy;
  let warnSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("BYOK 可用时不退出进程，只告警，并标记平台模型不可用", () => {
    const config = loadConfig({ llmKey: "" });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(config.platformModelAvailable).toBe(false);
    expect(config.byokAvailable).toBe(true);
    expect(warnSpy.mock.calls.flat().join("\n")).toMatch(/纯自带模型模式/);
  });

  it("BYOK 也不可用（没有 ENCRYPTION_KEY）时仍然按启动失败处理", () => {
    loadConfig({ llmKey: "", encryptionKey: "" });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("管理员显式关闭 BYOK 时同样按启动失败处理", () => {
    loadConfig({ llmKey: "", byokEnabled: false });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("平台 key 正常时两个开关都为 true", () => {
    const config = loadConfig({ llmKey: "sk-platform" });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(config.platformModelAvailable).toBe(true);
    expect(config.byokAvailable).toBe(true);
  });
});

describe("ensureLLMConfigured 的报错文案", () => {
  function loadService({ byokAvailable }) {
    jest.resetModules();
    jest.doMock("../../config", () => ({
      llmProvider: "deepseek",
      llmApiKey: "",
      llmApiHost: "",
      llmModel: "deepseek-v4-flash",
      llmModelHeavy: "",
      llmModelLight: "",
      llmReasoningEffort: "",
      deepseekApiKey: "",
      deepseekModel: "deepseek-v4-flash",
      deepseekApiHost: "",
      byokAvailable,
      platformModelAvailable: false,
    }));
    return require("../../services/llmService");
  }

  afterEach(() => {
    jest.resetModules();
  });

  it("BYOK 开着 → 引导用户去配自己的 Key，且标记为不可重试", () => {
    const svc = loadService({ byokAvailable: true });
    expect(() => svc.ensureLLMConfigured()).toThrow(/我的模型/);
    try {
      svc.ensureLLMConfigured();
    } catch (err) {
      expect(err.permanent).toBe(true);
    }
  });

  it("BYOK 关着 → 才是运维问题，给 .env 提示", () => {
    const svc = loadService({ byokAvailable: false });
    expect(() => svc.ensureLLMConfigured()).toThrow(/LLM_API_KEY/);
  });
});
