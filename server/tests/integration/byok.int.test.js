// ============================================================
// tests/integration/byok.int.test.js — 自带模型（BYOK）集成测试
//
// 用真 SQLite 跑迁移，覆盖两条产品级不变量：
//   1. 用户自带 API Key 时**不扣平台额度**（算力他自己付），
//      额度为 0 的用户也必须能跑
//   2. 分析结果缓存按模型隔离 —— 换模型重跑同一份 BP 必须真的重算，
//      否则用户花了自己的钱，却拿回上次平台模型出的旧报告
// 外加凭证存储的安全约束：密文落库、掩码展示、SSRF 白名单。
// ============================================================

process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "integration-test-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY = "0".repeat(64); // BYOK 加密所需
process.env.RATE_LIMIT_GLOBAL_MAX = "0";

const request = require("supertest");
const { createApp } = require("../../app");
const { getDb, closeDb } = require("../../db");
const { admitAnalysis } = require("../../controllers/analyzeController");
const { PIPELINE_VERSION } = require("../../config/versions");
const credentials = require("../../services/llmCredentialService");

let app;
let seq = 0;

beforeAll(() => { app = createApp(); });
afterAll(() => { closeDb(); });

function makeUser(freeQuota = 5) {
  seq += 1;
  const db = getDb();
  const info = db.prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, 'x', 'user')"
  ).run(`byok-user-${seq}`);
  const userId = info.lastInsertRowid;
  // 额度独立成表（免费/付费分离，扣减优先扣免费额度）
  db.prepare("INSERT INTO quotas (user_id, free_quota, paid_quota) VALUES (?, ?, 0)").run(userId, freeQuota);
  return userId;
}

function quotaOf(userId) {
  const row = getDb().prepare("SELECT free_quota, paid_quota FROM quotas WHERE user_id = ?").get(userId);
  return row.free_quota + row.paid_quota;
}

/** 写一条已完成任务，模拟"上次用某个模型分析过这份文件" */
function seedCompleted(userId, fileHash, provider, model) {
  seq += 1;
  const id = `task-${seq}`;
  getDb().prepare(
    `INSERT INTO tasks (id, user_id, status, file_hash, result, llm_provider, llm_model, llm_source, created_at)
     VALUES (?, ?, 'complete', ?, ?, ?, ?, 'platform', datetime('now'))`
  ).run(id, userId, fileHash, JSON.stringify({ pipeline_version: PIPELINE_VERSION, marker: model }), provider, model);
  return id;
}

describe("BYOK 额度豁免", () => {
  test("用自己的 key → 不扣额度", () => {
    const userId = makeUser();
    const before = quotaOf(userId);
    const res = admitAnalysis({
      userId, isAdmin: false, fileHash: `h-${userId}`,
      llmKey: "anthropic/claude-sonnet-5", skipQuota: true,
    });
    expect(res.kind).toBe("created");
    expect(res.quotaDeductType).toBeNull();
    expect(quotaOf(userId)).toBe(before);
  });

  test("用平台模型 → 照扣额度", () => {
    const userId = makeUser();
    const before = quotaOf(userId);
    const res = admitAnalysis({ userId, isAdmin: false, fileHash: `h-${userId}`, llmKey: "deepseek/deepseek-v4-flash" });
    expect(res.kind).toBe("created");
    expect(quotaOf(userId)).toBe(before - 1);
  });

  test("额度为 0 的用户用自己的 key 仍可分析", () => {
    const userId = makeUser(0);
    expect(admitAnalysis({
      userId, isAdmin: false, fileHash: `h-${userId}`,
      llmKey: "openai/gpt-4o", skipQuota: true,
    }).kind).toBe("created");
  });

  test("额度为 0 且用平台模型 → 拒绝", () => {
    const userId = makeUser(0);
    expect(admitAnalysis({
      userId, isAdmin: false, fileHash: `h-${userId}`, llmKey: "deepseek/deepseek-v4-flash",
    }).kind).toBe("no_quota");
  });
});

describe("分析缓存按模型隔离", () => {
  test("同文件同模型 → 命中缓存", () => {
    const userId = makeUser();
    const hash = `same-${userId}`;
    seedCompleted(userId, hash, "deepseek", "deepseek-v4-flash");
    const res = admitAnalysis({ userId, isAdmin: false, fileHash: hash, llmKey: "deepseek/deepseek-v4-flash" });
    expect(res.kind).toBe("cached");
    expect(res.existing.result.marker).toBe("deepseek-v4-flash");
  });

  test("同文件换模型 → 不复用，重新分析", () => {
    const userId = makeUser();
    const hash = `switch-${userId}`;
    seedCompleted(userId, hash, "deepseek", "deepseek-v4-flash");
    expect(admitAnalysis({
      userId, isAdmin: false, fileHash: hash,
      llmKey: "anthropic/claude-sonnet-5", skipQuota: true,
    }).kind).toBe("created");
  });

  test("换厂商同样不复用", () => {
    const userId = makeUser();
    const hash = `vendor-${userId}`;
    seedCompleted(userId, hash, "openai", "gpt-4o");
    expect(admitAnalysis({ userId, isAdmin: false, fileHash: hash, llmKey: "gemini/gpt-4o" }).kind).toBe("created");
  });

  test("迁移前的老任务（无模型字段）不会被错误复用", () => {
    const userId = makeUser();
    const hash = `legacy-${userId}`;
    seq += 1;
    getDb().prepare(
      `INSERT INTO tasks (id, user_id, status, file_hash, result, created_at)
       VALUES (?, ?, 'complete', ?, ?, datetime('now'))`
    ).run(`task-legacy-${seq}`, userId, hash, JSON.stringify({ pipeline_version: PIPELINE_VERSION }));
    expect(admitAnalysis({ userId, isAdmin: false, fileHash: hash, llmKey: "deepseek/deepseek-v4-flash" }).kind).toBe("created");
  });
});

