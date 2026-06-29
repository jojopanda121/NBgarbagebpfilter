// 熔断器：错误分类 + 状态机 + gate 行为
// 在 require 之前压低等待/探活时长，让 overload-gate 拒绝路径秒级返回。
process.env.LLM_OVERLOAD_CALL_WAIT_MS = "60";
process.env.LLM_BREAKER_PROBE_MS = "1000000"; // 实质关闭自动探活，由测试手动驱动状态
process.env.LLM_BREAKER_FAIL_THRESHOLD = "3";

const breaker = require("../services/llmCircuitBreaker");

afterEach(() => breaker._reset());

describe("classify", () => {
  test("429 → overload", () => {
    expect(breaker.classify({ status: 429, message: "Too Many Requests" })).toBe("overload");
  });
  test("5xx → overload", () => {
    expect(breaker.classify({ status: 503, message: "bad gateway" })).toBe("overload");
  });
  test("超时/网络抖动 → overload", () => {
    expect(breaker.classify({ message: "LLM 请求超时 (300000ms)" })).toBe("overload");
    expect(breaker.classify({ message: "ECONNRESET" })).toBe("overload");
  });
  test("余额/额度耗尽关键词 → depleted", () => {
    expect(breaker.classify({ status: 402, message: "insufficient balance" })).toBe("depleted");
    expect(breaker.classify({ message: "账户余额不足，请充值" })).toBe("depleted");
    expect(breaker.classify({ body: '{"base_resp":{"status_code":1008}}' })).toBe("depleted");
  });
  test("普通业务错误 → other（不影响熔断）", () => {
    expect(breaker.classify({ status: 400, message: "invalid params" })).toBe("other");
    expect(breaker.classify(null)).toBe("other");
  });
});

describe("状态机", () => {
  test("连续 overload 达阈值才打开熔断", () => {
    breaker.recordFailure({ status: 429 });
    breaker.recordFailure({ status: 429 });
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure({ status: 429 });
    expect(breaker.isOpen()).toBe(true);
  });

  test("一次 depleted 立即进入 depleted 态", () => {
    breaker.recordFailure({ message: "balance insufficient" });
    expect(breaker.isDepleted()).toBe(true);
    expect(breaker.getState().state).toBe("depleted");
  });

  test("recordSuccess 复位为 closed 并清零计数", () => {
    breaker.recordFailure({ status: 429 });
    breaker.recordFailure({ status: 429 });
    breaker.recordSuccess();
    breaker.recordFailure({ status: 429 });
    breaker.recordFailure({ status: 429 });
    expect(breaker.isOpen()).toBe(false); // 计数已清零，未到阈值
  });

  test("other 错误不推动熔断", () => {
    breaker.recordFailure({ status: 400 });
    breaker.recordFailure({ status: 400 });
    breaker.recordFailure({ status: 400 });
    breaker.recordFailure({ status: 400 });
    expect(breaker.isOpen()).toBe(false);
  });
});

describe("gateBeforeCreate", () => {
  test("closed → 直接放行", async () => {
    await expect(breaker.gateBeforeCreate()).resolves.toBeUndefined();
  });

  test("depleted → 立即抛 LLMDepletedError", async () => {
    breaker.recordFailure({ message: "insufficient balance" });
    await expect(breaker.gateBeforeCreate()).rejects.toBeInstanceOf(breaker.LLMDepletedError);
  });

  test("open 且未恢复 → 等待预算用尽后抛 LLMOverloadError", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure({ status: 429 });
    expect(breaker.isOpen()).toBe(true);
    await expect(breaker.gateBeforeCreate()).rejects.toBeInstanceOf(breaker.LLMOverloadError);
  });

  test("open 期间被 recordSuccess 恢复 → gate 放行", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure({ status: 429 });
    const gatePromise = breaker.gateBeforeCreate();
    // 模拟后台探活成功
    setTimeout(() => breaker.recordSuccess(), 10);
    await expect(gatePromise).resolves.toBeUndefined();
  });

  test("isProbe 跳过 gate（避免探活死锁）", async () => {
    breaker.recordFailure({ message: "insufficient balance" });
    await expect(breaker.gateBeforeCreate({ isProbe: true })).resolves.toBeUndefined();
  });
});
