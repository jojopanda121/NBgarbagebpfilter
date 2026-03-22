// server/routes/projects.js — 项目管理路由
const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  getProject,
  updateStage,
  updateLocation,
  updateNotes,
  updateTags,
  updateFollowup,
  startDD,
  saveDDAnswersHandler,
  rescoreHandler,
  getIMemo,
  regenerateIMemoHandler,
} = require("../controllers/projectController");

const router = Router();

// 项目基础信息
router.get("/:taskId",               requireAuth, getProject);
router.put("/:taskId/stage",         requireAuth, updateStage);
router.put("/:taskId/location",      requireAuth, updateLocation);
router.put("/:taskId/notes",         requireAuth, updateNotes);
router.put("/:taskId/tags",          requireAuth, updateTags);
router.put("/:taskId/followup",      requireAuth, updateFollowup);

// 尽调流程
router.post("/:taskId/dd/start",     requireAuth, startDD);
router.put("/:taskId/dd/answers",    requireAuth, saveDDAnswersHandler);
router.post("/:taskId/dd/rescore",   requireAuth, rescoreHandler);

// IMemo
router.get("/:taskId/imemo",                 requireAuth, getIMemo);
router.post("/:taskId/imemo/regenerate",     requireAuth, regenerateIMemoHandler);

module.exports = router;
