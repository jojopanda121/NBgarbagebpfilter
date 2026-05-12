// server/routes/workspaceProjects.js — Sprint 2 项目工作台路由
// 挂载到 /api/workspace/projects（避免与 /api/projects/:taskId 冲突）

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const ctrl = require("../controllers/workspaceProjectController");

const router = Router();

router.get("/", requireAuth, ctrl.list);
router.post("/migrate-legacy", requireAuth, ctrl.migrateLegacy);

// 合并建议(注意 path 顺序:必须放在 /:id 之前)
router.get("/merge-suggestions", requireAuth, ctrl.listMergeSuggestions);
router.post("/merge-suggestions/:id/accept", requireAuth, ctrl.acceptMergeSuggestion);
router.post("/merge-suggestions/:id/dismiss", requireAuth, ctrl.dismissMergeSuggestion);

router.get("/:id", requireAuth, ctrl.getOne);
router.patch("/:id", requireAuth, ctrl.update);
router.patch("/:id/status", requireAuth, ctrl.updateStatus);
router.get("/:id/versions/diff", requireAuth, ctrl.diff);
router.post("/:id/notes", requireAuth, ctrl.addNote);

// 项目级聊天(SSE 流)— 用 router.use 子挂载,把对应文件的所有路由暴露在 /:projectId/conversation/*
router.use("/", require("./workspaceProjectChat"));

module.exports = router;
