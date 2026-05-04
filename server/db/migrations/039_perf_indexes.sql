-- 039_perf_indexes.sql
-- M5: 为生产高频查询补充复合索引，避免全表扫描
-- 所有索引使用 IF NOT EXISTS，重复执行安全

-- 任务去重 / 历史结果查询：analyzeController.findExistingResult / findRunningTask
CREATE INDEX IF NOT EXISTS idx_tasks_user_hash_status
  ON tasks(user_id, file_hash, status);

-- 任务列表分页查询：getTasksByUser ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks(user_id, created_at DESC);

-- 任务分享查询：getSharedTask WHERE share_token = ?
CREATE INDEX IF NOT EXISTS idx_tasks_share_token
  ON tasks(share_token) WHERE share_token IS NOT NULL;

-- 验证码查找：verifyCode WHERE contact = ? AND expires_at > now
CREATE INDEX IF NOT EXISTS idx_vc_contact_exp
  ON verification_codes(contact, expires_at);

-- 撤销 token 黑名单：isRevoked WHERE jti = ? AND expires_at > now
CREATE INDEX IF NOT EXISTS idx_revoked_jti_exp
  ON revoked_tokens(jti, expires_at);

-- 邀请关系查找：rewardReferral WHERE invitee_id = ?
CREATE INDEX IF NOT EXISTS idx_referrals_invitee
  ON referrals(invitee_id);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter
  ON referrals(inviter_id);

-- 反馈管理列表：getFeedbackList WHERE status = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_feedback_status_created
  ON feedback(status, created_at DESC);

-- 兑换码查询：getTokenList ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_tokens_created
  ON tokens(created_at DESC);

-- 订单：管理后台统计 / 用户订单列表
CREATE INDEX IF NOT EXISTS idx_orders_status_paid
  ON orders(status, paid_at);

CREATE INDEX IF NOT EXISTS idx_orders_user_created
  ON orders(user_id, created_at DESC);
