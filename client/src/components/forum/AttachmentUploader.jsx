// AttachmentUploader — 论坛附件上传（图片 + 文档）
// 受控组件：value 为附件数组 [{url,kind,name,mime,size}]，onChange 回传新数组。
// 客户端先做数量/大小/类型校验给即时反馈；服务端 magic 校验兜底。
import React, { useRef, useState } from "react";
import { ImagePlus, Paperclip, X, Loader2, FileText } from "lucide-react";
import forumApi from "../../services/forumApi";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const FILE_EXTS = ["pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx"];
const IMAGE_MAX = 5 * 1024 * 1024; // 5MB
const FILE_MAX = 20 * 1024 * 1024; // 20MB

export function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

// scope: 'post'(9图+3文档) | 'comment'(1图)
export default function AttachmentUploader({
  value = [],
  onChange,
  scope = "post",
  disabled = false,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const commentMode = scope === "comment";
  const maxImages = commentMode ? 1 : 9;
  const maxFiles = commentMode ? 0 : 3;
  const accept = commentMode
    ? IMAGE_EXTS.map((e) => `.${e}`).join(",")
    : [...IMAGE_EXTS, ...FILE_EXTS].map((e) => `.${e}`).join(",");

  const images = value.filter((a) => a.kind === "image");
  const files = value.filter((a) => a.kind === "file");

  async function handleSelect(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // 允许重复选同一文件
    if (picked.length === 0) return;
    setError("");

    let imgCount = images.length;
    let fileCount = files.length;
    const next = [...value];

    setUploading(true);
    try {
      for (const file of picked) {
        const ext = extOf(file.name);
        const isImage = IMAGE_EXTS.includes(ext);
        const isFile = FILE_EXTS.includes(ext);
        if (!isImage && !isFile) {
          setError(`不支持的类型：${file.name}`);
          continue;
        }
        if (commentMode && !isImage) {
          setError("评论仅支持图片");
          continue;
        }
        if (isImage && file.size > IMAGE_MAX) {
          setError(`图片超过 5MB：${file.name}`);
          continue;
        }
        if (isFile && file.size > FILE_MAX) {
          setError(`文档超过 20MB：${file.name}`);
          continue;
        }
        if (isImage && imgCount >= maxImages) {
          setError(`最多 ${maxImages} 张图片`);
          continue;
        }
        if (isFile && fileCount >= maxFiles) {
          setError(`最多 ${maxFiles} 个文档`);
          continue;
        }

        try {
          const att = await forumApi.uploadAttachment(file);
          next.push(att);
          if (att.kind === "image") imgCount += 1;
          else fileCount += 1;
        } catch (uErr) {
          setError(uErr.message || `上传失败：${file.name}`);
        }
      }
      onChange?.(next);
    } finally {
      setUploading(false);
    }
  }

  function remove(url) {
    onChange?.(value.filter((a) => a.url !== url));
  }

  const canAddImage = images.length < maxImages;
  const canAddFile = !commentMode && files.length < maxFiles;
  const canAdd = (canAddImage || canAddFile) && !disabled && !uploading;

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={!commentMode}
        className="hidden"
        onChange={handleSelect}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canAdd}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-[#D8DCE8] text-[#4B5A72] hover:border-[#1B4FD8] hover:text-[#1B4FD8] disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : commentMode ? (
            <ImagePlus className="w-4 h-4" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
          {commentMode ? "图片" : "图片 / 文档"}
        </button>
        {!commentMode && (
          <span className="text-[11px] text-[#8E9BB0]">
            最多 9 张图 + 3 个文档，图≤5MB / 文档≤20MB
          </span>
        )}
      </div>

      {error && <div className="text-[11px] text-rose-600">{error}</div>}

      {/* 图片缩略 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <div key={a.url} className="relative group">
              <img
                src={a.url}
                alt={a.name}
                className="w-16 h-16 object-cover rounded-lg border border-[#D8DCE8]"
              />
              <button
                type="button"
                onClick={() => remove(a.url)}
                className="absolute -top-1.5 -right-1.5 bg-[#0F1C36] text-white rounded-full p-0.5 opacity-90 hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 文档 chip */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((a) => (
            <div
              key={a.url}
              className="flex items-center gap-2 text-xs bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg px-2.5 py-1.5"
            >
              <FileText className="w-4 h-4 text-[#1B4FD8] shrink-0" />
              <span className="text-[#0D2145] truncate flex-1">{a.name}</span>
              <span className="text-[#8E9BB0]">{formatBytes(a.size)}</span>
              <button
                type="button"
                onClick={() => remove(a.url)}
                className="text-[#8E9BB0] hover:text-rose-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
