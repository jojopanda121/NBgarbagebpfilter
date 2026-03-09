-- 站点内容管理（管理员可编辑的公告/购买说明/图片）
CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,           -- 唯一标识，如 'purchase_info'
  title TEXT DEFAULT '',               -- 标题
  body TEXT DEFAULT '',                -- 正文（支持纯文本或简单 HTML）
  images TEXT DEFAULT '[]',            -- JSON 数组，存储图片路径
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 预填充购买说明内容
INSERT OR IGNORE INTO site_content (slug, title, body, images) VALUES
  ('purchase_info', '扫码添加管理员微信购买兑换码', '微信号：pe_ren\n付款后管理员会发送兑换码给您，在上方输入即可充值', '[]');