describe("凭证存储安全", () => {
  const PLAIN = "sk-super-secret-key-abcdef123456";

  test("落库的是密文，明文不可见", () => {
    const userId = makeUser();
    credentials.saveCredential(
      userId,
      { provider: "openai", apiKey: PLAIN, models: { default: "gpt-4o" } },
      { ok: true, message: "ok" }
    );
    const row = getDb().prepare("SELECT api_key_cipher FROM user_llm_credentials WHERE user_id = ?").get(userId);
    expect(row.api_key_cipher).not.toContain(PLAIN);
    expect(row.api_key_cipher).not.toContain("super-secret");
    expect(credentials.decryptKey(row.api_key_cipher)).toBe(PLAIN);
  });

  test("对外视图只给掩码，永不返回明文", () => {
    const userId = makeUser();
    credentials.saveCredential(
      userId,
      { provider: "openai", apiKey: PLAIN, models: { default: "gpt-4o" } },
      { ok: true, message: "ok" }
    );
    const view = credentials.getCredentialForUser(userId);
    expect(JSON.stringify(view)).not.toContain(PLAIN);
    expect(view.api_key_masked).toMatch(/…/);
    expect(view.usable).toBe(true);
  });

  test("校验未通过的凭证不可用于分析", () => {
    const userId = makeUser();
    credentials.saveCredential(
      userId,
      { provider: "openai", apiKey: PLAIN, models: { default: "gpt-4o" } },
      { ok: false, message: "模型无法按 JSON 输出" }
    );
    expect(credentials.getCredentialForUser(userId).usable).toBe(false);
  });

  test("buildContextForUser 产出可直接用的 BYOK 上下文；只配一档时三档同模型", () => {
    const userId = makeUser();
    credentials.saveCredential(
      userId,
      { provider: "anthropic", apiKey: PLAIN, models: { default: "claude-sonnet-5" } },
      { ok: true, message: "ok" }
    );
    const ctx = credentials.buildContextForUser(userId);
    expect(ctx).toMatchObject({ source: "byok", providerId: "anthropic", apiKey: PLAIN });
    expect(ctx.models).toEqual({
      default: "claude-sonnet-5", heavy: "claude-sonnet-5", light: "claude-sonnet-5",
    });
  });

  test("没有凭证的用户拿到 null（调用方据此回落平台模型）", () => {
    expect(credentials.buildContextForUser(makeUser())).toBeNull();
  });

  test("删除后立即失效", () => {
    const userId = makeUser();
    credentials.saveCredential(userId, { provider: "openai", apiKey: PLAIN, models: { default: "gpt-4o" } }, { ok: true });
    credentials.deleteCredential(userId);
    expect(credentials.buildContextForUser(userId)).toBeNull();
  });
});

describe("BYOK 不得绕过账号级闸门", () => {
  // 用自己的 key 只是换了付费方式，邮箱绑定这类反滥用要求必须照旧。
  const { checkQuota } = require("../../middleware/quota");

  function runCheck(userId, { skipQuotaBalance = false } = {}) {
    const req = { user: { id: userId }, skipQuotaBalance };
    let status = null;
    let body = null;
    let passed = false;
    const res = {
      status(code) { status = code; return this; },
      json(payload) { body = payload; return this; },
    };
    checkQuota(req, res, () => { passed = true; });
    return { passed, status, body };
  }

  test("未绑定邮箱 → 即使自带 key 也被拦（4031）", () => {
    const userId = makeUser(0);
    const r = runCheck(userId, { skipQuotaBalance: true });
    expect(r.passed).toBe(false);
    expect(r.body.code).toBe(4031);
  });

  test("已绑定邮箱 + 额度为 0 + 自带 key → 放行", () => {
    const userId = makeUser(0);
    getDb().prepare("UPDATE users SET email = ?, contact_bound = 1 WHERE id = ?")
      .run(`byok${userId}@example.com`, userId);
    expect(runCheck(userId, { skipQuotaBalance: true }).passed).toBe(true);
  });

  test("已绑定邮箱 + 额度为 0 + 用平台模型 → 仍然拦额度（4032）", () => {
    const userId = makeUser(0);
    getDb().prepare("UPDATE users SET email = ?, contact_bound = 1 WHERE id = ?")
      .run(`plat${userId}@example.com`, userId);
    const r = runCheck(userId);
    expect(r.passed).toBe(false);
    expect(r.body.code).toBe(4032);
  });
});

describe("BYOK HTTP 合同", () => {
  test("GET /api/llm/providers 免登录可读，且不泄漏内部字段", async () => {
    const res = await request(app).get("/api/llm/providers");
    expect(res.status).toBe(200);
    expect(res.body.byok_enabled).toBe(true);
    expect(res.body.providers.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(res.body)).not.toContain("allowedHostSuffixes");
  });

  test("未登录不能读写凭证", async () => {
    expect((await request(app).get("/api/llm/credentials")).status).toBe(401);
    expect((await request(app).post("/api/llm/credentials").send({ provider: "openai", apiKey: "x" })).status).toBe(401);
  });
});
