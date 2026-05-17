// ============================================================
// server/skills/_artifactExport.js
// 让标准化 skill 复用 workspace 的确定性文档导出路径。
// ============================================================

async function exportDocx({ title, sections, ctx, userId, artifactTitle }) {
  if (!ctx?.conversationId) return null;
  const ws = require("../services/workspaceService");
  return ws.executeDocumentTool({
    tool: "generate_docx",
    args: { title, sections, artifactTitle: artifactTitle || title },
    conversationId: ctx.conversationId,
    messageId: ctx.messageId || null,
    userId: userId || ctx.userId,
  });
}

async function exportXlsx({ title, sheets, ctx, userId, artifactTitle }) {
  if (!ctx?.conversationId) return null;
  const ws = require("../services/workspaceService");
  return ws.executeDocumentTool({
    tool: "generate_xlsx",
    args: { title, sheets, artifactTitle: artifactTitle || title },
    conversationId: ctx.conversationId,
    messageId: ctx.messageId || null,
    userId: userId || ctx.userId,
  });
}

module.exports = { exportDocx, exportXlsx };
