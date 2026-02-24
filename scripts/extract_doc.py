#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用文档文本提取器（Smart Document Parser）
支持两种模式：
  pptx — 使用 python-pptx 直接提取幻灯片文本与演讲者备注（无 OCR）
  pdf  — 文字优先策略：PyMuPDF 直接提取；仅当 avg_chars_per_page <= 50 时
          回退 RapidOCR（替代 Tesseract，速度更快、无需系统依赖）

用法: python extract_doc.py <path_to_file> <mode>
      mode: pptx | pdf
输出: 纯文本到 stdout；错误时 stderr JSON + exit 1
"""

import sys
import os
import re
import json


# ─────────────────────────────────────────────────────────────
# Mode A: PPTX — python-pptx 直接提取，无需 OCR
# ─────────────────────────────────────────────────────────────

def extract_pptx(file_path: str) -> str:
    """遍历所有幻灯片，提取标题/正文文本框内容及演讲者备注。"""
    try:
        from pptx import Presentation
    except ImportError:
        raise RuntimeError("请安装 python-pptx: pip install python-pptx")

    prs = Presentation(file_path)
    parts = []

    for slide_idx, slide in enumerate(prs.slides, start=1):
        slide_parts = [f"--- 第 {slide_idx} 页 ---"]

        # 遍历所有形状，提取文本框内容（标题、正文等）
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    line = para.text.strip()
                    if line:
                        slide_parts.append(line)

        # 提取演讲者备注（speaker notes）
        if slide.has_notes_slide:
            notes_frame = slide.notes_slide.notes_text_frame
            if notes_frame:
                notes_text = notes_frame.text.strip()
                if notes_text:
                    slide_parts.append(f"[备注] {notes_text}")

        parts.append("\n".join(slide_parts))

    return "\n\n".join(parts).strip()


# ─────────────────────────────────────────────────────────────
# Mode B: PDF — 文字优先 + RapidOCR 兜底
# ─────────────────────────────────────────────────────────────

def extract_pdf(file_path: str) -> str:
    """
    Step 1: 用 PyMuPDF 直接抽取文字层。
    Step 2: 计算 avg_chars_per_page = total_text_len / num_pages。
    Step 3: avg_chars_per_page > 50  → 快速路径，直接返回文字。
            avg_chars_per_page <= 50 → 慢速路径，对页面图像运行 RapidOCR。
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise RuntimeError("请安装 PyMuPDF: pip install pymupdf")

    doc = fitz.open(file_path)

    # 检测加密 PDF
    if doc.is_encrypted:
        if not doc.authenticate(""):
            doc.close()
            raise RuntimeError("PDF 已加密且需要密码，请上传未加密的 PDF 文件")

    num_pages = len(doc)
    if num_pages == 0:
        doc.close()
        raise RuntimeError("PDF 文件为空（0 页），请检查文件是否完整")

    # Step 1: 提取文字层
    parts = []
    for i in range(num_pages):
        try:
            parts.append(doc[i].get_text() or "")
        except Exception as e:
            print(f"警告: 第 {i+1} 页提取失败: {e}", file=sys.stderr)
            parts.append("")

    text = "\n".join(parts).replace("\r\n", "\n").strip()

    # Step 2: 密度检查
    avg_chars_per_page = len(text) / num_pages

    # Step 3: 决策
    if avg_chars_per_page > 50:
        # 快速路径：文字版 PDF，直接返回
        doc.close()
        return re.sub(r"[ \t]+", " ", text)

    # 慢速路径：扫描版 PDF，启动 RapidOCR
    print(
        f"提示: 每页均字符数 {avg_chars_per_page:.1f} <= 50，启动 RapidOCR...",
        file=sys.stderr,
    )

    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        raise RuntimeError(
            "OCR 回退需要: pip install rapidocr_onnxruntime numpy"
        )

    ocr = RapidOCR()
    ocr_parts = []

    for i in range(num_pages):
        try:
            # 渲染页面为像素图（200 dpi）
            pix = doc[i].get_pixmap(dpi=200)
            # 转换为 numpy 数组（RapidOCR 接受 numpy array）
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            # PyMuPDF 默认 RGB(3) 或 RGBA(4)，RapidOCR 需要 RGB
            if pix.n == 4:
                img = img[:, :, :3]
            result, _ = ocr(img)
            if result:
                page_text = "\n".join(line[1] for line in result)
                ocr_parts.append(page_text)
            else:
                ocr_parts.append("")
        except Exception as e:
            print(f"警告: 第 {i+1} 页 OCR 失败: {e}", file=sys.stderr)
            ocr_parts.append("")

    doc.close()

    ocr_text = "\n".join(ocr_parts).replace("\r\n", "\n").strip()
    # 若 OCR 也未提取到内容，回退到原始文字层（可能极少）
    final = ocr_text if ocr_text else text
    return re.sub(r"[ \t]+", " ", final)


# ─────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("用法: python extract_doc.py <path_to_file> <mode>", file=sys.stderr)
        print("  mode: pptx | pdf", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    mode = sys.argv[2].lower()

    if not os.path.isfile(file_path):
        print(
            json.dumps({"error": f"文件不存在: {file_path}"}, ensure_ascii=False),
            file=sys.stderr,
        )
        sys.exit(1)

    file_size = os.path.getsize(file_path)
    if file_size == 0:
        print(
            json.dumps({"error": "文件大小为 0，请检查文件是否上传完整"}, ensure_ascii=False),
            file=sys.stderr,
        )
        sys.exit(1)
    if file_size < 100:
        print(
            json.dumps(
                {"error": f"文件大小异常（{file_size} 字节），可能不是有效文件"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        if mode == "pptx":
            out = extract_pptx(file_path)
        elif mode == "pdf":
            out = extract_pdf(file_path)
        else:
            raise ValueError(f"不支持的 mode: {mode}，请使用 pptx 或 pdf")

        if not out:
            print("警告: 未能从文件中提取到任何文本", file=sys.stderr)
            sys.exit(1)

        print(out, end="")

    except Exception as e:
        print(
            json.dumps({"error": str(e)}, ensure_ascii=False),
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
