// ============================================================
// notifications.test.js — 通知文案(纯函数)
// DB 落库 / 邮件 best-effort 路径走真实 better-sqlite3 冒烟验证。
// ============================================================

const { _internal } = require("../../services/notificationService");
const { renderText, VALID_TYPES } = _internal;

describe("renderText 通知文案", () => {
  const payload = { codename: "Project Helios", post_title: "某高分项目", actor_name: "Alice" };

  test("四类通知都有标题且正文带项目名", () => {
    for (const type of VALID_TYPES) {
      const { subject, body } = renderText(type, payload);
      expect(typeof subject).toBe("string");
      expect(subject.length).toBeGreaterThan(0);
      expect(body).toContain("Project Helios");
    }
  });

  test("正文带触发者名字", () => {
    expect(renderText("interest_received", payload).body).toContain("Alice");
  });

  test("缺 codename 时回退到 post_title", () => {
    const { body } = renderText("report_unlocked", { post_title: "备用标题", actor_name: "Bob" });
    expect(body).toContain("备用标题");
  });

  test("未知类型回退到默认文案,不崩", () => {
    const { subject, body } = renderText("not_a_type", {});
    expect(subject).toBe("论坛通知");
    expect(typeof body).toBe("string");
  });
});
