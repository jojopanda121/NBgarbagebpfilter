// ForumPostCard — 列表里的帖子卡片
import React from "react";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, Handshake, Eye } from "lucide-react";
import UserTypeBadge from "./UserTypeBadge";
import { gradeColorClass, categoryMeta } from "../../constants/forum";

export default function ForumPostCard({ post }) {
  const navigate = useNavigate();
  const cat = categoryMeta(post.category);
  const CatIcon = cat.Icon;
  const score = post.score;

  return (
    <article
      onClick={() => navigate(`/forum/post/${post.id}`)}
      className="bg-white border border-[#D8DCE8] rounded-lg p-4 hover:border-[#1B4FD8] hover:shadow-[0_4px_18px_rgba(27,79,216,0.08)] transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {/* 分数块（评分帖才有） */}
        {score && (
          <div className="flex flex-col items-center justify-center px-2.5 py-1.5 bg-[#F6F7FA] rounded-lg min-w-[58px] shrink-0">
            <span className={`text-2xl font-black ${gradeColorClass(score.grade)} font-mono-fin leading-none`}>
              {score.total_score}
            </span>
            <span className={`text-xs font-bold ${gradeColorClass(score.grade)} mt-0.5`}>{score.grade}</span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="inline-flex items-center gap-1 text-[11px] text-[#8E9BB0]"><CatIcon className="w-3 h-3" /> {cat.label}</span>
            {post.codename && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#EEF1F7] text-[#4B5A72] font-mono-fin">{post.codename}</span>
            )}
            {score && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E7F6EF] text-[#0F8A5F]">平台实测</span>
            )}
          </div>

          <h3 className="text-[15px] font-semibold text-[#0D2145] truncate">{post.title}</h3>
          {post.excerpt && (
            <p className="text-xs text-[#4B5A72] mt-1 line-clamp-2">{post.excerpt}</p>
          )}

          <div className="flex items-center gap-3 mt-2.5 text-xs text-[#8E9BB0]">
            <span className="flex items-center gap-1 text-[#4B5A72]">
              {post.author?.name}
              <UserTypeBadge type={post.author?.user_type} verified={post.author?.type_verified} size="xs" />
            </span>
            <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{post.like_count}</span>
            <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{post.comment_count}</span>
            {post.interest_count > 0 && (
              <span className="flex items-center gap-1 text-[#1B4FD8]"><Handshake className="w-3.5 h-3.5" />{post.interest_count}</span>
            )}
            <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.view_count}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
