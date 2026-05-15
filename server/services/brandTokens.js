// brandTokens.js — Node 渲染端的设计令牌单一真源
//
// 与 client/src/index.css 的 :root 完全对齐. pptxgenjs / 任何 Node 端 PPT 渲染
// 一律 require("./brandTokens"), 禁止硬编码 hex / 字体名 / 字号.
//
// 修改本文件时, 必须同步更新 client/src/index.css 的 :root 和
// doc-service/brand_tokens.py.

"use strict";

// pptxgenjs 颜色是不带 # 的 6 位 hex 字符串
const COLOR = {
  navy:     "0D2145",
  navy2:    "163069",
  accent:   "1B4FD8",
  accent2:  "3B6EF5",
  gold:     "A0700A",

  ink:      "0F1C36",
  mid:      "4B5A72",
  dim:      "8E9BB0",

  bg:       "F6F7FA",
  bg2:      "FFFFFF",
  bg3:      "EEF1F7",
  bg4:      "E5E9F4",

  border:   "D8DCE8",
  border2:  "BFC5D6",

  red:      "B91C1C",
  redBg:    "FEF2F2",
  green:    "15803D",
  greenBg:  "F0FDF4",
  amber:    "B45309",
  amberBg:  "FFFBEB",

  white:    "FFFFFF",
};

const FONT = {
  cnSerif: "Noto Serif CJK SC",
  cnSans:  "PingFang SC",
  en:      "DM Sans",
  mono:    "JetBrains Mono",
};

const SIZE = {
  coverTitle:  30,
  coverTag:    16,
  coverMeta:   12,
  pageTitle:   20,
  thesis:      14,
  section:     13,
  body:        11,
  table:       10,
  labelInline: 11,
  footer:       9,
};

module.exports = { COLOR, FONT, SIZE };
