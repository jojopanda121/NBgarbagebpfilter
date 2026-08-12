/** @type {import('jest').Config} */
// 真实供应商 API 测试 — 与另外两档的区别：
//   jest.config.js             单元测试，全 mock，不联网，CI 必跑
//   jest.integration.config.js DB/路由集成，真 SQLite，不联网，CI 可跑
//   jest.live.config.js        ← 本文件：真的调用 DeepSeek / 博查
//
// 这一档**会花钱、会走公网**，所以：
//   - 不进 CI 默认流程（package.json 里是独立的 test:live）
//   - 没配 key 时整个文件自动 skip，不会失败
//   - 不 stub dotenv：直接读项目根 .env，跑之前不用手动 export
//
// 用途：DeepSeek 改了行为（响应形状、思考策略、参数校验）时立刻暴露，
// 而不是等线上出事。单元测试用的是我们自己写的 fixture，测不出这类漂移。
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/live/**/*.live.test.js"],
  clearMocks: true,
  maxWorkers: 1,          // 串行，避免并发打爆供应商限流
  testTimeout: 180000,    // pro 开思考实测可达 40s，留足余量
};
