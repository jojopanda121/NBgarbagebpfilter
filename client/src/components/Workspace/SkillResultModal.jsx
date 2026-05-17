// ============================================================
// SkillResultModal — skill 产物展示
// kind=pptx/docx/xlsx/image → 提供下载按钮
// kind=json → 渲染结构化数据(根据 schema 简单分支)
// kind=link → 显示 teaser 分享链接 + 密码(由专门的 modal 处理,这里兜底)
// ============================================================

import React, { useEffect, useState } from "react";
import { downloadBase64File } from "../../utils/downloadFile";
import api from "../../services/api";

const DOWNLOADABLE_KINDS = new Set([
  "pptx", "docx", "xlsx",
  "generated_pptx", "generated_docx", "generated_xlsx", "generated_image",
]);

export default function SkillResultModal({ skill, runId, artifact, projectId, onClose }) {
  const canDownload = isDownloadableArtifact(artifact);

  const handleDownload = () => {
    if (!artifact) return;
    if (artifact.bufferBase64) {
      downloadBase64File(artifact.bufferBase64, artifact.filename, artifact.mimeType || artifact.mime_type);
      return;
    }
    const artifactId = artifact.workspaceArtifactId || artifact.workspace_artifact_id || artifact.id;
    if (!artifactId || !projectId) return;
    api.downloadBlob(
      `/api/workspace-projects/${projectId}/conversation/artifacts/${artifactId}/download`,
      artifact.filename || "artifact"
    ).catch((err) => alert("下载失败：" + err.message));
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#EEF1F7]">
          <div>
            <div className="text-sm font-medium text-[#0D2145]">{skill.title}</div>
            <div className="text-xs text-[#8E9BB0]">runId: {runId}</div>
          </div>
          <button onClick={onClose} className="text-[#8E9BB0] hover:text-[#0F1C36] text-xl">×</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Body artifact={artifact} />
        </div>

        <footer className="px-5 py-3 border-t border-[#EEF1F7] flex justify-end gap-2">
          {canDownload && (
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
            >
              下载文件
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-[#EEF1F7] text-[#0F1C36] hover:bg-[#F6F7FA]"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

function Body({ artifact }) {
  if (!artifact) return <div className="text-sm text-[#8E9BB0]">无产物</div>;

  if (isDownloadableArtifact(artifact)) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-[#0F1C36]">
          已生成: <code className="text-xs bg-[#F6F7FA] px-1.5 py-0.5 rounded">{artifact.filename}</code>
        </div>
        <div className="text-xs text-[#8E9BB0]">
          {artifact.summary} · {Math.round(((artifact.sizeBytes ?? artifact.size_bytes) || 0) / 1024)} KB
          {artifact.searchUsed && " · 检索增强"}
        </div>
        {isImageArtifact(artifact) && artifact.previewUrl && (
          <ImagePreview url={artifact.previewUrl} alt={artifact.filename} />
        )}
        {artifact.payload && <JsonPreview value={artifact.payload} />}
      </div>
    );
  }

  if (artifact.kind === "json") {
    return (
      <div className="space-y-3">
        <div className="text-sm text-[#0F1C36]">{artifact.summary}</div>
        <JsonPreview value={artifact.payload} />
      </div>
    );
  }

  if (artifact.kind === "link") {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-[#0F1C36]">{artifact.summary}</div>
        <div className="text-xs text-[#8E9BB0]">链接已生成,请在分享面板里查看密码与撤销选项。</div>
        <pre className="bg-[#F6F7FA] rounded p-2 text-xs overflow-x-auto">
{JSON.stringify(artifact.payload, null, 2)}
        </pre>
      </div>
    );
  }

  return <JsonPreview value={artifact} />;
}

function isDownloadableArtifact(artifact) {
  if (!artifact) return false;
  if (DOWNLOADABLE_KINDS.has(artifact.kind)) return true;
  const mime = artifact.mimeType || artifact.mime_type || "";
  return Boolean(artifact.bufferBase64 || mime.includes("officedocument") || mime.startsWith("image/"));
}

function isImageArtifact(artifact) {
  const mime = artifact?.mimeType || artifact?.mime_type || "";
  return artifact?.kind === "generated_image" || mime.startsWith("image/");
}

function ImagePreview({ url, alt }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    api.getBlob(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!src) return null;
  return (
    <div className="overflow-hidden rounded border border-[#EEF1F7] bg-[#F7F8FC]">
      <img src={src} alt={alt || "图片预览"} className="block w-full object-contain" />
    </div>
  );
}

function JsonPreview({ value }) {
  return (
    <pre className="bg-[#F6F7FA] rounded p-3 text-xs leading-relaxed text-[#0F1C36] overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(value, null, 2)}
    </pre>
  );
}
