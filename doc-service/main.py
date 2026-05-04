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


# ── 一页投资亮点 PPT (投资要点速览) ─────────────────────────

class OnePagerProduct(BaseModel):
    name: str
    desc: str


class OnePagerOverview(BaseModel):
    summary: str
    products: List[OnePagerProduct]


class OnePagerKpi(BaseModel):
    label: str
    value: str


class OnePagerDriver(BaseModel):
    type: str
    text: str


class OnePagerMarket(BaseModel):
    kpis: List[OnePagerKpi]
    drivers: List[OnePagerDriver]
    competition: str


class OnePagerItem(BaseModel):
    title: str
    desc: str


class OnePagerFooter(BaseModel):
    founded: str
    team_size: str
    funding_total: str
    ai_grade: str


class OnePagerPayload(BaseModel):
    company_name: str
    headline: str
    company_overview: OnePagerOverview
    market_opportunity: OnePagerMarket
    highlights: List[OnePagerItem]
    risks: List[OnePagerItem]
    footer: OnePagerFooter


def _set_cn_font(run, size_pt: int, bold: bool = False, color=None,
                 family: str = "Microsoft YaHei"):
    """设置中文友好字体（同时设置 latin / eastAsia typeface）"""
    from pptx.util import Pt
    from lxml import etree
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.name = family
    if color is not None:
        run.font.color.rgb = color
    # 强制东亚字体（python-pptx 默认只设 latin），保证 Mac/WPS 也能渲染
    rPr = run._r.get_or_add_rPr()
    for tag in ("ea", "cs"):
        existing = rPr.find(f"{{http://schemas.openxmlformats.org/drawingml/2006/main}}{tag}")
        if existing is not None:
            rPr.remove(existing)
        el = etree.SubElement(
            rPr, f"{{http://schemas.openxmlformats.org/drawingml/2006/main}}{tag}"
        )
        el.set("typeface", family)


