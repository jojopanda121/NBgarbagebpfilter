// ============================================================
// tests/llm/byokRouting.test.js
//
// 用户自带模型（BYOK）的调用路由与**能力降级**。
//
// 这里守的是整个多模型支持里最要命的一条：
// 流水线的 token 预算是照 DeepSeek V4（64K 输出）写死的，判定类任务还会被
// 强制抬到 12000（THINKING_MIN_TOKENS）。用户换成输出上限 4096 的模型后，
// 如果不裁剪，**每一次声明核查都会 400**，重试三次全废，整份分析失败。
// 所以：预算必须裁到能力上限，思考必须在预算不够时自动关掉，并留下
// 可以回给用户的降级说明。
// ============================================================

describe("BYOK 路由与能力降级", () => {
  let llmService;
  let llmContext;
  let captured;

  beforeEach(() => {
    captured = [];
    jest.resetModules();
    jest.doMock("../../utils/llmClient", () => ({
      createLLMClient: (args) => ({
        _args: args,
        messages: {
          create: async (req) => {
            captured.push({ req, client: args });
            return { content: [{ type: "text", text: "ok" }] };
          },
          stream: () => { throw new Error("not used"); },
        },
      }),
    }));
    jest.doMock("../../config", () => ({
      llmProvider: "deepseek",
      llmApiKey: "platform-key",
      llmApiHost: "https://api.deepseek.com/v1",
      llmModel: "deepseek-v4-flash",
      llmModelHeavy: "deepseek-v4-pro",
      llmModelLight: "",
      llmReasoningEffort: "",
      deepseekApiKey: "platform-key",
      deepseekModel: "deepseek-v4-flash",
    }));
    llmService = require("../../services/llmService");
    llmContext = require("../../runtime/llmContext");
  });

  afterEach(() => {
    jest.dontMock("../../utils/llmClient");
    jest.dontMock("../../config");
    jest.resetModules();
  });

  const byok = (overrides = {}) => ({
    source: "byok",
    providerId: "anthropic",
    apiKey: "user-key",
    models: { default: "claude-sonnet-5", heavy: "claude-opus-5", light: "claude-haiku-4-5-20251001" },
    ...overrides,
  });

  test("无上下文 → 用平台的 key 和模型", async () => {
    await llmService.callLLM("sys", "user", { maxTokens: 1000 });
    expect(captured[0].client.apiKey).toBe("platform-key");
    expect(captured[0].client.providerId).toBe("deepseek");
    expect(captured[0].req.model).toBe("deepseek-v4-flash");
  });

  test("BYOK 上下文 → 用用户的 key、厂商和模型", async () => {
    await llmContext.runWithLlmContext(byok(), () =>
      llmService.callLLM("sys", "user", { maxTokens: 1000 })
    );
    expect(captured[0].client.apiKey).toBe("user-key");
    expect(captured[0].client.providerId).toBe("anthropic");
    expect(captured[0].req.model).toBe("claude-sonnet-5");
  });

  test("BYOK 也走分档路由：heavy 任务用用户配的 heavy 模型", async () => {
    await llmContext.runWithLlmContext(byok(), () =>
      llmService.callLLM("sys", "user", { maxTokens: 1000, skillId: "ic_memo" })
    );
    expect(captured[0].req.model).toBe("claude-opus-5");
  });

  test("用户只配了一个模型 → 三档都用它，不报错", async () => {
    await llmContext.runWithLlmContext(
      byok({ models: { default: "claude-sonnet-5" } }),
      () => llmService.callLLM("sys", "user", { maxTokens: 1000, skillId: "ic_memo" })
    );
    expect(captured[0].req.model).toBe("claude-sonnet-5");
  });

  test("上下文只在本次异步链内生效，不泄漏到后续调用", async () => {
    await llmContext.runWithLlmContext(byok(), () => llmService.callLLM("s", "u", { maxTokens: 100 }));
    await llmService.callLLM("s", "u", { maxTokens: 100 });
    expect(captured[0].client.apiKey).toBe("user-key");
    expect(captured[1].client.apiKey).toBe("platform-key");
  });

  describe("能力降级（不裁剪就会每次 400 的那些场景）", () => {
    test("小输出上限模型：强制思考任务的预算被裁到上限，思考自动关闭", async () => {
      const notes = await llmContext.runWithLlmContext(
        byok({ providerId: "moonshot", models: { default: "moonshot-v1-8k" } }), // 上限 4096
        async () => {
          // claim_verdict 是强制开思考的判定任务，默认会被抬到 12000
          await llmService.callLLM("sys", "user", { maxTokens: 8000, taskHint: "claim_verdict" });
          return llmContext.getDegradeNotes();
        }
      );
      expect(captured[0].req.max_tokens).toBeLessThanOrEqual(4096);
      expect(captured[0].req.thinking).toEqual({ type: "disabled" });
      // 判定纪律被削弱这件事必须留痕，好回给用户
      expect(notes.join("")).toMatch(/输出上限|关闭深度思考|不支持深度思考/);
      // 降级说明是给用户看的，不能把内部函数名写进去
      expect(notes.join("")).not.toMatch(/callLLM|_planTokens/);
    });

    test("不支持思考的模型：不发思考字段，也不把预算抬到思考下限", async () => {
      await llmContext.runWithLlmContext(
        byok({ providerId: "openai", models: { default: "gpt-4o" } }),
        () => llmService.callLLM("sys", "user", { maxTokens: 3000, taskHint: "claim_verdict" })
      );
      expect(captured[0].req.max_tokens).toBe(3000);   // 没有被抬到 12000
      expect(captured[0].req.thinking).toEqual({ type: "disabled" });
    });

    test("能力足够的模型：保持原有的强制思考 + token 下限语义", async () => {
      await llmContext.runWithLlmContext(
        byok({ providerId: "deepseek", models: { default: "deepseek-v4-flash" } }),
        () => llmService.callLLM("sys", "user", { maxTokens: 3000, taskHint: "claim_verdict" })
      );
      expect(captured[0].req.max_tokens).toBe(12000);  // THINKING_MIN_TOKENS
      expect(captured[0].req.thinking).toEqual({ type: "enabled" });
    });

    test("不支持 reasoning_effort 的模型不带该字段", async () => {
      jest.resetModules();
      jest.doMock("../../config", () => ({
        llmProvider: "deepseek", llmApiKey: "k", llmModel: "deepseek-v4-flash",
        llmReasoningEffort: "high", deepseekApiKey: "k", deepseekModel: "deepseek-v4-flash",
      }));
      const svc = require("../../services/llmService");
      const ctx = require("../../runtime/llmContext");
      await ctx.runWithLlmContext(
        { source: "byok", providerId: "moonshot", apiKey: "u", models: { default: "kimi-k2-0905-preview" } },
        () => svc.callLLM("sys", "user", { maxTokens: 5000, taskHint: "claim_verdict" })
      );
      expect(captured[captured.length - 1].req).not.toHaveProperty("reasoning_effort");
    });

    test("中间档（上限 8192，支持思考）：保留思考但贴着上限跑", async () => {
      // qwen-plus 支持思考、上限 8192 —— 既不能抬到 12000（会 400），
      // 也没必要关掉思考（预算还够写正文）
      await llmContext.runWithLlmContext(
        byok({ providerId: "qwen", models: { default: "qwen-plus" } }),
        () => llmService.callLLM("sys", "user", { maxTokens: 8000, taskHint: "claim_verdict" })
      );
      expect(captured[0].req.max_tokens).toBe(8192);
      expect(captured[0].req.thinking).toEqual({ type: "enabled" });
    });

    test("用户显式覆盖输出上限后，思考预算能抬回下限", async () => {
      await llmContext.runWithLlmContext(
        byok({
          providerId: "qwen",
          models: { default: "qwen-plus" },
          capabilityOverrides: { maxOutputTokens: 32000 },
        }),
        () => llmService.callLLM("sys", "user", { maxTokens: 8000, taskHint: "claim_verdict" })
      );
      expect(captured[0].req.max_tokens).toBe(12000);
    });
  });

  describe("可观测", () => {
    test("describeActiveLlm 报告当前模型与降级说明", async () => {
      const desc = await llmContext.runWithLlmContext(
        byok({ providerId: "moonshot", models: { default: "moonshot-v1-8k" } }),
        async () => {
          await llmService.callLLM("s", "u", { maxTokens: 8000, taskHint: "claim_verdict" });
          return llmService.describeActiveLlm();
        }
      );
      expect(desc.source).toBe("byok");
      expect(desc.provider).toBe("moonshot");
      expect(desc.model).toBe("moonshot-v1-8k");
      expect(desc.degrade_notes.length).toBeGreaterThan(0);
    });

    test("平台模式下没有降级说明", async () => {
      const desc = llmService.describeActiveLlm();
      expect(desc.source).toBe("platform");
      expect(desc.degrade_notes).toEqual([]);
    });

    test("inputBudgetChars 随模型上下文缩小（防止超长 BP 打爆小模型）", async () => {
      const small = await llmContext.runWithLlmContext(
        byok({ providerId: "moonshot", models: { default: "moonshot-v1-32k" } }),
        async () => llmService.inputBudgetChars(8192)
      );
      const big = llmService.inputBudgetChars(8192);
      expect(small).toBeLessThan(big);
      expect(small).toBeGreaterThan(0);
    });
  });

  test("BYOK 上下文缺 key → 明确报错，绝不静默回退到平台 key", async () => {
    await expect(
      llmContext.runWithLlmContext(
        { source: "byok", providerId: "openai", apiKey: "", models: { default: "gpt-4o" } },
        () => llmService.callLLM("s", "u", { maxTokens: 100 })
      )
    ).rejects.toThrow();
    // 没有任何请求被发出去（更不能拿平台 key 发）
    expect(captured).toHaveLength(0);
  });
});
