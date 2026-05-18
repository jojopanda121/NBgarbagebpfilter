const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "../../../assets/fonts");

// 主源：Google 官方 noto-cjk 仓库；备选：jsdelivr 镜像。仅在本地缺失时下载一次。
const FONT_SOURCES = {
  "NotoSansSC-Regular.otf": [
    "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
  ],
  "NotoSansSC-Bold.otf": [
    "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf",
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf",
  ],
};

let cached = null;
let inflight = null;

async function downloadOne(filename, urls) {
  const dest = path.join(FONT_DIR, filename);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 200) {
    return fs.readFileSync(dest);
  }
  fs.mkdirSync(FONT_DIR, { recursive: true });

  let lastErr;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120 * 1000);
      const resp = await fetch(url, { signal: controller.signal, redirect: "follow" });
      clearTimeout(timer);
      if (!resp.ok) {
        lastErr = new Error(`下载字体失败 ${resp.status}: ${url}`);
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1024 * 200) {
        lastErr = new Error(`字体文件过小（${buf.length} bytes），疑似失败页：${url}`);
        continue;
      }
      fs.writeFileSync(dest, buf);
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `无法获取中文字体 ${filename}。请手动将 OTF 文件放到 ${FONT_DIR}/。最后错误：${lastErr?.message || lastErr}`
  );
}

async function loadFonts() {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const [regular, bold] = await Promise.all([
      downloadOne("NotoSansSC-Regular.otf", FONT_SOURCES["NotoSansSC-Regular.otf"]),
      downloadOne("NotoSansSC-Bold.otf", FONT_SOURCES["NotoSansSC-Bold.otf"]),
    ]);
    cached = [
      { name: "NotoSansSC", data: regular, weight: 400, style: "normal" },
      { name: "NotoSansSC", data: bold, weight: 700, style: "normal" },
    ];
    return cached;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

module.exports = { loadFonts, FONT_DIR };
