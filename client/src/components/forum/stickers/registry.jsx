// ============================================================
// 论坛定制卡通贴纸（社区趣味层）
//
// 一套手画 SVG 卡通角色,投资主题。复用三处:表情回应 / 插进评论 / 空状态。
// 边界:只在社区区出现,绝不进评分报告/风险旗标/免责。
// id 必须与后端白名单 STICKER_IDS 一致(forumService.js)。
// 浅色主题固定配色(论坛 bg 为 #F6F7FA)。
// ============================================================
import React from "react";

const Eyes = ({ y = 21 }) => (
  <>
    <circle cx="18" cy={y} r="2.3" fill="#26314A" />
    <circle cx="30" cy={y} r="2.3" fill="#26314A" />
  </>
);

function Base({ bg, children, label }) {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" role="img" aria-label={label}>
      <rect x="4" y="5" width="40" height="38" rx="13" fill={bg} />
      {children}
    </svg>
  );
}

// ── 10 个贴纸 ──
const RENDER = {
  bullish: () => (
    <Base bg="#D6F5DE" label="看好">
      <Eyes />
      <path d="M16 28 Q24 35 32 28" stroke="#1B7A46" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M35 16 l4 -4 m0 0 l-3.2 0 m3.2 0 l0 3.2" stroke="#1B7A46" strokeWidth="2" fill="none" strokeLinecap="round" />
    </Base>
  ),
  pass: () => (
    <Base bg="#E5E9F4" label="pass">
      <Eyes />
      <line x1="17" y1="31" x2="31" y2="31" stroke="#6B7794" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M33 14 l5 5 M38 14 l-5 5" stroke="#A23B3B" strokeWidth="2" strokeLinecap="round" />
    </Base>
  ),
  "show-me-bp": () => (
    <Base bg="#D8E6FF" label="求BP">
      <circle cx="18" cy="21" r="3" fill="#fff" /><circle cx="18" cy="21" r="1.6" fill="#26314A" />
      <circle cx="30" cy="21" r="3" fill="#fff" /><circle cx="30" cy="21" r="1.6" fill="#26314A" />
      <path d="M19 29 Q24 33 29 29" stroke="#1B4FD8" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <rect x="20" y="33" width="8" height="6" rx="1" fill="#fff" stroke="#1B4FD8" strokeWidth="1.3" />
    </Base>
  ),
  "valuation-wild": () => (
    <Base bg="#FFE3C2" label="估值离谱">
      <circle cx="18" cy="21" r="3.4" fill="#fff" stroke="#C76A1E" strokeWidth="1.2" /><circle cx="18" cy="21" r="1.5" fill="#26314A" />
      <circle cx="30" cy="21" r="3.4" fill="#fff" stroke="#C76A1E" strokeWidth="1.2" /><circle cx="30" cy="21" r="1.5" fill="#26314A" />
      <ellipse cx="24" cy="32" rx="3.4" ry="4" fill="#C76A1E" />
    </Base>
  ),
  "old-leek": () => (
    <Base bg="#E7F6EF" label="老韭菜">
      <path d="M16 16 l2 8 M24 14 l0 10 M32 16 l-2 8" stroke="#2E9E5B" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="16" y="24" width="16" height="11" rx="3" fill="#F4FBF7" stroke="#2E9E5B" strokeWidth="1.4" />
      <circle cx="20.5" cy="29" r="1.5" fill="#26314A" /><circle cx="27.5" cy="29" r="1.5" fill="#26314A" />
      <path d="M21 32.5 Q24 34 27 32.5" stroke="#8A93A6" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </Base>
  ),
  "due-diligence": () => (
    <Base bg="#D7F0EE" label="尽调中">
      <Eyes />
      <path d="M19 30 Q24 33 29 30" stroke="#147C74" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="30" r="5" fill="none" stroke="#147C74" strokeWidth="2.2" />
      <line x1="35.6" y1="33.6" x2="39" y2="37" stroke="#147C74" strokeWidth="2.4" strokeLinecap="round" />
    </Base>
  ),
  "money-eyes": () => (
    <Base bg="#FFF0B8" label="真香">
      <text x="18" y="25" fontSize="9" fontWeight="700" fill="#C99A18" textAnchor="middle">$</text>
      <text x="30" y="25" fontSize="9" fontWeight="700" fill="#C99A18" textAnchor="middle">$</text>
      <path d="M17 30 Q24 37 31 30" stroke="#C99A18" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </Base>
  ),
  skeptical: () => (
    <Base bg="#E8E0FB" label="存疑">
      <line x1="14.5" y1="17" x2="21" y2="18.5" stroke="#6B4FB0" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="22" r="2.3" fill="#26314A" /><circle cx="30" cy="22" r="2.3" fill="#26314A" />
      <path d="M18 31 Q24 29 30 31" stroke="#6B4FB0" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </Base>
  ),
  congrats: () => (
    <Base bg="#FBE0EC" label="撮合成功">
      <Eyes />
      <path d="M17 28 Q24 36 31 28" stroke="#C13C77" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="11" cy="12" r="1.6" fill="#F0B429" /><circle cx="38" cy="13" r="1.6" fill="#1B7A46" />
      <circle cx="36" cy="9" r="1.4" fill="#1B4FD8" /><circle cx="13" cy="8" r="1.4" fill="#C13C77" />
    </Base>
  ),
  thinking: () => (
    <Base bg="#EEF1F7" label="思考">
      <Eyes y={20} />
      <line x1="18" y1="30" x2="26" y2="30" stroke="#6B7794" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="35" cy="14" r="2.4" fill="#fff" stroke="#9AA6BF" strokeWidth="1.2" />
      <circle cx="31" cy="18" r="1.3" fill="#fff" stroke="#9AA6BF" strokeWidth="1" />
    </Base>
  ),
};

export const STICKERS = [
  { id: "bullish", label: "看好" },
  { id: "pass", label: "Pass" },
  { id: "show-me-bp", label: "求BP" },
  { id: "valuation-wild", label: "估值离谱" },
  { id: "old-leek", label: "老韭菜" },
  { id: "due-diligence", label: "尽调中" },
  { id: "money-eyes", label: "真香" },
  { id: "skeptical", label: "存疑" },
  { id: "congrats", label: "撮合成功" },
  { id: "thinking", label: "思考" },
];

export function Sticker({ id, size = 28, className = "" }) {
  const r = RENDER[id];
  return (
    <span style={{ width: size, height: size, display: "inline-block", lineHeight: 0 }} className={className} aria-hidden={false}>
      {r ? r() : <Base bg="#EEF1F7" label="贴纸"><Eyes /></Base>}
    </span>
  );
}

export default Sticker;
