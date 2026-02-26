-- ============================================================
-- 001_init.sql — 初始数据库 Schema
-- 用户、额度、订单、任务表
-- ============================================================

-- 用户表：渐进式注册，初始仅需 username + password
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,           -- bcrypt 加盐哈希，严禁明文
  email         TEXT    DEFAULT NULL,       -- 渐进式绑定：第4次使用时强制绑定
  phone         TEXT    DEFAULT NULL,       -- 渐进式绑定
  contact_bound INTEGER DEFAULT 0,          -- 0=未绑定 1=已绑定（邮箱或手机）
  usage_count   INTEGER DEFAULT 0,          -- 累计使用次数（触发绑定拦截）
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now'))
);

-- 额度表：免费额度与付费额度分离，扣减时优先扣免费额度
CREATE TABLE IF NOT EXISTS quotas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id),
  free_quota  INTEGER NOT NULL DEFAULT 3,   -- 免费额度（默认3次）
  paid_quota  INTEGER NOT NULL DEFAULT 0,   -- 付费额度
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

-- 订单表：支付网关集成，保证幂等性
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no        TEXT    NOT NULL UNIQUE,      -- 订单号（唯一索引，保证幂等）
  user_id         INTEGER NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL,              -- 金额（分），避免浮点精度问题
  quota_amount    INTEGER NOT NULL DEFAULT 0,    -- 购买的额度数量
  payment_channel TEXT    NOT NULL DEFAULT '',    -- wechat / alipay
  status          TEXT    NOT NULL DEFAULT 'PENDING', -- PENDING / PAID / FAILED / REFUNDED
  paid_at         TEXT    DEFAULT NULL,
  callback_raw    TEXT    DEFAULT NULL,           -- 支付回调原始数据（审计用）
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);

-- 分析任务表：持久化任务状态（替代内存 Map）
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT    PRIMARY KEY,             -- UUID hex
  user_id     INTEGER REFERENCES users(id),    -- 可选关联用户
  status      TEXT    NOT NULL DEFAULT 'running', -- running / complete / error
  percentage  INTEGER NOT NULL DEFAULT 0,
  stage       TEXT    NOT NULL DEFAULT 'queued',
  message     TEXT    NOT NULL DEFAULT '任务已提交，等待处理...',
  result      TEXT    DEFAULT NULL,             -- JSON 序列化的结果
  error       TEXT    DEFAULT NULL,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_quotas_user_id ON quotas(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
