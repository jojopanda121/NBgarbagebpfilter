/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  // 同时收录 tests/ 与 __tests__/（后者曾被遗漏，导致其中的评分测试
  // 长期不执行、把 bug 固化成了"预期行为"）
  testMatch: ["**/tests/**/*.test.js", "**/__tests__/**/*.test.js"],
  moduleNameMapper: {
    // Stub native / large deps that don't run in unit-test environment
    "^@anthropic-ai/sdk$": "<rootDir>/tests/__mocks__/@anthropic-ai/sdk.js",
    "^better-sqlite3$":    "<rootDir>/tests/__mocks__/better-sqlite3.js",
    "^dotenv$":            "<rootDir>/tests/__mocks__/dotenv.js",
  },
  clearMocks: true,
};
