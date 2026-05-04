// ============================================================
// client/src/components/Workspace/WorkspaceTab.jsx
//
// 多 Agent 工作区：三栏布局（Agent 状态 | 聊天流 | Artifacts）
// 通过 SSE 与后端交互，5 个 AI 角色协同回答用户问题。
// ============================================================

import React, { useEffect, useRef, useState } from "react";
import {
  Send, Paperclip, Loader2, AlertCircle, Download,
  TrendingUp, DollarSign, Cpu, Shield, MessageSquare, FileBox
} from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";
import { API_BASE } from "../../constants";
import { streamChatMessage } from "../../services/workspaceStream";

const AGENT_META = {
  host:    { label: "主持人",   icon: MessageSquare, color: "text-blue-300",   ring: "ring-blue-500/40",   bg: "bg-blue-500/10" },
  market:  { label: "市场",     icon: TrendingUp,    color: "text-emerald-300",ring: "ring-emerald-500/40",bg: "bg-emerald-500/10" },
  finance: { label: "财务",     icon: DollarSign,    color: "text-amber-300",  ring: "ring-amber-500/40",  bg: "bg-amber-500/10" },
  tech:    { label: "技术",     icon: Cpu,           color: "text-cyan-300",   ring: "ring-cyan-500/40",   bg: "bg-cyan-500/10" },
  risk:    { label: "风险",     icon: Shield,        color: "text-rose-300",   ring: "ring-rose-500/40",   bg: "bg-rose-500/10" },
};

const ALL_AGENTS = ["host", "market", "finance", "tech", "risk"];

function bytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function WorkspaceTab({ taskId }) {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [messages, setMessages]   = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);   // 当前 routing 命中的专家
  const [phase, setPhase]         = useState("idle");     // idle | routing | experts | host | tools
  const [streaming, setStreaming] = useState(false);
  const [input, setInput]         = useState("");
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef  = useRef(null);

  // 拉取历史
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const data = await api.get(`/api/workspace/${taskId}/messages`);
        if (cancelled) return;
        setMessages(data.messages || []);
        setArtifacts(data.artifacts || []);
      } catch (e) {
        if (!cancelled) setError(e.message || "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);
    setPhase("routing");
    setActiveAgents([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamChatMessage(taskId, text, (event, data) => {
        switch (event) {
          case "user_message":
            setMessages(m => [...m, {
              id: data.id, role: "user", content: data.content, created_at: new Date().toISOString(),
            }]);
            break;
          case "phase":
            setPhase(data.phase);
            if (data.phase === "experts" && Array.isArray(data.agents)) setActiveAgents(data.agents);
            break;
          case "routing":
            // 主持人决策结果
            if (Array.isArray(data.agents)) setActiveAgents(data.agents);
            break;
          case "expert":
            setMessages(m => [...m, {
              id: data.id, role: "agent", agent_name: data.agent,
              content: data.content, created_at: new Date().toISOString(),
              metadata: data.error ? { error: true } : null,
            }]);
            break;
          case "host_start":
            // 占位一条流式消息
            setMessages(m => [...m, {
              id: data.id, role: "agent", agent_name: "host",
              content: "", _streaming: true, created_at: new Date().toISOString(),
            }]);
            break;
          case "token":
            setMessages(m => m.map(msg =>
              msg.id === data.id ? { ...msg, content: msg.content + data.delta } : msg
            ));
            break;
          case "host_done":
            setMessages(m => m.map(msg =>
              msg.id === data.id ? { ...msg, content: data.content, _streaming: false } : msg
            ));
            break;
          case "artifact":
            setArtifacts(a => [data, ...a]);
            break;
          case "tool_error":
            setMessages(m => [...m, {
              id: `err-${Date.now()}`, role: "system", agent_name: null,
              content: `工具调用失败 (${data.tool}): ${data.error}`,
              created_at: new Date().toISOString(),
            }]);
            break;
          case "error":
            throw new Error(data.message || "服务器错误");
          case "done":
            // noop
            break;
          default: break;
        }
      }, ac.signal);
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(m => [...m, {
          id: `err-${Date.now()}`, role: "system", agent_name: null,
          content: `请求失败：${err.message}`, created_at: new Date().toISOString(),
        }]);
      }
    } finally {
      setStreaming(false);
      setPhase("idle");
      setActiveAgents([]);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const data = await api.upload(`/api/workspace/${taskId}/upload`, fd);
      setArtifacts(a => [data.artifact, ...a]);
      // 拉一次最新历史，把 system 摘要消息合并进来
      try {
        const refreshed = await api.get(`/api/workspace/${taskId}/messages`);
        setMessages(refreshed.messages || []);
      } catch {}
    } catch (err) {
      alert("上传失败：" + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadArtifact = (art) => {
    const token = useAuthStore.getState().token;
    fetch(`${API_BASE}/api/workspace/${taskId}/artifacts/${art.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = art.filename; a.click();
      URL.revokeObjectURL(url);
    }).catch(err => alert("下载失败：" + err.message));
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );
  if (error) return (
    <div className="flex flex-col items-center py-20">
      <AlertCircle className="w-10 h-10 text-red-400 mb-2" />
      <p className="text-red-400">{error}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-12 gap-4 min-h-[600px]">
      {/* 左：Agent 面板 */}
      <aside className="col-span-12 lg:col-span-2 space-y-2">
        <h3 className="text-xs font-medium text-[#4B5A72] uppercase tracking-wider mb-2">AI 团队</h3>
        {ALL_AGENTS.map(name => {
          const meta = AGENT_META[name];
          const Icon = meta.icon;
          const isActive = phase !== "idle" && (
            name === "host" ? (phase === "host" || phase === "tools") : activeAgents.includes(name)
          );
          return (
            <div
              key={name}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                isActive
                  ? `${meta.bg} ring-1 ${meta.ring} border-transparent`
                  : "border-[#EEF1F7] bg-white"
              }`}
            >
              <Icon className={`w-4 h-4 ${meta.color}`} />
              <span className="text-sm">{meta.label}</span>
              {isActive && <Loader2 className="w-3 h-3 animate-spin ml-auto text-[#4B5A72]" />}
            </div>
          );
        })}
      </aside>

      {/* 中：聊天流 */}
      <section className="col-span-12 lg:col-span-7 flex flex-col bg-white border border-[#EEF1F7] rounded-xl overflow-hidden min-h-[600px]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-[#8E9BB0] py-12">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">在这里向 AI 团队提问，例如：<br/>"这个项目最大的财务风险在哪？"<br/>"帮我生成一份 10 页投委会 PPT"</p>
            </div>
          )}
          {messages.map(m => <MessageBubble key={m.id} m={m} />)}
        </div>

        {/* 输入区 */}
        <div className="border-t border-[#EEF1F7] p-3">
          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx,.txt,.md"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || streaming}
              className="p-2 text-[#4B5A72] hover:text-[#0D2145] disabled:opacity-50 transition-colors"
              title="上传补充材料 (PDF/PPTX/TXT)"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
            </button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={streaming ? "AI 正在思考..." : "输入消息（Enter 发送 / Shift+Enter 换行）"}
              disabled={streaming}
              rows={1}
              className="flex-1 bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
              style={{ maxHeight: 120 }}
            />
            {streaming ? (
              <button
                onClick={handleStop}
                className="px-3 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium"
              >
                停止
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-3 py-2 bg-[#1B4FD8] hover:bg-[#163069] disabled:bg-[#E5E9F4] disabled:text-[#8E9BB0] rounded-lg flex items-center gap-1.5"
              >
                <Send className="w-4 h-4" />
                <span className="text-sm">发送</span>
              </button>
            )}
          </div>
          {phase !== "idle" && (
            <div className="mt-2 text-xs text-[#8E9BB0] flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              {phase === "routing" && "主持人正在判断需要哪些专家..."}
              {phase === "experts" && `${activeAgents.length} 位专家并行分析中...`}
              {phase === "host" && "主持人正在汇总意见..."}
              {phase === "tools" && "正在生成文档..."}
            </div>
          )}
        </div>
      </section>

      {/* 右：Artifacts */}
      <aside className="col-span-12 lg:col-span-3">
        <h3 className="text-xs font-medium text-[#4B5A72] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <FileBox className="w-3.5 h-3.5" />
          材料 & 产出 ({artifacts.length})
        </h3>
        <div className="space-y-2">
          {artifacts.length === 0 && (
            <p className="text-xs text-[#8E9BB0] px-3 py-4 border border-dashed border-[#D8DCE8] rounded-lg text-center">
              用户上传的补充材料和 AI 生成的 PPT 会出现在这里
            </p>
          )}
          {artifacts.map(art => (
            <div key={art.id} className="px-3 py-2 bg-white border border-[#EEF1F7] rounded-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" title={art.filename}>{art.filename}</p>
                  <p className="text-xs text-[#8E9BB0] mt-0.5">
                    {art.kind === "generated_pptx" ? "AI 生成" : "上传"} · {bytes(art.size_bytes)}
                  </p>
                </div>
                <button
                  onClick={() => downloadArtifact(art)}
                  className="p-1.5 text-[#4B5A72] hover:text-[#0D2145]"
                  title="下载"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
              {art.summary && (
                <p className="text-xs text-[#4B5A72] mt-1.5 line-clamp-3">{art.summary}</p>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({ m }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[#1B4FD8]/30 border border-blue-500/30 rounded-2xl rounded-tr-sm px-4 py-2">
          <p className="text-sm whitespace-pre-wrap">{m.content}</p>
        </div>
      </div>
    );
  }
  if (m.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] text-xs text-[#4B5A72] bg-[#EEF1F7] border border-[#EEF1F7] rounded-lg px-3 py-2 whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }
  // agent
  const meta = AGENT_META[m.agent_name] || AGENT_META.host;
  const Icon = meta.icon;
  return (
    <div className="flex justify-start gap-2">
      <div className={`shrink-0 w-7 h-7 rounded-full ${meta.bg} ring-1 ${meta.ring} flex items-center justify-center`}>
        <Icon className={`w-4 h-4 ${meta.color}`} />
      </div>
      <div className="max-w-[80%]">
        <div className={`text-xs ${meta.color} mb-1`}>{meta.label}</div>
        <div className="bg-[#EEF1F7] border border-[#EEF1F7] rounded-2xl rounded-tl-sm px-4 py-2">
          <p className="text-sm whitespace-pre-wrap">
            {m.content}
            {m._streaming && <span className="inline-block w-1.5 h-3.5 bg-slate-300 ml-0.5 animate-pulse align-middle" />}
          </p>
          {m.metadata?.error && (
            <p className="text-xs text-red-400 mt-1">（专家暂时不可用）</p>
          )}
        </div>
      </div>
    </div>
  );
}
