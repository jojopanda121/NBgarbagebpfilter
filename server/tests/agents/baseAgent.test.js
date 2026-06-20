// server/tests/agents/baseAgent.test.js
"use strict";

jest.mock("../../services/llmService");
jest.mock("../../services/agentRunService");
jest.mock("../../services/sseService");
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { callLLM, callLLMWithSearch } = require("../../services/llmService");
const agentRunService = require("../../services/agentRunService");
const { publishAgentEvent } = require("../../services/sseService");
const BaseAgent = require("../../agents/baseAgent");

// Concrete subclass for testing
class TestAgent extends BaseAgent {
  constructor(opts = {}) {
    super({ name: "test", systemPrompt: "sys", maxTokens: 1024, ...opts });
  }
  buildUserMessage({ text }) { return text || "hello"; }
  parseResponse(raw) {
    const data = JSON.parse(raw);
    return { userOutput: data, dataPayload: data };
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  agentRunService.markAgentStarted.mockReturnValue(undefined);
  agentRunService.markAgentDone.mockReturnValue(undefined);
  agentRunService.markAgentFailed.mockReturnValue(undefined);
});

describe("BaseAgent.run() — success path", () => {
  it("calls callLLM, parses response, marks done, publishes SSE event", async () => {
    callLLM.mockResolvedValue('{"ok":true}');
    const agent = new TestAgent();
    const result = await agent.run({ runId: "r1", context: { text: "bp text" } });

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(agentRunService.markAgentStarted).toHaveBeenCalledWith("r1", "test");
    expect(agentRunService.markAgentDone).toHaveBeenCalledWith(
      "r1", "test",
      expect.objectContaining({ userOutput: { ok: true } })
    );
    expect(publishAgentEvent).toHaveBeenCalledWith("r1", expect.objectContaining({ status: "done" }));
    expect(result.userOutput).toEqual({ ok: true });
  });
});

describe("BaseAgent.run() — retry logic", () => {
  it("retries maxRetries times then throws and marks failed", async () => {
    callLLM.mockRejectedValue(new Error("timeout"));
    const agent = new TestAgent({ maxRetries: 2 });

    await expect(agent.run({ runId: "r2", context: {} })).rejects.toThrow("timeout");

    // 1 initial attempt + 2 retries = 3 total calls
    expect(callLLM).toHaveBeenCalledTimes(3);
    expect(agentRunService.markAgentFailed).toHaveBeenCalledWith(
      "r2", "test", expect.objectContaining({ error: "timeout" })
    );
    expect(publishAgentEvent).toHaveBeenCalledWith("r2", expect.objectContaining({ status: "failed" }));
  });

  it("succeeds on second attempt after one failure", async () => {
    callLLM
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValueOnce('{"recovered":true}');

    const agent = new TestAgent({ maxRetries: 1 });
    const result = await agent.run({ runId: "r3", context: {} });

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(result.userOutput).toEqual({ recovered: true });
    expect(agentRunService.markAgentDone).toHaveBeenCalled();
    expect(agentRunService.markAgentFailed).not.toHaveBeenCalled();
  });
});

