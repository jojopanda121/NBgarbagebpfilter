/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  // 同时收录 tests/ 与 __tests__/（后者曾被遗漏，导致其中的评分测试
  // 长期不执行、把 bug 固化成了"预期行为"）
  testMatch: ["**/tests/**/*.test.js", "**/__tests__/**/*.test.js"],
  // 集成测试用真 sqlite，走 jest.integration.config.js（npm run test:integration）
  testPathIgnorePatterns: ["/node_modules/", "/tests/integration/"],
  moduleNameMapper: {
    // Stub native / large deps that don't run in unit-test environment
    "^better-sqlite3$":    "<rootDir>/tests/stubs/better-sqlite3.js",
    "^dotenv$":            "<rootDir>/tests/stubs/dotenv.js",
  },
  clearMocks: true,
};
