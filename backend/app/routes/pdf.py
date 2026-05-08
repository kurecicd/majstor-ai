from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

router = APIRouter()


class LineItem(BaseModel):
    description: str
    quantity: str
    unit: str
    unit_price: float
    total: float


class QuoteRequest(BaseModel):
    builder_name: str
    customer_name: str
    job_description: str
    items: List[LineItem]
    notes: str = ""


@router.post("/generate")
def generate_pdf(request: QuoteRequest):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", parent=styles["Heading1"], fontSize=20, spaceAfter=6)
    normal = styles["Normal"]
    small = ParagraphStyle("small", parent=normal, fontSize=9)

    story = []

    # Header
    story.append(Paragraph("PONUDA / OFFERT", title_style))
    story.append(Paragraph(f"<b>Majstor:</b> {request.builder_name}", normal))
    story.append(Paragraph(f"<b>Klijent:</b> {request.customer_name}", normal))
    story.append(Spacer(1, 0.3*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.grey))
    story.append(Spacer(1, 0.3*cm))

    story.append(Paragraph(f"<b>Opis posla:</b> {request.job_description}", normal))
    story.append(Spacer(1, 0.5*cm))

    # Items table
    table_data = [["Opis", "Kol.", "Jed.", "Cij. (SEK)", "Ukupno (SEK)"]]
    for item in request.items:
        table_data.append([
            item.description,
            item.quantity,
            item.unit,
            f"{item.unit_price:,.0f}",
            f"{item.total:,.0f}",
        ])

    total_sum = sum(i.total for i in request.items)
    table_data.append(["", "", "", "UKUPNO:", f"{total_sum:,.0f} SEK"])

    table = Table(table_data, colWidths=[7*cm, 2*cm, 1.5*cm, 3*cm, 3*cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d6a4f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f0f0f0")]),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEBELOW", (0, -1), (-1, -1), 1, colors.black),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -2), 0.5, colors.HexColor("#cccccc")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)

    if request.notes:
        story.append(Spacer(1, 0.5*cm))
        story.append(Paragraph(f"<b>Napomena:</b> {request.notes}", small))

    doc.build(story)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="ponuda.pdf"'},
    )
