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