describe("BaseAgent — MiniMax M3 think-only / 截断输出处理", () => {
  it("retries with corrective feedback when the model returns think-only output, then succeeds", async () => {
    callLLM
      // 第一轮：M3 把预算烧在 <think> 上，没吐 JSON
      .mockResolvedValueOnce("<think>let me think very hard about this</think>")
      .mockResolvedValueOnce('{"recovered":true}');

    const agent = new TestAgent({ maxRetries: 2 });
    const result = await agent.run({ runId: "rt1", context: { text: "BASE_MSG" } });

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(result.userOutput).toEqual({ recovered: true });
    expect(agentRunService.markAgentDone).toHaveBeenCalled();
    expect(agentRunService.markAgentFailed).not.toHaveBeenCalled();
  });

  it("appends a 'finish the JSON' hint and escalates tokens (no model-tier switch, no thinking suppression) on the retry", async () => {
    callLLM
      .mockResolvedValueOnce("<think>burning tokens</think>")
      .mockResolvedValueOnce('{"ok":true}');

    const agent = new TestAgent({ maxRetries: 2, maxTokens: 4096 });
    await agent.run({ runId: "rt2", context: { text: "BASE_MSG" } });

    // 首轮：原始消息 + 原始 token 预算（数字签名）
    const [, firstMsg, firstOpts] = callLLM.mock.calls[0];
    expect(firstMsg).toBe("BASE_MSG");
    expect(firstOpts).toBe(4096);

    // 纠偏轮：消息追加"思考后务必输出完整 JSON"的提示，预算放大一倍（仍是数字签名，不切档）
    const [, secondMsg, secondOpts] = callLLM.mock.calls[1];
    expect(secondMsg).toContain("BASE_MSG");
    expect(secondMsg).toContain("务必输出最终答案");
    expect(secondOpts).toBe(8192); // 4096 * 2
  });

  it("fails after exhausting retries when every attempt is think-only", async () => {
    callLLM.mockResolvedValue("<think>only ever thinking, never any json</think>");

    const agent = new TestAgent({ maxRetries: 2 });
    await expect(agent.run({ runId: "rt3", context: {} })).rejects.toThrow(/无有效 JSON/);

    expect(callLLM).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(agentRunService.markAgentFailed).toHaveBeenCalledWith(
      "rt3", "test", expect.objectContaining({ error: expect.stringMatching(/无有效 JSON/) })
    );
  });

  it("useSearch path: think-only triggers retry with escalated maxTokens and no re-search", async () => {
    callLLMWithSearch
      .mockResolvedValueOnce({ text: "<think>burning the budget</think>" })
      .mockResolvedValueOnce({ text: '{"ok":true}' });

    const agent = new TestAgent({ useSearch: true, maxRetries: 2 }); // maxTokens=1024
    const result = await agent.run({ runId: "rt4", context: {} });

    expect(callLLMWithSearch).toHaveBeenCalledTimes(2);
    const secondOpts = callLLMWithSearch.mock.calls[1][2];
    expect(secondOpts.maxTokens).toBe(2048); // 1024 * 2
    expect(secondOpts.preSearchQueries).toEqual([]); // 重试不重复检索
    expect(result.userOutput).toEqual({ ok: true });
  });

  it("does not probe JSON when jsonOnly=false (non-JSON agents opt out)", async () => {
    class TextAgent extends BaseAgent {
      constructor() { super({ name: "text", systemPrompt: "s", maxTokens: 512, jsonOnly: false }); }
      buildUserMessage() { return "hi"; }
      parseResponse(raw) { return { userOutput: raw, dataPayload: raw }; }
    }
    callLLM.mockResolvedValue("just markdown prose, no json at all");

    const agent = new TextAgent();
    const result = await agent.run({ runId: "rt5", context: {} });

    expect(callLLM).toHaveBeenCalledTimes(1); // 无 JSON 探针 → 不触发重试
    expect(result.userOutput).toBe("just markdown prose, no json at all");
  });
});

describe("BaseAgent — useSearch mode", () => {
  it("calls callLLMWithSearch when useSearch=true", async () => {
    callLLMWithSearch.mockResolvedValue({ text: '{"search":true}' });
    const agent = new TestAgent({ useSearch: true });
    await agent.run({ runId: "r4", context: {} });

    expect(callLLMWithSearch).toHaveBeenCalledTimes(1);
    expect(callLLM).not.toHaveBeenCalled();
  });
});

describe("BaseAgent — buildUserMessage not implemented", () => {
  it("throws if subclass does not implement buildUserMessage", async () => {
    class BrokenAgent extends BaseAgent {
      constructor() { super({ name: "broken", systemPrompt: "s", maxTokens: 100 }); }
    }
    callLLM.mockResolvedValue("{}");
    const agent = new BrokenAgent();
    await expect(agent.run({ runId: "r5", context: {} })).rejects.toThrow("buildUserMessage");
  });
});
