// ============================================================
// ProjectChat — 项目级聊天面板(WorkspaceProjectPage 的 chat tab)
// 复用 streamProjectChatMessage SSE 客户端
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from "react";
import workspaceProjectApi from "../../services/workspaceProjectApi";
import { streamProjectChatMessage } from "../../services/workspaceStream";
import useAuthStore from "../../store/useAuthStore";
import { API_BASE } from "../../constants";

export default function ProjectChat({ project }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null);     // routing | experts | host | tools
  const abortRef = useRef(null);
  const tailRef = useRef(null);

  const reload = useCallback(async () => {
    try {
      const r = await workspaceProjectApi.getConversationMessages(project.id);
      setMessages(r.messages || []);
    } catch (e) { setError(e.message); }
  }, [project?.id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, phase]);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    setError("");
    setStreaming(true);
    setPhase("routing");

    const ac = new AbortController();
    abortRef.current = ac;

    const updateMsg = (id, mapper) => {
      setMessages((m) => m.map((x) => (x.id === id ? mapper(x) : x)));
    };

    try {
      await streamProjectChatMessage(project.id, input.trim(), (event, data) => {
        if (event === "user_message") {
          setMessages((m) => [...m, { id: data.id, role: "user", content: data.content }]);
          setInput("");
        } else if (event === "phase") {
          setPhase(data.phase);
        } else if (event === "expert" || event === "expert_done") {
          // 主持人侧合并 expert: 同一 id 上后到 expert_done 不再追加新 bubble
          setMessages((m) => {
            if (m.some((x) => x.id === data.id)) return m;
            return [...m, { id: data.id, role: "agent", agent_name: data.agent, content: data.content, error: data.error }];
          });
        } else if (event === "host_start") {
          setMessages((m) => [...m, {
            id: data.id,
            role: "agent",
            agent_name: "host",
            content: "",
            _streaming: true,
            metadata: { run_id: data.run_id, thinking: "", tool_events: [] },
          }]);
        } else if (event === "host_thinking_delta") {
          updateMsg(data.id, (msg) => ({
            ...msg,
            metadata: { ...(msg.metadata || {}), thinking: (msg.metadata?.thinking || "") + (data.delta || "") },
          }));
        } else if (event === "host_text_delta") {
          updateMsg(data.id, (msg) => ({ ...msg, content: (msg.content || "") + (data.delta || "") }));
        } else if (event === "token") {
          // 旧客户端兼容: host_text_delta 已处理, token 不再追加避免重复
        } else if (event === "host_tool_use_start") {
          updateMsg(data.id, (msg) => ({
            ...msg,
            metadata: {
              ...(msg.metadata || {}),
              tool_events: [
                ...((msg.metadata && msg.metadata.tool_events) || []),
                { tool_id: data.tool_id, name: data.name, phase: "started" },
              ],
            },
          }));
        } else if (event === "host_tool_use") {
          updateMsg(data.id, (msg) => ({
            ...msg,
            metadata: {
              ...(msg.metadata || {}),
              tool_events: ((msg.metadata && msg.metadata.tool_events) || []).map((t) =>
                t.tool_id === data.tool_id ? { ...t, input: data.input, phase: "calling" } : t
              ),
            },
          }));
        } else if (event === "host_tool_result") {
          updateMsg(data.id, (msg) => ({
            ...msg,
            metadata: {
              ...(msg.metadata || {}),
              tool_events: ((msg.metadata && msg.metadata.tool_events) || []).map((t) =>
                t.tool_id === data.tool_id
                  ? { ...t, result: data.result, error: !!data.error, phase: data.error ? "error" : "done" }
                  : t
              ),
            },
          }));
        } else if (event === "host_done") {
          updateMsg(data.id, (msg) => ({
            ...msg,
            content: data.content || msg.content,
            _streaming: false,
          }));
        } else if (event === "artifact") {
          setMessages((m) => [...m, {
            id: `art-${Date.now()}`,
            role: "system",
            content: `已生成 ${data.summary || data.filename || "产物"}`,
            metadata: { artifact: data },
          }]);
        } else if (event === "tool_error") {
          setMessages((m) => [...m, { id: `te-${Date.now()}`, role: "system", content: `工具调用失败:${data.tool} — ${data.error}` }]);
        } else if (event === "error") {
          setError(data.message || "服务器错误");
        }
      }, ac.signal);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setStreaming(false);
      setPhase(null);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex flex-col h-[70vh] border border-[#EEF1F7] rounded bg-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-sm text-[#8E9BB0] text-center py-8">
            和投委会主持人聊聊这个项目 — 它会按需调度市场/财务/技术/风险专家,并能调用所有 skill 直接生成产物。
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} projectId={project.id} />)}
        {streaming && phase && <PhaseLine phase={phase} />}
        <div ref={tailRef} />
      </div>

      {error && (
        <div className="px-4 py-2 border-t border-rose-200 bg-rose-50 text-xs text-rose-600">{error}</div>
      )}

      <form onSubmit={handleSend} className="border-t border-[#EEF1F7] p-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !streaming && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          placeholder={`问点什么 — 比如"按 A 轮投决,这个项目最大的 3 个风险是什么?"`}
          rows={2}
          disabled={streaming}
          className="flex-1 border border-[#EEF1F7] rounded px-2 py-1.5 text-sm resize-none disabled:bg-[#F6F7FA]"
        />
        {streaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="px-3 py-1.5 text-sm rounded bg-rose-500 text-white hover:bg-rose-600"
          >
            停止
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            发送
          </button>
        )}
      </form>
    </div>
  );
}

