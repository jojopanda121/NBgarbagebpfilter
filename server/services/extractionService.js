// ============================================================
// server/services/extractionService.js — 文档提取服务
// 支持两种模式：
//   1. 本地 Python 子进程（兼容模式）
//   2. 远程 FastAPI 微服务（推荐生产模式）
// ============================================================

const path = require("path");
const { spawn } = require("child_process");
const config = require("../config");

/**
 * 提取文档文本
 * 优先使用远程微服务，降级为本地 Python 子进程
 */
async function extractDocText(filePath, mode) {
  if (config.docServiceUrl) {
    return extractViaService(filePath, mode);
  }
  return extractViaSubprocess(filePath, mode);
}

/** 通过远程 FastAPI 微服务提取 */
async function extractViaService(filePath, mode) {
  const fs = require("fs");
  const formData = new FormData();
  formData.append("file", new Blob([fs.readFileSync(filePath)]), `document.${mode}`);
  formData.append("mode", mode);

  const resp = await fetch(`${config.docServiceUrl}/extract`, {
    method: "POST",
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`文档提取服务错误: ${err}`);
  }

  const result = await resp.json();
  return result.text;
}

/** 通过本地 Python 子进程提取（兼容模式） */
function extractViaSubprocess(filePath, mode) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "..", "..", "scripts", "extract_doc.py");
    const HARD_TIMEOUT_MS = 120_000;
    const proc = spawn("python3", [scriptPath, filePath, mode], {
      timeout: HARD_TIMEOUT_MS, // node 内置超时（会发送 SIGTERM）
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const MAX_BYTES = 30 * 1024 * 1024;
    let settled = false;

    const cleanup = () => {
      try { proc.kill("SIGKILL"); } catch (_) { /* ignore */ }
      try { proc.stdin.destroy(); } catch (_) { /* ignore */ }
    };

    const finish = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      cleanup();
      fn(...args);
    };

    const safeResolve = finish(resolve);
    const safeReject = finish(reject);

    // 双保险硬超时（防止 node timeout 配合 SIGTERM 失效）
    const killTimer = setTimeout(() => {
      safeReject(new Error("python 子进程超时"));
    }, HARD_TIMEOUT_MS + 5000);
    killTimer.unref();

    proc.stdout.on("data", (d) => {
      stdoutBytes += d.length;
      if (stdoutBytes > MAX_BYTES) return safeReject(new Error("python 输出超过 30MB 上限"));
      stdout += d;
    });
    proc.stderr.on("data", (d) => {
      stderrBytes += d.length;
      if (stderrBytes > MAX_BYTES) return safeReject(new Error("python 错误输出超过 30MB 上限"));
      stderr += d;
    });
    proc.on("close", (code) => {
      if (code !== 0) return safeReject(new Error(stderr || `python 退出码 ${code}`));
      safeResolve(stdout.trim());
    });
    proc.on("error", (err) => safeReject(err));
  });
}

module.exports = { extractDocText };
