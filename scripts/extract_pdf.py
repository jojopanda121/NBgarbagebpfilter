#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF → 纯文本提取器
- 优先用 PyMuPDF (fitz) 直接抽取文字（文字版 PDF）
- 若每页文字太少（<500 字符）则回退到 OCR（扫描版 PDF）
用法: python extract_pdf.py <path_to.pdf>
输出: 纯文本到 stdout；错误时 stderr + exit 1
"""

import sys
import os
import re
import json


def extract_with_pymupdf(pdf_path: str):
    """使用 PyMuPDF 直接提取文字"""
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
    """OCR 回退：将 PDF 转图片后用 tesseract 识别"""
    try:
        from pdf2image import convert_from_path
        import pytesseract
    except ImportError as e:
        raise RuntimeError(
            "OCR 需要: pip install pdf2image pytesseract Pillow；"
            "系统需安装 poppler 和 tesseract-ocr（中文: tesseract-lang）"
        )

    images = convert_from_path(pdf_path, dpi=200)
    texts = []
    # 中英混合 BP 常用 chi_sim + eng
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
    """主入口：提取 PDF 文本，必要时回退到 OCR"""
    if not os.path.isfile(pdf_path):
        raise FileNotFoundError(f"文件不存在: {pdf_path}")

    # 1) 先用 PyMuPDF 抽文字
    text, num_pages = extract_with_pymupdf(pdf_path)

    # 2) 若整份 PDF 文字量过少（可能是扫描版），走 OCR
    min_chars_threshold = 500
    if num_pages > 0 and len(text.strip()) < min_chars_threshold:
        try:
            text = extract_with_ocr(pdf_path)
        except RuntimeError as e:
            # OCR 不可用，返回已有文字
            print(f"OCR 不可用: {e}", file=sys.stderr)

    # 简单归一化空白
    return re.sub(r"[ \t]+", " ", (text or "").strip()) if text else ""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python extract_pdf.py <path_to.pdf>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    try:
        out = pdf_to_text(pdf_path)
        print(out, end="")
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
