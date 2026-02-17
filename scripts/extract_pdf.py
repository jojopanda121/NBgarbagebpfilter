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

    # 检测加密 PDF
    if doc.is_encrypted:
        # 尝试空密码解密（部分 PDF 加密但无实际密码）
        if not doc.authenticate(""):
            doc.close()
            raise RuntimeError("PDF 已加密且需要密码，请上传未加密的 PDF 文件")

    num_pages = len(doc)
    if num_pages == 0:
        doc.close()
        raise RuntimeError("PDF 文件为空（0 页），请检查文件是否完整")

    parts = []
    for i in range(num_pages):
        try:
            page_text = doc[i].get_text() or ""
            parts.append(page_text)
        except Exception as e:
            # 单页提取失败不中断整体流程
            print(f"警告: 第 {i+1} 页提取失败: {e}", file=sys.stderr)
            parts.append("")

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

    try:
        images = convert_from_path(pdf_path, dpi=200)
    except Exception as e:
        raise RuntimeError(f"PDF 转图片失败（可能需要安装 poppler-utils）: {e}")

    texts = []
    # 中英混合 BP 常用 chi_sim + eng
    try:
        langs = pytesseract.get_languages()
        lang = "chi_sim+eng" if "chi_sim" in langs else "eng"
        if lang == "eng":
            print("警告: 中文 OCR 包未安装，仅使用英文识别。建议安装: apt-get install tesseract-ocr-chi-sim", file=sys.stderr)
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

    # 检查文件大小
    file_size = os.path.getsize(pdf_path)
    if file_size == 0:
        raise RuntimeError("PDF 文件大小为 0，请检查文件是否上传完整")
    if file_size < 100:
        raise RuntimeError(f"文件大小异常（{file_size} 字节），可能不是有效的 PDF 文件")

    # 1) 先用 PyMuPDF 抽文字
    try:
        text, num_pages = extract_with_pymupdf(pdf_path)
    except RuntimeError:
        raise  # 已知错误直接抛出（加密、空页等）
    except Exception as e:
        raise RuntimeError(f"PDF 解析失败，文件可能已损坏: {e}")

    # 2) 若整份 PDF 文字量过少（可能是扫描版），走 OCR
    min_chars_threshold = 500
    if num_pages > 0 and len(text.strip()) < min_chars_threshold:
        print(f"提示: 文字版提取仅获得 {len(text.strip())} 字符（{num_pages} 页），尝试 OCR...", file=sys.stderr)
        try:
            ocr_text = extract_with_ocr(pdf_path)
            if len(ocr_text.strip()) > len(text.strip()):
                text = ocr_text
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
        if not out:
            print("警告: 未能从 PDF 中提取到任何文本", file=sys.stderr)
            sys.exit(1)
        print(out, end="")
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
