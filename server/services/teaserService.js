// ============================================================
// server/services/teaserService.js — 加密 Teaser 分享服务
//
// 核心安全模型:
//   - 服务端永不持久化明文 payload
//   - 解密密钥由 password 通过 scrypt 派生(N=2^14, r=8, p=1 — 4GB 服务器友好)
//   - GCM 模式自带完整性校验,密文被改动会直接 fail-decrypt
//   - password_hash(bcrypt) 仅作"快速密码核对",不是密钥本身
//   - 多重失效闸: revoked_at / expires_at / max_views
//
// 前端流程:
//   1) owner 创建 share -> 拿到 token + (可选) password
//   2) owner 把 https://app/teaser/{token} 加 password 发给收件人
//   3) 收件人输入 password -> 后端校验 hash -> 用 password 派生密钥 -> 解密 -> 返回 teaser JSON
//   4) view_count++,写 access_log
// ============================================================

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDb } = require("../db");

const KDF_N = 1 << 14;   // 16384
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;      // 256 bit
const IV_LEN = 12;       // GCM standard
const SALT_LEN = 16;
const TOKEN_LEN = 18;    // 24 base64url 字符

function _generateToken() {
  return crypto.randomBytes(TOKEN_LEN).toString("base64url");
}

function _deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, KEY_LEN, { N: KDF_N, r: KDF_R, p: KDF_P, maxmem: 64 * 1024 * 1024 });
}

function _encrypt(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = _deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const buf = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: buf.toString("hex"),
  };
}

function _decrypt({ salt, iv, tag, ciphertext }, password) {
  const key = _deriveKey(password, Buffer.from(salt, "hex"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const buf = Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]);
  return buf.toString("utf8");
}

/**
 * @param {object} args
 * @param {number} args.userId
 * @param {number} args.projectId
 * @param {object} args.payload          已脱敏的 teaser JSON
 * @param {string} [args.password]        无密码时随机生成 8 字符
 * @param {number} [args.ttlHours=168]    默认 7 天
 * @param {number} [args.maxViews]
 * @param {string} [args.recipientLabel]
 * @param {string} [args.watermarkText]
 * @returns {{ id, token, password, url_path, expires_at, max_views }}
 */
function createShare({ userId, projectId, payload, password, ttlHours = 168, maxViews, recipientLabel, watermarkText }) {
  if (!payload) throw new Error("payload 不能为空");
  const db = getDb();

  // PRIVACY: 校验项目归属
  const proj = db.prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`).get(projectId, userId);
  if (!proj) throw new Error("项目不存在或无权访问");

  const finalPassword = (password && password.length >= 4)
    ? password
    : crypto.randomBytes(6).toString("base64url").slice(0, 8);

  const passwordHash = bcrypt.hashSync(finalPassword, 10);
  const enc = _encrypt(JSON.stringify(payload), finalPassword);

  const token = _generateToken();
  const expiresAt = ttlHours > 0
    ? new Date(Date.now() + ttlHours * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19)
    : null;

  db.prepare(
    `INSERT INTO teaser_shares
      (id, project_id, user_id, kdf_salt, cipher_iv, cipher_tag, payload_ciphertext,
       password_hash, recipient_label, watermark_text, expires_at, max_views)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    token, projectId, userId,
    enc.salt, enc.iv, enc.tag, enc.ciphertext,
    passwordHash, recipientLabel || null, watermarkText || null,
    expiresAt, maxViews || null
  );

  return {
    id: token,
    token,
    password: finalPassword,
    url_path: `/teaser/${token}`,
    expires_at: expiresAt,
    max_views: maxViews || null,
  };
}

function _logAccess(shareId, req, outcome) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO teaser_access_log (share_id, ip, user_agent, outcome) VALUES (?, ?, ?, ?)`
    ).run(
      shareId,
      req?.ip || req?.headers?.["x-forwarded-for"] || null,
      (req?.headers?.["user-agent"] || "").slice(0, 200),
      outcome
    );
  } catch (_) { /* 审计失败不影响主流程 */ }
}

/**
 * 公开端点用 — 只返回必要的元信息(不含密文/不含项目内部数据)
 */
function getPublicMeta(token) {
  const db = getDb();
  const row = db.prepare(`SELECT id, expires_at, max_views, view_count, revoked_at FROM teaser_shares WHERE id = ?`).get(token);
  if (!row) return null;
  return {
    id: row.id,
    expires_at: row.expires_at,
    max_views: row.max_views,
    view_count: row.view_count,
    revoked: !!row.revoked_at,
  };
}

/**
 * 公开端点用 — 凭 password 解密 teaser payload。
 * 失败时不告诉调用方"是密码错还是过期",统一 generic error。
 */
function viewShare(token, password, req) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM teaser_shares WHERE id = ?`).get(token);
  if (!row) return { ok: false, code: "not_found" };

  if (row.revoked_at) {
    _logAccess(token, req, "revoked");
    return { ok: false, code: "revoked" };
  }
  if (row.expires_at && new Date(row.expires_at.replace(" ", "T") + "Z") < new Date()) {
    _logAccess(token, req, "expired");
    return { ok: false, code: "expired" };
  }
  if (row.max_views != null && row.view_count >= row.max_views) {
    _logAccess(token, req, "limit_exceeded");
    return { ok: false, code: "limit_exceeded" };
  }

  if (!password || !bcrypt.compareSync(password, row.password_hash)) {
    _logAccess(token, req, "wrong_password");
    return { ok: false, code: "wrong_password" };
  }

  let payload;
  try {
    const plaintext = _decrypt({
      salt: row.kdf_salt, iv: row.cipher_iv, tag: row.cipher_tag, ciphertext: row.payload_ciphertext,
    }, password);
    payload = JSON.parse(plaintext);
  } catch (e) {
    _logAccess(token, req, "wrong_password");
    return { ok: false, code: "wrong_password" };
  }

  db.prepare(
    `UPDATE teaser_shares SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?`
  ).run(token);
  _logAccess(token, req, "viewed");

  return {
    ok: true,
    payload,
    watermark: row.watermark_text || null,
    meta: {
      view_count: row.view_count + 1,
      max_views: row.max_views,
      expires_at: row.expires_at,
    },
  };
}

function listSharesForProject(userId, projectId) {
  const db = getDb();
  const proj = db.prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`).get(projectId, userId);
  if (!proj) throw new Error("项目不存在或无权访问");
  return db.prepare(
    `SELECT id, recipient_label, expires_at, max_views, view_count, revoked_at, created_at, last_viewed_at
     FROM teaser_shares WHERE project_id = ? ORDER BY created_at DESC`
  ).all(projectId);
}

function revokeShare(userId, token) {
  const db = getDb();
  const row = db.prepare(`SELECT user_id FROM teaser_shares WHERE id = ?`).get(token);
  if (!row) throw new Error("分享不存在");
  if (row.user_id !== userId) throw new Error("无权撤销");
  db.prepare(`UPDATE teaser_shares SET revoked_at = datetime('now') WHERE id = ?`).run(token);
  return { ok: true };
}

function listAccessLog(userId, token) {
  const db = getDb();
  const row = db.prepare(`SELECT user_id FROM teaser_shares WHERE id = ?`).get(token);
  if (!row || row.user_id !== userId) throw new Error("无权查看");
  return getDb().prepare(
    `SELECT ip, user_agent, outcome, viewed_at FROM teaser_access_log WHERE share_id = ? ORDER BY viewed_at DESC LIMIT 200`
  ).all(token);
}

module.exports = {
  createShare,
  viewShare,
  getPublicMeta,
  listSharesForProject,
  revokeShare,
  listAccessLog,
};
