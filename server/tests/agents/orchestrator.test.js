// server/tests/agents/orchestrator.test.js
"use strict";

jest.mock("../../agents/projectSummaryAgent");
jest.mock("../../agents/founderAgent");
jest.mock("../../agents/financialAgent");
jest.mock("../../agents/competitorAgent");
jest.mock("../../agents/valuationAgent");
jest.mock("../../agents/redFlagAgent");
jest.mock("../../services/agentRunService");
jest.mock("../../services/sseService");
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const agentRunService = require("../../services/agentRunService");
const { publishRunFinished } = require("../../services/sseService");

const ProjectSummaryAgent = require("../../agents/projectSummaryAgent");
const FounderAgent        = require("../../agents/founderAgent");
const FinancialAgent      = require("../../agents/financialAgent");
const CompetitorAgent     = require("../../agents/competitorAgent");
const ValuationAgent      = require("../../agents/valuationAgent");
const RedFlagAgent        = require("../../agents/redFlagAgent");

const { runAllAgents } = require("../../agents/orchestrator");

function mockAgentRun(AgentClass, output) {
  AgentClass.mockImplementation(() => ({
    run: jest.fn().mockResolvedValue({ userOutput: output, dataPayload: output }),
  }));
}

function mockAgentRunFail(AgentClass, message) {
  AgentClass.mockImplementation(() => ({
    run: jest.fn().mockRejectedValue(new Error(message)),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  agentRunService.createRun.mockReturnValue(undefined);
  agentRunService.markRunFinished.mockReturnValue(undefined);
});

describe("runAllAgents — happy path", () => {
  beforeEach(() => {
    mockAgentRun(ProjectSummaryAgent, { one_liner: "AI SaaS"  });
    mockAgentRun(FounderAgent,        { founders: [] });
    mockAgentRun(FinancialAgent,      { overall_credibility: 4 });
    mockAgentRun(CompetitorAgent,     { competitors: [] });
    mockAgentRun(ValuationAgent,      { verdict: { position: "合理" } });
    mockAgentRun(RedFlagAgent,        { red_flags: [] });
  });

  it("returns multiagent object with all 6 agent outputs", async () => {
    const { multiagent } = await runAllAgents("bp text", {}, "task1", "user1");

    expect(multiagent.project_summary).toEqual({ one_liner: "AI SaaS" });
    expect(multiagent.founder_profile).toEqual({ founders: [] });
    expect(multiagent.financial_analysis).toEqual({ overall_credibility: 4 });
    expect(multiagent.competitor_analysis).toEqual({ competitors: [] });
    expect(multiagent.valuation_analysis).toEqual({ verdict: { position: "合理" } });
    expect(multiagent.red_flags).toEqual({ red_flags: [] });
  });

  it("creates a run record and marks it finished", async () => {
    await runAllAgents("bp text", {}, "task1", "user1");
    expect(agentRunService.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task1", userId: "user1" })
    );
    expect(agentRunService.markRunFinished).toHaveBeenCalled();
  });

  it("publishes run_finished SSE event", async () => {
    await runAllAgents("bp text", {}, "task1", "user1");
    expect(publishRunFinished).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ failedCount: 0 }));
  });

  it("returns a runId (UUID format)", async () => {
    const { runId } = await runAllAgents("bp text", {}, "task1", "user1");
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("runAllAgents — partial failure", () => {
  it("one phase-1 agent fails but others still complete", async () => {
    mockAgentRun(ProjectSummaryAgent,  { one_liner: "AI SaaS" });
    mockAgentRunFail(FounderAgent,     "LLM timeout");
    mockAgentRun(FinancialAgent,       { overall_credibility: 3 });
    mockAgentRun(CompetitorAgent,      { competitors: [] });
    mockAgentRun(ValuationAgent,       { verdict: { position: "偏高" } });
    mockAgentRun(RedFlagAgent,         { red_flags: [{ title: "团队不完整" }] });

    const { multiagent } = await runAllAgents("bp text", {}, "task2", "user1");

    expect(multiagent.project_summary.one_liner).toBe("AI SaaS");
    expect(multiagent.founder_profile).toMatchObject({ error: expect.any(String), partial: true });
    expect(multiagent.financial_analysis.overall_credibility).toBe(3);
    // RedFlag agent should still run even if one phase-1 agent failed
    expect(multiagent.red_flags.red_flags).toHaveLength(1);
  });

  it("RedFlagAgent failure does not throw — returns error sentinel", async () => {
    mockAgentRun(ProjectSummaryAgent, { one_liner: "test" });
    mockAgentRun(FounderAgent,        { founders: [] });
    mockAgentRun(FinancialAgent,      { overall_credibility: 5 });
    mockAgentRun(CompetitorAgent,     { competitors: [] });
    mockAgentRun(ValuationAgent,      { verdict: {} });
    mockAgentRunFail(RedFlagAgent,    "red flag agent error");

    const { multiagent } = await runAllAgents("bp text", {}, "task3", "user1");

    expect(multiagent.red_flags).toMatchObject({ error: expect.any(String), partial: true });
    expect(agentRunService.markRunFinished).toHaveBeenCalled();
  });
});

describe("runAllAgents — RedFlagAgent receives prior agent outputs", () => {
  it("passes priorAgentOutputs to RedFlagAgent context", async () => {
    mockAgentRun(ProjectSummaryAgent, { one_liner: "AI" });
    mockAgentRun(FounderAgent,        { founders: [] });
    mockAgentRun(FinancialAgent,      { overall_credibility: 4 });
    mockAgentRun(CompetitorAgent,     { competitors: [] });
    mockAgentRun(ValuationAgent,      { verdict: { position: "合理" } });

    let capturedContext;
    RedFlagAgent.mockImplementation(() => ({
      run: jest.fn().mockImplementation(({ context }) => {
        capturedContext = context;
        return Promise.resolve({ userOutput: { red_flags: [] }, dataPayload: {} });
      }),
    }));

    await runAllAgents("bp text", { industry: "AI" }, "task4", "user1");

    expect(capturedContext).toHaveProperty("priorAgentOutputs");
    expect(capturedContext.priorAgentOutputs).toHaveProperty("project_summary");
    expect(capturedContext.priorAgentOutputs).toHaveProperty("valuation");
  });
});
