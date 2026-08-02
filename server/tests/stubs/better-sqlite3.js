// Stub for better-sqlite3 — unit tests mock db/agentRunService directly
class Database {
  constructor() {}
  prepare() { return { run: jest.fn(), get: jest.fn(), all: jest.fn(() => []) }; }
  exec() {}
  pragma() {}
  transaction(fn) { return fn; }
  close() {}
}
module.exports = Database;
