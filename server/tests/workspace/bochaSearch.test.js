// ============================================================
// tests/workspace/bochaSearch.test.js
//
// 覆盖 DeepSeek 迁移后的检索层（博查 Bocha）：
//   - 未配置 BOCHA_API_KEY → 静默返回空，不发请求、不抛异常
//   - 正常响应 → 映射为内部 result 形状（name→title, summary 优先于 snippet）
//   - 业务错误码 / HTTP 错误 → 单条查询失败不拖垮整轮检索
// ============================================================

const BOCHA_OK = {
  code: 200,
  msg: null,
  data: {
    webPages: {
      value: [
        {
          name: "某公司 2025 年融资披露",
          url: "https://example.com/a",
          snippet: "短摘要",
          summary: "这是更长的摘要正文，信息量比 snippet 大。",
          siteName: "example.com",
          datePublished: "2025-11-02T00:00:00Z",
        },
        { name: "只有 snippet 的结果", url: "https://example.com/b", snippet: "仅短摘要" },
      ],
    },
  },
};

function loadService({ key = "test-bocha-key" } = {}) {
  jest.resetModules();
  jest.doMock("../../config", () => ({
    searchApiKey: key,
    searchApiHost: "https://api.bochaai.com/v1",
  }));
  return require("../../services/webSearchService");
}

describe("博查检索层", () => {
  afterEach(() => {
    jest.dontMock("../../config");
    jest.resetModules();
    delete global.fetch;
  });

  test("未配置 key → 不发请求，返回空数组", async () => {
    const svc = loadService({ key: "" });
    global.fetch = jest.fn();
    expect(svc.isSearchConfigured()).toBe(false);
    await expect(svc.runWebSearch(["任意查询"])).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("占位符 key 也算未配置", () => {
    expect(loadService({ key: "your-bocha-api-key" }).isSearchConfigured()).toBe(false);
  });

  test("正常响应 → 映射为内部形状，summary 优先于 snippet", async () => {
    const svc = loadService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => BOCHA_OK,
    });

    const rows = await svc.searchWithBocha("某公司 融资");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "某公司 2025 年融资披露",
      url: "https://example.com/a",
      snippet: "这是更长的摘要正文，信息量比 snippet 大。",
      source: "bocha_web_search",
      siteName: "example.com",
      query: "某公司 融资",
    });
    // summary 缺失时回落 snippet
    expect(rows[1].snippet).toBe("仅短摘要");

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.bochaai.com/v1/web-search");
    expect(init.headers.Authorization).toBe("Bearer test-bocha-key");
    expect(JSON.parse(init.body)).toMatchObject({ query: "某公司 融资", summary: true });
  });

  test("业务错误码 → 抛出，但 runWebSearch 只跳过该条查询", async () => {
    const svc = loadService();
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 401, msg: "invalid key" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => BOCHA_OK });

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await svc.runWebSearch(["坏查询", "好查询"]);
    warn.mockRestore();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.query === "好查询")).toBe(true);
  });

  test("HTTP 错误 → 整轮返回空但不抛", async () => {
    const svc = loadService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "upstream down",
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(svc.runWebSearch(["查询"])).resolves.toEqual([]);
    warn.mockRestore();
  });

  test("formatSearchContext 无结果时返回空串", () => {
    expect(loadService().formatSearchContext([])).toBe("");
  });
});
