// ============================================================
// server/utils/fileMagic.js — 上传文件内容(magic-byte)校验
//
// 仅看扩展名/MIME 容易被伪造（把 .exe 改名 .png 照样过 fileFilter），
// 这里读文件头若干字节核对真实类型，挡掉「换皮」文件。
// 覆盖论坛允许的图片 + 文档类型；未知扩展一律拒绝。
// ============================================================

const fs = require("fs");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const FILE_EXTS = new Set([".pdf", ".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx"]);

// 扩展名 → 'image' | 'file'（未知返回 null）
function kindForExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (FILE_EXTS.has(e)) return "file";
  return null;
}

function readHead(filePath, n = 16) {
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(n);
    const read = fs.readSync(fd, head, 0, n, 0);
    return head.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

// OOXML（docx/xlsx/pptx）与 zip 一样以 PK\x03\x04 开头
function isZipContainer(head) {
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

// 老版 Office（doc/xls/ppt）是 OLE 复合文档：D0 CF 11 E0 A1 B1 1A E1
function isOleDoc(head) {
  return (
    head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 &&
    head[4] === 0xa1 && head[5] === 0xb1 && head[6] === 0x1a && head[7] === 0xe1
  );
}

// 核对文件头与扩展名是否一致。返回 true = 内容可信。
function isValidMagic(filePath, ext) {
  const e = String(ext || "").toLowerCase();
  let head;
  try {
    head = readHead(filePath, 16);
  } catch {
    return false;
  }
  if (head.length < 4) return false;

  switch (e) {
    case ".png":
      return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    case ".jpg":
    case ".jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case ".gif": {
      const sig = head.subarray(0, 6).toString("ascii");
      return sig === "GIF87a" || sig === "GIF89a";
    }
    case ".webp":
      return (
        head.subarray(0, 4).toString("ascii") === "RIFF" &&
        head.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case ".pdf":
      return head.subarray(0, 4).toString("ascii") === "%PDF";
    case ".docx":
    case ".xlsx":
    case ".pptx":
      return isZipContainer(head);   // OOXML = zip 容器
    case ".doc":
    case ".xls":
    case ".ppt":
      return isOleDoc(head);         // 老版 OLE 复合文档
    default:
      return false;
  }
}

module.exports = { isValidMagic, kindForExt, IMAGE_EXTS, FILE_EXTS };
