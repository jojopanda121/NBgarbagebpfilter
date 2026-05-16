// ============================================================
// client/src/components/Workspace/WorkspaceTab.jsx
//
// 一级市场投资专家多 Agent 工作区 —— "类 Claude" 体验。
// - 4 个专家：每个都会先 thinking（实时流），再写最终答复
// - 主持人：thinking 流式可见 + 真 tool use 调 doc-service
// - 所有 tool_use / tool_result / thinking 事件在聊天里透明显示
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Paperclip, Loader2, AlertCircle, Download,
  TrendingUp, DollarSign, Cpu, Shield, MessageSquare, FileBox,
  CheckCircle2, X, Trash2, ChevronDown, ChevronRight, Sparkles, Info,
  Brain, Wrench, FileText, Presentation, ClipboardList, Table2,
} from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";
import { API_BASE } from "../../constants";
import { streamChatMessage } from "../../services/workspaceStream";

const AGENT_META = {
  host:    { label: "主持人",   icon: MessageSquare, color: "text-blue-700",   ring: "ring-blue-300",   bg: "bg-blue-50" },
  market_deal: { label: "市场/交易", icon: TrendingUp, color: "text-emerald-700", ring: "ring-emerald-300", bg: "bg-emerald-50" },
  finance_valuation: { label: "财务/估值", icon: DollarSign, color: "text-amber-700", ring: "ring-amber-300", bg: "bg-amber-50" },
  product_team_risk: { label: "产品/团队/风险", icon: Shield, color: "text-rose-700", ring: "ring-rose-300", bg: "bg-rose-50" },
  // legacy aliases for old conversation history
  market:  { label: "市场",     icon: TrendingUp,    color: "text-emerald-700",ring: "ring-emerald-300",bg: "bg-emerald-50" },
  finance: { label: "财务",     icon: DollarSign,    color: "text-amber-700",  ring: "ring-amber-300",  bg: "bg-amber-50" },
  tech:    { label: "技术",     icon: Cpu,           color: "text-cyan-700",   ring: "ring-cyan-300",   bg: "bg-cyan-50" },
  risk:    { label: "风险",     icon: Shield,        color: "text-rose-700",   ring: "ring-rose-300",   bg: "bg-rose-50" },
};

const ALL_AGENTS = ["host", "market_deal", "finance_valuation", "product_team_risk"];

const QUICK_OUTPUT_ACTIONS = [
  {
    label: "一页亮点 PPT",
    icon: Presentation,
    prompt: "请基于当前项目分析结果和我上传的所有材料，生成一份投资亮点一页 PPT。必须调用 onepager_pptx 模板 skill，内容要克制、可溯源，不要堆字。",
  },
  {
    label: "投决速览",
    icon: FileText,
    prompt: "请基于当前项目分析结果和我上传的所有材料，生成一份投委会一页纸投决速览。必须调用 investment_snapshot 模板 skill，文字精简，避免版面拥挤。",
  },
  {
    label: "尽调清单 Excel",
    icon: Table2,
    prompt: "请基于当前项目分析结果和我上传的所有材料，生成一份尽调问题清单 Excel。必须调用 dd_checklist_xlsx 工具。",
  },
  {
    label: "投决材料",
    icon: ClipboardList,
    prompt: "请基于当前项目分析结果和我上传的所有材料，生成一份 16 页投决材料 PPT。必须调用 investment_deck_pptx 模板 skill，按投资概要、尽调概况、公司、行业、业务技术、财务、估值、风险建议组织。",
  },
  {
    label: "项目简报",
    icon: ClipboardList,
    prompt: "请基于当前项目分析结果和我上传的所有材料，生成一份 3 页项目简报 PPT。必须调用 project_brief 模板 skill。",
  },
];

const ARTIFACT_KIND_LABEL = {
  generated_pptx: "AI 生成 PPT",
  generated_docx: "AI 生成 Word",
  generated_xlsx: "AI 生成 Excel",
  upload: "上传",
};

const TOOL_LABEL = {
  web_search: "联网检索",
  onepager_pptx: "一页投资亮点",
  investment_snapshot: "投决速览",
  project_brief: "项目简报",
  investment_deck_pptx: "投决材料",
  generate_onepager: "生成一页纸",
  generate_pptx: "生成 PPT",
  generate_docx: "生成 Word",
  generate_xlsx: "生成 Excel",
};

function bytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isInternalMsg(m) {
  return m?.role === "agent" && m?.agent_name !== "host" && m?.metadata?.internal;
}

export default function WorkspaceTab({ taskId }) {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [messages, setMessages]   = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);
  const [phase, setPhase]         = useState("idle");
  const [streaming, setStreaming] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [input, setInput]         = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [capOpen, setCapOpen] = useState(false);

  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef  = useRef(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get("/api/workspace/capabilities");
        if (!cancelled) setCapabilities(data);
      } catch (e) {
        if (!cancelled) console.warn("[Workspace] capabilities 加载失败:", e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const timeline = useMemo(
    () => buildTimeline(messages, currentRunId, phase, activeAgents),
    [messages, currentRunId, phase, activeAgents]
  );

  const uploads = useMemo(() => artifacts.filter((a) => a.kind === "upload"), [artifacts]);
  const outputs = useMemo(() => artifacts.filter((a) => a.kind && a.kind.startsWith("generated_")), [artifacts]);

  const updateMessage = (id, updater) => {
    setMessages((m) => m.map((msg) => (msg.id === id ? updater(msg) : msg)));
  };

  const handleSend = async (overrideText = null) => {
    const text = (typeof overrideText === "string" ? overrideText : input).trim();
    const filesToSend = [...pendingFiles];
    if ((!text && filesToSend.length === 0) || streaming) return;
    setInput("");
    setPendingFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStreaming(true);
    setPhase("routing");
    setActiveAgents([]);
    setCurrentRunId(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      if (filesToSend.length > 0) {
        await Promise.all(filesToSend.map(async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const r = await api.upload(`/api/workspace/${taskId}/upload`, fd);
          if (r.artifact) setArtifacts(a => [r.artifact, ...a]);
        }));
      }
      const msgText = text || (filesToSend.length > 0 ? "请分析已上传的材料" : "");
      await streamChatMessage(taskId, msgText, (event, data) => {
        switch (event) {
          case "user_message":
            setMessages(m => [...m, {
              id: data.id, role: "user", content: data.content, created_at: new Date().toISOString(),
            }]);
            break;

          case "phase":
            setPhase(data.phase);
            if (data.run_id) setCurrentRunId(data.run_id);
            if (data.phase === "experts" && Array.isArray(data.agents)) setActiveAgents(data.agents);
            break;

          case "routing":
            if (Array.isArray(data.agents)) setActiveAgents(data.agents);
            break;

          // ── 专家相关 ────────────────────────────────
          case "expert_start":
            setMessages(m => [...m, {
              id: data.id, role: "agent", agent_name: data.agent,
              content: "", _streaming: true, _thinkingActive: true,
              created_at: new Date().toISOString(),
              metadata: { internal: true, run_id: data.run_id, thinking: "" },
            }]);
            break;
          case "expert_thinking_delta":
            updateMessage(data.id, (msg) => ({
              ...msg,
              metadata: { ...(msg.metadata || {}), thinking: (msg.metadata?.thinking || "") + data.delta },
              _thinkingActive: true,
            }));
            break;
          case "expert_text_delta":
            updateMessage(data.id, (msg) => ({
              ...msg,
              content: (msg.content || "") + data.delta,
              _thinkingActive: false,
            }));
            break;
          case "expert_done":
            updateMessage(data.id, (msg) => ({
              ...msg,
              content: data.content || msg.content,
              _streaming: false,
              _thinkingActive: false,
              metadata: { ...(msg.metadata || {}), error: !!data.error },
            }));
            break;

          // ── 旧版兼容（如果 LLM 不支持流，可能只发 expert）──
          case "expert":
            setMessages(m => [...m, {
              id: data.id, role: "agent", agent_name: data.agent,
              content: data.content, created_at: new Date().toISOString(),
              metadata: { internal: true, run_id: data.run_id, error: !!data.error },
            }]);
            break;

          // ── 主持人相关 ───────────────────────────────
          case "host_start":
            setMessages(m => [...m, {
              id: data.id, role: "agent", agent_name: "host",
              content: "", _streaming: true, _thinkingActive: true,
              created_at: new Date().toISOString(),
              metadata: { run_id: data.run_id, thinking: "", tool_events: [] },
            }]);
            break;
          case "host_thinking_delta":
            updateMessage(data.id, (msg) => ({
              ...msg,
              metadata: { ...(msg.metadata || {}), thinking: (msg.metadata?.thinking || "") + data.delta },
              _thinkingActive: true,
            }));
            break;
          case "host_text_delta":
            updateMessage(data.id, (msg) => ({
              ...msg,
              content: (msg.content || "") + data.delta,
              _thinkingActive: false,
            }));
            break;
          case "host_tool_use_start":
            updateMessage(data.id, (msg) => ({
              ...msg,
              metadata: {
                ...(msg.metadata || {}),
                tool_events: [
                  ...(msg.metadata?.tool_events || []),
                  { tool_id: data.tool_id, name: data.name, phase: "started" },
                ],
              },
            }));
            break;
          case "host_tool_use":
            updateMessage(data.id, (msg) => ({
              ...msg,
              metadata: {
                ...(msg.metadata || {}),
                tool_events: (msg.metadata?.tool_events || []).map((t) =>
                  t.tool_id === data.tool_id ? { ...t, input: data.input, phase: "calling" } : t
                ),
              },
            }));
            break;
          case "host_tool_result":
            updateMessage(data.id, (msg) => ({
              ...msg,
              metadata: {
                ...(msg.metadata || {}),
                tool_events: (msg.metadata?.tool_events || []).map((t) =>
                  t.tool_id === data.tool_id
                    ? { ...t, result: data.result, error: !!data.error, phase: data.error ? "error" : "done" }
                    : t
                ),
              },
            }));
            break;
          case "host_done":
            updateMessage(data.id, (msg) => ({
              ...msg,
              content: data.content || msg.content,
              _streaming: false,
              _thinkingActive: false,
            }));
            break;

          // 旧版兼容：每行 token 推到 host content
          case "token":
            // 已通过 host_text_delta 渲染；旧客户端走这条
            // 这里不动，避免重复追加
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
            break;
          default: break;
        }
      }, ac.signal, null);
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(m => [...m, {
          id: `err-${Date.now()}`, role: "system", agent_name: null,
          content: `请求失败：${err.message}`, created_at: new Date().toISOString(),
        }]);
        if (filesToSend.length > 0) setPendingFiles(filesToSend);
      }
    } finally {
      setStreaming(false);
      setPhase("idle");
      setActiveAgents([]);
      setCurrentRunId(null);
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();
  const handleQuickOutput = (prompt) => handleSend(prompt);

  const doClear = async (scope, label) => {
    if (streaming) return;
    const ok = window.confirm(`确定${label}吗？此操作不可撤销。`);
    if (!ok) return;
    try {
      await api.delete(`/api/workspace/${taskId}/messages?scope=${scope}`);
      if (scope === "chat") {
        setMessages([]);
        setActiveAgents([]);
        setPhase("idle");
      } else if (scope === "uploads") {
        setArtifacts(items => items.filter((a) => a.kind !== "upload"));
        setPendingFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else if (scope === "outputs") {
        setArtifacts(items => items.filter((a) => !(a.kind || "").startsWith("generated_")));
      }
    } catch (err) {
      alert(`${label}失败：` + err.message);
    }
  };

  const handleFile = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setPendingFiles(prev => [...prev, ...files].slice(0, 10));
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  const deleteArtifact = async (art) => {
    if (streaming) return;
    const ok = window.confirm(`删除「${art.filename}」吗？`);
    if (!ok) return;
    try {
      await api.delete(`/api/workspace/${taskId}/artifacts/${art.id}`);
      setArtifacts(items => items.filter(item => item.id !== art.id));
    } catch (err) {
      alert("删除失败：" + err.message);
    }
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
    <div className="space-y-3">
      <CapabilityCard
        capabilities={capabilities}
        open={capOpen}
        onToggle={() => setCapOpen((v) => !v)}
      />
      <div className="grid grid-cols-12 gap-4 h-[min(720px,calc(100vh-260px))] min-h-[520px] overflow-hidden">
        <aside className="col-span-12 lg:col-span-2 space-y-2 overflow-y-auto pr-1">
          <h3 className="text-xs font-medium text-[#4B5A72] uppercase tracking-wider mb-2">AI 投资专家</h3>
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
          <QuickOutputActions
            actions={QUICK_OUTPUT_ACTIONS}
            disabled={streaming}
            onRun={handleQuickOutput}
          />
        </aside>

        <section className="col-span-12 lg:col-span-7 flex min-h-0 flex-col bg-white border border-[#EEF1F7] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#EEF1F7] px-4 py-2">
            <div className="text-sm font-medium text-[#0F1C36]">工作区对话</div>
            <button
              type="button"
              onClick={() => doClear("chat", "清空对话")}
              disabled={streaming || messages.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D8DCE8] px-2 py-1 text-xs text-[#4B5A72] hover:border-red-300 hover:text-red-700 disabled:opacity-40 disabled:hover:text-[#4B5A72]"
              title="只清空对话记录，不影响材料和产出"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空对话
            </button>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
            {timeline.length === 0 && (
              <div className="text-center text-[#8E9BB0] py-12">
                <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">我是一级市场早期项目投资专家，你可以问我：<br/>"这个项目的投资 thesis 是什么？"<br/>"估值合理吗？要什么条款保护？"<br/>"帮我生成一份投委会一页 PPT"</p>
              </div>
            )}
            {timeline.map((item) => {
              if (item.kind === "message") return <MessageBubble key={item.id} m={item.message} />;
              if (item.kind === "thinking") return (
                <ThinkingPanel
                  key={item.id}
                  experts={item.experts}
                  inProgress={item.inProgress}
                  activeAgents={item.inProgress ? activeAgents : []}
                  phase={item.inProgress ? phase : "idle"}
                />
              );
              return null;
            })}
          </div>

          <div className="border-t border-[#EEF1F7] p-3">
            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.pptx,.docx,.xlsx,.csv,.txt,.md"
                multiple
                onChange={handleFile}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming}
                className="p-2 text-[#4B5A72] hover:text-[#0D2145] disabled:opacity-50 transition-colors"
                title="上传补充材料 (PDF/PPTX/DOCX/XLSX/CSV/TXT)"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
                  className="px-3 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium text-white"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() && pendingFiles.length === 0}
                  className="px-3 py-2 bg-[#1B4FD8] hover:bg-[#163069] disabled:bg-[#E5E9F4] disabled:text-[#8E9BB0] text-white rounded-lg flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  <span className="text-sm">发送</span>
                </button>
              )}
            </div>
            {pendingFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[#BFC5D6] bg-white px-2 py-1 text-xs text-[#0F1C36]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-[#5B677A] shrink-0">{bytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-0.5 text-[#5B677A] hover:text-[#0F1C36]"
                      title="移除"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {phase !== "idle" && (
              <div className="mt-2 text-xs text-[#8E9BB0] flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {phase === "routing" && "主持人正在判断需要哪些专家..."}
                {phase === "experts" && `${activeAgents.length} 位专家并行分析中（实时思考流）...`}
                {phase === "host" && "主持人正在思考与综合..."}
                {phase === "tools" && "主持人正在调用工具..."}
              </div>
            )}
          </div>
        </section>

        <aside className="col-span-12 lg:col-span-3 min-h-0 overflow-y-auto pr-1 space-y-4">
          <ArtifactGroup
            title="用户上传材料"
            icon={Paperclip}
            items={uploads}
            emptyText="上传 PDF/PPTX/DOCX/XLSX/CSV/TXT 等材料后会出现在这里。"
            streaming={streaming}
            onDownload={downloadArtifact}
            onDelete={deleteArtifact}
            onClearAll={() => doClear("uploads", "清空所有上传材料")}
          />
          <ArtifactGroup
            title="AI 生成产出"
            icon={FileBox}
            items={outputs}
            emptyText="AI 生成的 PPT / Word / Excel 会出现在这里。"
            streaming={streaming}
            onDownload={downloadArtifact}
            onDelete={deleteArtifact}
            onClearAll={() => doClear("outputs", "清空所有 AI 生成产出")}
          />
        </aside>
      </div>
    </div>
  );
}

function QuickOutputActions({ actions, disabled, onRun }) {
  return (
    <div className="pt-3 mt-3 border-t border-[#EEF1F7]">
      <h3 className="text-xs font-medium text-[#4B5A72] uppercase tracking-wider mb-2">常用产出</h3>
      <div className="space-y-1.5">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onRun(action.prompt)}
              disabled={disabled}
              title={action.label}
              className="w-full flex items-center gap-2 rounded-lg border border-[#D8DCE8] bg-white px-3 py-2 text-left text-sm text-[#0F1C36] transition-colors hover:border-[#1B4FD8] hover:text-[#1B4FD8] disabled:opacity-45 disabled:hover:border-[#D8DCE8] disabled:hover:text-[#0F1C36]"
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Timeline 构造 ────────────────────────────────────────────
function buildTimeline(messages, currentRunId, phase, activeAgents) {
  const items = [];
  const groups = new Map();

  for (const m of messages) {
    if (isInternalMsg(m)) {
      const rid = m.metadata?.run_id || "_orphan_";
      if (!groups.has(rid)) groups.set(rid, { experts: [], hostSeen: false });
      groups.get(rid).experts.push(m);
    }
  }

  for (const m of messages) {
    if (isInternalMsg(m)) continue;
    if (m.role === "agent" && m.agent_name === "host") {
      const rid = m.metadata?.run_id;
      if (rid && groups.has(rid)) {
        const g = groups.get(rid);
        if (!g.hostSeen) {
          items.push({ kind: "thinking", id: `think-${rid}`, experts: g.experts, inProgress: false });
          g.hostSeen = true;
        }
      }
      items.push({ kind: "message", id: m.id, message: m });
    } else {
      items.push({ kind: "message", id: m.id, message: m });
    }
  }

  if (currentRunId && groups.has(currentRunId)) {
    const g = groups.get(currentRunId);
    if (!g.hostSeen) {
      items.push({
        kind: "thinking",
        id: `think-live-${currentRunId}`,
        experts: g.experts,
        inProgress: true,
      });
    }
  } else if (phase === "experts" || phase === "routing") {
    items.push({
      kind: "thinking",
      id: "think-live-empty",
      experts: [],
      inProgress: true,
    });
  }

  for (const [rid, g] of groups.entries()) {
    if (!g.hostSeen && rid !== currentRunId) {
      items.push({ kind: "thinking", id: `think-orphan-${rid}`, experts: g.experts, inProgress: false });
    }
  }

  return items;
}

function ThinkingPanel({ experts, inProgress, activeAgents, phase }) {
  const [open, setOpen] = useState(inProgress);
  useEffect(() => {
    setOpen(inProgress);
  }, [inProgress]);

  const total = experts.length;
  const target = activeAgents.length || total;
  const label = inProgress
    ? `专家正在思考（${total}/${target || "?"}）`
    : `思考过程（${total} 位专家分析）`;

  return (
    <div className="rounded-lg border border-dashed border-[#D8DCE8] bg-[#F7F8FC]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg transition-colors"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {inProgress && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
          <Brain className="w-3.5 h-3.5 text-blue-500" />
          <span>{label}</span>
        </span>
        <span className="text-[10px] text-[#8E9BB0]">点击{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {inProgress && experts.length === 0 && (
            <div className="text-xs text-[#8E9BB0] py-2 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              {phase === "routing" ? "正在判断需要哪些专家..." : "专家即将开始思考..."}
            </div>
          )}
          {inProgress && activeAgents.length > 0 && (
            <div className="text-xs text-[#8E9BB0] flex flex-wrap gap-1.5 py-1">
              {activeAgents.map((a) => {
                const expert = experts.find((e) => e.agent_name === a);
                const completed = expert && !expert._streaming;
                const meta = AGENT_META[a] || AGENT_META.host;
                return (
                  <span
                    key={a}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                      completed ? `${meta.bg} ${meta.color}` :
                      expert ? "bg-white border border-blue-200 text-blue-700" :
                      "bg-white border border-[#EEF1F7] text-[#8E9BB0]"
                    }`}
                  >
                    {completed ? "✓" : <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}
          {experts.map((e) => <ExpertNote key={e.id} m={e} />)}
        </div>
      )}
    </div>
  );
}

function ExpertNote({ m }) {
  const meta = AGENT_META[m.agent_name] || AGENT_META.host;
  const Icon = meta.icon;
  const thinking = m.metadata?.thinking || "";
  const content = m.content || "";
  const isStreaming = m._streaming;
  const thinkingActive = m._thinkingActive;
  const [thinkingOpen, setThinkingOpen] = useState(false);

  // 流式中默认展开 thinking；切到 content 后默认折叠
  useEffect(() => {
    if (thinkingActive) setThinkingOpen(true);
    else if (!isStreaming) setThinkingOpen(false);
  }, [thinkingActive, isStreaming]);

  return (
    <div className="flex gap-2 bg-white border border-[#EEF1F7] rounded-lg p-2.5">
      <div className={`shrink-0 w-6 h-6 rounded-full ${meta.bg} ring-1 ${meta.ring} flex items-center justify-center`}>
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-xs ${meta.color} mb-1 flex items-center gap-1.5`}>
          <span>{meta.label}专家</span>
          {isStreaming && thinkingActive && (
            <span className="text-[10px] text-blue-600 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              思考中
            </span>
          )}
          {isStreaming && !thinkingActive && content && (
            <span className="text-[10px] text-emerald-700 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              撰写中
            </span>
          )}
        </div>
        {thinking && (
          <div className="mb-1">
            <button
              type="button"
              onClick={() => setThinkingOpen(!thinkingOpen)}
              className="text-[10px] text-[#8E9BB0] hover:text-[#4B5A72] flex items-center gap-1"
            >
              {thinkingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              推理过程（{thinking.length} 字）
            </button>
            {thinkingOpen && (
              <p className="mt-1 text-[11px] text-[#6F7C92] whitespace-pre-wrap leading-relaxed bg-[#F7F8FC] rounded px-2 py-1.5 italic border-l-2 border-blue-200">
                {thinking}
                {thinkingActive && <span className="inline-block w-1 h-3 bg-blue-300 ml-0.5 animate-pulse align-middle" />}
              </p>
            )}
          </div>
        )}
        {content && (
          <p className="text-xs text-[#4B5A72] whitespace-pre-wrap leading-relaxed">
            {content}
            {isStreaming && !thinkingActive && <span className="inline-block w-1 h-3 bg-slate-300 ml-0.5 animate-pulse align-middle" />}
          </p>
        )}
        {m.metadata?.error && (
          <p className="text-xs text-red-500 mt-1">（专家暂时不可用）</p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ m }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[#1B4FD8]/10 border border-blue-200 rounded-2xl rounded-tr-sm px-4 py-2">
          <p className="text-sm whitespace-pre-wrap text-[#0F1C36]">{m.content}</p>
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
  // host
  return <HostBubble m={m} />;
}

function HostBubble({ m }) {
  const meta = AGENT_META.host;
  const Icon = meta.icon;
  const thinking = m.metadata?.thinking || "";
  const toolEvents = m.metadata?.tool_events || [];
  const isStreaming = m._streaming;
  const thinkingActive = m._thinkingActive;
  const [thinkingOpen, setThinkingOpen] = useState(false);

  useEffect(() => {
    if (thinkingActive) setThinkingOpen(true);
    else if (!isStreaming) setThinkingOpen(false);
  }, [thinkingActive, isStreaming]);

  return (
    <div className="flex justify-start gap-2">
      <div className={`shrink-0 w-7 h-7 rounded-full ${meta.bg} ring-1 ${meta.ring} flex items-center justify-center`}>
        <Icon className={`w-4 h-4 ${meta.color}`} />
      </div>
      <div className="max-w-[80%] min-w-0 flex-1">
        <div className={`text-xs ${meta.color} mb-1 flex items-center gap-1.5`}>
          <span>{meta.label}（一级市场投资专家）</span>
          {isStreaming && thinkingActive && (
            <span className="text-[10px] text-blue-600 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              思考中
            </span>
          )}
        </div>
        {thinking && (
          <div className="mb-1.5">
            <button
              type="button"
              onClick={() => setThinkingOpen(!thinkingOpen)}
              className="text-[10px] text-[#8E9BB0] hover:text-[#4B5A72] flex items-center gap-1"
            >
              {thinkingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Brain className="w-3 h-3 text-blue-500" />
              主持人推理过程（{thinking.length} 字）
            </button>
            {thinkingOpen && (
              <p className="mt-1 text-[11px] text-[#6F7C92] whitespace-pre-wrap leading-relaxed bg-[#F7F8FC] rounded px-2 py-1.5 italic border-l-2 border-blue-300">
                {thinking}
                {thinkingActive && <span className="inline-block w-1 h-3 bg-blue-400 ml-0.5 animate-pulse align-middle" />}
              </p>
            )}
          </div>
        )}
        {toolEvents.length > 0 && (
          <div className="mb-1.5 space-y-1">
            {toolEvents.map((t) => <ToolEventChip key={t.tool_id} t={t} />)}
          </div>
        )}
        {(m.content || isStreaming) && (
          <div className="bg-[#EEF1F7] border border-[#EEF1F7] rounded-2xl rounded-tl-sm px-4 py-2">
            <p className="text-sm whitespace-pre-wrap text-[#0F1C36]">
              {m.content}
              {isStreaming && !thinkingActive && <span className="inline-block w-1.5 h-3.5 bg-slate-300 ml-0.5 animate-pulse align-middle" />}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolEventChip({ t }) {
  const label = TOOL_LABEL[t.name] || t.name;
  const desc = describeToolInput(t.name, t.input);
  const isError = t.phase === "error";
  const isDone = t.phase === "done";
  const isCalling = t.phase === "calling" || t.phase === "started";

  return (
    <div className={`inline-flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
      isError ? "border-red-200 bg-red-50 text-red-700" :
      isDone ? "border-emerald-200 bg-emerald-50 text-emerald-800" :
      "border-blue-200 bg-blue-50 text-blue-800"
    }`}>
      <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{isCalling ? "调用工具" : isDone ? "工具完成" : "工具失败"}</span>
          <span>·</span>
          <span>{label}</span>
          {isCalling && <Loader2 className="w-3 h-3 animate-spin" />}
          {isDone && <CheckCircle2 className="w-3 h-3" />}
        </div>
        {desc && <div className="text-[11px] opacity-80 mt-0.5">{desc}</div>}
        {isDone && t.result && (
          <div className="text-[11px] opacity-80 mt-0.5 truncate max-w-[400px]" title={t.result}>↳ {t.result}</div>
        )}
        {isError && t.result && (
          <div className="text-[11px] mt-0.5">{t.result}</div>
        )}
      </div>
    </div>
  );
}

function describeToolInput(name, input) {
  if (!input || typeof input !== "object") return "";
  if (name === "web_search") {
    return input.query || (Array.isArray(input.queries) ? input.queries.join(" · ") : "");
  }
  if (name === "generate_onepager") {
    return input.company_name || input.headline || "投资要点速览";
  }
  if (name === "onepager_pptx") {
    return input.regenerate ? "重新生成投资亮点单页" : "投资亮点单页";
  }
  if (name === "investment_snapshot" || name === "project_brief") {
    return input.company_hint || (input.materials ? "基于补充材料" : "基于项目上下文");
  }
  if (name === "generate_pptx") {
    const slides = Array.isArray(input.slides) ? input.slides.length : 0;
    return `${input.title || "(无标题)"} · ${slides} 页`;
  }
  if (name === "generate_docx") {
    const secs = Array.isArray(input.sections) ? input.sections.length : 0;
    return `${input.title || "(无标题)"} · ${secs} 节`;
  }
  if (name === "generate_xlsx") {
    const sheets = Array.isArray(input.sheets) ? input.sheets.length : 0;
    return `${input.title || "(无标题)"} · ${sheets} 表`;
  }
  return "";
}

function ArtifactGroup({ title, icon: Icon, items, emptyText, streaming, onDownload, onDelete, onClearAll }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-[#4B5A72] uppercase tracking-wider flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          {title} ({items.length})
        </h3>
        <button
          type="button"
          onClick={onClearAll}
          disabled={streaming || items.length === 0}
          className="inline-flex items-center gap-1 rounded-md border border-[#D8DCE8] px-1.5 py-0.5 text-[10px] text-[#4B5A72] hover:border-red-300 hover:text-red-700 disabled:opacity-40"
          title={`清空所有${title}`}
        >
          <Trash2 className="w-3 h-3" />
          清空
        </button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-xs text-[#8E9BB0] px-3 py-4 border border-dashed border-[#D8DCE8] rounded-lg text-center">
            {emptyText}
          </p>
        )}
        {items.map(art => (
          <div key={art.id} className="px-3 py-2 bg-white border border-[#EEF1F7] rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate text-[#0F1C36]" title={art.filename}>{art.filename}</p>
                <p className="text-xs text-[#8E9BB0] mt-0.5">
                  {ARTIFACT_KIND_LABEL[art.kind] || "文件"} · {bytes(art.size_bytes)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => onDownload(art)}
                  className="p-1.5 text-[#4B5A72] hover:text-[#0D2145]"
                  title="下载"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(art)}
                  disabled={streaming}
                  className="p-1.5 text-[#4B5A72] hover:text-red-700 disabled:opacity-40"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            {art.summary && (
              <p className="text-xs text-[#4B5A72] mt-1.5 line-clamp-3">{art.summary}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilityCard({ capabilities, open, onToggle }) {
  return (
    <div className="rounded-xl border border-[#EEF1F7] bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[#F7F8FC] transition-colors"
      >
        <span className="flex items-center gap-2 text-[#0F1C36]">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span className="font-medium">一级市场投资专家能力清单</span>
          <span className="text-xs text-[#8E9BB0]">点击{open ? "收起" : "展开"}查看各专家擅长与触发话术</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-[#8E9BB0]" /> : <ChevronRight className="w-4 h-4 text-[#8E9BB0]" />}
      </button>
      {open && (
        <div className="border-t border-[#EEF1F7] px-4 py-3 space-y-3 text-xs text-[#4B5A72]">
          <p className="text-[#0F1C36] leading-relaxed">
            <Info className="w-3.5 h-3.5 inline mr-1 text-blue-600" />
            主持人是<strong>一级市场早期项目投资专家</strong>，按你的提问综合调度 4 位专家。每位专家都会先 <Brain className="w-3 h-3 inline text-blue-500"/> 实时思考再回答；主持人调用工具会在对话里透明显示（<Wrench className="w-3 h-3 inline"/> 调用工具 → ✅ 完成）。
          </p>
          {capabilities ? (
            <>
              <div>
                <div className="text-[11px] font-medium text-[#0F1C36] mb-1.5">专家与擅长领域</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(capabilities.agents || []).map((a) => {
                    const meta = AGENT_META[a.name] || AGENT_META.host;
                    const Icon = meta.icon;
                    const trig = TRIGGER_HINTS[a.name] || [];
                    return (
                      <div key={a.name} className="border border-[#EEF1F7] rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                          <span className="text-[#0F1C36] font-medium text-xs">{a.label}（{a.role}）</span>
                        </div>
                        <p className="leading-relaxed mb-1">{a.description}</p>
                        {a.skills?.length > 0 && (
                          <p className="text-[10px] text-[#8E9BB0]">
                            Skills：{a.skills.join(" · ")}
                          </p>
                        )}
                        {trig.length > 0 && (
                          <p className="text-[10px] mt-1 text-[#4B5A72]">
                            <span className="text-[#8E9BB0]">触发示例：</span>
                            {trig.map((t, i) => (
                              <code key={i} className="inline-block bg-[#F7F8FC] border border-[#EEF1F7] rounded px-1 mr-1 mb-0.5">{t}</code>
                            ))}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[#0F1C36] mb-1.5">可调用工具</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {(capabilities.tools || []).filter((t) => t.callableByModel).map((t) => (
                    <div key={t.name} className="border border-[#EEF1F7] rounded-lg p-2.5">
                      <div className="text-[#0F1C36] font-medium text-xs mb-1">{t.label}</div>
                      <p className="leading-relaxed">{t.description}</p>
                      {TOOL_TRIGGER_HINTS[t.name] && (
                        <p className="text-[10px] mt-1 text-[#4B5A72]">
                          <span className="text-[#8E9BB0]">触发示例：</span>
                          <code className="inline-block bg-[#F7F8FC] border border-[#EEF1F7] rounded px-1">{TOOL_TRIGGER_HINTS[t.name]}</code>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="text-[#8E9BB0]">能力清单加载中...</p>
          )}
        </div>
      )}
    </div>
  );
}

const TRIGGER_HINTS = {
  market_deal: ["这个赛道 TAM 多大？", "竞品格局怎么样？", "本轮估值和融资结构怎么看？"],
  finance_valuation: ["估值合理吗？", "单位经济模型怎么算？", "应该要哪些条款保护？"],
  product_team_risk: ["技术壁垒能撑多久？", "创始团队有什么风险？", "有哪些重大红旗？"],
};

const TOOL_TRIGGER_HINTS = {
  web_search: "联网检索这个赛道最新政策",
  onepager_pptx: "生成一份投资亮点一页纸",
  investment_snapshot: "生成一页纸投决速览",
  project_brief: "生成 3 页项目简报",
  investment_deck_pptx: "生成 16 页投决材料",
  generate_docx: "生成一份尽调备忘录 Word",
  generate_xlsx: "生成一份风险台账 Excel",
};
