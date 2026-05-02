// ============================================================
// server/services/projectMigrationService.js
// Sprint 2: 历史数据迁移
//
// 把 Sprint 2 之前的孤立 BP 上传（tasks 没绑到 workspace_project_id）
// 批量整理成 workspace projects。用户可在前端"一键整理"。
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");
const workspaceProjectService = require("./workspaceProjectService");

/**
 * 把指定用户名下还没有 workspace_project_id 的 tasks 全部迁移。
 * 仅处理 status='complete' 的 tasks。
 */
function migrateLegacyForUser(userId) {
  const db = getDb();

  const orphanTasks = db
    .prepare(
      `SELECT t.id AS task_id, t.user_id, t.result, ar.run_id
         FROM tasks t
         LEFT JOIN agent_runs ar ON ar.task_id = t.id
        WHERE t.user_id = ?
          AND t.status = 'complete'
          AND (t.workspace_project_id IS NULL OR t.workspace_project_id = 0)
        ORDER BY t.created_at ASC`
    )
    .all(userId);

  let migrated = 0;
  const failures = [];

  for (const row of orphanTasks) {
    try {
      let agentOutputs = {};

      // 优先从 agent_results 取，每个 agent 的 user_output
      if (row.run_id) {
        const results = db
          .prepare(
            `SELECT agent_name, user_output FROM agent_results
              WHERE run_id = ? AND status = 'done'`
          )
          .all(row.run_id);
        for (const r of results) {
          if (!r.user_output) continue;
          try {
            agentOutputs[r.agent_name] = JSON.parse(r.user_output);
          } catch (_) {
            // ignore
          }
        }
      }

      // 兜底：从 tasks.result 反推
      if (!agentOutputs.project_summary && row.result) {
        try {
          const parsed =
            typeof row.result === "string"
              ? JSON.parse(row.result)
              : row.result;
          agentOutputs.project_summary = {
            project_name:
              parsed.title ||
              parsed.company_name ||
              parsed.project_name ||
              "（未命名）",
            one_liner: parsed.one_liner || parsed.summary || null,
            industry: parsed.industry || null,
          };
          if (parsed.founder)
            agentOutputs.founder = { founders: [parsed.founder] };
        } catch (_) {
          continue;
        }
      }

      if (!agentOutputs.project_summary) continue;

      workspaceProjectService.createOrAttachProject({
        userId,
        taskId: row.task_id,
        agentRunId: row.run_id || null,
        agentOutputs,
      });
      migrated++;
    } catch (err) {
      logger.warn(
        `[Migration] task ${row.task_id} failed: ${err.message}`
      );
      failures.push({ taskId: row.task_id, error: err.message });
    }
  }

  return { migrated, total: orphanTasks.length, failures };
}

module.exports = { migrateLegacyForUser };