function Bubble({ m, projectId }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[#0D2145] text-white text-sm px-3 py-2 rounded-lg rounded-br-sm">
          {m.content}
        </div>
      </div>
    );
  }
  if (m.role === "system") {
    const art = m.metadata?.artifact;
    return (
      <div className="text-xs text-[#8E9BB0] italic">
        {m.content}
        {art && (
          <div className="text-[#0F1C36] mt-1 not-italic">
            {art.bufferBase64 ? (
              <button
                onClick={() => downloadBase64(art.bufferBase64, art.filename, art.mimeType)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700"
              >
                下载 {art.filename}
              </button>
            ) : art.id ? (
              <button
                onClick={() => downloadArtifact(projectId, art)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700"
              >
                下载 {art.filename}
              </button>
            ) : (
              <span>{art.filename}</span>
            )}
          </div>
        )}
      </div>
    );
  }
  // agent
  const agentLabel = ({
    host: "主持人",
    market_deal: "市场/交易专家",
    finance_valuation: "财务/估值专家",
    product_team_risk: "产品/团队/风险专家",
    market: "市场专家",
    finance: "财务专家",
    tech: "技术专家",
    risk: "风险专家",
  })[m.agent_name] || m.agent_name || "AI";
  return (
    <div className="flex flex-col">
      <div className="text-[11px] text-[#8E9BB0] mb-0.5">
        {agentLabel}
        {m.metadata?.version_number && (
          <span className="ml-2 px-1.5 py-0.5 bg-[#EEF1F7] text-[#4B5A72] rounded">基于 v{m.metadata.version_number}</span>
        )}
      </div>
      <div className={[
        "max-w-[90%] text-sm px-3 py-2 rounded-lg rounded-bl-sm whitespace-pre-wrap",
        m.error ? "bg-rose-50 text-rose-700" : "bg-[#F6F7FA] text-[#0F1C36]",
      ].join(" ")}>
        {m.content}
        {Array.isArray(m.metadata?.tool_events) && m.metadata.tool_events.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#E4E8F0] flex flex-wrap gap-1.5">
            {m.metadata.tool_events.map((t, i) => {
              const cls = t.phase === "done"
                ? "bg-emerald-50 text-emerald-700"
                : t.phase === "error"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-[#EEF1F7] text-[#4B5A72]";
              const label = t.phase === "done" ? `${t.name} ✓` : t.phase === "error" ? `${t.name} ✗` : `${t.name}…`;
              return (
                <span key={`${t.tool_id}-${i}`} className={`px-1.5 py-0.5 rounded text-[11px] ${cls}`}>
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function downloadBase64(base64, filename, mimeType) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.pptx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadArtifact(projectId, artifact) {
  const token = useAuthStore.getState().token;
  fetch(`${API_BASE}/api/workspace-projects/${projectId}/conversation/artifacts/${artifact.id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = artifact.filename || "artifact";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch((err) => alert(`下载失败: ${err.message}`));
}

function PhaseLine({ phase }) {
  const labels = {
    routing: "正在分析问题…",
    experts: "正在咨询专家…",
    host: "主持人正在汇总…",
    tools: "正在执行工具调用…",
  };
  return (
    <div className="text-xs text-[#8E9BB0] flex items-center gap-2">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
      {labels[phase] || phase}
    </div>
  );
}
