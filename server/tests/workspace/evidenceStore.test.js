// ============================================================
// tests/workspace/evidenceStore.test.js
//
// 覆盖 services/evidenceStore.js 的核心行为：
//   1) 纯函数：chunkText / safeFtsQuery / evidenceLevelForSource
//   2) Retention 数学：admin / 活跃 VIP / VIP 失效 / free 四档
//   3) structured_facts roundtrip：写一组 fact → 读回来按 evidence_level 排序
// 不调真实 better-sqlite3；用手工 fake DB 拦截 SQL。
// ============================================================

const evidenceStore = require("../../services/evidenceStore");

describe("evidenceStore · 纯函数", () => {
  test("evidenceLevelForSource 把 source_type 映射到 1-5 层级", () => {
    expect(evidenceStore.evidenceLevelForSource("upload_structured")).toBe(1);
    expect(evidenceStore.evidenceLevelForSource("upload")).toBe(2);
    expect(evidenceStore.evidenceLevelForSource("external_search")).toBe(3);
    expect(evidenceStore.evidenceLevelForSource("project_context")).toBe(4);
    expect(evidenceStore.evidenceLevelForSource("institutional_memory")).toBe(4);
    expect(evidenceStore.evidenceLevelForSource("bp_self_report")).toBe(5);
    // 未知 source_type 默认 4（不强行降级也不强行提级）
    expect(evidenceStore.evidenceLevelForSource("anything_else")).toBe(4);
    expect(evidenceStore.evidenceLevelForSource(undefined)).toBe(4);
  });

  test("chunkText 按段落优先、长段落 fallback 到 char 切片", () => {
    const { chunkText } = evidenceStore._private;
    // 短段落合并到一个 chunk
    const out1 = chunkText("段落A\n\n段落B", 500);
    expect(out1.length).toBe(1);
    expect(out1[0]).toContain("段落A");
    expect(out1[0]).toContain("段落B");
    // 长段落按 char 切片
    const long = "a".repeat(5000);
    const out2 = chunkText(long, 2048);
    expect(out2.length).toBeGreaterThan(1);
    expect(out2[0].length).toBeLessThanOrEqual(2048);
    // 空输入返回空数组
    expect(chunkText("")).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  test("safeFtsQuery 提取中英文 token，过滤特殊字符，限制 12 个 token", () => {
    const { safeFtsQuery } = evidenceStore._private;
    // 中文 token + 英文 token 混合
    const q = safeFtsQuery("AI SaaS 智能客服 LTV");
    expect(q).toContain("AI");
    expect(q).toContain("SaaS");
    expect(q).toContain("智");
    expect(q).toContain("能");
    // FTS5 OR 语法
    expect(q).toMatch(/ OR /);
    // 空查询返回空字符串
    expect(safeFtsQuery("")).toBe("");
    expect(safeFtsQuery(null)).toBe("");
    // 超长输入只保留前 12 个 token
    const q2 = safeFtsQuery("a b c d e f g h i j k l m n o p");
    const tokens = q2.split(" OR ");
    expect(tokens.length).toBeLessThanOrEqual(12);
  });
});

describe("evidenceStore · Retention 数学", () => {
  // ── Fake DB：只需要 PRAGMA table_info(users) + SELECT users by id 这两个查询
  function buildFakeDb({ user }) {
    return {
      prepare: (sql) => {
        if (sql.startsWith("PRAGMA table_info(users)")) {
          return { all: () => [
            { name: "id" }, { name: "role" }, { name: "is_vip" }, { name: "vip_expires_at" },
          ]};
        }
        if (sql.includes("FROM users WHERE id = ?")) {
          return { get: () => user || null, all: () => [] };
        }
        return { get: () => null, all: () => [], run: () => ({}) };
      },
    };
  }

  test("admin 角色永不过期", () => {
    const db = buildFakeDb({ user: { role: "admin", is_vip: 0, vip_expires_at: null } });
    const out = evidenceStore.computeArtifactExpiresAt({
      db, userId: 1, kind: "upload", createdAt: "2026-05-01T00:00:00Z",
    });
    expect(out).toBeNull();
  });

  test("活跃 VIP 永不过期", () => {
    const future = new Date(Date.now() + 365 * 86400000).toISOString();
    const db = buildFakeDb({ user: { role: "user", is_vip: 1, vip_expires_at: future } });
    const out = evidenceStore.computeArtifactExpiresAt({
      db, userId: 1, kind: "upload", createdAt: "2026-05-01T00:00:00Z",
    });
    expect(out).toBeNull();
  });

  test("VIP 失效后 +3 天 (lapsed VIP)", () => {
    const expired = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19);
    const out = evidenceStore._private.computeLapsedVipUploadExpiresAt({
      vipExpiresAt: expired,
      createdAt: "2026-04-01T00:00:00Z",
    });
    const outDate = new Date(out);
    const expiredDate = new Date(expired);
    // 3 天差距，允许 1 小时浮动避开 DST 计算
    const diffDays = (outDate - expiredDate) / 86400000;
    expect(diffDays).toBeGreaterThan(2.9);
    expect(diffDays).toBeLessThan(3.1);
  });

  test("free 用户 upload 是 createdAt + 3 天", () => {
    const db = buildFakeDb({ user: { role: "user", is_vip: 0, vip_expires_at: null } });
    const out = evidenceStore.computeArtifactExpiresAt({
      db, userId: 1, kind: "upload", createdAt: "2026-05-01T00:00:00Z",
    });
    expect(out).toBeTruthy();
    const diffDays = (new Date(out) - new Date("2026-05-01T00:00:00Z")) / 86400000;
    expect(diffDays).toBeGreaterThan(2.9);
    expect(diffDays).toBeLessThan(3.1);
  });

  test("free 用户 generated artifact 是 createdAt + 7 天 (kind!=upload 走 GENERATED_ARTIFACT_TTL_DAYS)", () => {
    const db = buildFakeDb({ user: { role: "user", is_vip: 0, vip_expires_at: null } });
    const out = evidenceStore.computeArtifactExpiresAt({
      db, userId: 1, kind: "generated_pptx", createdAt: "2026-05-01T00:00:00Z",
    });
    const diffDays = (new Date(out) - new Date("2026-05-01T00:00:00Z")) / 86400000;
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });
});

describe("evidenceStore · structured_facts 往返 (replace + list)", () => {
  // ── Fake DB：精确拦截需要的 SQL，把 structured_facts 当 in-memory 数组
  let factsTable;
  let docsTable;
  let conversationsTable;

  function buildFakeDb() {
    factsTable = [];
    docsTable = [];
    conversationsTable = [{ id: "conv-1", project_id: 42, user_id: 7 }];
    return {
      prepare: (sql) => {
        // tableExists checks
        if (sql.includes("FROM sqlite_master")) {
          return { get: (name) => {
            // 我们 fake "structured_facts" / "workspace_documents" 都存在
            return ["structured_facts", "workspace_documents", "workspace_chunks_fts"].includes(name)
              ? { name } : null;
          }, all: () => [] };
        }
        // PRAGMA table_info — 不需要列信息细节
        if (sql.startsWith("PRAGMA table_info")) {
          return { all: () => [] };
        }
        // getConversationMeta
        if (sql.includes("FROM workspace_conversations c") && sql.includes("WHERE c.id = ?")) {
          return { get: (convId) => {
            const c = conversationsTable.find((x) => x.id === convId);
            return c ? { id: c.id, project_id: c.project_id, user_id: c.user_id, industry: "AI SaaS", sub_industry: null } : null;
          }};
        }
        // SELECT document_id FROM workspace_documents WHERE artifact_id = ?
        if (sql.includes("SELECT document_id FROM workspace_documents WHERE artifact_id = ?")) {
          return { get: (artifactId) => {
            const d = docsTable.find((x) => x.artifact_id === artifactId);
            return d ? { document_id: d.document_id } : null;
          }};
        }
        // DELETE FROM structured_facts WHERE artifact_id = ?
        if (sql.includes("DELETE FROM structured_facts WHERE artifact_id")) {
          return { run: (artifactId) => {
            const before = factsTable.length;
            factsTable = factsTable.filter((f) => f.artifact_id !== artifactId);
            return { changes: before - factsTable.length };
          }};
        }
        // INSERT INTO structured_facts
        if (sql.includes("INSERT INTO structured_facts")) {
          return { run: (...args) => {
            const [fact_id, project_id, document_id, artifact_id, fact_type, field, label, value, fact_json, source_type, source_ref, evidence_level, confidence] = args;
            factsTable.push({ fact_id, project_id, document_id, artifact_id, fact_type, field, label, value, fact_json, source_type, source_ref, evidence_level, confidence, updated_at: new Date().toISOString() });
            return { lastInsertRowid: factsTable.length };
          }};
        }
        // listStructuredFactsForEvidencePack: SELECT sf.*, d.file_name ...
        if (sql.includes("FROM structured_facts sf") && sql.includes("LEFT JOIN workspace_documents d")) {
          return { all: (...args) => {
            const params = args.flat();
            const projectId = params[0];
            const limit = params[params.length - 1];
            let rows = factsTable.filter((f) => f.project_id === projectId);
            rows.sort((a, b) => a.evidence_level - b.evidence_level || (b.updated_at || "").localeCompare(a.updated_at || ""));
            return rows.slice(0, limit).map((f) => ({ ...f, file_name: docsTable.find((d) => d.document_id === f.document_id)?.file_name || null }));
          }};
        }
        return { run: () => ({}), get: () => null, all: () => [] };
      },
    };
  }

  test("replaceStructuredFactsForArtifact 写入后 listStructuredFactsForEvidencePack 能读回", () => {
    const db = buildFakeDb();
    docsTable.push({ document_id: "doc-1", artifact_id: "art-1", file_name: "财务表.xlsx" });

    const { count, projectId } = evidenceStore.replaceStructuredFactsForArtifact({
      db,
      artifactId: "art-1",
      conversationId: "conv-1",
      projectId: 42,
      flatFacts: [
        { field: "upload.financials.revenue", label: "上传资料-营业收入", value: "800 万元 (2024)", source_type: "upload_structured", source_name: "上传资料-财务表.xlsx", source_ref: "P3", artifact_id: "art-1", filename: "财务表.xlsx", confidence: "high" },
        { field: "upload.customers.concentration_top3_pct", label: "上传资料-前 3 大客户占比", value: "72 %", source_type: "upload_structured", source_name: "上传资料-客户清单.xlsx", artifact_id: "art-1", confidence: "high" },
      ],
    });
    expect(count).toBe(2);
    expect(projectId).toBe(42);
    expect(factsTable.length).toBe(2);
    // evidence_level 必须按 source_type 映射
    expect(factsTable[0].evidence_level).toBe(1);

    const back = evidenceStore.listStructuredFactsForEvidencePack({ db, projectId: 42, limit: 80 });
    expect(back.length).toBe(2);
    expect(back[0].source_type).toBe("upload_structured");
    expect(back[0].evidence_level).toBe(1);
    expect(back[0].filename).toBe("财务表.xlsx");
    // 重复 replace 时先 DELETE 同 artifact_id，再 INSERT；不应叠加
    evidenceStore.replaceStructuredFactsForArtifact({
      db, artifactId: "art-1", conversationId: "conv-1", projectId: 42,
      flatFacts: [{ field: "upload.financials.revenue", label: "上传资料-营业收入", value: "900 万元 (2025)", source_type: "upload_structured", confidence: "high" }],
    });
    expect(factsTable.length).toBe(1);
    expect(factsTable[0].value).toBe("900 万元 (2025)");
  });

  test("没有 structured_facts 表时返回空，不抛错", () => {
    const db = { prepare: () => ({ get: () => null, all: () => [], run: () => ({}) }) };
    const out = evidenceStore.listStructuredFactsForEvidencePack({ db, projectId: 1, limit: 10 });
    expect(out).toEqual([]);
  });
});
