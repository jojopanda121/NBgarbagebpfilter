// ============================================================
// server/skills/registry.js — Skill 注册表 + 执行器
//
// Skill 接口:
//   {
//     id: "kebab-case",
//     title: "中文展示名",
//     description: "一句话说明",
//     category: "report" | "share" | "research" | "memo",
//     inputSchema: JSON Schema,                  // 调用方传入参数的契约
//     outputArtifactKind?: "json"|"pptx"|"link", // 用于前端展示分支
//     permissions?: ["project:read", "project:write", "share:create"],
//     async run({ project, params, ctx, userId }) — 返回 SkillResult
//   }
//
// SkillResult:
//   {
//     ok: true,
//     artifact: { kind, mimeType?, filename?, summary?, payload?, downloadUrl? },
//     metadata?: object
//   }
//   或抛出 Error 由执行器捕获并落 skill_runs(status='failed')
//
// 资源约束(4 vCPU / 4GB):
//   - 执行串行 per request,Express 自然限并发
//   - 每个 skill 内部不允许 spawn 子进程 / 启动浏览器
//   - LLM 调用走 callLLMJson,带 schema 自动重试
// ============================================================

const { validate, formatErrors } = require("../utils/jsonSchema");
const logger = require("../utils/logger");
// getDb 懒加载 — 只在 execute() 时才需要,避免注册阶段触发 DB 初始化(测试/环境差异友好)

const _registry = new Map();

function register(skill) {
  if (!skill || typeof skill !== "object") throw new Error("Skill 必须是对象");
  for (const k of ["id", "title", "inputSchema", "run"]) {
    if (!skill[k]) throw new Error(`Skill 缺少必填字段: ${k}`);
  }
  if (_registry.has(skill.id)) {
    logger.warn(`[Skills] 覆盖已注册 skill: ${skill.id}`);
  }
  _registry.set(skill.id, {
    category: "report",
    permissions: ["project:read"],
    description: "",
    ...skill,
  });
  logger.info(`[Skills] 注册: ${skill.id} (${skill.title})`);
}

function get(id) { return _registry.get(id); }

function list() {
  return [..._registry.values()].map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    category: s.category,
    inputSchema: s.inputSchema,
    outputArtifactKind: s.outputArtifactKind || null,
    permissions: s.permissions,
    pptxTemplate: s.pptxTemplate || null,
  }));
}

/**
 * 列出所有 pptxTemplate 标记的 skill —— 供 host prompt 动态展示 catalog。
 *
 * pptxTemplate 元数据形状（约定，非强制）：
 *   {
 *     useCase: "一句话适用场景（让 LLM 路由用）",
 *     pageCount: 1 | "1-N" | "exactly N",
 *     argsHint:  "<TOOL_CALL>{...}</TOOL_CALL> 形如",  // 可选,registry 默认按 inputSchema 推
 *   }
 */
function listPptxTemplates() {
  return [..._registry.values()]
    .filter((s) => s.pptxTemplate && s.outputArtifactKind === "pptx")
    .map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      pageCount: s.pptxTemplate.pageCount || null,
      useCase: s.pptxTemplate.useCase || s.description || "",
      inputSchema: s.inputSchema,
      argsHint: s.pptxTemplate.argsHint || null,
    }));
}

/**
 * 执行 skill — 校验参数 → 落 skill_runs(running) → run() → 落终态
 * 对外:统一 try/catch,绝不抛裸错。
 *
 * @param {object} args
 * @param {string} args.skillId
 * @param {object} args.params         skill 参数
 * @param {object} args.project        workspace project 行(或 null,某些 skill 不依赖项目)
 * @param {number|string} args.userId
 * @param {object} [args.ctx]          额外上下文(如 conversationId / messageId)
 * @returns {Promise<{ ok:boolean, runId:string, artifact?:object, error?:string, metadata?:object }>}
 */
