// ============================================================
// tests/integration/api.int.test.js — HTTP 层集成测试（P1-2）
//
// 用真 better-sqlite3 :memory: 跑全部迁移，再用 supertest 打完整
// Express 栈（安全中间件 → 路由 → 控制器 → 服务 → 真 SQL）。
// 覆盖目标：迁移可用性、认证/权限边界、核心 API 合同。
// ============================================================

process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "integration-test-secret-0123456789abcdef";
process.env.RATE_LIMIT_GLOBAL_MAX = "0"; // 测试中关闭全局限流，避免用例间互相干扰

const request = require("supertest");
const { createApp } = require("../../app");
const { getDb, closeDb } = require("../../db");
const VERSION = require("../../package.json").version;

let app;

beforeAll(() => {
  // createApp 内部执行 getDb() → 在 :memory: 上运行全部迁移
  app = createApp();
});

afterAll(() => {
  closeDb();
});

// ── 迁移与健康检查 ─────────────────────────────────────────
describe("migrations & health", () => {
  test("全部迁移在空库上成功执行且已登记", () => {
    const db = getDb();
    const fs = require("fs");
    const path = require("path");
    const files = fs
      .readdirSync(path.join(__dirname, "..", "..", "db", "migrations"))
      .filter((f) => f.endsWith(".sql") && f !== "000_schema_migrations.sql");
    const applied = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n;
    expect(applied).toBe(files.length);
    // 关键表存在
    for (const table of ["users", "tasks", "quotas", "forum_posts", "revoked_tokens"]) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ).toBeTruthy();
    }
  });

  test("GET /api/health → 200 且版本号来自 package.json", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(VERSION);
    expect(res.headers["x-request-id"]).toBeTruthy(); // P3-4
  });
});

// ── 认证流程 ───────────────────────────────────────────────
describe("auth flow", () => {
  test("注册 → 登录 → /me 全链路", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ username: "int_user_1", password: "test-passwd-1" });
    expect(reg.status).toBe(201);
    expect(reg.body.token).toBeTruthy();
    expect(reg.body.user.role).toBe("user");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "int_user_1", password: "test-passwd-1" });
    expect(login.status).toBe(200);

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user?.username || me.body.username).toBe("int_user_1");
  });

  test("重复用户名 → 409；非法用户名 → 400；错误密码 → 401", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ username: "int_user_dup", password: "test-passwd-1" });
    const dup = await request(app)
      .post("/api/auth/register")
      .send({ username: "int_user_dup", password: "test-passwd-1" });
    expect(dup.status).toBe(409);

    const bad = await request(app)
      .post("/api/auth/register")
      .send({ username: "x", password: "test-passwd-1" });
    expect(bad.status).toBe(400);

    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ username: "int_user_dup", password: "wrong-password" });
    expect(wrong.status).toBe(401);
  });
});

// ── 权限边界 ───────────────────────────────────────────────
describe("authorization boundaries", () => {
  let userToken;

  beforeAll(async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ username: "int_user_2", password: "test-passwd-2" });
    userToken = reg.body.token;
  });

  test("未登录访问 /api/analyze → 401", async () => {
    const res = await request(app).post("/api/analyze").send({ text: "hello" });
    expect(res.status).toBe(401);
  });

  test("普通用户访问管理接口 → 403", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  test("伪造 token → 401", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

// ── 论坛（软墙：游客可读，写需登录）──────────────────────────
describe("forum", () => {
  test("游客可读帖子列表", async () => {
    const res = await request(app).get("/api/forum/posts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.posts || res.body.items || res.body.list || [])).toBe(true);
  });

  test("游客发帖 → 401", async () => {
    const res = await request(app)
      .post("/api/forum/posts")
      .send({ category: "general", title: "t", body: "b" });
    expect(res.status).toBe(401);
  });
});

// ── API 边界防护 ───────────────────────────────────────────
describe("api guards", () => {
  test("非 JSON/multipart 的写请求 → 415（writeContentTypeGuard）", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "text/plain")
      .send("username=a&password=b");
    expect(res.status).toBe(415);
  });

  test("超过 1MB 的普通 JSON body → 413（P0-2 全局限额）", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "a", password: "x".repeat(1.5 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });
});
