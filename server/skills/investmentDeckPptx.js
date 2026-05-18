// ============================================================
// skills/investmentDeckPptx.js — 可变页数投决材料 deck
// ============================================================

const path = require("path");
const fs = require("fs");

function _loadDeps() {
  return {
    tmpl: require("../services/investment_deck"),
    ws: require("../services/workspaceService"),
    augmentMaterialsWithEvidence: require("./_evidenceMaterial").augmentMaterialsWithEvidence,
  };
}

function clampPageCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(8, Math.min(30, Math.round(num)));
}

module.exports = {
  id: "investment_deck_pptx",
  title: "可变页数投决材料 PPT",
  description:
    "生成 8-30 页可变页数投决报告/可研报告/尽调汇报 PPT。" +
    "Agent 只产 deck plan 与内容 JSON, 视觉由固定模板渲染器锁定。",
  category: "report",
  outputArtifactKind: "pptx",
  pptxTemplate: {
    useCase:
      "8-30 页中长投决材料/可研报告/尽调汇报。适合用户要求 10页、15页、20页、30页、完整投委会材料等场景。",
    pageCount: "8-30",
    argsHint:
      '<TOOL_CALL>{"id":"investment_deck_pptx","args":{"target_pages":16,"deck_type":"investment_committee","materials":"<公司原始材料或项目上下文>","company_hint":"<公司全称>"}}</TOOL_CALL>',
  },
  inputSchema: {
    type: "object",
    properties: {
      materials: {
        type: "string",
        description: "目标公司原始材料。留空则用 workspace 项目上下文。",
      },
      company_hint: {
        type: "string",
        description: "可选, 公司名提示。",
      },
      target_pages: {
        type: "integer",
        minimum: 8,
        maximum: 30,
        description: "目标页数。当前模板支持 8-30 页。",
      },
      deck_type: {
        type: "string",
        enum: ["investment_committee", "feasibility_study", "diligence_report"],
        description: "材料类型: 投决报告 / 可研报告 / 尽调汇报。",
      },
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选。开启后并行跑 3 个 BP 深度解析 agent，结构化数字 (D-prefixed) 喂给 Cap Table + Downside Case 页。默认走 env ENABLE_BP_DEEP_PARSING。",
      },
      enable_institutional_memory: {
        type: "boolean",
        description: "可选。开启后注入机构历史先例 (K 编号)。默认走 env ENABLE_INSTITUTIONAL_MEMORY。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    const { tmpl, ws, augmentMaterialsWithEvidence } = _loadDeps();

    const targetPages = clampPageCount(params.target_pages);
    const deckType = params.deck_type || "investment_committee";
    const parts = [];
    parts.push(`【用户指定材料类型】${deckType}`);
    if (targetPages) parts.push(`【用户指定页数】${targetPages} 页`);
    if (params.company_hint) parts.push(`【目标公司】${params.company_hint}`);
    if (params.materials && params.materials.trim()) {
      parts.push("【用户提供材料】", params.materials.trim());
    }
    if (project?.latest_task_id) {
      try {
        const projCtx = ws.buildProjectContext(project.latest_task_id, ctx?.conversationId);
        if (projCtx && !projCtx.includes("项目数据不存在")) {
          parts.push("【workspace 项目快照】", projCtx);
        }
      } catch { /* 没有项目上下文不阻塞 */ }
    }

    let materials = parts.join("\n\n").trim();
    if (materials.length < 20) {
      return {
        ok: false,
        error: "公司材料不足。请先上传 BP/财务/尽调材料，或在 materials 参数提供原始资料。",
      };
    }
    let evidenceMeta = {};
    let bpDeepInfo = { used: false, count: 0 };
    try {
      const augmented = await augmentMaterialsWithEvidence({
        project,
        ctx,
        skillId: "investment_deck_pptx",
        materials,
        companyHint: params.company_hint || "",
        enableBpDeepParsing: params.enable_bp_deep_parsing,
        enableInstitutionalMemory: params.enable_institutional_memory,
      });
      materials = augmented.materials;
      evidenceMeta = { ...(augmented.evidence || {}), searchQueries: augmented.searchQueries || [] };
      bpDeepInfo.used = !!augmented.evidence?.bpDeepUsed;
      bpDeepInfo.count = augmented.evidence?.bpDeepCount || 0;
    } catch (err) {
      console.warn("[investment_deck_pptx] Evidence Pack 注入失败，继续使用原材料:", err.message);
    }

    let result;
    try {
      result = await tmpl.generate(materials, {
        useSearch: !evidenceMeta.searchUsed,
        searchQueries: evidenceMeta.searchQueries || [],
      });
    } catch (err) {
      if (err.name === "TemplateSchemaError") {
        return { ok: false, error: `内容 JSON 不合 schema: ${err.message}` };
      }
      if (err.name === "TemplateRenderError") {
        return { ok: false, error: `渲染失败: ${err.message}` };
      }
      if (err.name === "LLMJsonValidationError") {
        return { ok: false, error: "LLM 输出无法通过 schema 校验" };
      }
      return { ok: false, error: `投决材料生成失败: ${err.message}` };
    }

    const { json, buffer, searchUsed } = result;
    const filename = tmpl.filename(json);

    let artifactRow = null;
    if (ctx?.conversationId) {
      const dir = path.join(ws.ARTIFACTS_ROOT, ctx.conversationId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, `${Date.now()}-${filename}`);
      require("../services/workspaceUploadLimits").enforceWorkspaceOutputLimits({
        userId: ctx.userId,
        sizeBytes: buffer.length,
        artifactRoot: ws.ARTIFACTS_ROOT,
      });
      fs.writeFileSync(fullPath, buffer);
      artifactRow = ws.insertArtifact({
        conversationId: ctx.conversationId,
        messageId: ctx.messageId || null,
        kind: "generated_pptx",
        filename: artifactRow?.filename || filename,
        storagePath: fullPath,
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: buffer.length,
        summary: `${json.deck_title || "投决材料"} — ${json.company_full_name}`,
        userId: ctx.userId,
        artifactTitle: "投决材料",
      });
    }

    return {
      ok: true,
      artifact: {
        kind: "generated_pptx",
        filename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: buffer.length,
        summary: `${json.deck_title || "投决材料"} — ${json.company_full_name}`,
        bufferBase64: buffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        payload: json,
        searchUsed: searchUsed || !!evidenceMeta.searchUsed,
        evidence: {
          searchUsed: !!evidenceMeta.searchUsed,
          uploadCount: evidenceMeta.uploadCount || 0,
        },
      },
      // P3 fix-E：可观测指标统一放 result.metadata
      metadata: {
        evidence_search_used: !!(searchUsed || evidenceMeta.searchUsed),
        upload_facts_used: evidenceMeta.uploadCount || 0,
        bp_deep_parsing_used: !!bpDeepInfo.used,
        bp_deep_fact_count: bpDeepInfo.count || 0,
        bp_deep_reason: evidenceMeta.bpDeepReason || null,
        institutional_memory_used: !!evidenceMeta.institutionalMemoryUsed,
        institutional_memory_count: evidenceMeta.institutionalMemoryCount || 0,
      },
    };
  },
};
