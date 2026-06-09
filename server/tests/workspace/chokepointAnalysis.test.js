// 供应链咽喉护城河 skill —— 纯 JS 综合分计算（不依赖 LLM）。
const chokepoint = require("../../skills/chokepointAnalysis");
const { computeChokepointScore } = chokepoint._private;
const { FACTOR_WEIGHTS } = require("../../skills/_chokepointMethodology");

function factors(scores) {
  return Object.entries(scores).map(([factor, score]) => ({ factor, score }));
}

describe("chokepointAnalysis skill shape", () => {
  test("registers required skill fields", () => {
    expect(chokepoint.id).toBe("chokepoint_analysis");
    expect(typeof chokepoint.run).toBe("function");
    expect(chokepoint.inputSchema.type).toBe("object");
    expect(chokepoint.outputArtifactKind).toBe("json");
  });

  test("factor weights sum to 1", () => {
    const sum = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("computeChokepointScore", () => {
  test("all factors 100 => 100", () => {
    const r = computeChokepointScore(
      factors({
        irreplaceability: 100,
        supply_concentration: 100,
        big_player_dependency: 100,
        value_capture: 100,
        strategic_lockin: 100,
      })
    );
    expect(r.chokepoint_score).toBe(100);
    expect(r.gated).toBe(false);
  });

  test("missing factors fall back to neutral 50", () => {
    const r = computeChokepointScore([]);
    expect(r.base_score).toBe(50);
    expect(r.chokepoint_score).toBe(50);
  });

  test("weighted average respects FACTOR_WEIGHTS", () => {
    // irreplaceability=100, 其余 0 → base = 100 * weight(irreplaceability)
    const r = computeChokepointScore(
      factors({
        irreplaceability: 100,
        supply_concentration: 0,
        big_player_dependency: 0,
        value_capture: 50, // 设为 50 避免触发门控，单测权重本身
        strategic_lockin: 0,
      })
    );
    const expectedBase = Math.round(100 * FACTOR_WEIGHTS.irreplaceability + 50 * FACTOR_WEIGHTS.value_capture);
    expect(r.base_score).toBe(expectedBase);
  });

  test("value_capture gate: strong chokepoint but cannot monetize => discounted", () => {
    const strong = {
      irreplaceability: 90,
      supply_concentration: 90,
      big_player_dependency: 90,
      strategic_lockin: 90,
    };
    const monetizable = computeChokepointScore(factors({ ...strong, value_capture: 80 }));
    const stuck = computeChokepointScore(factors({ ...strong, value_capture: 10 }));
    expect(stuck.gated).toBe(true);
    expect(monetizable.gated).toBe(false);
    expect(stuck.chokepoint_score).toBeLessThan(monetizable.chokepoint_score);
  });

  test("value_capture exactly 40 is the gate boundary (no discount)", () => {
    const f = factors({
      irreplaceability: 80,
      supply_concentration: 80,
      big_player_dependency: 80,
      value_capture: 40,
      strategic_lockin: 80,
    });
    const r = computeChokepointScore(f);
    expect(r.gated).toBe(false);
    expect(r.chokepoint_score).toBe(r.base_score);
  });

  test("out-of-range factor scores are clamped", () => {
    const r = computeChokepointScore(
      factors({
        irreplaceability: 999,
        supply_concentration: -50,
        big_player_dependency: 50,
        value_capture: 50,
        strategic_lockin: 50,
      })
    );
    expect(r.chokepoint_score).toBeGreaterThanOrEqual(0);
    expect(r.chokepoint_score).toBeLessThanOrEqual(100);
  });
});
