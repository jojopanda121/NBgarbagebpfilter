const express = require("express");
const fs = require("fs");
const path = require("path");

const config = require("./config");

function ensureUploadsDir() {
  const uploadsDir = config.uploadsDir;
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function mountUploads(app) {
  const uploadsDir = ensureUploadsDir();
  app.use("/uploads", express.static(uploadsDir));

  // 兼容旧路径：v3.0 以前头像/站点图写到 client/public/uploads，旧 URL 仍在 DB 中。
  const legacyUploadsDir = path.join(__dirname, "..", "client", "public", "uploads");
  if (fs.existsSync(legacyUploadsDir) && legacyUploadsDir !== uploadsDir) {
    app.use("/uploads", express.static(legacyUploadsDir));
  }
}

function mountClientBuild(app) {
  const clientBuildDir = path.join(__dirname, "..", "client", "build");
  if (fs.existsSync(clientBuildDir)) {
    app.use(
      express.static(clientBuildDir, {
        extensions: ["html"],
        setHeaders(res, filePath) {
          if (/\.html$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.includes(`${path.sep}static${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(clientBuildDir, "index.html"));
    });
    return true;
  }

  app.get("*", (_req, res) => {
    res.status(503).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>前端未构建</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.box{text-align:center;padding:2rem;border:1px solid #334155;border-radius:1rem;max-width:480px}h1{color:#f87171}code{background:#1e293b;padding:.2em .5em;border-radius:.3em}</style></head><body><div class="box"><h1>前端尚未构建</h1><p>请执行：<code>npm run build</code></p></div></body></html>`);
  });
  return false;
}

function mountStaticAssets(app) {
  mountUploads(app);
  return mountClientBuild(app);
}

module.exports = {
  mountStaticAssets,
  mountUploads,
  mountClientBuild,
};
