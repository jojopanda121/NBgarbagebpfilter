-- 邀请关系表
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_id INTEGER NOT NULL REFERENCES users(id),
  invitee_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'invite_link',
  rewarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_id);

-- users 表增加邀请码
ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);

-- tasks 表增加分享 token
ALTER TABLE tasks ADD COLUMN share_token TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN share_expires_at TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_share_token ON tasks(share_token);
