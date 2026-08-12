// ForumPostPage — 帖子详情：评分快照 + 正文 + 撮合 + 评论 + 游客软墙
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Loader2,
  Heart,
  Bookmark,
  Flag,
  Handshake,
  Trash2,
  ArrowLeft,
  Send,
  FileText,
  Smile,
} from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import ScoreSnapshotCard from "../../components/forum/ScoreSnapshotCard";
import UserTypeBadge from "../../components/forum/UserTypeBadge";
import Avatar from "../../components/forum/Avatar";
import BadgeList from "../../components/forum/BadgeList";
import RegistrationGate from "../../components/forum/RegistrationGate";
import ForumDisclaimer from "../../components/forum/ForumDisclaimer";
import ReactionBar from "../../components/forum/ReactionBar";
import UnlockedReportModal from "../../components/forum/UnlockedReportModal";
import AttachmentList from "../../components/forum/AttachmentList";
import AttachmentUploader from "../../components/forum/AttachmentUploader";
import Seo from "../../components/Seo";
import { Sticker, STICKERS } from "../../components/forum/stickers/registry";
import InterestModal from "./InterestModal";
import { categoryMeta } from "../../constants/forum";

// 评论正文里的 [[sticker:id]] token → 渲染成贴纸
function renderCommentBody(body) {
  const parts = String(body || "").split(/(\[\[sticker:[a-z-]+\]\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[\[sticker:([a-z-]+)\]\]$/);
    if (m) return <Sticker key={i} id={m[1]} size={40} className="align-middle mx-0.5" />;
    return <span key={i}>{p}</span>;
  });
}

