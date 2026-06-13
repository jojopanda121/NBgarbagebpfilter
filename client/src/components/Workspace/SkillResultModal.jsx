// ============================================================
// SkillResultModal — skill 产物展示
// kind=pptx → 提供下载按钮
// kind=json → 渲染结构化数据(根据 schema 简单分支)
// kind=link → 显示 teaser 分享链接 + 密码(由专门的 modal 处理,这里兜底)
// ============================================================

import React from "react";
import { downloadBase64File } from "../../utils/downloadFile";

export default function SkillResultModal({ skill, runId, artifact, onClose }) {
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
          {artifact?.kind === "pptx" && artifact.bufferBase64 && (
            <button
              onClick={() => downloadBase64File(artifact.bufferBase64, artifact.filename, artifact.mimeType)}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
            >
              下载 PPT
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

  if (artifact.kind === "pptx") {
    return (
      <div className="space-y-3">
        <div className="text-sm text-[#0F1C36]">
          已生成: <code className="text-xs bg-[#F6F7FA] px-1.5 py-0.5 rounded">{artifact.filename}</code>
        </div>
        <div className="text-xs text-[#8E9BB0]">
          {artifact.summary} · {Math.round((artifact.sizeBytes || 0) / 1024)} KB
          {artifact.searchUsed && " · 检索增强"}
        </div>
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

function JsonPreview({ value }) {
  return (
    <pre className="bg-[#F6F7FA] rounded p-3 text-xs leading-relaxed text-[#0F1C36] overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(value, null, 2)}
    </pre>
  );
}
