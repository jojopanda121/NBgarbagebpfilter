"""
doc-service/main.py — 文档提取微服务 (FastAPI)

独立微服务，替代 Node.js 的 child_process 调用方式。
Node.js 主后端通过 HTTP 将文件传给 Python 服务进行解析。

启动方式：
  uvicorn main:app --host 0.0.0.0 --port 8001

Docker 启动：
  docker build -t doc-service .
  docker run -p 8001:8001 doc-service
"""

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse

app = FastAPI(title="GarbageBPFilter Doc Service", version="1.0.0")


def extract_pdf_text(file_path: str) -> str:
    """从 PDF 提取文本，先尝试直接提取，文本过少时降级为 OCR"""
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)
    pages_text = []

    for page in doc:
        text = page.get_text("text")
        pages_text.append(text.strip())

    doc.close()
    full_text = "\n".join(pages_text)

    # 如果每页平均文本不足 50 字符，尝试 OCR
    avg_chars = len(full_text) / max(len(pages_text), 1)
    if avg_chars < 50:
        full_text = extract_pdf_ocr(file_path)

    return full_text


def extract_pdf_ocr(file_path: str) -> str:
    """OCR 提取 PDF 文本"""
    import fitz
    from rapidocr_onnxruntime import RapidOCR

    ocr = RapidOCR()
    doc = fitz.open(file_path)
    pages_text = []

    for page in doc:
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")

        result, _ = ocr(img_bytes)
        if result:
            page_text = "\n".join([line[1] for line in result])
            pages_text.append(page_text)

    doc.close()
    return "\n".join(pages_text)


def extract_pptx_text(file_path: str) -> str:
    """从 PPTX 提取文本"""
    from pptx import Presentation

    prs = Presentation(file_path)
    slides_text = []

    for slide in prs.slides:
        slide_parts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        slide_parts.append(text)
        if slide_parts:
            slides_text.append("\n".join(slide_parts))

    return "\n\n".join(slides_text)


@app.post("/extract")
async def extract_text(
    file: UploadFile = File(...),
    mode: str = Form("pdf"),
):
    """
    接收上传的文档文件，提取文本内容。

    Args:
        file: 上传的 PDF 或 PPTX 文件
        mode: 文件类型 ("pdf" 或 "pptx")

    Returns:
        { "text": "提取的文本内容", "chars": 字符数 }
    """
    if mode not in ("pdf", "pptx"):
        raise HTTPException(status_code=400, detail="不支持的文件类型，仅支持 pdf/pptx")

    # 保存到临时文件
    suffix = f".{mode}"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        if mode == "pptx":
            text = extract_pptx_text(tmp_path)
        else:
            text = extract_pdf_text(tmp_path)

        if not text or len(text.strip()) < 10:
            raise HTTPException(
                status_code=422,
                detail="文档提取的文本过少，请检查文件是否包含有效内容",
            )

        return JSONResponse({
            "text": text,
            "chars": len(text),
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文档解析失败: {str(e)}")
    finally:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.get("/health")
async def health():
    return {"status": "ok", "service": "doc-extraction"}
