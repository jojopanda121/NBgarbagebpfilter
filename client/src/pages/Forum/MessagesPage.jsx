// MessagesPage — 轻量站内信：左侧会话列表 + 右侧消息流。
//   /forum/messages           → 会话列表
//   /forum/messages?to=<uid>  → 打开/新建与某用户的会话
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, Send, ArrowLeft } from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import Avatar from "../../components/forum/Avatar";
import UserTypeBadge from "../../components/forum/UserTypeBadge";
import RegistrationGate from "../../components/forum/RegistrationGate";
import Seo from "../../components/Seo";

export default function MessagesPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toUserId = params.get("to") ? Number(params.get("to")) : null;

  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [draftRecipient, setDraftRecipient] = useState(null); // {id,name,...} 尚未建立会话
  const [thread, setThread] = useState(null); // {counterpart, messages}
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const r = await forumApi.listConversations();
      setConversations(r.conversations || []);
      return r.conversations || [];
    } catch {
      setConversations([]);
      return [];
    } finally {
      setLoadingList(false);
    }
  }, []);

  // 初次加载 + 处理 ?to=
  useEffect(() => {
    if (!token) return;
    (async () => {
      const list = await loadList();
      if (toUserId) {
        const existing = list.find((c) => c.counterpart?.id === toUserId);
        if (existing) {
          setActiveId(existing.id);
        } else {
          // 新会话草稿：取对方资料做头部
          try {
            const p = await forumApi.getPublicProfile(toUserId);
            setDraftRecipient({
              id: toUserId,
              name: p.profile?.name,
              user_type: p.profile?.user_type,
              avatar_url: p.profile?.avatar_url,
            });
          } catch {
            setDraftRecipient({ id: toUserId, name: "用户" });
          }
          setActiveId(null);
          setThread({ counterpart: null, messages: [] });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, toUserId]);

  // 加载选中会话 + 轮询
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    const fetchThread = async () => {
      try {
        const r = await forumApi.getMessages(activeId);
        if (alive) setThread(r);
      } catch {
        /* noop */
      }
    };
    setLoadingThread(true);
    fetchThread().finally(() => alive && setLoadingThread(false));
    const t = setInterval(fetchThread, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages?.length]);

  function openConversation(c) {
    setDraftRecipient(null);
    setActiveId(c.id);
    setParams(c.counterpart?.id ? { to: String(c.counterpart.id) } : {});
  }

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      if (activeId) {
        await forumApi.sendMessage(activeId, body);
        setInput("");
        const r = await forumApi.getMessages(activeId);
        setThread(r);
      } else if (draftRecipient) {
        const r = await forumApi.startConversation(draftRecipient.id, body);
        setInput("");
        const list = await loadList();
        const conv = list.find((c) => c.id === r.conversation_id);
        setDraftRecipient(null);
        setActiveId(r.conversation_id);
        if (conv) setParams({ to: String(conv.counterpart.id) });
      }
    } catch (e) {
      alert(e.message || "发送失败");
    } finally {
      setSending(false);
    }
  }

  if (!token) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <RegistrationGate message="登录后查看与收发站内私信" />
      </div>
    );
  }

  const header = thread?.counterpart || draftRecipient;

  return (
    <div className="max-w-4xl mx-auto px-4 py-5">
      <Seo title="站内私信" noindex path="/forum/messages" />
      <button
        onClick={() => navigate("/forum")}
        className="flex items-center gap-1 text-xs text-[#8E9BB0] hover:text-[#0D2145] mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> 返回论坛
      </button>
      <div
        className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3 bg-white border border-[#D8DCE8] rounded-lg overflow-hidden"
        style={{ minHeight: 480 }}
      >
        {/* 会话列表 */}
        <aside
          className={`border-r border-[#EEF1F7] ${activeId || draftRecipient ? "hidden md:block" : ""}`}
        >
          <div className="px-3 py-2.5 text-sm font-semibold text-[#0D2145] border-b border-[#EEF1F7]">
            私信
          </div>
          {loadingList ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-[#8E9BB0]" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-xs text-[#8E9BB0] text-center py-10 px-3">
              还没有私信。
              <br />
              在项目帖点「我有兴趣」，
              <br />
              发帖人同意后即可在此私信。
            </div>
          ) : (
            <ul className="divide-y divide-[#F3F5F9]">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => openConversation(c)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-[#F6F7FA] ${activeId === c.id ? "bg-[#EEF1F7]" : ""}`}
                  >
                    <Avatar
                      src={c.counterpart?.avatar_url}
                      name={c.counterpart?.name}
                      id={c.counterpart?.id}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-[#0D2145] truncate">
                          {c.counterpart?.name}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="ml-auto shrink-0 text-[10px] bg-[#1B4FD8] text-white rounded-full px-1.5">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#8E9BB0] truncate">
                        {c.last_message
                          ? (c.last_message.from_me ? "我: " : "") + c.last_message.body
                          : "（暂无消息）"}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* 消息流 */}
        <section className={`flex flex-col ${activeId || draftRecipient ? "" : "hidden md:flex"}`}>
          {!header ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[#8E9BB0]">
              选择左侧会话开始聊天
            </div>
          ) : (
            <>
              <div className="px-3 py-2.5 border-b border-[#EEF1F7] flex items-center gap-2">
                <button
                  className="md:hidden text-[#8E9BB0]"
                  onClick={() => {
                    setActiveId(null);
                    setDraftRecipient(null);
                    setParams({});
                  }}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => header.id && navigate(`/forum/u/${header.id}`)}
                  className="flex items-center gap-2 hover:opacity-80"
                >
                  <Avatar src={header.avatar_url} name={header.name} id={header.id} size="sm" />
                  <span className="text-sm font-semibold text-[#0D2145]">{header.name}</span>
                  <UserTypeBadge type={header.user_type} size="xs" />
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#FAFBFC]"
                style={{ maxHeight: 420 }}
              >
                {loadingThread && !thread?.messages?.length ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-[#8E9BB0]" />
                  </div>
                ) : thread?.messages?.length === 0 ? (
                  <div className="text-xs text-[#8E9BB0] text-center py-10">
                    还没有消息，发一句打个招呼吧
                  </div>
                ) : (
                  thread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line break-words ${
                          m.from_me
                            ? "bg-[#1B4FD8] text-white rounded-br-sm"
                            : "bg-white border border-[#E6E9F0] text-[#0D2145] rounded-bl-sm"
                        }`}
                      >
                        {m.body}
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-[#EEF1F7] p-2.5 flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())
                  }
                  placeholder="写点什么…"
                  className="flex-1 border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="px-3 py-2 bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 text-sm"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
