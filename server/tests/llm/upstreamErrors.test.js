// ============================================================
// tests/llm/upstreamErrors.test.js
//
// 这一组测的是"换任何厂商都别把分析跑挂"的三层防线：
//
//  1) HTTP 200 里的业务错误（MiniMax 就是这么报错的：限流/额度/参数非法
//     一律 HTTP 200 + base_resp.status_code，choices=null）。不拦下来，
//     整条链路拿到的是空字符串，真实原因永远查不到。
//  2) 参数不兼容时的**运行时自适应**：被拒一次就学会该去掉哪个字段，
//     改写后立刻重试，并记住这个模型的脾气。
//  3) 退避要听 Retry-After，且必须有抖动（否则并发的几路会一起重撞）。
// ============================================================

const {
  assertBusinessOk,
  parseRetryAfter,
  createOpenAICompatibleClient,
  LLMAPIError,
} = require("../../services/llm/providers/openaiCompatible");
const { adaptRequest, applyQuirks, quirkKey, _resetQuirks } = require("../../services/llm/quirks");
const { resolveCapabilities } = require("../../services/llm/capabilities");
const { recommendedConcurrency } = require("../../services/llm/concurrency");

const OK_BODY = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };

function mockFetchSequence(responses) {
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push(JSON.parse(init.body));
    const r = responses.shift();
    return {
      ok: r.status ? r.status < 400 : true,
      status: r.status || 200,
      statusText: "",
      headers: new Map(Object.entries(r.headers || {})),
      text: async () => JSON.stringify(r.body),
      json: async () => r.body,
    };
  });
  return calls;
}

