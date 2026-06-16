// ForumProfilePage
//   /forum/me        → 我的：资料编辑 + 撮合 + 我的帖子
//   /forum/u/:id     → 他人公开主页 + 其帖子
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import ForumPostCard from "../../components/forum/ForumPostCard";
import UserTypeBadge from "../../components/forum/UserTypeBadge";
import Avatar from "../../components/forum/Avatar";
import BadgeList from "../../components/forum/BadgeList";
import RegistrationGate from "../../components/forum/RegistrationGate";
import ProfileEditor from "./ProfileEditor";
import ConnectionsPanel from "./ConnectionsPanel";

export default function ForumProfilePage() {
  const { id } = useParams();
  const isMe = !id;
  const token = useAuthStore((s) => s.token);

  if (isMe && !token) {
    return <div className="max-w-3xl mx-auto px-4 py-10"><RegistrationGate message="登录后管理你的论坛资料与撮合" /></div>;
  }
  return isMe ? <MyProfile /> : <PublicProfile userId={Number(id)} />;
}

// ── 我的 ──
function MyProfile() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "profile";
  const setTab = (t) => setSearchParams(t === "profile" ? {} : { tab: t });

  const TABS = [
    { key: "profile", label: "论坛资料" },
    { key: "connections", label: "我的撮合" },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <h1 className="text-lg font-bold text-[#0D2145] mb-3">我的论坛</h1>
      <div className="flex items-center gap-1.5 mb-4 border-b border-[#EEF1F7]">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === t.key ? "border-[#1B4FD8] text-[#1B4FD8]" : "border-transparent text-[#8E9BB0] hover:text-[#0D2145]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "profile" ? <ProfileEditor /> : <ConnectionsPanel />}
    </div>
  );
}

// ── 他人公开主页 ──
function PublicProfile({ userId }) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await forumApi.getPublicProfile(userId);
      setData(r);
    } catch (e) {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-20 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#8E9BB0]" /></div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-20 text-center text-sm text-[#8E9BB0]">用户不存在</div>;

  const { profile, posts } = data;
  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <button onClick={() => navigate("/forum")} className="flex items-center gap-1 text-xs text-[#8E9BB0] hover:text-[#0D2145] mb-3"><ArrowLeft className="w-4 h-4" /> 返回论坛</button>
      <div className="bg-white border border-[#D8DCE8] rounded-lg p-5 flex items-start gap-4">
        <Avatar src={profile.avatar_url} name={profile.name} id={profile.id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-[#0D2145]">{profile.name}</span>
            <UserTypeBadge type={profile.user_type} verified={profile.type_verified} />
          </div>
          {profile.org_name && <div className="text-xs text-[#8E9BB0] mt-0.5">{profile.org_name}</div>}
          {profile.bio && <div className="text-sm text-[#4B5A72] mt-1">{profile.bio}</div>}
          {profile.badges?.length > 0 && (
            <div className="mt-2"><BadgeList badges={profile.badges} size="sm" max={6} showName /></div>
          )}
        </div>
        {/* 私信已门控：不能从冷主页直接私信。先到 TA 的项目帖点「我有兴趣」，对方同意后解锁。 */}
      </div>

      <h2 className="text-sm font-semibold text-[#0D2145] mt-5 mb-3">TA 的帖子</h2>
      {posts.length === 0 ? (
        <div className="text-xs text-[#8E9BB0] text-center py-6">暂无帖子</div>
      ) : (
        <div className="space-y-2.5">{posts.map((p) => <ForumPostCard key={p.id} post={p} />)}</div>
      )}
    </div>
  );
}
