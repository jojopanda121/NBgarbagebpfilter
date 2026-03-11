const { Router } = require("express");
const { requireAuth } = require("../middleware/auth");
const { getDb } = require("../db");
const { requireAdmin } = require("../controllers/adminController");

const router = Router();

// 公开接口：获取当前生效公告
router.get("/active", (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, content, type, created_at FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5"
    ).all();
    res.json({ announcements: rows });
  } catch {
    res.json({ announcements: [] });
  }
});

// 管理员接口
router.use(requireAuth);

// 获取所有公告（管理员）
router.get("/list", requireAdmin, (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50"
    ).all();
    res.json({ announcements: rows });
  } catch {
    res.json({ announcements: [] });
  }
});

// 创建公告
router.post("/", requireAdmin, (req, res) => {
  const { content, type = "info" } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "公告内容不能为空" });
  }
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO announcements (content, type, created_by) VALUES (?, ?, ?)"
  ).run(content.trim(), type, req.user.id);
  res.json({ id: result.lastInsertRowid, message: "公告发布成功" });
});

// 更新公告
router.put("/:id", requireAdmin, (req, res) => {
  const { content, type, is_active } = req.body;
  const db = getDb();
  const updates = [];
  const values = [];
  if (content !== undefined) { updates.push("content = ?"); values.push(content.trim()); }
  if (type !== undefined) { updates.push("type = ?"); values.push(type); }
  if (is_active !== undefined) { updates.push("is_active = ?"); values.push(is_active ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: "无更新内容" });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE announcements SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  res.json({ message: "更新成功" });
});

// 删除公告
router.delete("/:id", requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM announcements WHERE id = ?").run(req.params.id);
  res.json({ message: "删除成功" });
});

module.exports = router;
