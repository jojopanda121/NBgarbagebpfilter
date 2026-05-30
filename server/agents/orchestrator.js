// ============================================================
// server/agents/orchestrator.js — 2-phase multiagent调度
// Phase 1: 5 independent agents in parallel
// Phase 2: RedFlagAgent (depends on phase-1 outputs)
// ============================================================

const { randomUUID } = require("crypto");
const logger = require("../utils/logger");
const agentRunService = require("../services/agentRunService");
const { publishRunFinished } = require("../services/sseService");

const ProjectSummaryAgent = require("./projectSummaryAgent");
const FounderAgent        = require("./founderAgent");
const FinancialAgent      = require("./financialAgent");
const CompetitorAgent     = require("./competitorAgent");
const ValuationAgent      = require("./valuationAgent");
const RedFlagAgent        = require("./redFlagAgent");

// Lazy factory — creates fresh instances per run so Jest mocks apply correctly
function createAgents() {
  return {
    project_summary: new ProjectSummaryAgent(),
    founder:         new FounderAgent(),
    financial:       new FinancialAgent(),
    competitor:      new CompetitorAgent(),
    valuation:       new ValuationAgent(),
    red_flag:        new RedFlagAgent(),
  };
}

/**
 * Run a single agent, swallowing errors so allSettled works cleanly.
 * Returns { userOutput, dataPayload } on success, throws on failure.
 */
async function runAgent(agent, runId, context) {
  return agent.run({ runId, context });
}

/**
 * Execute all 6 agents in 2 phases.
 *
 * @param {string} bpText       — full BP text
 * @param {object} extractedData — Agent A structured output
 * @param {string} taskId        — linked task ID
 * @param {string} userId        — owner user ID (for PRIVACY checks)
 * @returns {{ runId: string, multiagent: object }}
 */
async function runAllAgents(bpText, extractedData, taskId, userId) {
  const runId = randomUUID();

  agentRunService.createRun({ runId, taskId, userId });
  logger.info("[Orchestrator] run started", { runId, taskId });

  const context = { bpFullText: bpText, extractedData };
  const phase1Names = ["project_summary", "founder", "financial", "competitor", "valuation"];

  // 主流程状态（在 try 外声明，finally 能访问）
  let multiagent = null;
  let crashed = false;
  let crashErr = null;
  const phase1Results = {};
  let phase2Result = null;
  let workspaceAttach = null;

  try {
    // Create fresh agent instances for this run
    const agentInstances = createAgents();

    // ── Phase 1: 5 independent agents ──────────────────────────
    const phase1Outcomes = await Promise.allSettled(
      phase1Names.map((name) => runAgent(agentInstances[name], runId, context))
    );

    phase1Names.forEach((name, i) => {
      const outcome = phase1Outcomes[i];
      if (outcome.status === "fulfilled") {
        phase1Results[name] = outcome.value;   // { userOutput, dataPayload }
      } else {
        phase1Results[name] = null;
        logger.warn(`[Orchestrator] phase-1 agent ${name} failed: ${outcome.reason?.message}`);
      }
    });

    // ── Phase 2: RedFlagAgent (needs phase-1 outputs) ──────────
    const redFlagContext = {
      ...context,
      priorAgentOutputs: phase1Results,
    };
    try {
      phase2Result = await runAgent(agentInstances.red_flag, runId, redFlagContext);
    } catch (err) {
      logger.warn("[Orchestrator] RedFlagAgent failed:", err.message);
    }

    // ── Sprint 2: 自动创建/挂载到 workspace project ───────────
    try {
      if (userId) {
        const workspaceProjectService = require("../services/workspaceProjectService");
        const agentOutputs = {
          project_summary: phase1Results.project_summary?.userOutput || {},
          founder: phase1Results.founder?.userOutput || {},
          financial: phase1Results.financial?.userOutput || {},
          competitor: phase1Results.competitor?.userOutput || {},
          valuation: phase1Results.valuation?.userOutput || {},
          red_flag: phase2Result?.userOutput || {},
        };
        workspaceAttach = workspaceProjectService.createOrAttachProject({
          userId,
          taskId,
          agentRunId: runId,
          agentOutputs,
        });
      }
    } catch (err) {
      logger.warn("[Orchestrator] workspace attach failed:", err.message);
    }

    // ── Build multiagent result object ──────────────────────────
    multiagent = {
      run_id: runId,
      workspace_project_id: workspaceAttach?.projectId || null,
      workspace_version_number: workspaceAttach?.versionNumber || null,
      project_summary:    phase1Results.project_summary?.userOutput    || { error: "执行失败", partial: true },
      founder_profile:    phase1Results.founder?.userOutput            || { error: "执行失败", partial: true },
      financial_analysis: phase1Results.financial?.userOutput          || { error: "执行失败", partial: true },
      competitor_analysis: phase1Results.competitor?.userOutput        || { error: "执行失败", partial: true },
      valuation_analysis: phase1Results.valuation?.userOutput          || { error: "执行失败", partial: true },
      red_flags:          phase2Result?.userOutput                     || { error: "执行失败", partial: true },
    };
  } catch (err) {
    // 顶层致命 throw：构造 partial 结果，不让前端拿到撒谎的 done 状态
    crashed = true;
    crashErr = err;
    logger.error("[Orchestrator] CRITICAL crash", { runId, err: err.message, stack: err.stack });
    multiagent = {
      run_id: runId,
      workspace_project_id: workspaceAttach?.projectId || null,
      workspace_version_number: workspaceAttach?.versionNumber || null,
      error: err.message,
      partial: true,
      project_summary:    phase1Results.project_summary?.userOutput    || { error: "执行中断", partial: true },
      founder_profile:    phase1Results.founder?.userOutput            || { error: "执行中断", partial: true },
      financial_analysis: phase1Results.financial?.userOutput          || { error: "执行中断", partial: true },
      competitor_analysis: phase1Results.competitor?.userOutput        || { error: "执行中断", partial: true },
      valuation_analysis: phase1Results.valuation?.userOutput          || { error: "执行中断", partial: true },
      red_flags:          phase2Result?.userOutput                     || { error: "执行中断", partial: true },
    };
  } finally {
    // 无论 happy path 还是顶层崩溃，状态机和 SSE 必须收尾
    if (crashed) {
      agentRunService.markRunCrashed(runId, crashErr?.message);
    } else {
      agentRunService.markRunFinished(runId);
    }
    const failedCount = [
      ...phase1Names.map((n) => !phase1Results[n]),
      !phase2Result,
    ].filter(Boolean).length;
    try {
      publishRunFinished(runId, { failedCount, workspaceAttach, crashed });
    } catch (err) {
      logger.error("[Orchestrator] publishRunFinished failed", { runId, err: err.message });
    }
    logger.info("[Orchestrator] run finished", {
      runId,
      failedCount,
      crashed,
      projectId: workspaceAttach?.projectId,
    });
  }

  return { runId, multiagent };
}

module.exports = { runAllAgents };
