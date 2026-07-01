// AttachmentList — 展示帖子/评论附件（图片网格 + 文档下载链接）
// 仅登录用户可见（后端 getPostDetail 仅对登录返回 attachments）。
import React, { useState } from "react";
import { FileText, Download } from "lucide-react";
import { formatBytes } from "./AttachmentUploader";

function ImageLightbox({ src, alt, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <img src={src} alt={alt} className="max-h-[90vh] max-w-full rounded-lg" />
    </div>
  );
}

export default function AttachmentList({ attachments = [], compact = false }) {
  const [preview, setPreview] = useState(null);
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  const imgSize = compact ? "w-20 h-20" : "w-28 h-28";

  return (
    <div className={compact ? "space-y-2" : "space-y-3 mt-3"}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <button key={a.url} type="button" onClick={() => setPreview(a)} className="block">
              <img src={a.url} alt={a.name} loading="lazy"
                className={`${imgSize} object-cover rounded-lg border border-[#D8DCE8] hover:opacity-90`} />
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((a) => (
            <a key={a.url} href={a.url} download={a.name} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-xs bg-white border border-[#D8DCE8] rounded-lg px-3 py-2 hover:border-[#1B4FD8] group max-w-md">
              <FileText className="w-4 h-4 text-[#1B4FD8] shrink-0" />
              <span className="text-[#0D2145] truncate flex-1">{a.name}</span>
              <span className="text-[#8E9BB0]">{formatBytes(a.size)}</span>
              <Download className="w-3.5 h-3.5 text-[#8E9BB0] group-hover:text-[#1B4FD8]" />
            </a>
          ))}
        </div>
      )}

      {preview && <ImageLightbox src={preview.url} alt={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}
