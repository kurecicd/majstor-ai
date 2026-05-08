from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List
import io
import base64
import mimetypes

from pypdf import PdfReader
from docx import Document
from openpyxl import load_workbook

router = APIRouter()

MAX_TEXT_PER_FILE = 200_000  # chars per file
MAX_TOTAL_BYTES = 25 * 1024 * 1024  # 25 MB total per request
MAX_IMAGES = 20


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def extract_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(parts)


def extract_pdf_pages_as_images(data: bytes, max_pages: int = 4, dpi: int = 120) -> list[dict]:
    """Render PDF pages to JPEG images using PyMuPDF for Claude vision.

    Returns a list of image dicts compatible with the project files schema.
    Fails silently — caller should catch exceptions and fall back to text-only.
    """
    import fitz  # PyMuPDF
    doc = fitz.open(stream=data, filetype="pdf")
    pages = min(len(doc), max_pages)
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    out = []
    for i in range(pages):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB)
        jpeg_bytes = pix.tobytes("jpeg", jpg_quality=75)
        b64 = base64.b64encode(jpeg_bytes).decode("ascii")
        out.append({
            "kind": "image",
            "name": f"pdf_page_{i + 1}.jpg",
            "media_type": "image/jpeg",
            "data": b64,
        })
    doc.close()
    return out


def extract_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text]
    for table in doc.tables:
        for row in table.rows:
            parts.append("\t".join(c.text for c in row.cells))
    return "\n".join(parts)


def extract_xlsx(data: bytes) -> str:
    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f"# Sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            out.append("\t".join("" if v is None else str(v) for v in row))
    return "\n".join(out)


def extract_text_bytes(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


@router.post("")
async def extract(files: List[UploadFile] = File(...)):
    total = 0
    image_count = 0
    results = []

    for f in files:
        data = await f.read()
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(413, "Upload too large (max 25 MB total)")

        name = f.filename or "file"
        ext = _ext(name)
        ctype = (f.content_type or mimetypes.guess_type(name)[0] or "").lower()

        try:
            if ext == "pdf" or ctype == "application/pdf":
                txt = extract_pdf(data)[:MAX_TEXT_PER_FILE]
                results.append({"kind": "text", "name": name, "text": txt})
            elif ext == "docx":
                txt = extract_docx(data)[:MAX_TEXT_PER_FILE]
                results.append({"kind": "text", "name": name, "text": txt})
            elif ext in ("xlsx", "xlsm"):
                txt = extract_xlsx(data)[:MAX_TEXT_PER_FILE]
                results.append({"kind": "text", "name": name, "text": txt})
            elif ext in ("csv", "tsv", "txt", "md", "log", "json", "yaml", "yml", "xml", "html", "htm"):
                txt = extract_text_bytes(data)[:MAX_TEXT_PER_FILE]
                results.append({"kind": "text", "name": name, "text": txt})
            elif ctype.startswith("image/") or ext in ("png", "jpg", "jpeg", "gif", "webp"):
                if image_count >= MAX_IMAGES:
                    results.append({"kind": "skipped", "name": name, "text": "[Too many images, skipped]"})
                    continue
                if ext == "jpg":
                    media = "image/jpeg"
                elif ctype.startswith("image/"):
                    media = ctype
                else:
                    media = f"image/{ext}"
                b64 = base64.b64encode(data).decode("ascii")
                results.append({"kind": "image", "name": name, "media_type": media, "data": b64})
                image_count += 1
            else:
                results.append({"kind": "unsupported", "name": name, "text": f"[Unsupported file type: {name}]"})
        except Exception as e:
            results.append({"kind": "error", "name": name, "text": f"[Failed to parse {name}: {e}]"})

    return {"files": results}