def _build_onepager(payload: OnePagerPayload) -> bytes:
    """渲染一页"投资要点速览"PPT。
    版式严格还原原图：米白底 + 金棕标题 + 红底标语 + 双栏（公司概况 / 市场机会）
    + 投资亮点 4 条 + 投资风险 2 条 + 页脚小条。
    """
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR

    # 配色（贴近原图）
    BG = RGBColor(0xFA, 0xF7, 0xF2)         # 米白底
    GOLD = RGBColor(0x8B, 0x6F, 0x3F)       # 金棕（标题色）
    GOLD_LINE = RGBColor(0xC9, 0xA9, 0x6E)  # 金棕分隔线
    RED = RGBColor(0xA8, 0x29, 0x2A)        # 标语红底
    RED_LABEL = RGBColor(0xC2, 0x3B, 0x3B)  # 板块红色标签 / 红色小标题
    BLACK = RGBColor(0x1A, 0x1A, 0x1A)
    GRAY = RGBColor(0x55, 0x55, 0x55)
    LIGHT = RGBColor(0xF1, 0xE9, 0xDB)      # 板块浅米黄底
    GRAY_BG = RGBColor(0xEE, 0xEA, 0xE2)    # 风险板块灰底

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    s = prs.slides.add_slide(blank)

    def paint_bg():
        rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0,
                                  prs.slide_width, prs.slide_height)
        rect.line.fill.background()
        rect.fill.solid()
        rect.fill.fore_color.rgb = BG
        sp = rect._element.getparent()
        sp.remove(rect._element)
        sp.insert(2, rect._element)

    def add_text(left, top, width, height, text, *, size=12, bold=False,
                 color=BLACK, anchor_top=True, line_spacing=None,
                 fill_color=None, line_color=None):
        box = s.shapes.add_textbox(left, top, width, height)
        if fill_color is not None:
            box.fill.solid()
            box.fill.fore_color.rgb = fill_color
        else:
            box.fill.background()
        if line_color is not None:
            box.line.color.rgb = line_color
            box.line.width = Pt(0.75)
        else:
            box.line.fill.background()
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.08)
        tf.margin_right = Inches(0.08)
        tf.margin_top = Inches(0.04)
        tf.margin_bottom = Inches(0.04)
        tf.vertical_anchor = MSO_ANCHOR.TOP if anchor_top else MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        if line_spacing:
            p.line_spacing = line_spacing
        run = p.add_run()
        run.text = text or ""
        _set_cn_font(run, size, bold=bold, color=color)
        return box, tf, p

    def add_filled_rect(left, top, width, height, color):
        rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
        rect.line.fill.background()
        rect.fill.solid()
        rect.fill.fore_color.rgb = color
        return rect

    def add_section_label(left, top, width, text):
        """红色板块小标签（'公司概况' / '市场机会与行业速览' / '投资亮点' / '投资风险'）"""
        add_filled_rect(left, top, width, Inches(0.34), LIGHT)
        add_text(left, top, width, Inches(0.34), text,
                 size=14, bold=True, color=RED_LABEL, anchor_top=False)

    paint_bg()

    # ── 顶部标题 + 金线 ──────────────────────────────────────
    title_text = f"投资要点速览——{payload.company_name}"
    add_text(Inches(0.55), Inches(0.32), Inches(12.2), Inches(0.6),
             title_text, size=26, bold=True, color=GOLD)
    add_filled_rect(Inches(0.55), Inches(0.95), Inches(12.2), Inches(0.025), GOLD_LINE)

    # ── 红底标语条 ──────────────────────────────────────────
    add_filled_rect(Inches(0.55), Inches(1.10), Inches(12.2), Inches(0.55), RED)
    headline_box, _, _ = add_text(
        Inches(0.55), Inches(1.10), Inches(12.2), Inches(0.55),
        payload.headline, size=16, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF),
        anchor_top=False
    )
    headline_box.text_frame.paragraphs[0].alignment = 0  # left

    # ── 左：公司概况 ────────────────────────────────────────
    LEFT_X = Inches(0.55)
    LEFT_W = Inches(5.9)
    BLOCK_TOP = Inches(1.85)
    add_section_label(LEFT_X, BLOCK_TOP, LEFT_W, "公司概况")

    # 公司概况框 + 内容（虚线感用浅边框模拟）
    overview_top = Inches(2.22)
    overview_h = Inches(2.85)
    add_filled_rect(LEFT_X, overview_top, LEFT_W, overview_h, BG)

    # 摘要段
    summary_box, summary_tf, _ = add_text(
        LEFT_X, overview_top, LEFT_W, Inches(1.2),
        payload.company_overview.summary, size=11, color=BLACK,
        line_spacing=1.25
    )
    summary_box.line.color.rgb = GOLD_LINE
    summary_box.line.width = Pt(0.5)

    # 产品/业务条目
    p_top = overview_top + Inches(1.25)
    p_h = (overview_h - Inches(1.25)) // max(len(payload.company_overview.products), 1)
    for i, prod in enumerate(payload.company_overview.products[:3]):
        item_top = p_top + p_h * i
        item_box = s.shapes.add_textbox(LEFT_X, item_top, LEFT_W, p_h)
        item_box.line.fill.background()
        item_box.fill.background()
        tf = item_box.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.08)
        tf.margin_right = Inches(0.08)
        para = tf.paragraphs[0]
        para.line_spacing = 1.2
        r1 = para.add_run()
        r1.text = f"{prod.name}："
        _set_cn_font(r1, 11, bold=True, color=RED_LABEL)
        r2 = para.add_run()
        r2.text = prod.desc
        _set_cn_font(r2, 11, color=BLACK)

    # ── 右：市场机会与行业速览 ─────────────────────────────
    RIGHT_X = Inches(6.65)
    RIGHT_W = Inches(6.10)
    add_section_label(RIGHT_X, BLOCK_TOP, RIGHT_W, "市场机会与行业速览")

    market_top = Inches(2.22)
    market_h = Inches(2.85)
    add_filled_rect(RIGHT_X, market_top, RIGHT_W, market_h, BG)

    # KPI 行（4 列）
    kpi_h = Inches(0.7)
    kpi_w = RIGHT_W // 4
    for i, kpi in enumerate(payload.market_opportunity.kpis[:4]):
        x = RIGHT_X + kpi_w * i
        # 标签
        label_box, _, lp = add_text(
            x, market_top + Inches(0.05), kpi_w, Inches(0.28),
            kpi.label, size=10, bold=True, color=GRAY, anchor_top=False
        )
        lp.alignment = 1  # center
        # 值
        val_box, _, vp = add_text(
            x, market_top + Inches(0.30), kpi_w, Inches(0.40),
            kpi.value, size=13, bold=True, color=RED_LABEL, anchor_top=False
        )
        vp.alignment = 1  # center

    # 驱动力 3 条
    drv_top = market_top + Inches(0.85)
    drv_h = Inches(0.45)
    for i, drv in enumerate(payload.market_opportunity.drivers[:3]):
        y = drv_top + drv_h * i
        box = s.shapes.add_textbox(RIGHT_X + Inches(0.1), y,
                                    RIGHT_W - Inches(0.2), drv_h)
        box.line.fill.background()
        box.fill.background()
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.05)
        tf.margin_right = Inches(0.05)
        p = tf.paragraphs[0]
        p.line_spacing = 1.15
        r1 = p.add_run()
        r1.text = f"〔{drv.type}〕 "
        _set_cn_font(r1, 10, bold=True, color=RED_LABEL)
        r2 = p.add_run()
        r2.text = drv.text
        _set_cn_font(r2, 10, color=BLACK)

    # 竞争格局
    comp_top = drv_top + drv_h * 3 + Inches(0.05)
    comp_box = s.shapes.add_textbox(RIGHT_X + Inches(0.1), comp_top,
                                     RIGHT_W - Inches(0.2), Inches(0.55))
    comp_box.line.fill.background()
    comp_box.fill.background()
    ctf = comp_box.text_frame
    ctf.word_wrap = True
    ctf.margin_left = Inches(0.05)
    cp = ctf.paragraphs[0]
    cp.line_spacing = 1.15
    cr1 = cp.add_run()
    cr1.text = "〔竞争格局〕 "
    _set_cn_font(cr1, 10, bold=True, color=RED_LABEL)
    cr2 = cp.add_run()
    cr2.text = payload.market_opportunity.competition
    _set_cn_font(cr2, 10, color=BLACK)

    # ── 投资亮点（4 条，2x2 网格） ─────────────────────────
    HL_TOP = Inches(5.18)
    HL_H = Inches(1.55)
    add_section_label(LEFT_X, HL_TOP, Inches(12.2), "投资亮点")
    cells_top = HL_TOP + Inches(0.40)
    cell_w = (Inches(12.2) - Inches(0.30)) // 2
    cell_h = (HL_H - Inches(0.40)) // 2
    for i, hl in enumerate(payload.highlights[:4]):
        col = i % 2
        row = i // 2
        x = LEFT_X + (cell_w + Inches(0.30)) * col
        y = cells_top + cell_h * row
        # 标题
        add_text(x, y, cell_w, Inches(0.35),
                 f"· {hl.title}", size=12, bold=True, color=RED_LABEL,
                 anchor_top=False)
        # 描述
        add_text(x + Inches(0.18), y + Inches(0.32), cell_w - Inches(0.18),
                 cell_h - Inches(0.32), hl.desc, size=10, color=BLACK,
                 line_spacing=1.2)

    # ── 投资风险（灰底，2 条横排） ─────────────────────────
    RISK_TOP = Inches(6.78)
    RISK_H = Inches(0.55)
    add_filled_rect(LEFT_X, RISK_TOP, Inches(12.2), RISK_H, GRAY_BG)
    # 标签
    add_text(LEFT_X + Inches(0.1), RISK_TOP, Inches(1.2), RISK_H,
             "投资风险", size=12, bold=True, color=RED_LABEL, anchor_top=False)
    risks = payload.risks[:2]
    risk_area_x = LEFT_X + Inches(1.35)
    risk_area_w = Inches(12.2) - Inches(1.35)
    rw = risk_area_w // max(len(risks), 1)
    for i, rk in enumerate(risks):
        x = risk_area_x + rw * i
        box = s.shapes.add_textbox(x, RISK_TOP, rw, RISK_H)
        box.line.fill.background()
        box.fill.background()
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = Inches(0.05)
        tf.margin_right = Inches(0.10)
        p = tf.paragraphs[0]
        p.line_spacing = 1.15
        r1 = p.add_run()
        r1.text = f"{rk.title}： "
        _set_cn_font(r1, 10, bold=True, color=RED_LABEL)
        r2 = p.add_run()
        r2.text = rk.desc
        _set_cn_font(r2, 10, color=BLACK)

    # ── 页脚小条 ────────────────────────────────────────────
    FOOT_TOP = Inches(7.05)
    f = payload.footer
    foot_text = (
        f"成立年份 {f.founded}　·　团队规模 {f.team_size}"
        f"　·　累计融资 {f.funding_total}　·　{f.ai_grade}"
    )
    add_text(LEFT_X, FOOT_TOP, Inches(12.2), Inches(0.35),
             foot_text, size=9, color=GRAY, anchor_top=False)

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf.getvalue()


@app.post("/generate/onepager")
async def generate_onepager(payload: OnePagerPayload):
    try:
        data = _build_onepager(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"一页 PPT 生成失败: {str(e)}")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": "attachment; filename=onepager.pptx"},
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "doc-extraction"}
