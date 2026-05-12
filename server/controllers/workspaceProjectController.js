// ============================================================
// server/controllers/workspaceProjectController.js
// Sprint 2: 项目工作台 REST 接口
//
// 注意：所有 handler 均依赖 requireAuth，req.user.id 一定存在。
// 所有查询都通过 service 层带 user_id 过滤（PRIVACY）。
// ============================================================

const workspaceProjectService = require("../services/workspaceProjectService");
const bpDiffService = require("../services/bpVersionDiffService");

// GET /api/workspace/projects
async function list(req, res) {
  const { status, industry, includeArchived } = req.query;
  try {
    const projects = workspaceProjectService.listByUser(req.user.id, {
      status: status || undefined,
      industry: industry || undefined,
      includeArchived: includeArchived === "true",
    });
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/workspace/projects/:id
async function getOne(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "无效的项目 ID" });
  const project = workspaceProjectService.getById(id, req.user.id);
  if (!project) return res.status(404).json({ error: "项目不存在或无权访问" });
  res.json(project);
}

// PATCH /api/workspace/projects/:id
async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "无效的项目 ID" });
  try {
    const r = workspaceProjectService.updateBasic(id, req.user.id, req.body || {});
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// PATCH /api/workspace/projects/:id/status
async function updateStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "无效的项目 ID" });
  const { status } = req.body || {};
  try {
    const r = workspaceProjectService.updateStatus(id, req.user.id, status);
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET /api/workspace/projects/:id/versions/diff?versionA=1&versionB=2
async function diff(req, res) {
  const id = parseInt(req.params.id, 10);
  const vA = parseInt(req.query.versionA, 10);
  const vB = parseInt(req.query.versionB, 10);
  if ([id, vA, vB].some(Number.isNaN)) {
    return res.status(400).json({ error: "参数无效" });
  }
  try {
    const r = bpDiffService.compareVersions(id, req.user.id, vA, vB);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/workspace/projects/:id/notes
async function addNote(req, res) {
  const id = parseInt(req.params.id, 10);
  const { content } = req.body || {};
  try {
    workspaceProjectService.addNote(id, req.user.id, content);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/workspace/projects/migrate-legacy
async function migrateLegacy(req, res) {
  try {
    const migrationService = require("../services/projectMigrationService");
    const result = migrationService.migrateLegacyForUser(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/workspace-projects/merge-suggestions — 待确认的项目合并建议
async function listMergeSuggestions(req, res) {
  try {
    const items = workspaceProjectService.listPendingMergeSuggestions(req.user.id);
    res.json({ suggestions: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/workspace-projects/merge-suggestions/:id/accept
async function acceptMergeSuggestion(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "无效的建议 ID" });
  try {
    const r = workspaceProjectService.acceptMergeSuggestion(req.user.id, id);
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/workspace-projects/merge-suggestions/:id/dismiss
async function dismissMergeSuggestion(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "无效的建议 ID" });
  try {
    workspaceProjectService.dismissMergeSuggestion(req.user.id, id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  list,
  getOne,
  update,
  updateStatus,
  diff,
  addNote,
  migrateLegacy,
  listMergeSuggestions,
  acceptMergeSuggestion,
  dismissMergeSuggestion,
};
