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
  const formData = new (require("undici").FormData)();
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
    const proc = spawn("python3", [scriptPath, filePath, mode], {
      timeout: 120_000,
      maxBuffer: 30 * 1024 * 1024,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `python 退出码 ${code}`));
      resolve(stdout.trim());
    });
    proc.on("error", reject);
  });
}

module.exports = { extractDocText };
