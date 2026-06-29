// 分析并发闸：全局并发上限 + FIFO 排队 + 队满判定
// require 前设定并发=1、队列上限=2，便于断言排队行为。
process.env.ANALYSIS_MAX_CONCURRENCY = "1";
process.env.ANALYSIS_MAX_QUEUE = "2";
process.env.ANALYSIS_MAX_QUEUE_WAIT_MS = "1"; // 1ms：排队任务在 _tick() 时即判超时（注意 0 会被 || 当默认值）

jest.mock("../services/taskService", () => ({ updateTask: jest.fn() }));

const queue = require("../services/analysisQueue");

const flush = async () => {
  // 多刷几轮 microtask/macrotask，确保 p-limit 调度落地
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
};

afterEach(() => queue._reset());

test("并发上限=1 时严格串行，按 FIFO 启动", async () => {
  const started = [];
  const resolvers = {};
  let active = 0;
  let maxActive = 0;

  const makeJob = (label) => () =>
    new Promise((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(label);
      resolvers[label] = () => { active -= 1; resolve(); };
    });

  queue.submit("t1", makeJob("t1"));
  queue.submit("t2", makeJob("t2"));
  queue.submit("t3", makeJob("t3"));

  await flush();
  // 只有 t1 开跑，t2/t3 在排队
  expect(started).toEqual(["t1"]);
  expect(queue.depth()).toBe(2);

  resolvers["t1"]();
  await flush();
  expect(started).toEqual(["t1", "t2"]);
  expect(queue.depth()).toBe(1);

  resolvers["t2"]();
  await flush();
  expect(started).toEqual(["t1", "t2", "t3"]);

  resolvers["t3"]();
  await flush();
  expect(maxActive).toBe(1); // 全程并发从未超过 1
});

test("isQueueFull：排队数达到上限即为满", async () => {
  const hold = {};
  const makeJob = (label) => () => new Promise((resolve) => { hold[label] = resolve; });

  expect(queue.isQueueFull()).toBe(false);
  queue.submit("a", makeJob("a")); // 立即拿槽开跑
  queue.submit("b", makeJob("b")); // 排队
  queue.submit("c", makeJob("c")); // 排队
  await flush();
  // 等待中的有 b、c 两个，达到 MAX_QUEUE=2 → 满
  expect(queue.depth()).toBe(2);
  expect(queue.isQueueFull()).toBe(true);

  // 收尾，避免悬挂
  hold["a"](); hold["b"] && hold["b"](); hold["c"] && hold["c"]();
  await flush();
});

test("排队超时触发 onTimeout，且被取消的任务不会再执行 runJob", async () => {
  const ran = [];
  const onTimeout = jest.fn();

  // 先占住唯一的槽，让后续任务卡在排队
  let releaseBlocker;
  queue.submit("blocker", () => new Promise((r) => { releaseBlocker = r; }));
  queue.submit("late", () => { ran.push("late"); return Promise.resolve(); }, { onTimeout });

  await flush(); // blocker 拿到槽开跑，late 进入排队

  // 让排队时长明显 > 0，再手动驱动一次 ticker（MAX_QUEUE_WAIT_MS=0 → 立即判超时）
  await new Promise((r) => setTimeout(r, 5));
  queue._tick();
  expect(onTimeout).toHaveBeenCalledWith("late");

  // 释放 blocker，让槽空出；被取消的 late 不应执行 runJob
  releaseBlocker();
  await flush();
  expect(ran).not.toContain("late");
});
