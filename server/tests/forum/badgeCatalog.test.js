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

describe("CATALOG.high_score 分级", () => {
  const ev = CATALOG.high_score.evaluate;
  test("未达 80 分不授予", () => expect(ev({ bestScore: 79 })).toBeNull());
  test("80 → tier1", () => expect(ev({ bestScore: 80 }).tier).toBe(1));
  test("88 → tier2", () => expect(ev({ bestScore: 88 }).tier).toBe(2));
  test("93 → tier3", () => expect(ev({ bestScore: 95 }).tier).toBe(3));
  test("无分数 → null", () => expect(ev({ bestScore: null })).toBeNull());
  test("meta 带 best_score", () => expect(ev({ bestScore: 90 }).meta.best_score).toBe(90));
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
  test("无地域不授予", () => expect(CATALOG.region.evaluate({ topRegion: null })).toBeNull());
  test("有地域授予并带 region", () => expect(CATALOG.region.evaluate({ topRegion: "华东" }).meta.region).toBe("华东"));
});

describe("toRegion 省份→大区", () => {
  test("北京 → 华北", () => expect(toRegion("北京")).toBe("华北"));
  test("含后缀也命中：浙江省 → 华东", () => expect(toRegion("浙江省")).toBe("华东"));
  test("广东 → 华南", () => expect(toRegion("广东")).toBe("华南"));
  test("未知地名回退原值", () => expect(toRegion("火星")).toBe("火星"));
  test("空值 → null", () => { expect(toRegion("")).toBeNull(); expect(toRegion(null)).toBeNull(); });
});

describe("badgeView 展示视图", () => {
  test("region 徽章名按地区拼接", () => {
    const v = badgeView({ badge_code: "region", tier: 1, meta: JSON.stringify({ region: "华东" }), displayed: 1, awarded_at: "t" });
    expect(v.name).toBe("华东在地");
    expect(v.displayed).toBe(true);
  });
  test("high_score tier3 用对应等级名与颜色", () => {
    const v = badgeView({ badge_code: "high_score", tier: 3, meta: JSON.stringify({ best_score: 95 }), displayed: 0, awarded_at: "t" });
    expect(v.name).toBe("顶尖猎手");
    expect(v.tier).toBe(3);
    expect(v.displayed).toBe(false);
  });
  test("未知 code → null", () => {
    expect(badgeView({ badge_code: "nope", tier: 1 })).toBeNull();
  });
});