export default function ForumPostPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.user);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentAttachments, setCommentAttachments] = useState([]);
  const [posting, setPosting] = useState(false);
  const [showInterest, setShowInterest] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showCommentStickers, setShowCommentStickers] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <Center>
        <Loader2 className="w-6 h-6 animate-spin text-[#8E9BB0]" />
      </Center>
    );
  if (err || !data)
    return (
      <Center>
        <div className="text-sm text-[#8E9BB0]">{err || "帖子不存在"}</div>
      </Center>
    );

  const { post, comments, viewer, gated } = data;
  const cat = categoryMeta(post.category);
  const CatIcon = cat.Icon;
  const seoDesc =
    (post.body || "").trim().slice(0, 150) ||
    `${post.title}（${cat.label}）— 垃圾BP过滤机投资人论坛`;

  async function toggleLike() {
    if (!token) return navigate("/login");
    try {
      const r = await forumApi.toggleLike("post", post.id);
      setData((d) => ({
        ...d,
        viewer: { ...d.viewer, liked: r.liked },
        post: { ...d.post, like_count: r.like_count },
      }));
    } catch (e) {
      /* noop */
    }
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
    if (!commentText.trim() && commentAttachments.length === 0) return;
    setPosting(true);
    try {
      await forumApi.addComment(post.id, {
        body: commentText.trim(),
        attachments: commentAttachments.length ? commentAttachments : undefined,
      });
      setCommentText("");
      setCommentAttachments([]);
      load();
    } finally {
      setPosting(false);
    }
  }
  async function deleteComment(cid) {
    if (!window.confirm("删除这条评论？")) return;
    await forumApi.deleteComment(cid);
    load();
  }

  // 完整报告:作者/已解锁 → 打开;否则 → 申请(通知发帖人)
  async function openReport() {
    if (!token) return navigate("/login");
    if (post.is_author) {
      setShowReport(true);
      return;
    }
    try {
      await forumApi.getUnlockedReport(post.id);
      setShowReport(true);
    } catch (probeErr) {
      if (probeErr.status !== 403) {
        alert(probeErr.message || "无法打开报告");
        return;
      }
      try {
        const r = await forumApi.requestReport(post.id);
        if (r.already_unlocked) {
          setShowReport(true);
          return;
        }
        alert("已向发帖人申请完整报告，TA 同意后你会收到通知");
      } catch {
        alert("申请失败，请稍后再试");
      }
    }
  }

  function setPostReactions(reactions) {
    setData((d) => ({ ...d, post: { ...d.post, reactions } }));
  }
  function setCommentReactions(cid, reactions) {
    setData((d) => ({
      ...d,
      comments: d.comments.map((c) => (c.id === cid ? { ...c, reactions } : c)),
    }));
  }
  function insertSticker(id) {
    setCommentText((t) => `${t}[[sticker:${id}]]`);
    setShowCommentStickers(false);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <Seo
        title={post.title}
        description={seoDesc}
        path={`/forum/post/${post.id}`}
        type="article"
      />
      <button
        onClick={() => navigate("/forum")}
        className="flex items-center gap-1 text-xs text-[#8E9BB0] hover:text-[#0D2145] mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> 返回论坛
      </button>

      <article className="bg-white border border-[#D8DCE8] rounded-lg p-5">
        {/* 头部 */}
        <div className="flex items-center gap-2 text-[11px] text-[#8E9BB0] mb-2">
          <span className="inline-flex items-center gap-1">
            <CatIcon className="w-3.5 h-3.5" /> {cat.label}
          </span>
          {post.codename && (
            <span className="px-1.5 py-0.5 rounded bg-[#EEF1F7] text-[#4B5A72] font-mono-fin">
              {post.codename}
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold text-[#0D2145]">{post.title}</h1>

        {/* 作者 */}
        <div className="flex items-center gap-2 mt-2 text-sm flex-wrap">
          <button
            onClick={() => post.author?.id && navigate(`/forum/u/${post.author.id}`)}
            className="text-[#4B5A72] hover:text-[#1B4FD8] flex items-center gap-1.5"
          >
            <Avatar
              src={post.author?.avatar_url}
              name={post.author?.name}
              id={post.author?.id}
              size="sm"
            />
            {post.author?.name}
            <UserTypeBadge type={post.author?.user_type} verified={post.author?.type_verified} />
          </button>
          {post.author?.badges?.length > 0 && (
            <BadgeList badges={post.author.badges} size="xs" max={3} />
          )}
          {post.author?.org_name && (
            <span className="text-xs text-[#8E9BB0]">· {post.author.org_name}</span>
          )}
          <span className="text-xs text-[#8E9BB0]">· {post.created_at}</span>
        </div>

        {/* 评分快照 */}
        {post.score && (
          <div className="mt-4">
            <ScoreSnapshotCard score={post.score} />
            {gated && (
              <p className="text-[11px] text-[#8E9BB0] mt-1.5">登录后查看完整亮点与风险旗标</p>
            )}
          </div>
        )}

        {/* 正文 */}
        {post.body && (
          <div className="mt-4 text-sm text-[#0D2145] leading-relaxed whitespace-pre-line">
            {post.body}
          </div>
        )}

        {/* 附件（图片 + 文档，仅登录可见）*/}
        {!gated && post.attachments?.length > 0 && (
          <AttachmentList attachments={post.attachments} />
        )}

        {/* 公开联系方式 */}
        {post.public_contact && (
          <div className="mt-3 text-xs bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg px-3 py-2 text-[#0D2145]">
            <span className="text-[#8E9BB0]">联系方式：</span>
            {post.public_contact}
          </div>
        )}

        {/* 操作栏 */}
        {!gated && (
          <>
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[#EEF1F7]">
              <Action onClick={toggleLike} active={viewer.liked} icon={Heart}>
                {post.like_count}
              </Action>
              <Action onClick={toggleBookmark} active={viewer.bookmarked} icon={Bookmark}>
                收藏
              </Action>
              <Action onClick={report} icon={Flag}>
                举报
              </Action>
              <div className="flex-1" />
              {/* 完整报告:作者预览 / 他人申请查看（授权解锁后可看） */}
              {post.score && (
                <Action onClick={openReport} icon={FileText}>
                  {post.is_author ? "预览完整报告" : "完整报告"}
                </Action>
              )}
              {post.is_author ? (
                <Action onClick={handleDelete} icon={Trash2} danger>
                  删除
                </Action>
              ) : (
                // 私信已门控：先「我有兴趣」，发帖人同意后才解锁站内私信（在「撮合」里进入对话）
                post.allow_contact && (
                  <button
                    onClick={() => (token ? setShowInterest(true) : navigate("/login"))}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-lg font-semibold"
                  >
                    <Handshake className="w-4 h-4" /> 我有兴趣
                  </button>
                )
              )}
            </div>
            {/* 表情回应（社区趣味层） */}
            <div className="mt-3">
              <ReactionBar
                reactions={post.reactions || []}
                targetType="post"
                targetId={post.id}
                disabled={!token}
                onChange={setPostReactions}
              />
            </div>
          </>
        )}
      </article>

      {/* 游客墙 */}
      {gated && (
        <div className="mt-4">
          <RegistrationGate message="登录后查看完整内容、参与讨论与撮合" />
        </div>
      )}

      {/* 评论区 */}
      {!gated && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-[#0D2145] mb-3">
            评论 {comments.length > 0 && `(${comments.length})`}
          </h2>

          {token ? (
            <div className="mb-4 space-y-2">
              <div className="flex gap-2 items-start">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitComment()}
                  placeholder="友善交流，理性讨论…"
                  className="flex-1 border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
                />
                <div className="relative">
                  <button
                    onClick={() => setShowCommentStickers((s) => !s)}
                    aria-label="插入贴纸"
                    className="px-2.5 py-2 border border-[#D8DCE8] rounded-lg text-[#8E9BB0] hover:text-[#1B4FD8] hover:border-[#1B4FD8]"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  {showCommentStickers && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowCommentStickers(false)}
                      />
                      <div className="absolute z-20 mt-1 right-0 w-56 bg-white border border-[#D8DCE8] rounded-xl shadow-lg p-2 grid grid-cols-5 gap-1">
                        {STICKERS.map((s) => (
                          <button
                            key={s.id}
                            title={s.label}
                            onClick={() => insertSticker(s.id)}
                            className="hover:bg-[#EEF1F7] rounded p-0.5"
                          >
                            <Sticker id={s.id} size={28} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={submitComment}
                  disabled={posting || (!commentText.trim() && commentAttachments.length === 0)}
                  className="px-3 py-2 bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 text-sm"
                >
                  {posting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
              <AttachmentUploader
                value={commentAttachments}
                onChange={setCommentAttachments}
                scope="comment"
                disabled={posting}
              />
            </div>
          ) : (
            <div className="mb-4">
              <RegistrationGate message="登录后参与评论" />
            </div>
          )}

          <div className="space-y-3">
            {comments.length === 0 ? (
              <div className="text-xs text-[#8E9BB0] text-center py-6 flex flex-col items-center gap-2">
                <Sticker id="thinking" size={44} /> 还没有评论，来抢沙发~
              </div>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="bg-white border border-[#EEF1F7] rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => c.author?.id && navigate(`/forum/u/${c.author.id}`)}
                      className="flex items-center gap-1.5 text-xs hover:opacity-80"
                    >
                      <Avatar
                        src={c.author.avatar_url}
                        name={c.author.name}
                        id={c.author.id}
                        size="xs"
                      />
                      <span className="text-[#0D2145] font-medium">{c.author.name}</span>
                      <UserTypeBadge
                        type={c.author.user_type}
                        verified={c.author.type_verified}
                        size="xs"
                      />
                      <span className="text-[#8E9BB0]">· {c.created_at}</span>
                    </button>
                    {(c.is_author || me?.role === "admin") && (
                      <button
                        onClick={() => deleteComment(c.id)}
                        className="text-[#8E9BB0] hover:text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-[#0D2145] mt-1 whitespace-pre-line">
                    {renderCommentBody(c.body)}
                  </p>
                  {c.attachments?.length > 0 && (
                    <AttachmentList attachments={c.attachments} compact />
                  )}
                  <div className="mt-2">
                    <ReactionBar
                      reactions={c.reactions || []}
                      targetType="comment"
                      targetId={c.id}
                      disabled={!token}
                      onChange={(rs) => setCommentReactions(c.id, rs)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <ForumDisclaimer variant="footer" />

      {showInterest && (
        <InterestModal
          post={post}
          onClose={() => setShowInterest(false)}
          onDone={() => {
            setShowInterest(false);
            alert("已发送意向，等待对方同意后即可交换联系方式并私信");
          }}
        />
      )}

      {showReport && <UnlockedReportModal postId={post.id} onClose={() => setShowReport(false)} />}
    </div>
  );
}

function Action({ onClick, active, icon: Icon, danger, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
        danger
          ? "text-rose-500 hover:bg-rose-50"
          : active
            ? "text-[#1B4FD8] bg-[#EEF1F7]"
            : "text-[#4B5A72] hover:bg-[#EEF1F7]"
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? "fill-current" : ""}`} /> {children}
    </button>
  );
}

function Center({ children }) {
  return <div className="max-w-3xl mx-auto px-4 py-20 flex justify-center">{children}</div>;
}
