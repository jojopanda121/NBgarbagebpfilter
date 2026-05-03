/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  moduleNameMapper: {
    // Stub native / large deps that don't run in unit-test environment
    "^@anthropic-ai/sdk$": "<rootDir>/tests/__mocks__/@anthropic-ai/sdk.js",
    "^better-sqlite3$":    "<rootDir>/tests/__mocks__/better-sqlite3.js",
    "^dotenv$":            "<rootDir>/tests/__mocks__/dotenv.js",
  },
  clearMocks: true,
};
