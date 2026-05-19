const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const config = require("../config");

function checkPythonDeps() {
  if (config.docServiceUrl) return;

  const probe = spawn("python3", [
    "-c",
    "import fitz, pptx, rapidocr_onnxruntime, numpy, PIL",
  ]);
  let stderr = "";

  probe.stderr.on("data", (data) => {
    stderr += data;
  });

  probe.on("close", (code) => {
    if (code === 0) return;

    console.warn("\n[启动自检] 本地 Python 文档提取依赖缺失，PDF/PPT/DOC 上传将失败。");
    console.warn("  解决方案: 运行 `npm run install:python`，或在 .env 中设置 DOC_SERVICE_URL 走远程提取微服务。");
    if (stderr) console.warn("  详情:", stderr.trim().split("\n").pop());
    console.warn("");
  });

  probe.on("error", () => {
    console.warn("\n[启动自检] 未找到 python3，PDF/PPT/DOC 提取不可用。请安装 Python 3.10+ 或配置 DOC_SERVICE_URL。\n");
  });
}

function bootDocServiceIfLocal({ isShuttingDown = () => false } = {}) {
  const url = config.docServiceUrl || "";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1):8001\/?$/.test(url);
  let child = null;

  function spawnDocService() {
    const docDir = path.join(__dirname, "..", "..", "doc-service");
    if (!fs.existsSync(path.join(docDir, "main.py"))) {
      console.warn(`[doc-service] 未找到 ${docDir}/main.py, 跳过自启`);
      return;
    }

    console.log("[doc-service] 自启 uvicorn 子进程 ...");
    child = spawn(
      "python3",
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"],
      { cwd: docDir, stdio: ["ignore", "pipe", "pipe"], env: process.env }
    );

    child.stdout.on("data", (data) => process.stdout.write(`[doc-service] ${data}`));
    child.stderr.on("data", (data) => process.stderr.write(`[doc-service] ${data}`));
    child.on("error", (err) => {
      console.error(
        `[doc-service] 启动失败: ${err.message}\n` +
        "  这会导致投决速览/竞品矩阵/IC 问题清单/xlsx/docx 产出全部不可用.\n" +
        "  解决: 安装 Python 3.10+ 并执行 npm run install:doc-service"
      );
    });
    child.on("exit", (code, signal) => {
      child = null;
      if (!isShuttingDown()) {
        console.warn(`[doc-service] 子进程退出 (code=${code}, signal=${signal})`);
      }
    });
  }

  if (isLocal) {
    const baseUrl = url.replace(/\/$/, "");
    const probeReq = http.get(`${baseUrl}/health`, { timeout: 1500 }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        console.log("[doc-service] 已检测到 8001 端口在运行, 跳过自启");
      } else {
        spawnDocService();
      }
    });

    probeReq.on("timeout", () => {
      probeReq.destroy(new Error("timeout"));
    });
    probeReq.on("error", () => {
      spawnDocService();
    });
  }

  return {
    getChild: () => child,
    stop() {
      if (child && !child.killed) {
        child.kill("SIGTERM");
      }
    },
  };
}

module.exports = {
  checkPythonDeps,
  bootDocServiceIfLocal,
};
