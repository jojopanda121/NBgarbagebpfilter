// ForumPostPage — 帖子详情：评分快照 + 正文 + 撮合 + 评论 + 游客软墙
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Heart, Bookmark, Flag, Handshake, Trash2, ArrowLeft, Send } from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import ScoreSnapshotCard from "../../components/forum/ScoreSnapshotCard";
import UserTypeBadge from "../../components/forum/UserTypeBadge";
import Avatar from "../../components/forum/Avatar";
import BadgeList from "../../components/forum/BadgeList";
import RegistrationGate from "../../components/forum/RegistrationGate";
import ForumDisclaimer from "../../components/forum/ForumDisclaimer";
import InterestModal from "./InterestModal";
import { categoryMeta } from "../../constants/forum";

export default function ForumPostPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.user);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showInterest, setShowInterest] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await forumApi.getPost(id);
      setData(r);
    } catch (e) {
      setErr(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Center><Loader2 className="w-6 h-6 animate-spin text-[#8E9BB0]" /></Center>;
  if (err || !data) return <Center><div className="text-sm text-[#8E9BB0]">{err || "帖子不存在"}</div></Center>;

  const { post, comments, viewer, gated } = data;
  const cat = categoryMeta(post.category);
  const CatIcon = cat.Icon;

  async function toggleLike() {
    if (!token) return navigate("/login");
    try {
      const r = await forumApi.toggleLike("post", post.id);
      setData((d) => ({ ...d, viewer: { ...d.viewer, liked: r.liked }, post: { ...d.post, like_count: r.like_count } }));
    } catch (e) { /* noop */ }
  }
  async function toggleBookmark() {
    if (!token) return navigate("/login");
    const r = await forumApi.toggleBookmark(post.id);
    setData((d) => ({ ...d, viewer: { ...d.viewer, bookmarked: r.bookmarked } }));
  }
  async function report() {
    if (!token) return navigate("/login");
    const reason = window.prompt("举报原因（可选）：");
    if (reason === null) return;
    await forumApi.report("post", post.id, reason);
    alert("已提交举报，感谢反馈");
  }
  async function handleDelete() {
    if (!window.confirm("确定删除这条帖子？")) return;
    await forumApi.deletePost(post.id);
    navigate("/forum");
  }
  async function submitComment() {
    if (!token) return navigate("/login");
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      await forumApi.addComment(post.id, { body: commentText.trim() });
      setCommentText("");
      load();
    } finally { setPosting(false); }
  }
  async function deleteComment(cid) {
    if (!window.confirm("删除这条评论？")) return;
    await forumApi.deleteComment(cid);
    load();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <button onClick={() => navigate("/forum")} className="flex items-center gap-1 text-xs text-[#8E9BB0] hover:text-[#0D2145] mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回论坛
      </button>

      <article className="bg-white border border-[#D8DCE8] rounded-lg p-5">
        {/* 头部 */}
        <div className="flex items-center gap-2 text-[11px] text-[#8E9BB0] mb-2">
          <span className="inline-flex items-center gap-1"><CatIcon className="w-3.5 h-3.5" /> {cat.label}</span>
          {post.codename && <span className="px-1.5 py-0.5 rounded bg-[#EEF1F7] text-[#4B5A72] font-mono-fin">{post.codename}</span>}
        </div>
        <h1 className="text-xl font-bold text-[#0D2145]">{post.title}</h1>

        {/* 作者 */}
        <div className="flex items-center gap-2 mt-2 text-sm flex-wrap">
          <button onClick={() => post.author?.id && navigate(`/forum/u/${post.author.id}`)} className="text-[#4B5A72] hover:text-[#1B4FD8] flex items-center gap-1.5">
            <Avatar src={post.author?.avatar_url} name={post.author?.name} id={post.author?.id} size="sm" />
            {post.author?.name}
            <UserTypeBadge type={post.author?.user_type} verified={post.author?.type_verified} />
          </button>
          {post.author?.badges?.length > 0 && <BadgeList badges={post.author.badges} size="xs" max={3} />}
          {post.author?.org_name && <span className="text-xs text-[#8E9BB0]">· {post.author.org_name}</span>}
          <span className="text-xs text-[#8E9BB0]">· {post.created_at}</span>
        </div>

        {/* 评分快照 */}
        {post.score && (
          <div className="mt-4">
            <ScoreSnapshotCard score={post.score} />
            {gated && <p className="text-[11px] text-[#8E9BB0] mt-1.5">登录后查看完整亮点与风险旗标</p>}
          </div>
        )}

        {/* 正文 */}
        {post.body && (
          <div className="mt-4 text-sm text-[#0D2145] leading-relaxed whitespace-pre-line">{post.body}</div>
        )}

        {/* 公开联系方式 */}
        {post.public_contact && (
          <div className="mt-3 text-xs bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg px-3 py-2 text-[#0D2145]">
            <span className="text-[#8E9BB0]">联系方式：</span>{post.public_contact}
          </div>
        )}

        {/* 操作栏 */}
        {!gated && (
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[#EEF1F7]">
            <Action onClick={toggleLike} active={viewer.liked} icon={Heart}>{post.like_count}</Action>
            <Action onClick={toggleBookmark} active={viewer.bookmarked} icon={Bookmark}>收藏</Action>
            <Action onClick={report} icon={Flag}>举报</Action>
            <div className="flex-1" />
            {post.is_author ? (
              <Action onClick={handleDelete} icon={Trash2} danger>删除</Action>
            ) : (
              // 私信已门控：先「我有兴趣」，发帖人同意后才解锁站内私信（在「撮合」里进入对话）
              post.allow_contact && (
                <button onClick={() => (token ? setShowInterest(true) : navigate("/login"))}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-lg font-semibold">
                  <Handshake className="w-4 h-4" /> 我有兴趣
                </button>
              )
            )}
          </div>
        )}
      </article>

      {/* 游客墙 */}
      {gated && (
        <div className="mt-4"><RegistrationGate message="登录后查看完整内容、参与讨论与撮合" /></div>
      )}

      {/* 评论区 */}
      {!gated && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-[#0D2145] mb-3">评论 {comments.length > 0 && `(${comments.length})`}</h2>

          {token ? (
            <div className="flex gap-2 mb-4">
              <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitComment()}
                placeholder="友善交流，理性讨论…"
                className="flex-1 border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm" />
              <button onClick={submitComment} disabled={posting || !commentText.trim()}
                className="px-3 py-2 bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 text-sm">
                {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="mb-4"><RegistrationGate message="登录后参与评论" /></div>
          )}

          <div className="space-y-3">
            {comments.length === 0 ? (
              <div className="text-xs text-[#8E9BB0] text-center py-6">还没有评论，来说两句</div>
            ) : comments.map((c) => (
              <div key={c.id} className="bg-white border border-[#EEF1F7] rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <button onClick={() => c.author?.id && navigate(`/forum/u/${c.author.id}`)} className="flex items-center gap-1.5 text-xs hover:opacity-80">
                    <Avatar src={c.author.avatar_url} name={c.author.name} id={c.author.id} size="xs" />
                    <span className="text-[#0D2145] font-medium">{c.author.name}</span>
                    <UserTypeBadge type={c.author.user_type} verified={c.author.type_verified} size="xs" />
                    <span className="text-[#8E9BB0]">· {c.created_at}</span>
                  </button>
                  {(c.is_author || me?.role === "admin") && (
                    <button onClick={() => deleteComment(c.id)} className="text-[#8E9BB0] hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
                <p className="text-sm text-[#0D2145] mt-1 whitespace-pre-line">{c.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <ForumDisclaimer variant="footer" />

      {showInterest && (
        <InterestModal post={post} onClose={() => setShowInterest(false)}
          onDone={() => { setShowInterest(false); alert("已发送意向，等待对方同意后即可交换联系方式并私信"); }} />
      )}
    </div>
  );
}

function Action({ onClick, active, icon: Icon, danger, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
        danger ? "text-rose-500 hover:bg-rose-50"
        : active ? "text-[#1B4FD8] bg-[#EEF1F7]" : "text-[#4B5A72] hover:bg-[#EEF1F7]"
      }`}>
      <Icon className={`w-4 h-4 ${active ? "fill-current" : ""}`} /> {children}
    </button>
  );
}

function Center({ children }) {
  return <div className="max-w-3xl mx-auto px-4 py-20 flex justify-center">{children}</div>;
}
