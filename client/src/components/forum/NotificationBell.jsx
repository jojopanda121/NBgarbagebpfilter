// NotificationBell — 站内通知铃铛（轮询未读数,下拉列表,打开即标记已读）
import React, { useEffect, useState, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import forumApi from "../../services/forumApi";
import { Sticker } from "./stickers/registry";

export default function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const loadCount = useCallback(async () => {
    try { const r = await forumApi.notificationsUnreadCount(); setCount(r.count || 0); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000); // 轮询(无 websocket,仿站内信)
    return () => clearInterval(t);
  }, [loadCount]);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const r = await forumApi.listNotifications({});
        setItems(r.items || []);
        if (count > 0) { await forumApi.markNotificationsRead(); setCount(0); }
      } catch { /* noop */ } finally { setLoading(false); }
    }
  }

  function go(n) {
    setOpen(false);
    if (n.post_id) navigate(`/forum/post/${n.post_id}`);
    else navigate("/forum/me?tab=connections");
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={togglePanel} aria-label="通知"
        className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#EEF1F7] text-[#4B5A72]">
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#E0245E] text-white text-[10px] leading-4 text-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 max-h-96 overflow-auto bg-white border border-[#D8DCE8] rounded-xl shadow-lg z-30">
          <div className="px-3 py-2 border-b border-[#EEF1F7] text-xs font-semibold text-[#0D2145]">通知</div>
          {loading ? (
            <div className="py-6 text-center text-xs text-[#8E9BB0]">加载中…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#8E9BB0] flex flex-col items-center gap-2">
              <Sticker id="thinking" size={40} /> 还没有通知
            </div>
          ) : items.map((n) => (
            <button key={n.id} onClick={() => go(n)}
              className={`w-full text-left px-3 py-2.5 border-b border-[#F2F4F9] hover:bg-[#F6F7FA] ${!n.read ? "bg-[#F3F7FF]" : ""}`}>
              <div className="text-xs font-medium text-[#0D2145]">{n.title}</div>
              <div className="text-[11px] text-[#4B5A72] mt-0.5 line-clamp-2">{n.body}</div>
              <div className="text-[10px] text-[#8E9BB0] mt-1">{n.created_at}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
