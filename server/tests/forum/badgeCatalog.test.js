// ============================================================
// badgeCatalog.test.js — BP 自动徽章的纯逻辑（目录阈值 / 地域映射 / 展示视图）
//
// 守护：徽章按平台数据(分数/总量/活跃/地域)分级授予，tier 阈值稳定；
// 地域归并到大区；region 徽章展示名按地区拼接。
// （DB 写入路径 recompute/getBadges 依赖真实 sqlite，由集成环境验证；
//  jest 环境 better-sqlite3 是 no-op stub，此处只测纯逻辑。）
// ============================================================

const { CATALOG, _internal } = require("../../services/badgeService");
const { toRegion, badgeView } = _internal;

describe("CATALOG.high_score 分级（按 70+ 优质项目数量）", () => {
  const ev = CATALOG.high_score.evaluate;
  test("0 个 70+ 不授予", () => expect(ev({ highCount: 0 })).toBeNull());
  test("1 个 → tier1（高分猎手）", () => expect(ev({ highCount: 1 }).tier).toBe(1));
  test("5 个 → tier2（明星猎手）", () => expect(ev({ highCount: 5 }).tier).toBe(2));
  test("15 个 → tier3（顶尖猎手）", () => expect(ev({ highCount: 20 }).tier).toBe(3));
  test("缺字段 → null", () => expect(ev({})).toBeNull());
  test("meta 带 high_count", () => expect(ev({ highCount: 7 }).meta.high_count).toBe(7));
});

describe("CATALOG.volume 分级", () => {
  const ev = CATALOG.volume.evaluate;
  test("9 份不授予", () => expect(ev({ totalCount: 9 })).toBeNull());
  test("10 → tier1", () => expect(ev({ totalCount: 10 }).tier).toBe(1));
  test("30 → tier2", () => expect(ev({ totalCount: 30 }).tier).toBe(2));
  test("100 → tier3", () => expect(ev({ totalCount: 120 }).tier).toBe(3));
});

describe("CATALOG.active / region", () => {
  test("近30天 <5 不授予活跃", () => expect(CATALOG.active.evaluate({ recentCount: 4 })).toBeNull());
  test("近30天 ≥5 授予活跃", () => expect(CATALOG.active.evaluate({ recentCount: 5 }).tier).toBe(1));
  const reg = CATALOG.region.evaluate;
  test("无地域不授予", () => expect(reg({ topRegion: null })).toBeNull());
  test("地区项目 <3 不授予", () => expect(reg({ topRegion: "华东", topRegionCount: 2 })).toBeNull());
  test("地区 ≥3 → tier1（在地）", () => { const r = reg({ topRegion: "华东", topRegionCount: 3 }); expect(r.tier).toBe(1); expect(r.meta.region).toBe("华东"); });
  test("地区 ≥15 → tier2（项目王）", () => expect(reg({ topRegion: "华东", topRegionCount: 18 }).tier).toBe(2));
});

describe("toRegion 省份→大区", () => {
  test("北京 → 华北", () => expect(toRegion("北京")).toBe("华北"));
  test("含后缀也命中：浙江省 → 华东", () => expect(toRegion("浙江省")).toBe("华东"));
  test("广东 → 华南", () => expect(toRegion("广东")).toBe("华南"));
  test("未知地名回退原值", () => expect(toRegion("火星")).toBe("火星"));
  test("空值 → null", () => { expect(toRegion("")).toBeNull(); expect(toRegion(null)).toBeNull(); });
});

describe("badgeView 展示视图", () => {
  test("region tier1 名按地区拼接（华东在地）", () => {
    const v = badgeView({ badge_code: "region", tier: 1, meta: JSON.stringify({ region: "华东", count: 5, tier: 1 }), displayed: 1, awarded_at: "t" });
    expect(v.name).toBe("华东在地");
    expect(v.displayed).toBe(true);
  });
  test("region tier2 名为 华东项目王", () => {
    const v = badgeView({ badge_code: "region", tier: 2, meta: JSON.stringify({ region: "华东", count: 18, tier: 2 }), displayed: 0, awarded_at: "t" });
    expect(v.name).toBe("华东项目王");
    expect(v.tier).toBe(2);
  });
  test("high_score tier3 用对应等级名与颜色", () => {
    const v = badgeView({ badge_code: "high_score", tier: 3, meta: JSON.stringify({ high_count: 20 }), displayed: 0, awarded_at: "t" });
    expect(v.name).toBe("顶尖猎手");
    expect(v.tier).toBe(3);
    expect(v.displayed).toBe(false);
  });
  test("未知 code → null", () => {
    expect(badgeView({ badge_code: "nope", tier: 1 })).toBeNull();
  });
});
