import React, { useState, useEffect, useCallback } from "react";
import { FileText, Download, RefreshCw, Loader2, Copy, CheckCircle, Presentation } from "lucide-react";
import api from "../services/api";
import OnePagerModal from "./OnePagerModal";

export default function IMemoTab({ taskId }) {
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [imemo, setImemo] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showOnePager, setShowOnePager] = useState(false);

  const fetchIMemo = useCallback(async (regenerate = false) => {
    if (regenerate) setRegenerating(true);
    else setLoading(true);
    setError(null);
    try {
      const url = regenerate
        ? `/api/projects/${taskId}/imemo/regenerate`
        : `/api/projects/${taskId}/imemo`;
      const data = regenerate
        ? await api.post(url, {})
        : await api.get(url);
      setImemo(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchIMemo();
  }, [fetchIMemo]);

  const handleCopy = async () => {
    if (!imemo?.markdown) return;
    try {
      await navigator.clipboard.writeText(imemo.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownload = () => {
    if (!imemo?.markdown) return;
    const blob = new Blob([imemo.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IMemo_${taskId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-3 text-[#4B5A72]">生成投资备忘录...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => fetchIMemo()}
          className="px-4 py-2 bg-[#EEF1F7] hover:bg-[#E5E9F4] rounded-lg text-sm"
        >
          重试
        </button>
      </div>
    );
  }

  if (!imemo) return null;

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center justify-between p-3 bg-white border border-[#D8DCE8] rounded-xl">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-[#4B5A72]">
            生成于 {imemo.generated_at ? new Date(imemo.generated_at).toLocaleString("zh-CN") : "—"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-sm bg-[#EEF1F7] hover:bg-[#E5E9F4] rounded-lg flex items-center gap-1.5 transition-colors"
          >
            {copied ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? "已复制" : "复制 Markdown"}
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 text-sm bg-[#EEF1F7] hover:bg-[#E5E9F4] rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-4 h-4" />
            下载 .md
          </button>
          <button
            onClick={() => setShowOnePager(true)}
            className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 rounded-lg flex items-center gap-1.5 transition-colors text-white"
            title="结合多 Agent 分析与公开资料生成一页投资亮点 PPT"
          >
            <Presentation className="w-4 h-4" />
            生成一页亮点 PPT
          </button>
          <button
            onClick={() => fetchIMemo(true)}
            disabled={regenerating}
            className="px-3 py-1.5 text-sm bg-[#E5E9F4] hover:bg-slate-600 disabled:opacity-50 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            {regenerating
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />
            }
            重新生成
          </button>
        </div>
      </div>

      {showOnePager && (
        <OnePagerModal taskId={taskId} onClose={() => setShowOnePager(false)} />
      )}

      {/* Markdown 内容展示 */}
      <div className="bg-white border border-[#D8DCE8] rounded-xl p-6">
        <div className="prose prose-invert prose-sm max-w-none
          prose-headings:text-[#0D2145] prose-headings:font-semibold
          prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
          prose-p:text-[#0F1C36] prose-p:leading-relaxed
          prose-strong:text-[#0F1C36]
          prose-ul:text-[#0F1C36] prose-li:text-[#0F1C36]
          prose-table:text-[#0F1C36]
          prose-th:text-[#0F1C36] prose-th:font-semibold
          prose-td:text-[#0F1C36]
          prose-blockquote:text-[#4B5A72] prose-blockquote:border-slate-600
          prose-hr:border-[#D8DCE8]
          prose-code:text-blue-300 prose-code:bg-[#EEF1F7]">
          <IMemoMarkdownRenderer markdown={imemo.markdown} />
        </div>
      </div>
    </div>
  );
}

/**
 * 简单的 Markdown 渲染器（无依赖，处理常见格式）
 */
function IMemoMarkdownRenderer({ markdown }) {
  if (!markdown) return null;

  const lines = markdown.split("\n");
  const elements = [];
  let tableBuffer = [];
  let inTable = false;
  let key = 0;

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      tableBuffer.forEach(l => elements.push(<p key={key++} className="text-[#0F1C36] my-1">{l}</p>));
      tableBuffer = [];
      inTable = false;
      return;
    }
    const headers = tableBuffer[0].split("|").filter(h => h.trim()).map(h => h.trim());
    const rows = tableBuffer.slice(2).map(r => r.split("|").filter(c => c.trim()).map(c => c.trim()));
    elements.push(
      <div key={key++} className="overflow-x-auto my-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#D8DCE8]">
              {headers.map((h, i) => (
                <th key={i} className="text-left px-3 py-2 text-[#0F1C36] font-semibold">{renderInline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-[#EEF1F7] hover:bg-[#EEF1F7]">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-[#4B5A72]">{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableBuffer = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table detection
    if (line.includes("|")) {
      inTable = true;
      tableBuffer.push(line);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (line.startsWith("# ")) {
      elements.push(<h1 key={key++} className="text-xl font-bold text-[#0D2145] mt-6 mb-3">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={key++} className="text-lg font-semibold text-[#0D2145] mt-5 mb-2 border-b border-[#EEF1F7] pb-1">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={key++} className="text-base font-semibold text-[#0F1C36] mt-4 mb-1.5">{line.slice(4)}</h3>);
    } else if (line.startsWith("---")) {
      elements.push(<hr key={key++} className="border-[#EEF1F7] my-4" />);
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={key++} className="border-l-4 border-slate-600 pl-4 my-2 text-[#4B5A72] italic text-sm">
          {renderInline(line.slice(2))}
        </blockquote>
      );
    } else if (line.match(/^(\d+)\. /)) {
      elements.push(
        <p key={key++} className="text-[#0F1C36] text-sm my-1 pl-2">{renderInline(line)}</p>
      );
    } else if (line.startsWith("- ")) {
      elements.push(
        <p key={key++} className="text-[#0F1C36] text-sm my-0.5 pl-2">• {renderInline(line.slice(2))}</p>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(
        <p key={key++} className="text-[#0F1C36] text-sm my-1 leading-relaxed">{renderInline(line)}</p>
      );
    }
  }

  if (inTable) flushTable();

  return <div>{elements}</div>;
}

function renderInline(text) {
  if (!text) return text;
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-[#0F1C36] font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
