// Sprint 2: bpVersionDiffService 单元测试（纯函数）
const {
  makeChange,
  diffMetrics,
} = require("../../services/bpVersionDiffService");

describe("makeChange", () => {
  test("数字字段：deltaPct 计算正确", () => {
    const c = makeChange(100, 150);
    expect(c.changed).toBe(true);
    expect(c.delta).toBe(50);
    expect(c.deltaPct).toBeCloseTo(0.5);
  });

  test("数字下降：deltaPct 为负", () => {
    const c = makeChange(200, 100);
    expect(c.delta).toBe(-100);
    expect(c.deltaPct).toBeCloseTo(-0.5);
  });

  test("起点为 0：deltaPct = null（避免除零）", () => {
    const c = makeChange(0, 100);
    expect(c.changed).toBe(true);
    expect(c.deltaPct).toBeNull();
  });

  test("一边为 null：不崩，标记为变更", () => {
    const c = makeChange(null, 50);
    expect(c.changed).toBe(true);
    expect(c.delta).toBeNull();
    expect(c.deltaPct).toBeNull();
  });

  test("字符串相等：未变更", () => {
    const c = makeChange("Pre-A", "Pre-A");
    expect(c.changed).toBe(false);
  });

  test("字符串变更：标记 changed，但无 delta", () => {
    const c = makeChange("Pre-A", "A");
    expect(c.changed).toBe(true);
    expect(c.delta).toBeNull();
  });
});

describe("diffMetrics", () => {
  test("新增 / 删除 / 变更", () => {
    const a = [
      { name: "DAU", value: 1000 },
      { name: "Revenue", value: 500 },
    ];
    const b = [
      { name: "DAU", value: 2000 },
      { name: "GMV", value: 100 },
    ];
    const r = diffMetrics(a, b);
    const dau = r.find((x) => x.name === "DAU");
    const rev = r.find((x) => x.name === "Revenue");
    const gmv = r.find((x) => x.name === "GMV");
    expect(dau.status).toBe("changed");
    expect(rev.status).toBe("removed");
    expect(gmv.status).toBe("added");
  });

  test("空输入不崩", () => {
    expect(diffMetrics(null, undefined)).toEqual([]);
  });
});
