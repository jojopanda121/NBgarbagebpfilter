// ============================================================
// tests/live/multiProvider.live.test.js — 各厂商真实 API 冒烟
//
// 单测里的适配层都是对着我们自己写的 fixture 断言的：厂商真改了参数校验
// 或响应形状，单测照样全绿。这一档用真 key 逐家打一遍，回答的是那个真正
// 该担心的问题——**用户换成这家模型后，流水线到底能不能跑完？**
//
// 每家都跑同一组三关，与流水线里真实用到的能力一一对应：
//   1. 基础应答          → callLLM（BP 抽取、维度分析都靠它）
//   2. 结构化 JSON 输出  → callLLMJson（评分、声明核查的命脉，过不了就等于不可用）
//   3. 能力自检          → 报告该模型的输出上限/思考风格，并核对没发出禁用参数
//
// 跑法（只测配了 key 的厂商，其余自动 skip，会产生真实费用）：
//   LIVE_ANTHROPIC_KEY=sk-ant-... LIVE_OPENAI_KEY=sk-... npm run test:live
//
// 想验证某个具体模型，用 LIVE_<厂商>_MODEL 覆盖默认模型名。
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });

const { runWithLlmContext, getDegradeNotes } = require("../../runtime/llmContext");
const { getProvider } = require("../../services/llm/providers");
const { resolveCapabilities } = require("../../services/llm/capabilities");

// 厂商 → 环境变量。没配的自动跳过，不会让整个套件失败。
const VENDORS = [
  { id: "deepseek", keyEnv: ["LIVE_DEEPSEEK_KEY", "DEEPSEEK_API_KEY"] },
  { id: "anthropic", keyEnv: ["LIVE_ANTHROPIC_KEY", "ANTHROPIC_API_KEY"] },
  { id: "openai", keyEnv: ["LIVE_OPENAI_KEY", "OPENAI_API_KEY"] },
  { id: "gemini", keyEnv: ["LIVE_GEMINI_KEY", "GEMINI_API_KEY"] },
  { id: "minimax", keyEnv: ["LIVE_MINIMAX_KEY", "MINIMAX_API_KEY"] },
  { id: "moonshot", keyEnv: ["LIVE_MOONSHOT_KEY", "MOONSHOT_API_KEY"] },
  { id: "qwen", keyEnv: ["LIVE_QWEN_KEY", "DASHSCOPE_API_KEY"] },
  { id: "zhipu", keyEnv: ["LIVE_ZHIPU_KEY", "ZHIPU_API_KEY"] },
];

function keyFor(vendor) {
  for (const name of vendor.keyEnv) {
    const v = (process.env[name] || "").trim();
    if (v) return v;
  }
  return "";
}

function modelFor(vendor) {
  const override = (process.env[`LIVE_${vendor.id.toUpperCase()}_MODEL`] || "").trim();
  return override || getProvider(vendor.id).defaultModels.default;
}

// 与流水线里声明核查同构的最小 schema：有枚举、有数值、有数组
const SCHEMA = {
  type: "object",
  required: ["verdict", "confidence", "reasons"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["支持", "存疑", "证伪"] },
    confidence: { type: "number" },
    reasons: { type: "array", items: { type: "string" } },
  },
};

const configured = VENDORS.filter((v) => keyFor(v));
if (configured.length === 0) {
  console.warn("[live] 未配置任何厂商 key（LIVE_*_KEY），跳过多厂商冒烟测试");
}

describe.each(configured.length ? configured : [{ id: "__none__", keyEnv: [] }])(
  "厂商冒烟：$id",
  (vendor) => {
    if (vendor.id === "__none__") {
      test.skip("未配置任何厂商 key", () => {});
      return;
    }

    const apiKey = keyFor(vendor);
    const model = modelFor(vendor);
    const ctx = {
      source: "byok",
      providerId: vendor.id,
      apiKey,
      models: { default: model, heavy: model, light: model },
    };

    // 注意：这里**不能** jest.resetModules() 换新的 llmService 实例 ——
    // AsyncLocalStorage 是模块级单例，换实例后 llmService 看到的就是另一个
    // 空上下文，BYOK 的 key 传不进去。客户端本身按 (厂商, key, 模型) 缓存，
    // 各家之间本来就不会串味。
    const llm = require("../../services/llmService");

    test(`[${vendor.id}/${model}] 基础应答：返回非空正文`, async () => {
      const text = await runWithLlmContext(ctx, () =>
        llm.callLLM("你是投资分析师，回答简短。", "用一句话说明什么是 ARR。", { maxTokens: 800 })
      );
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    });

    test(`[${vendor.id}/${model}] 结构化输出：能通过 JSON Schema 校验`, async () => {
      const res = await runWithLlmContext(ctx, () =>
        llm.callLLMJson(
          "你是投资尽调分析师。只输出 JSON 对象。",
          "某公司自称已与三家世界 500 强签署年框协议，但未提供合同或客户名称。请判断该声明可信度。",
          SCHEMA,
          { maxTokens: 2000, maxRepairs: 1, thinking: false }
        )
      );
      expect(["支持", "存疑", "证伪"]).toContain(res.data.verdict);
      expect(Array.isArray(res.data.reasons)).toBe(true);
    });

    test(`[${vendor.id}/${model}] 强制思考的判定任务不会因参数不兼容而失败`, async () => {
      // claim_verdict 会触发强制思考 + 12000 token 下限。
      // 对输出上限小/不支持思考的模型，这里必须自动降级跑通，而不是 400。
      const { text, notes } = await runWithLlmContext(ctx, async () => {
        const t = await llm.callLLM(
          "你是投资尽调分析师，回答简短。",
          "一句话说明：为什么没有合同佐证的大客户声明应当标为存疑？",
          { taskHint: "claim_verdict", maxTokens: 1500 }
        );
        return { text: t, notes: getDegradeNotes() };
      });
      expect(text.trim().length).toBeGreaterThan(0);
      if (notes.length) {
        console.warn(`[live][${vendor.id}/${model}] 能力降级：${notes.join(" / ")}`);
      }
    });

    test(`[${vendor.id}/${model}] 能力矩阵与实际模型不矛盾`, () => {
      const caps = resolveCapabilities(vendor.id, model);
      expect(caps.maxOutputTokens).toBeGreaterThan(0);
      expect(caps.contextWindow).toBeGreaterThan(0);
      console.log(
        `[live][${vendor.id}/${model}] 输出上限=${caps.maxOutputTokens} 上下文=${caps.contextWindow} ` +
        `思考=${caps.thinkingStyle} 工具=${caps.supportsTools} JSON模式=${caps.supportsJsonMode}`
      );
    });
  }
);
