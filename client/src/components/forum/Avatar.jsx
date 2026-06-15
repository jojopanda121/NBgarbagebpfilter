// Avatar — 论坛头像。有图显示图；无图/加载失败回退「昵称首字 + 按 id 生成的渐变底色」。
import React, { useState } from "react";

const SIZES = {
  xs: { box: "w-6 h-6", text: "text-[10px]" },
  sm: { box: "w-8 h-8", text: "text-xs" },
  md: { box: "w-11 h-11", text: "text-base" },
  lg: { box: "w-20 h-20", text: "text-2xl" },
};

// 按 id 稳定生成一组渐变色（X / 微博风格的彩色默认头像）
const GRADIENTS = [
  ["#1B4FD8", "#5B8DEF"], ["#0F8A5F", "#46C28A"], ["#B45309", "#F0A85A"],
  ["#7C3AED", "#A877F5"], ["#BE123C", "#F2607E"], ["#0E7490", "#4BC4D9"],
  ["#9333EA", "#C77DF5"], ["#C2410C", "#F08A4B"],
];

function firstChar(name) {
  const s = (name || "").trim();
  return s ? s[0].toUpperCase() : "?";
}

export default function Avatar({ src, name, id = 0, size = "sm", className = "" }) {
  const [errored, setErrored] = useState(false);
  const sz = SIZES[size] || SIZES.sm;
  const showImg = src && !errored;

  if (showImg) {
    return (
      <img
        src={src}
        alt={name || "头像"}
        onError={() => setErrored(true)}
        className={`${sz.box} rounded-full object-cover bg-[#EEF1F7] shrink-0 ${className}`}
      />
    );
  }

  const [from, to] = GRADIENTS[Math.abs(Number(id) || 0) % GRADIENTS.length];
  return (
    <div
      className={`${sz.box} ${sz.text} rounded-full shrink-0 flex items-center justify-center font-bold text-white ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-label={name || "头像"}
    >
      {firstChar(name)}
    </div>
  );
}
