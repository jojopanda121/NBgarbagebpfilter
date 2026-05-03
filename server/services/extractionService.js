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

/** 通过远程 FastAPI 微服务提取（M7: 指数退避重试） */
async function extractViaService(filePath, mode) {
  const fs = require("fs");
  const fileBuf = fs.readFileSync(filePath);

  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 1500;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 每次重试都重建 FormData（fetch 消费过的 body 不能复用）
      const formData = new FormData();
      formData.append("file", new Blob([fileBuf]), `document.${mode}`);
      formData.append("mode", mode);

      // 单次调用 90s 上限，避免 hang 死
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      timer.unref?.();
      let resp;
      try {
        resp = await fetch(`${config.docServiceUrl}/extract`, {
          method: "POST",
          body: formData,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        const errText = await resp.text();
        // 4xx 不重试（一定是文件本身问题）
        if (resp.status >= 400 && resp.status < 500) {
          throw new Error(`文档提取服务拒绝: ${errText}`);
        }
        throw new Error(`文档提取服务错误(${resp.status}): ${errText}`);
      }

      const result = await resp.json();
      return result.text;
    } catch (err) {
      lastErr = err;
      // 4xx 永久错误立即抛出
      if (/拒绝/.test(err.message)) throw err;
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[Extraction] 第 ${attempt} 次失败：${err.message}，${delay}ms 后重试...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr || new Error("文档提取服务不可用");
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
