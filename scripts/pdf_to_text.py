#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF → 纯文本（String）
- 优先用 PyMuPDF 直接抽取文字（文字版 PDF）
- 若每页文字很少则用 OCR（扫描版 PDF，需安装 tesseract + chi_sim）
用法: python pdf_to_text.py <path_to.pdf>
输出: 纯文本到 stdout；错误时 stderr + exit 1

依赖检查（启动时执行）：
  核心依赖 fitz (PyMuPDF) 必须存在，否则直接退出并给出安装提示。
  OCR 依赖（pdf2image、pytesseract）仅在扫描版 PDF 时才需要，缺失时给出警告。
"""

import sys
import os
import re
import json

# ── 启动时依赖检查 ─────────────────────────────────────────────
def _check_dependencies():
    """在模块加载时立即验证核心依赖是否可用，给出明确的安装提示。"""
    missing_core = []
    try:
        import fitz  # noqa: F401
    except ImportError:
        missing_core.append("pymupdf  # pip install pymupdf")

    if missing_core:
        print(
            "[pdf_to_text] 缺少核心依赖，请先安装：\n  pip install "
            + " ".join(missing_core),
            file=sys.stderr,
        )
        sys.exit(1)

    # OCR 依赖是可选的，缺失时仅警告
    missing_ocr = []
    try:
        import pdf2image  # noqa: F401
    except ImportError:
        missing_ocr.append("pdf2image")
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        missing_ocr.append("pytesseract")

    if missing_ocr:
        print(
            "[pdf_to_text] 警告：OCR 可选依赖未安装（"
            + ", ".join(missing_ocr)
            + "），扫描版 PDF 将无法识别。\n"
            "  安装方法: pip install pdf2image pytesseract Pillow\n"
            "  系统依赖: tesseract-ocr, poppler-utils",
            file=sys.stderr,
        )


_check_dependencies()
# ──────────────────────────────────────────────────────────────

def extract_with_pymupdf(pdf_path: str):
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise RuntimeError("请安装 PyMuPDF: pip install pymupdf")

    doc = fitz.open(pdf_path)
    num_pages = len(doc)
    parts = []
    for i in range(num_pages):
        parts.append(doc[i].get_text() or "")
    doc.close()
    text = "\n".join(parts).replace("\r\n", "\n").strip()
    return text, num_pages


def extract_with_ocr(pdf_path: str) -> str:
    try:
        from pdf2image import convert_from_path
        import pytesseract
    except ImportError as e:
        raise RuntimeError("OCR 需要: pip install pdf2image pytesseract Pillow；系统需安装 poppler 和 tesseract-ocr（中文: tesseract-lang）")

    images = convert_from_path(pdf_path, dpi=200)
    texts = []
    # 中英混合 BP 常用 chi_sim + eng；若未装 chi_sim 则仅用 eng
    try:
        langs = pytesseract.get_languages()
        lang = "chi_sim+eng" if "chi_sim" in langs else "eng"
    except Exception:
        lang = "eng"
    for img in images:
        text = pytesseract.image_to_string(img, lang=lang)
        texts.append(text or "")
    return "\n".join(texts).replace("\r\n", "\n").strip()


def pdf_to_text(pdf_path: str) -> str:
    if not os.path.isfile(pdf_path):
        raise FileNotFoundError(f"文件不存在: {pdf_path}")

    # 1) 先用 PyMuPDF 抽文字
    text, num_pages = extract_with_pymupdf(pdf_path)

    # 2) 若整份 PDF 几乎没字（扫描版），走 OCR
    min_chars_per_page = 80
    if num_pages > 0 and len(text.strip()) < num_pages * min_chars_per_page:
        text = extract_with_ocr(pdf_path)

    # 简单归一化空白
    return re.sub(r"[ \t]+", " ", (text or "").strip()) if text else ""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python pdf_to_text.py <path_to.pdf>", file=sys.stderr)
        sys.exit(1)
    pdf_path = sys.argv[1]
    try:
        out = pdf_to_text(pdf_path)
        print(out, end="")
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
