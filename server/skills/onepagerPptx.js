// ============================================================
// skills/onepagerPptx.js — 一页投资亮点 PPT (双模式)
//
// 两种数据源:
//   1) source_mode = "bp_analysis" (默认): 走 project.latest_task_id 已落库的
//      BP 多 agent 分析结果. 这是强耦合路径, 保证跨公司输出基于同一套结构化字段.
//   2) source_mode = "materials":           直接用用户传入的 materials 文本生成.
//      用于"workspace 里临时贴一段 BP 想出张单页"的场景, 不写 task 缓存.
//
// 默认 bp_analysis 保留向后兼容. LLM 显式传 materials 字段时自动切到 materials 模式
// (即便没显式声明 source_mode), 避免 LLM 忘记带模式字段又传材料导致两边都用不上.
// ============================================================

const path = require("path");
const fs = require("fs");

// 服务模块懒加载, 避免注册阶段触发 DB / config 链.
function _loadDeps() {
  return {
    pptService: require("../services/pptService"),
    ws: require("../services/workspaceService"),
    precheck: require("../agents/quality/materialPrecheck").precheck,
  };
}

module.exports = {
  id: "onepager_pptx",
  title: "一页投资亮点 PPT",
  description:
    "生成 1 页可发给 LP/投委会的投资要点速览 (.pptx). " +
    "默认基于已完成的 BP 多 agent 分析结果 (强耦合 latest_task_id); " +
    "也可显式传 materials + source_mode='materials' 走临时文本模式.",
  category: "report",
  outputArtifactKind: "pptx",
  pptxTemplate: {
    useCase:
      "1 页 16:9 投资亮点 PPT (pitch deck 风格, KPI 卡 + 4 亮点 + 2 风险 + 页脚). " +
      "适合: 项目已跑完 BP 多 agent 分析后做对 LP/投委会的正面 pitch 速览; " +
      "或临时贴一段 BP 想要 1 页对外可发的亮点单页 (source_mode='materials').",
    pageCount: "exactly 1",
    argsHint:
      '默认 (source_mode=bp_analysis, 基于已落库 BP 分析): ' +
      '<TOOL_CALL>{"id":"onepager_pptx","args":{}}</TOOL_CALL>\n' +
      '基于即时材料 (source_mode=materials): ' +
      '<TOOL_CALL>{"id":"onepager_pptx","args":{"source_mode":"materials","materials":"<公司原始材料>","company_hint":"<公司全称>"}}</TOOL_CALL>',
  },
  inputSchema: {
    type: "object",
    properties: {
      source_mode: {
        type: "string",
        enum: ["bp_analysis", "materials"],
        description:
          "数据源模式. " +
          "'bp_analysis' (默认): 用 project.latest_task_id 已落库的 BP 分析. " +
          "'materials': 用 args.materials 文本直接生成, 不依赖 task. " +
          "若显式传 materials 但忘了带 source_mode, 自动切到 materials 模式.",
      },
      materials: {
        type: "string",
        description: "source_mode='materials' 时必填, 公司原始材料文本 (>=200 字, 见 materialPrecheck).",
      },
      company_hint: {
        type: "string",
        description: "可选, 公司名提示, 防 LLM 误判主体. 仅 materials 模式生效.",
      },
      user_overrides: {
        type: "object",
        description: "可选, 人工微调字段 (如最新轮次/估值/重点客户), 会覆盖抽取值. 两种模式都生效.",
        additionalProperties: true,
      },
      industry_hint: {
        type: "string",
        description:
          "可选, 行业提示 (仅 materials 模式生效). 用于选 KPI 模板 (医疗/硬科技/SaaS/...). " +
          "若不传, 自动从 project.industry 兜底; 仍无则走默认模板.",
      },
      stage_hint: {
        type: "string",
        description:
          "可选, 轮次提示 (仅 materials 模式生效, 如 'A 轮' / 'Pre-B'). " +
          "若不传, 自动从 project.stage 或 user_overrides.funding_round 兜底.",
      },
      regenerate: {
        type: "boolean",
        description: "true 时清缓存重新生成. 仅 bp_analysis 模式生效 (materials 模式本就不写缓存).",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    const { pptService, ws, precheck } = _loadDeps();

    // 模式判定: 显式 source_mode 优先; 否则若传了 materials, 隐式走 materials 模式;
    // 否则走默认 bp_analysis. 这种自动兜底让 LLM 忘带 source_mode 也能跑.
    const hasMaterials = typeof params.materials === "string" && params.materials.trim().length > 0;
    const mode =
      params.source_mode ||
      (hasMaterials ? "materials" : "bp_analysis");

    let cache;
    let companyName;

    if (mode === "materials") {
      if (!hasMaterials) {
        return {
          ok: false,
          error: "source_mode='materials' 需要 params.materials 字段且 >= 20 字. 不要传空 materials.",
        };
      }
      // 材料预检 (与 pptxTemplate.generate 同款规则)
      const pre = precheck(params.materials, {
        templateName: "onepager_pptx",
        minChars: 200,
        minNumbers: 3,
      });
      if (!pre.ok) {
        return {
          ok: false,
          error: `[materialPrecheck] ${pre.errors.join(" | ")}`,
        };
      }
      // hint 来源优先级: LLM 显式参数 > project.industry/stage 兜底 > 空
      const industryHint = params.industry_hint || project?.industry || "";
      const stageHint = params.stage_hint || project?.stage || "";
      // 调 LLM 抽取 + normalize, 不写 task 缓存
      try {
        cache = await pptService.generateOnePagerFromMaterials(params.materials, {
          companyHint: params.company_hint || "",
          industryHint,
          stageHint,
          userOverrides: params.user_overrides || null,
        });
      } catch (err) {
        return { ok: false, error: `materials 模式生成失败: ${err.message}` };
      }
      companyName = cache.json.company_name;
    } else {
      // bp_analysis 默认模式
      const taskId = project?.latest_task_id;
      if (!taskId) {
        return {
          ok: false,
          error:
            "默认 (bp_analysis) 模式需要项目关联的 BP 分析任务. " +
            "请先上传材料完成 BP 分析, 或显式传 source_mode='materials' + materials 走临时材料模式.",
        };
      }
      try {
        cache = params.regenerate
          ? await pptService.regenerateOnePager(taskId, params.user_overrides || null)
          : await pptService.getOrGenerateOnePager(taskId, params.user_overrides || null, false);
      } catch (err) {
        return { ok: false, error: `bp_analysis 模式生成失败: ${err.message}` };
      }
      companyName = cache.json.company_name;
    }

    const pptxBuffer = await pptService.renderOnePagerPptx(cache.json);
    const filename = pptService.buildPptxFilename(companyName);

    // 落盘到 workspace_artifacts (若有 conversationId 上下文)
    let artifactRow = null;
    if (ctx?.conversationId) {
      const dir = path.join(ws.ARTIFACTS_ROOT, ctx.conversationId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, `${Date.now()}-${filename}`);
      require("../services/workspaceUploadLimits").enforceWorkspaceOutputLimits({
        userId: ctx.userId,
        sizeBytes: pptxBuffer.length,
        artifactRoot: ws.ARTIFACTS_ROOT,
      });
      fs.writeFileSync(fullPath, pptxBuffer);
      artifactRow = ws.insertArtifact({
        conversationId: ctx.conversationId,
        messageId: ctx.messageId || null,
        kind: "generated_pptx",
        filename,
        storagePath: fullPath,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: pptxBuffer.length,
        summary: `一页投资亮点 PPT — ${companyName} (${mode})`,
        userId: ctx.userId,
      });
    }

    return {
      ok: true,
      artifact: {
        kind: "pptx",
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: pptxBuffer.length,
        summary: `一页 PPT — ${companyName}`,
        bufferBase64: pptxBuffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        payload: cache.json,
        sourceMode: mode,
        searchUsed: cache.search_used,
        generatedAt: cache.generated_at,
      },
    };
  },
};
