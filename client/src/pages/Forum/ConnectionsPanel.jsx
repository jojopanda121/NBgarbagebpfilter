// ConnectionsPanel — 我的撮合：收到的意向（可同意/拒绝/解锁报告）+ 发出的意向 + 我的报告库
import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, X, MessageSquare, FileText, FileLock2 } from "lucide-react";
import forumApi from "../../services/forumApi";
import UserTypeBadge from "../../components/forum/UserTypeBadge";
import Avatar from "../../components/forum/Avatar";
import { Sticker } from "../../components/forum/stickers/registry";

const STATUS_LABEL = {
  pending: { text: "待回应", cls: "text-[#B45309] bg-[#FBF1E3]" },
  accepted: { text: "已建立联系", cls: "text-[#0F8A5F] bg-[#E7F6EF]" },
  declined: { text: "已婉拒", cls: "text-[#8E9BB0] bg-[#EEF1F7]" },
};

export default function ConnectionsPanel() {
  const [data, setData] = useState(null);
  const [reports, setReports] = useState({ unlocked_to_me: [], granted_by_me: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [conns, reps] = await Promise.all([forumApi.listConnections(), forumApi.listMyReports()]);
      setData(conns);
      setReports(reps);
    } catch {
      setData({ received: [], sent: [] });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function respond(connId, accept) {
    await forumApi.respondInterest(connId, accept);
    load();
  }

  // 已授权报告的 grantee id 集合（用于按钮态）
  const grantedSet = new Set((reports.granted_by_me || []).map((g) => `${g.post_id}:${g.to.id}`));

  async function grant(conn) {
    try {
      await forumApi.grantReport(conn.post_id, conn.counterpart.id);
      alert("已解锁完整报告，对方会收到通知");
      load();
    } catch (e) { alert(e.message || "解锁失败"); }
  }

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#8E9BB0]" /></div>;

  return (
    <div className="space-y-6">
      <Section title="收到的意向" empty="还没有人对你的项目表达兴趣">
        {data.received.map((c) => (
          <ConnCard key={c.id} conn={c} side="received" onRespond={respond}
            onGrant={grant} granted={grantedSet.has(`${c.post_id}:${c.counterpart.id}`)} />
        ))}
      </Section>

      <ReportLibrary reports={reports.unlocked_to_me} />

      <Section title="我发出的意向" empty="你还没有对任何项目表达兴趣">
        {data.sent.map((c) => (
          <ConnCard key={c.id} conn={c} side="sent" />
        ))}
      </Section>
    </div>
  );
}

// 我的报告库:被发帖人解锁给我的完整报告(留存面)
function ReportLibrary({ reports = [] }) {
  const navigate = useNavigate();
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#0D2145] mb-2 flex items-center gap-1.5">
        <FileLock2 className="w-4 h-4 text-[#1B4FD8]" /> 我的报告库
      </h3>
      {reports.length === 0 ? (
        <div className="text-xs text-[#8E9BB0] py-4 flex items-center gap-2">
          <Sticker id="show-me-bp" size={32} /> 还没有被解锁的完整报告。对感兴趣的项目点「完整报告」可向发帖人申请。
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <button key={r.post_id} onClick={() => navigate(`/forum/post/${r.post_id}`)}
              className="w-full text-left bg-white border border-[#D8DCE8] rounded-lg px-3.5 py-3 hover:border-[#1B4FD8]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[#0D2145] truncate flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#1B4FD8]" /> {r.codename || r.title}
                </span>
                {r.snapshot?.total_score != null && (
                  <span className="shrink-0 text-xs font-semibold text-[#1B4FD8]">{r.snapshot.total_score} 分</span>
                )}
              </div>
              <div className="text-[11px] text-[#8E9BB0] mt-1">由 {r.from?.name} 解锁 · {r.granted_at}</div>
            </button>
          ))}
        </div>
      )}
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

function ConnCard({ conn, side, onRespond, onGrant, granted }) {
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
        <span className="text-[#8E9BB0]">{side === "received" ? "来自" : "对方"}：</span>
        <button onClick={() => conn.counterpart.id && navigate(`/forum/u/${conn.counterpart.id}`)}
          className="flex items-center gap-1.5 hover:text-[#1B4FD8]">
          <Avatar src={conn.counterpart.avatar_url} name={conn.counterpart.name} id={conn.counterpart.id} size="xs" />
          {conn.counterpart.name}
          <UserTypeBadge type={conn.counterpart.user_type} size="xs" />
        </button>
        {conn.counterpart.org_name && <span className="text-[#8E9BB0]">· {conn.counterpart.org_name}</span>}
      </div>

      {conn.message && <p className="text-xs text-[#8E9BB0] mt-1.5 bg-[#F6F7FA] rounded px-2 py-1.5">{conn.message}</p>}

      {/* 名片（accepted 后解锁） */}
      {conn.counterpart.contact_card && (
        <div className="mt-2 text-xs bg-[#E7F6EF] border border-[#CDEBDD] rounded px-2.5 py-1.5 text-[#0D2145]">
          <span className="text-[#0F8A5F]">名片：</span>{conn.counterpart.contact_card}
        </div>
      )}

      {/* 建立联系后可直接站内私信 */}
      {conn.status === "accepted" && conn.counterpart.id && (
        <button onClick={() => navigate(`/forum/messages?to=${conn.counterpart.id}`)}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#D8DCE8] hover:border-[#1B4FD8] text-[#4B5A72] hover:text-[#1B4FD8] rounded-lg">
          <MessageSquare className="w-3.5 h-3.5" /> 站内私信
        </button>
      )}

      {/* 收到的意向:同意/拒绝 + 解锁完整报告（授权 ≠ 换名片，可独立先给报告） */}
      {side === "received" && (
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {conn.status === "pending" && (
            <>
              <button onClick={() => onRespond(conn.id, true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-lg font-medium">
                <Check className="w-3.5 h-3.5" /> 同意并开启私信
              </button>
              <button onClick={() => onRespond(conn.id, false)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">
                <X className="w-3.5 h-3.5" /> 婉拒
              </button>
            </>
          )}
          {conn.status !== "declined" && onGrant && (
            granted ? (
              <span className="flex items-center gap-1 px-3 py-1.5 text-xs text-[#0F8A5F] bg-[#E7F6EF] rounded-lg">
                <FileLock2 className="w-3.5 h-3.5" /> 报告已解锁
              </span>
            ) : (
              <button onClick={() => onGrant(conn)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs border border-[#1B4FD8] text-[#1B4FD8] hover:bg-[#EEF1F7] rounded-lg font-medium">
                <FileLock2 className="w-3.5 h-3.5" /> 解锁完整报告
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
