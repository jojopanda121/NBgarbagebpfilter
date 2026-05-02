// server/routes/workspaceProjects.js — Sprint 2 项目工作台路由
// 挂载到 /api/workspace/projects（避免与 /api/projects/:taskId 冲突）

const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const ctrl = require("../controllers/workspaceProjectController");

const router = Router();

router.get("/", requireAuth, ctrl.list);
router.post("/migrate-legacy", requireAuth, ctrl.migrateLegacy);
router.get("/:id", requireAuth, ctrl.getOne);
router.patch("/:id", requireAuth, ctrl.update);
router.patch("/:id/status", requireAuth, ctrl.updateStatus);
router.get("/:id/versions/diff", requireAuth, ctrl.diff);
router.post("/:id/notes", requireAuth, ctrl.addNote);

module.exports = router;
