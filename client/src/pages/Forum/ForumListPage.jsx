// ForumListPage — 论坛首页：板块 + 排序 + 帖子流 + 游客软墙
import React, { useEffect, useState, useCallback } from "react";
import { Loader2, PenSquare } from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import ForumPostCard from "../../components/forum/ForumPostCard";
import RegistrationGate from "../../components/forum/RegistrationGate";
import ForumDisclaimer from "../../components/forum/ForumDisclaimer";
import Seo from "../../components/Seo";
import NewDiscussionModal from "./NewDiscussionModal";
import { FORUM_CATEGORIES, SORT_OPTIONS } from "../../constants/forum";

export default function ForumListPage() {
  const token = useAuthStore((s) => s.token);
  const [category, setCategory] = useState(""); // "" = 全部
  const [sort, setSort] = useState("latest");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await forumApi.listPosts({ category: category || undefined, sort, page });
      setData(r);
    } catch (e) {
      setData({ items: [], total: 0, gated: false });
    } finally {
      setLoading(false);
    }
  }, [category, sort, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setPage(1);
  }, [category, sort]);

  const items = data?.items || [];
  const totalPages =
    data && !data.gated ? Math.ceil((data.total || 0) / (data.page_size || 20)) : 1;

  return (
    <div className="max-w-4xl mx-auto px-4 py-5">
      <Seo
        title="投资人论坛 — 优质项目 / 行业讨论 / 找钱找项目"
        description="垃圾BP过滤机投资人社区：带平台实测评分的优质项目、一级市场赛道讨论，以及找钱/找项目供需对接。内容公开可检索，登录后参与讨论与撮合。"
        path="/forum"
      />
      {/* 顶部说明 + 发帖 */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-xs text-[#4B5A72] mt-0.5">
          高分项目 · 行业交流 · 投融资撮合。论坛分数均为平台实测脱敏快照。
        </p>
        {token && (
          <button
            onClick={() => setShowNew(true)}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-lg font-semibold"
          >
            <PenSquare className="w-4 h-4" /> 发帖
          </button>
        )}
      </div>

      {/* 板块 */}
      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
        <Chip active={category === ""} onClick={() => setCategory("")}>
          全部
        </Chip>
        {FORUM_CATEGORIES.map((c) => (
          <Chip key={c.key} active={category === c.key} onClick={() => setCategory(c.key)}>
            <c.Icon className="w-3.5 h-3.5" /> {c.label}
          </Chip>
        ))}
        <div className="flex-1" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-xs border border-[#D8DCE8] rounded-lg px-2 py-1.5 text-[#4B5A72] bg-white shrink-0"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#8E9BB0]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-sm text-[#8E9BB0]">还没有帖子，来发布第一个吧</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((p) => (
            <ForumPostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      {/* 游客软墙 */}
      {!token && data?.gated && (
        <div className="mt-4">
          <RegistrationGate message="还有更多高分项目与讨论，登录后查看全部" />
        </div>
      )}

      {/* 分页（登录用户） */}
      {token && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-5 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 rounded-lg border border-[#D8DCE8] disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-[#8E9BB0]">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-lg border border-[#D8DCE8] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      <ForumDisclaimer variant="footer" />

      {showNew && (
        <NewDiscussionModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-[#1B4FD8] text-white"
          : "bg-white border border-[#D8DCE8] text-[#4B5A72] hover:bg-[#EEF1F7]"
      }`}
    >
      {children}
    </button>
  );
}