describe("HTTP 200 里的业务错误必须被识别", () => {
  test("限流 1002 → 429（可重试）", () => {
    expect(() => assertBusinessOk({ choices: null, base_resp: { status_code: 1002, status_msg: "触发限流" } }, "MiniMax"))
      .toThrow(/1002/);
    try {
      assertBusinessOk({ base_resp: { status_code: 1002 } }, "MiniMax");
    } catch (e) {
      expect(e.status).toBe(429);
    }
  });

  test("Token Plan 用量耗尽 2056 → 402（永久，不该重试）", () => {
    try {
      assertBusinessOk({ choices: null, base_resp: { status_code: 2056, status_msg: "已达到 Token Plan 用量上限" } }, "MiniMax");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.status).toBe(402);
      expect(e.message).toContain("Token Plan");
    }
  });

  test("参数非法 2013 → 400", () => {
    try {
      assertBusinessOk({ base_resp: { status_code: 2013, status_msg: 'invalid thinking.type: "enabled"' } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });

  test("status_code=0 且有 choices → 放行", () => {
    expect(() => assertBusinessOk({ ...OK_BODY, base_resp: { status_code: 0 } })).not.toThrow();
  });

  test("既没报错也没有 choices → 502，绝不当成'空回答'放过去", () => {
    try {
      assertBusinessOk({ id: "x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.status).toBe(502);
    }
  });

  test("未知业务码按 500 处理（可重试，不判死）", () => {
    try {
      assertBusinessOk({ base_resp: { status_code: 99999, status_msg: "?" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.status).toBe(500);
    }
  });
});

describe("Retry-After", () => {
  test("秒数", () => {
    expect(parseRetryAfter(new Map([["retry-after", "12"]]))).toBe(12000);
  });
  test("缺失 → 0（回落到指数退避）", () => {
    expect(parseRetryAfter(new Map())).toBe(0);
  });
  test("超长值被截到 120s，避免一个请求卡死整条流水线", () => {
    expect(parseRetryAfter(new Map([["retry-after", "99999"]]))).toBe(120000);
  });
});

describe("运行时自适应：被拒一次就学会", () => {
  beforeEach(() => _resetQuirks());

  test("thinking 值非法 → 采纳报错里给出的合法取值", () => {
    const key = quirkKey("https://x/v1", "MiniMax-M3");
    const err = new LLMAPIError('invalid params, invalid thinking.type: "enabled" (allowed: adaptive, disabled)', 400);
    const body = { model: "MiniMax-M3", thinking: { type: "enabled" }, messages: [] };
    const out = adaptRequest(key, err, body);
    expect(out.body.thinking).toEqual({ type: "adaptive" });
    // 学到之后，后续请求不必再撞一次
    expect(applyQuirks(key, { ...body }).thinking).toEqual({ type: "adaptive" });
  });

  test("说不清合法取值的 thinking 报错 → 整个字段丢掉", () => {
    const key = quirkKey("https://x/v1", "some-model");
    const err = new LLMAPIError("unknown field: thinking", 400);
    const out = adaptRequest(key, err, { model: "m", thinking: { type: "enabled" }, messages: [] });
    expect(out.body).not.toHaveProperty("thinking");
  });

  test("response_format / reasoning_effort 被点名 → 丢字段", () => {
    const key = quirkKey("https://x/v1", "m");
    const err = new LLMAPIError("response_format is not supported", 400);
    const out = adaptRequest(key, err, { model: "m", response_format: { type: "json_object" }, messages: [] });
    expect(out.body).not.toHaveProperty("response_format");
  });

  test("输出上限超标 → 贴报错里给出的上限", () => {
    const key = quirkKey("https://x/v1", "m");
    const err = new LLMAPIError("max_tokens is too large: this model supports at most 8192 tokens", 400);
    const out = adaptRequest(key, err, { model: "m", max_tokens: 32000, messages: [] });
    expect(out.body.max_tokens).toBe(8192);
  });

  test("认不出的参数错 → 退回最小请求体，也不让分析失败", () => {
    const key = quirkKey("https://x/v1", "m");
    const err = new LLMAPIError("bad request: unsupported parameter foo", 400);
    const out = adaptRequest(key, err, {
      model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }], foo: 1, tools: [],
    });
    expect(out.body).toEqual({ model: "m", messages: [{ role: "user", content: "hi" }], max_tokens: 100 });
  });

  test("限流/余额/5xx 不属于'改请求体能解决'的问题，原样抛给重试层", () => {
    const key = quirkKey("https://x/v1", "m");
    for (const status of [429, 402, 401, 500, 503]) {
      expect(adaptRequest(key, new LLMAPIError("boom", status), { model: "m", messages: [] })).toBeNull();
    }
  });
});

describe("客户端端到端：错误识别 + 自适应重试", () => {
  const caps = resolveCapabilities("minimax", "MiniMax-M3");
  const client = () => createOpenAICompatibleClient({
    apiKey: "k", endpoint: "https://api.minimaxi.com/v1/text/chatcompletion_v2", caps, label: "MiniMax",
  });

  beforeEach(() => _resetQuirks());

  test("HTTP 200 + 限流业务码 → 抛 429，而不是返回空回答", async () => {
    mockFetchSequence([{ body: { choices: null, base_resp: { status_code: 1002, status_msg: "触发限流" } } }]);
    await expect(client().messages.create({ model: "MiniMax-M3", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }))
      .rejects.toMatchObject({ status: 429 });
  });

  test("被拒一次 → 自动改写后成功，调用方完全无感", async () => {
    const calls = mockFetchSequence([
      { status: 400, body: { error: { message: 'invalid params, invalid thinking.type: "enabled" (allowed: adaptive, disabled)' } } },
      { body: OK_BODY },
    ]);
    const resp = await client().messages.create({
      model: "MiniMax-M3", max_tokens: 100, messages: [{ role: "user", content: "hi" }], thinking: { type: "enabled" },
    });
    expect(resp.content).toEqual([{ type: "text", text: "ok" }]);
    expect(calls[1].thinking).toEqual({ type: "adaptive" });
  });
});

describe("并发闸门：按厂商给保守默认值", () => {
  test("MiniMax / Kimi 的默认并发明显低于 DeepSeek", () => {
    expect(recommendedConcurrency("minimax")).toBeLessThan(recommendedConcurrency("deepseek"));
    expect(recommendedConcurrency("moonshot")).toBeLessThan(recommendedConcurrency("deepseek"));
  });
  test("没见过的厂商（自建网关）一律保守", () => {
    expect(recommendedConcurrency("whatever")).toBeLessThanOrEqual(3);
  });
});
