// ConnectionsPanel — 我的撮合：收到的意向（可同意/拒绝）+ 发出的意向
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, X } from "lucide-react";
import forumApi from "../../services/forumApi";
import UserTypeBadge from "../../components/forum/UserTypeBadge";

const STATUS_LABEL = {
  pending: { text: "待回应", cls: "text-[#B45309] bg-[#FBF1E3]" },
  accepted: { text: "已建立联系", cls: "text-[#0F8A5F] bg-[#E7F6EF]" },
  declined: { text: "已婉拒", cls: "text-[#8E9BB0] bg-[#EEF1F7]" },
};

export default function ConnectionsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await forumApi.listConnections()); }
    catch { setData({ received: [], sent: [] }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function respond(connId, accept) {
    await forumApi.respondInterest(connId, accept);
    load();
  }

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#8E9BB0]" /></div>;

  return (
    <div className="space-y-6">
      <Section title="收到的意向" empty="还没有人对你的项目表达兴趣">
        {data.received.map((c) => (
          <ConnCard key={c.id} conn={c} side="received" onRespond={respond} />
        ))}
      </Section>
      <Section title="我发出的意向" empty="你还没有对任何项目表达兴趣">
        {data.sent.map((c) => (
          <ConnCard key={c.id} conn={c} side="sent" />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }) {
  const arr = React.Children.toArray(children);
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#0D2145] mb-2">{title}</h3>
      {arr.length === 0 ? <div className="text-xs text-[#8E9BB0] py-4">{empty}</div> : <div className="space-y-2">{arr}</div>}
    </div>
  );
}

function ConnCard({ conn, side, onRespond }) {
  const navigate = useNavigate();
  const st = STATUS_LABEL[conn.status] || STATUS_LABEL.pending;
  return (
    <div className="bg-white border border-[#D8DCE8] rounded-lg px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => navigate(`/forum/post/${conn.post_id}`)} className="text-sm font-medium text-[#0D2145] hover:text-[#1B4FD8] truncate">
          {conn.post_title}
        </button>
        <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.text}</span>
      </div>

      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-[#4B5A72]">
        {side === "received" ? "来自" : "对方"}：{conn.counterpart.name}
        <UserTypeBadge type={conn.counterpart.user_type} size="xs" />
        {conn.counterpart.org_name && <span className="text-[#8E9BB0]">· {conn.counterpart.org_name}</span>}
      </div>

      {conn.message && <p className="text-xs text-[#8E9BB0] mt-1.5 bg-[#F6F7FA] rounded px-2 py-1.5">{conn.message}</p>}

      {/* 名片（accepted 后解锁） */}
      {conn.counterpart.contact_card && (
        <div className="mt-2 text-xs bg-[#E7F6EF] border border-[#CDEBDD] rounded px-2.5 py-1.5 text-[#0D2145]">
          <span className="text-[#0F8A5F]">名片：</span>{conn.counterpart.contact_card}
        </div>
      )}

      {/* 收到的 pending 可同意/拒绝 */}
      {side === "received" && conn.status === "pending" && (
        <div className="flex items-center gap-2 mt-2.5">
          <button onClick={() => onRespond(conn.id, true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-lg font-medium">
            <Check className="w-3.5 h-3.5" /> 同意建立联系
          </button>
          <button onClick={() => onRespond(conn.id, false)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">
            <X className="w-3.5 h-3.5" /> 婉拒
          </button>
        </div>
      )}
    </div>
  );
}
