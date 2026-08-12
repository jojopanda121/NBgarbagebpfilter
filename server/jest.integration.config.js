/** @type {import('jest').Config} */
// P1-2: 集成测试配置 — 与单测(jest.config.js)的关键区别：
//   1. 不 mock better-sqlite3：用真 SQLite :memory: 跑全部迁移（迁移体系首次进入自动化验证）
//   2. 仍 stub dotenv：不读开发机 .env，保持环境封闭可复现
//   3. 只收 tests/integration/**/*.int.test.js
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/integration/**/*.int.test.js"],
  moduleNameMapper: {
    "^dotenv$": "<rootDir>/tests/stubs/dotenv.js",
  },
  clearMocks: true,
  // :memory: 库随进程共享，串行执行避免跨文件干扰
  maxWorkers: 1,
};
