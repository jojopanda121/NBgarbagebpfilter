// ReactionBar — 表情回应（emoji + 定制贴纸）。社区趣味层。
import React, { useState } from "react";
import { Smile } from "lucide-react";
import forumApi from "../../services/forumApi";
import { Sticker, STICKERS } from "./stickers/registry";

// 必须与后端白名单 REACTION_EMOJIS 一致（forumService.js）
const EMOJIS = ["👍", "❤️", "😂", "🔥", "👏", "🎉", "💡", "🤔", "👀", "🚀", "😮", "😅", "🙏", "💪", "🤝", "📈", "📉", "💰", "🧐", "🥲"];

export function ReactionGlyph({ reaction, size = 18 }) {
  if (typeof reaction !== "string") return null;
  if (reaction.startsWith("sticker:")) return <Sticker id={reaction.slice(8)} size={size} />;
  if (reaction.startsWith("emoji:")) return <span style={{ fontSize: Math.round(size * 0.8) }}>{reaction.slice(6)}</span>;
  return null;
}

export default function ReactionBar({ reactions = [], targetType, targetId, disabled = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle(reaction) {
    if (disabled || busy) return;
    setBusy(true);
    try {
      const r = await forumApi.react(targetType, targetId, reaction);
      onChange?.(r.reactions || []);
      setOpen(false);
    } catch { /* noop */ } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {reactions.map((x) => (
        <button key={x.reaction} onClick={() => toggle(x.reaction)} disabled={disabled}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs transition-colors ${
            x.mine ? "border-[#1B4FD8] bg-[#EEF1F7]" : "border-[#D8DCE8] bg-white hover:border-[#9AA6BF]"
          } ${disabled ? "cursor-default" : ""}`}>
          <ReactionGlyph reaction={x.reaction} size={16} />
          <span className="text-[#4B5A72]">{x.count}</span>
        </button>
      ))}

      {!disabled && (
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} aria-label="添加表情"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-[#C2CAD9] text-[#8E9BB0] hover:text-[#1B4FD8] hover:border-[#1B4FD8]">
            <Smile className="w-3.5 h-3.5" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute z-20 mt-1 left-0 w-64 bg-white border border-[#D8DCE8] rounded-xl shadow-lg p-2">
                <div className="grid grid-cols-8 gap-0.5">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => toggle(`emoji:${e}`)} className="text-base hover:bg-[#EEF1F7] rounded p-0.5 leading-none">{e}</button>
                  ))}
                </div>
                <div className="text-[10px] text-[#8E9BB0] mt-2 mb-1">贴纸</div>
                <div className="grid grid-cols-5 gap-1">
                  {STICKERS.map((s) => (
                    <button key={s.id} title={s.label} onClick={() => toggle(`sticker:${s.id}`)} className="hover:bg-[#EEF1F7] rounded p-0.5">
                      <Sticker id={s.id} size={28} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
