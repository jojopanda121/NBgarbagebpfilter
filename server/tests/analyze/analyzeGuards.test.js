// ============================================================
// tests/analyze/analyzeGuards.test.js
// 上传防护（magic number）/ 在途任务登记 / 评分缺失标记 回归测试
// ============================================================

const fs = require("fs");
const os = require("os");
const path = require("path");

const { verifyFileMagic, computeFileHash } = require("../../controllers/analyzeController");
const inflightTasks = require("../../runtime/inflightTasks");
const { scoreProject } = require("../../scoring");
const { PIPELINE_VERSION } = require("../../config/versions");

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `bpf-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(p, content);
  return p;
}

describe("verifyFileMagic", () => {
  const created = [];
  afterAll(() => { for (const p of created) try { fs.unlinkSync(p); } catch {} });

  test("accepts real PDF header", async () => {
    const p = tmpFile(Buffer.from("%PDF-1.7\nfake body"));
    created.push(p);
    await expect(verifyFileMagic(p, "pdf")).resolves.toBe(true);
  });

  test("accepts real PPTX (ZIP) header", async () => {
    const p = tmpFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
    created.push(p);
    await expect(verifyFileMagic(p, "pptx")).resolves.toBe(true);
  });

  test("rejects renamed non-PDF content", async () => {
    const p = tmpFile(Buffer.from("MZ\x90\x00 definitely-not-a-pdf"));
    created.push(p);
    await expect(verifyFileMagic(p, "pdf")).resolves.toBe(false);
  });

  test("rejects PDF content claiming to be pptx (cross-format swap)", async () => {
    const p = tmpFile(Buffer.from("%PDF-1.7\n"));
    created.push(p);
    await expect(verifyFileMagic(p, "pptx")).resolves.toBe(false);
  });

  test("rejects files shorter than 4 bytes", async () => {
    const p = tmpFile(Buffer.from("PK"));
    created.push(p);
    await expect(verifyFileMagic(p, "pptx")).resolves.toBe(false);
  });
});

describe("computeFileHash (streaming)", () => {
  test("matches known sha256", async () => {
    const p = tmpFile("hello");
    const hash = await computeFileHash(p);
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    fs.unlinkSync(p);
  });
});

describe("inflightTasks", () => {
  test("register/unregister tracks count", () => {
    expect(inflightTasks.count()).toBe(0);
    inflightTasks.register("t1");
    inflightTasks.register("t2");
    expect(inflightTasks.count()).toBe(2);
    inflightTasks.unregister("t1");
    expect(inflightTasks.count()).toBe(1);
    inflightTasks.unregister("t2");
  });

  test("waitForDrain resolves true when empty", async () => {
    await expect(inflightTasks.waitForDrain(100, 10)).resolves.toBe(true);
  });

  test("waitForDrain resolves false on timeout with pending task", async () => {
    inflightTasks.register("stuck");
    await expect(inflightTasks.waitForDrain(60, 10)).resolves.toBe(false);
    inflightTasks.unregister("stuck");
  });
});

describe("scoring TAM_missing 标记", () => {
  test("TAM 缺失时 timing_ceiling.inputs 标记 TAM_missing", () => {
    const r = scoreProject({ CAGR: 10, claim_verdicts: [] }, { modeOverride: "off" });
    expect(r.dimensions.timing_ceiling.inputs.TAM_missing).toBe(true);
  });

  test("TAM 存在时不标记", () => {
    const r = scoreProject({ TAM_Million_RMB: 5000, CAGR: 10, claim_verdicts: [] }, { modeOverride: "off" });
    expect(r.dimensions.timing_ceiling.inputs.TAM_missing).toBeUndefined();
  });

  test("全部声明证伪时总分不被 S5 默认值抬高（回归）", () => {
    const verdicts = [{ verdict: "证伪" }, { verdict: "证伪" }];
    const r = scoreProject({ TAM_Million_RMB: 1000, CAGR: 0, claim_verdicts: verdicts }, { modeOverride: "off" });
    expect(r.dimensions.external_risk.score).toBe(0);
  });
});

describe("pipeline 版本号", () => {
  test("PIPELINE_VERSION 为非空字符串", () => {
    expect(typeof PIPELINE_VERSION).toBe("string");
    expect(PIPELINE_VERSION.length).toBeGreaterThan(0);
  });
});
