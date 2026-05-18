// ============================================================
// skills/investmentSnapshot.js — 一页纸投决速览（A4 横版 / 砖红主题）
//
// 与 onepager_pptx 的区别：
//   - onepager_pptx 强依赖 project.latest_task_id（已完成的 BP 多 agent 分析结果）
//   - investment_snapshot 接受 user-provided 公司材料 + 项目上下文 → sub-agent 直接产 JSON
//     适用于"workspace 里说一句生成一页纸"的零门槛场景
//
// 设计约束（来自 harness README）：
//   - 版式归代码：所有坐标/字号锁在 doc-service/investment_snapshot_render.py
//   - 内容归 agent：sub-agent 走 server/services/investment_snapshot/AGENT_SYSTEM_PROMPT.md
//   - JSON 是合约：每次 LLM 输出先用 content_schema.json 校验
// ============================================================

const path = require("path");
const fs = require("fs");

function _loadDeps() {
  return {
    snap: require("../services/investment_snapshot"),
    ws: require("../services/workspaceService"),
    augmentMaterialsWithEvidence: require("./_evidenceMaterial").augmentMaterialsWithEvidence,
  };
}

module.exports = {
  id: "investment_snapshot",
  title: "一页纸投决速览（A4 横版）",
  description:
    "根据公司材料生成一页纸投资速览 PPT（A4 横版/砖红主题/确定性渲染）。" +
    "版式锁在代码中；agent 仅产内容。适用于 workspace 中临时 brief 任意公司。",
  category: "report",
  outputArtifactKind: "pptx",
  pptxTemplate: {
    useCase:
      "1 页砖红 A4 横版投资速览(投决/速览/一页纸/one-pager/pitch). " +
      "适合: 把任意一家公司的材料浓缩成对外/对内的 1 页投资亮点速览.",
    pageCount: "exactly 1",
    argsHint:
      '<TOOL_CALL>{"id":"investment_snapshot","args":{"materials":"<公司原始材料原文>","company_hint":"<公司全称>"}}</TOOL_CALL>',
  },
  inputSchema: {
    type: "object",
    properties: {
      materials: {
        type: "string",
        description:
          "目标公司原始材料（招股书/年报/立项书/调研笔记等任意纯文本）。" +
          "若留空，将仅用 workspace 项目上下文（项目快照 + 已上传材料摘要）作为输入。",
      },
      company_hint: {
        type: "string",
        description: "可选，公司名提示（防止 LLM 误判主体）",
      },
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选. 开启后并行跑 3 个 BP 深度解析 agent. 默认走 env ENABLE_BP_DEEP_PARSING.",
      },
      enable_institutional_memory: {
        type: "boolean",
        description: "可选. 开启后注入机构历史先例 (K 编号). 默认走 env ENABLE_INSTITUTIONAL_MEMORY.",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    const { snap, ws, augmentMaterialsWithEvidence } = _loadDeps();

    // 组装材料：用户显式输入 + 项目上下文（如有）。两者都没有时报错。
    const parts = [];
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
      } catch (err) {
        // 项目上下文取不到不阻塞 —— 只要 params.materials 有内容仍可继续
      }
    }
    let materials = parts.join("\n\n").trim();
    if (materials.length < 20) {
      return {
        ok: false,
        error:
          "公司材料不足。请在 materials 参数提供原始资料文本，或先在 workspace 关联一个已分析的项目。",
      };
    }
    let evidenceMeta = {};
    try {
      const augmented = await augmentMaterialsWithEvidence({
        project,
        ctx,
        skillId: "investment_snapshot",
        materials,
        companyHint: params.company_hint || "",
        enableBpDeepParsing: params.enable_bp_deep_parsing,
        enableInstitutionalMemory: params.enable_institutional_memory,
      });
      materials = augmented.materials;
      evidenceMeta = { ...(augmented.evidence || {}), searchQueries: augmented.searchQueries || [] };
    } catch (err) {
      console.warn("[investment_snapshot] Evidence Pack 注入失败，继续使用原材料:", err.message);
    }

    // 生成 JSON（schema 校验 + 最多 2 次 repair 内嵌在 callLLMJson 里）→ 渲染 pptx
    let result;
    try {
      result = await snap.generateSnapshotPptx(materials, {
        useSearch: !evidenceMeta.searchUsed,
        searchQueries: evidenceMeta.searchQueries || [],
      });
    } catch (err) {
      if (err.name === "SnapshotSchemaError") {
        return { ok: false, error: `内容 JSON 不合 schema：${err.message}` };
      }
      if (err.name === "SnapshotRenderError") {
        return { ok: false, error: `渲染失败：${err.message}` };
      }
      if (err.name === "LLMJsonValidationError") {
        return {
          ok: false,
          error: `LLM 输出无法通过 schema 校验（已重试 ${err.validationErrors?.length || 0} 次）`,
        };
      }
      return { ok: false, error: `一页纸生成失败：${err.message}` };
    }

    const { json, buffer, searchUsed } = result;
    const filename = snap.buildFilename(json.company_full_name);

    // 落盘 + 写 workspace_artifacts（与 onepager_pptx 同样的模式）
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
        summary: `一页纸投决速览 — ${json.company_full_name}`,
        userId: ctx.userId,
        artifactTitle: "投决速览",
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
        summary: `投决速览 — ${json.company_full_name}`,
        bufferBase64: buffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        payload: json,
        searchUsed: searchUsed || !!evidenceMeta.searchUsed,
        evidence: {
          searchUsed: !!evidenceMeta.searchUsed,
          uploadCount: evidenceMeta.uploadCount || 0,
        },
      },
      // P3 fix-E：可观测指标统一放 result.metadata，registry 会落入 skill_runs.metadata_json
      metadata: {
        evidence_search_used: !!(searchUsed || evidenceMeta.searchUsed),
        upload_facts_used: evidenceMeta.uploadCount || 0,
        bp_deep_parsing_used: !!evidenceMeta.bpDeepUsed,
        bp_deep_fact_count: evidenceMeta.bpDeepCount || 0,
        bp_deep_reason: evidenceMeta.bpDeepReason || null,
        institutional_memory_used: !!evidenceMeta.institutionalMemoryUsed,
        institutional_memory_count: evidenceMeta.institutionalMemoryCount || 0,
      },
    };
  },
};
