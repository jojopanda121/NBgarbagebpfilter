// ============================================================
// server/skills/index.js — Skill barrel
// 在服务器启动时被 require,自动注册所有内置 skill。
// ============================================================

const registry = require("./registry");

const builtins = [
  require("./onepagerPptx"),
  require("./ddQuestions"),
  require("./icMemo"),
  require("./riskRegister"),
  require("./teaserGenerate"),
  require("./teaserShare"),
];

let _initialized = false;

function init() {
  if (_initialized) return;
  for (const s of builtins) registry.register(s);
  _initialized = true;
}

module.exports = { init, registry };
