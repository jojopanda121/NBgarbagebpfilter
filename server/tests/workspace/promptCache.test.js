// ============================================================
// tests/workspace/promptCache.test.js
//
// 覆盖 P2-3 prompt caching helper 的行为：
//   - 默认 env 关闭 → 返回原字符串，行为不变
//   - 开启 + 系统提示 ≥ 1500 字符 → 返回带 cache_control 的 content 块数组
//   - 开启 + 用户前缀 ≥ 1500 字符 → 返回 [cached_prefix_block, tail_block]
//   - 开启但内容过短 → 仍然回退到字符串拼接（避免无效缓存）
//
// 不调用真实 LLM —— 直接测内部 helper 暴露的行为。
// ============================================================

// 强制每个 case 独立隔离 env 状态
function withEnv(value, fn) {
  const prev = process.env.ENABLE_PROMPT_CACHE;
  if (value === undefined) delete process.env.ENABLE_PROMPT_CACHE;
  else process.env.ENABLE_PROMPT_CACHE = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.ENABLE_PROMPT_CACHE;
    else process.env.ENABLE_PROMPT_CACHE = prev;
  }
}

const evidenceMaterial = require("../../skills/_evidenceMaterial");

describe("P2-3 prompt caching · _evidenceMaterial 暴露 cacheablePrefix", () => {
  // augmentMaterialsWithEvidence 涉及 DB/项目上下文; 这里只验证返回字段形状,
  // 用 stubbed factPack（mock buildEvidencePack）避免真实 DB 调用太复杂。
  // 实际产线上的回归在 onepager / competitorMatrix 集成测试已覆盖。
  test("返回值包含 cacheablePrefix 字段且总 materials = dynamicTail + cacheablePrefix", async () => {
    // 直接 require 内部模块并 monkey patch buildEvidencePack
    const factPack = {
      project_name: "测试公司",
      generated_at: new Date().toISOString(),
      facts: [
        { id: "F001", label: "公司", value: "测试公司", source_type: "project_context", source_name: "WS", source_url: "", confidence: "high" },
        { id: "F002", label: "ARR", value: "1.2 亿", source_type: "project_context", source_name: "WS", source_url: "", confidence: "high" },
      ],
      evidence_policy: "policy text",
      missing_policy: "missing policy",
    };
    const fp = require("../../skills/_factPack");
    const origBuild = fp.buildEvidencePack;
    fp.buildEvidencePack = async () => ({
      context: {},
      factPack,
      uploadCount: 0,
      searchUsed: false,
      searchQueries: [],
      searchResults: [],
    });
    try {
      const out = await evidenceMaterial.augmentMaterialsWithEvidence({
        project: {},
        ctx: {},
        skillId: "onepager_pptx",
        materials: "用户提供的简短材料",
        companyHint: "测试公司",
        useSearch: false,
      });
      expect(out).toHaveProperty("cacheablePrefix");
      expect(out).toHaveProperty("dynamicTail");
      expect(out.cacheablePrefix).toContain("Evidence Pack v2");
      expect(out.dynamicTail).toBe("用户提供的简短材料");
      // combined materials 仍包含两部分（向后兼容）
      expect(out.materials).toContain("用户提供的简短材料");
      expect(out.materials).toContain("Evidence Pack v2");
    } finally {
      fp.buildEvidencePack = origBuild;
    }
  });
});

// llmService 的 cache helper 是模块私有, 通过观察 callLLM 入参间接测试
// (mock anthropic SDK 后断言 system/messages 是否被转换成 content block 数组)
describe("P2-3 prompt caching · llmService cache_control 注入", () => {
  let llmService;
  let capturedRequests;
  const longText = "A".repeat(2000);
  const shortText = "短短提示";

  beforeEach(() => {
    capturedRequests = [];
    jest.resetModules();
    jest.doMock("@anthropic-ai/sdk", () => {
      class Anthropic {
        constructor() {
          this.messages = {
            create: async (req) => {
              capturedRequests.push(req);
              return { content: [{ type: "text", text: "{}" }] };
            },
            stream: () => { throw new Error("not used"); },
          };
        }
      }
      Anthropic.default = Anthropic;
      return Anthropic;
    });
    // 用 fake config 跳过 ensureMinimaxConfigured 校验
    jest.doMock("../../config", () => ({
      minimaxApiKey: "test-key",
      minimaxApiHost: "https://api.minimax.test",
      minimaxModel: "test-model",
    }));
    llmService = require("../../services/llmService");
  });

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("@anthropic-ai/sdk");
    jest.dontMock("../../config");
  });

  test("ENABLE_PROMPT_CACHE 未设 → system 保持字符串，messages.content 保持字符串", async () => {
    await withEnv(undefined, async () => {
      await llmService.callLLM(longText, "用户任务", 1024);
      expect(capturedRequests.length).toBe(1);
      expect(typeof capturedRequests[0].system).toBe("string");
      expect(typeof capturedRequests[0].messages[0].content).toBe("string");
    });
  });

  test("ENABLE_PROMPT_CACHE=1 + 长 system → system 变成带 cache_control 的 content block 数组", async () => {
    await withEnv("1", async () => {
      await llmService.callLLM(longText, "用户任务", 1024);
      const req = capturedRequests[0];
      expect(Array.isArray(req.system)).toBe(true);
      expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
      expect(req.system[0].text).toBe(longText);
    });
  });

  test("ENABLE_PROMPT_CACHE=1 但 system 过短 → 仍保持字符串（避免无效缓存）", async () => {
    await withEnv("1", async () => {
      await llmService.callLLM(shortText, "用户任务", 1024);
      expect(typeof capturedRequests[0].system).toBe("string");
    });
  });

  test("ENABLE_PROMPT_CACHE=1 + userPrefix 长 → messages.content 是 [cached_prefix, tail]", async () => {
    await withEnv("1", async () => {
      await llmService.callLLM(shortText, "动态任务", { maxTokens: 1024, userPrefix: longText });
      const req = capturedRequests[0];
      expect(Array.isArray(req.messages[0].content)).toBe(true);
      expect(req.messages[0].content.length).toBe(2);
      expect(req.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
      expect(req.messages[0].content[0].text).toBe(longText);
      expect(req.messages[0].content[1].text).toBe("动态任务");
      // tail 不带 cache_control
      expect(req.messages[0].content[1].cache_control).toBeUndefined();
    });
  });

  test("callLLM 旧签名 (number 作为 maxTokens) 仍工作", async () => {
    await withEnv(undefined, async () => {
      await llmService.callLLM(shortText, "task", 2048);
      expect(capturedRequests[0].max_tokens).toBe(2048);
    });
  });
});
