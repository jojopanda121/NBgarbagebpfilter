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

import io
import os
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="GarbageBPFilter Doc Service", version="1.0.0")

# 在应用启动时初始化 OCR 引擎（避免每次请求重新加载模型）
_ocr_engine = None


def _get_ocr():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


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

    ocr = _get_ocr()
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


# ── PPT 生成 ────────────────────────────────────────────────

class SlideSpec(BaseModel):
    title: str
    bullets: Optional[List[str]] = None
    notes: Optional[str] = None


class GeneratePptxPayload(BaseModel):
    title: str
    subtitle: Optional[str] = None
    slides: List[SlideSpec]


def _build_pptx(payload: GeneratePptxPayload) -> bytes:
    """根据 slides JSON 渲染 .pptx 字节流（深色简洁模板）"""
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    BG = RGBColor(0x0F, 0x17, 0x2A)
    ACCENT = RGBColor(0x60, 0xA5, 0xFA)
    TEXT = RGBColor(0xE2, 0xE8, 0xF0)
    SUB = RGBColor(0x94, 0xA3, 0xB8)

    def paint_bg(slide):
        bg_shape = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
        )
        bg_shape.line.fill.background()
        bg_shape.fill.solid()
        bg_shape.fill.fore_color.rgb = BG
        # 把矩形放到最底层
        spTree = bg_shape._element.getparent()
        spTree.remove(bg_shape._element)
        spTree.insert(2, bg_shape._element)

    blank_layout = prs.slide_layouts[6]

    # 封面页
    cover = prs.slides.add_slide(blank_layout)
    paint_bg(cover)
    title_box = cover.shapes.add_textbox(Inches(0.8), Inches(2.6), Inches(11.7), Inches(1.6))
    tf = title_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = payload.title
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = TEXT

    if payload.subtitle:
        sub_box = cover.shapes.add_textbox(Inches(0.8), Inches(4.2), Inches(11.7), Inches(0.8))
        sp = sub_box.text_frame.paragraphs[0]
        sp.text = payload.subtitle
        sp.font.size = Pt(20)
        sp.font.color.rgb = SUB

    # 内容页
    for idx, slide_spec in enumerate(payload.slides, 1):
        s = prs.slides.add_slide(blank_layout)
        paint_bg(s)

        # 顶部装饰条
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(0.55), Inches(0.4), Inches(0.05))
        bar.line.fill.background()
        bar.fill.solid()
        bar.fill.fore_color.rgb = ACCENT

        # 标题
        title_box = s.shapes.add_textbox(Inches(0.8), Inches(0.7), Inches(11.7), Inches(1.0))
        tp = title_box.text_frame.paragraphs[0]
        tp.text = slide_spec.title or f"第 {idx} 页"
        tp.font.size = Pt(30)
        tp.font.bold = True
        tp.font.color.rgb = TEXT

        # 项目符号
        bullets = slide_spec.bullets or []
        if bullets:
            body = s.shapes.add_textbox(Inches(0.9), Inches(1.9), Inches(11.5), Inches(5.0))
            tf = body.text_frame
            tf.word_wrap = True
            for i, bullet in enumerate(bullets):
                if i == 0:
                    para = tf.paragraphs[0]
                else:
                    para = tf.add_paragraph()
                para.text = f"•  {bullet}"
                para.font.size = Pt(18)
                para.font.color.rgb = TEXT
                para.space_after = Pt(8)

        # 页脚页码
        pn = s.shapes.add_textbox(Inches(12.4), Inches(7.0), Inches(0.7), Inches(0.4))
        pp = pn.text_frame.paragraphs[0]
        pp.text = f"{idx}/{len(payload.slides)}"
        pp.font.size = Pt(10)
        pp.font.color.rgb = SUB

        if slide_spec.notes:
            s.notes_slide.notes_text_frame.text = slide_spec.notes

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf.getvalue()


@app.post("/generate/pptx")
async def generate_pptx(payload: GeneratePptxPayload):
    if not payload.slides:
        raise HTTPException(status_code=400, detail="slides 不能为空")
    try:
        data = _build_pptx(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PPT 生成失败: {str(e)}")
    headers = {
        "Content-Disposition": "attachment; filename=presentation.pptx",
    }
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers=headers,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "doc-extraction"}