async function execute({ skillId, params = {}, project = null, userId, ctx = {} }) {
  const skill = _registry.get(skillId);
  if (!skill) return { ok: false, error: `未知 skill: ${skillId}`, runId: null };

  // 参数 schema 校验
  const v = validate(params, skill.inputSchema);
  if (!v.valid) {
    return {
      ok: false,
      runId: null,
      error: `参数校验失败:\n${formatErrors(v.errors)}`,
    };
  }

  const { getDb } = require("../db");
  const db = getDb();
  const runId = require("crypto").randomUUID();
  const startedAt = Date.now();
  try {
    db.prepare(
      `UPDATE skill_runs
       SET status='failed',
           error='stale running run auto-closed before new execution',
           finished_at=datetime('now')
       WHERE status='running' AND created_at < datetime('now', '-30 minutes')`
    ).run();
  } catch (_) { /* older schemas/tests may not have skill_runs */ }
  db.prepare(
    `INSERT INTO skill_runs (id, skill_id, user_id, project_id, params_json, status)
     VALUES (?, ?, ?, ?, ?, 'running')`
  ).run(runId, skillId, userId || null, project?.id || null, JSON.stringify(params));

  try {
    const result = await skill.run({ project, params, ctx, userId });
    if (!result || result.ok === false) {
      const errMsg = result?.error || "skill 返回失败,无错误信息";
      db.prepare(
        `UPDATE skill_runs SET status='failed', error=?, duration_ms=?, finished_at=datetime('now') WHERE id=?`
      ).run(errMsg, Date.now() - startedAt, runId);
      return { ok: false, runId, error: errMsg };
    }
    // P3-4 metricsAggregator 友好: metadata 单独落 metadata_json 列, 避免后续聚合
    // 时逐行 JSON.parse(artifact_json). 旧 schema 没有 metadata_json 列时 silently 降级。
    let metricsMetadata = null;
    if (result.metadata && typeof result.metadata === "object") {
      // 只挑跟可观测指标相关的子集, 避免存大块原始 payload
      metricsMetadata = {
        fallback: result.metadata.fallback || null,
        semantic_audit: result.metadata.semantic_audit || null,
        upload_structured_used: !!(result.metadata.upload_structured_used || result.metadata.bp_deep_parsing_used),
        upload_structured_fact_count: result.metadata.upload_structured_fact_count ?? result.metadata.bp_deep_fact_count ?? 0,
        institutional_memory_used: !!result.metadata.institutional_memory_used,
        institutional_memory_count: result.metadata.institutional_memory_count || 0,
        sector_compliance_hits: result.metadata.sector_compliance_hits || [],
        evidence_search_used: !!result.metadata.evidence_search_used,
        upload_facts_used: result.metadata.upload_facts_used || 0,
        llm_repairs: result.metadata.llm_repairs ?? null,
        grounding_ok: result.metadata.grounding?.ok ?? null,
        grounding_referenced_count: result.metadata.grounding?.referenced_count ?? null,
        valuation_exit_error: result.metadata.valuation_exit_error || null,
        closed_question_fixes: result.metadata.closed_question_fixes ?? null,
        pipeline_steps: result.metadata.pipeline_steps ?? null,
      };
    }
    try {
      db.prepare(
        `UPDATE skill_runs SET status='succeeded', artifact_json=?, metadata_json=?, duration_ms=?, finished_at=datetime('now') WHERE id=?`
      ).run(
        JSON.stringify(result.artifact || null),
        metricsMetadata ? JSON.stringify(metricsMetadata) : null,
        Date.now() - startedAt,
        runId
      );
    } catch (e) {
      // 旧 schema 没 metadata_json 列时回退到老 UPDATE
      db.prepare(
        `UPDATE skill_runs SET status='succeeded', artifact_json=?, duration_ms=?, finished_at=datetime('now') WHERE id=?`
      ).run(
        JSON.stringify(result.artifact || null),
        Date.now() - startedAt,
        runId
      );
    }
    return { ok: true, runId, artifact: result.artifact, metadata: result.metadata };
  } catch (err) {
    logger.warn(`[Skills/${skillId}] 失败: ${err.message}`);
    db.prepare(
      `UPDATE skill_runs SET status='failed', error=?, duration_ms=?, finished_at=datetime('now') WHERE id=?`
    ).run(err.message?.slice(0, 1000) || "未知错误", Date.now() - startedAt, runId);
    return { ok: false, runId, error: err.message || "skill 执行失败" };
  }
}

module.exports = { register, get, list, listPptxTemplates, execute };
