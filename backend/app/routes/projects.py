from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from typing import List, Dict, Optional, Generator
from pydantic import BaseModel
import uuid
import base64
import mimetypes
import json as json_lib
import anthropic

from app.config import get_settings
from app import storage
from app.routes.extract import (
    _ext,
    extract_pdf,
    extract_pdf_pages_as_images,
    extract_docx,
    extract_xlsx,
    extract_text_bytes,
    MAX_TEXT_PER_FILE,
    MAX_TOTAL_BYTES,
    MAX_IMAGES,
)
from app.routes.chat import SYSTEM_PROMPT

router = APIRouter()

# In-memory project cache, hydrated from disk at import time. Every mutating
# endpoint persists the affected project back to disk via storage.save_one.
_projects: Dict[str, dict] = storage.load_all()

ANALYZE_PROMPT = """Analyze this construction/renovation project based on the description and/or uploaded files provided.
The description may be in Croatian, Bosnian, English or Swedish — understand all of them.
ALL output (section names, material names, labor names, units, notes) must be written in SWEDISH.

Even if only a text description is given (no files), generate a full material list and cost estimate.

For EACH area of work you identify:
1. Name the section clearly — in Swedish
2. List all materials with realistic quantities, dimensions/specs, and estimated SEK prices (excl. VAT) — in Swedish
3. Suggest labor hours and labor type — in Swedish

Be practical and complete — include all materials needed.
Keep any human-readable description SHORT (max 3-4 sentences per section summary) — the <<<QUOTE>>> block is the priority and must always be included in full.
The <<<QUOTE>>> block is MANDATORY — generate it even if the human-readable part is truncated."""


class ProjectCreate(BaseModel):
    name: str


class RemoveFileBody(BaseModel):
    name: str


class AnalyzeRequest(BaseModel):
    description: Optional[str] = None


class SaveQuoteRequest(BaseModel):
    quote: dict


@router.get("")
async def list_projects():
    return storage.list_recent(10)


@router.post("")
async def create_project(body: ProjectCreate):
    pid = str(uuid.uuid4())
    _projects[pid] = {"id": pid, "name": body.name, "files": []}
    storage.save_one(_projects[pid])
    return {"id": pid, "name": body.name}


@router.get("/{pid}")
async def get_project(pid: str):
    p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return {
        "id": p["id"],
        "name": p["name"],
        "files": [{"name": f["name"], "kind": f["kind"]} for f in p["files"]],
    }


@router.post("/{pid}/files")
async def upload_project_files(pid: str, files: List[UploadFile] = File(...)):
    p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "Project not found")

    total = 0
    image_count = sum(1 for f in p["files"] if f["kind"] == "image")

    for f in files:
        data = await f.read()
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(413, "Upload too large (max 25 MB total)")

        name = f.filename or "file"
        ext = _ext(name)
        ctype = (f.content_type or mimetypes.guess_type(name)[0] or "").lower()

        # Skip if already stored
        if any(sf["name"] == name for sf in p["files"]):
            continue

        try:
            if ext == "pdf" or ctype == "application/pdf":
                txt = extract_pdf(data)[:MAX_TEXT_PER_FILE]
                p["files"].append({"kind": "text", "name": name, "text": txt})
                # Render ALL pages as images — PDF pages don't count toward
                # the user-image cap; the user intentionally put them in the PDF.
                try:
                    for img in extract_pdf_pages_as_images(data, max_pages=999):
                        p["files"].append(img)
                except Exception:
                    pass  # fall back to text-only if rendering fails
            elif ext == "docx":
                txt = extract_docx(data)[:MAX_TEXT_PER_FILE]
                p["files"].append({"kind": "text", "name": name, "text": txt})
            elif ext in ("xlsx", "xlsm"):
                txt = extract_xlsx(data)[:MAX_TEXT_PER_FILE]
                p["files"].append({"kind": "text", "name": name, "text": txt})
            elif ext in ("csv", "tsv", "txt", "md", "log", "json", "yaml", "yml", "xml", "html", "htm"):
                txt = extract_text_bytes(data)[:MAX_TEXT_PER_FILE]
                p["files"].append({"kind": "text", "name": name, "text": txt})
            elif ctype.startswith("image/") or ext in ("png", "jpg", "jpeg", "gif", "webp"):
                if image_count >= MAX_IMAGES:
                    p["files"].append({"kind": "skipped", "name": name, "text": "[Too many images, skipped]"})
                    continue
                media = (
                    "image/jpeg"
                    if ext == "jpg"
                    else (ctype if ctype.startswith("image/") else f"image/{ext}")
                )
                b64 = base64.b64encode(data).decode("ascii")
                p["files"].append({"kind": "image", "name": name, "media_type": media, "data": b64})
                image_count += 1
            else:
                p["files"].append({"kind": "unsupported", "name": name, "text": f"[Unsupported: {name}]"})
        except Exception as e:
            p["files"].append({"kind": "error", "name": name, "text": f"[Failed to parse {name}: {e}]"})

    storage.save_one(p)
    return {"files": [{"name": f["name"], "kind": f["kind"]} for f in p["files"]]}


@router.post("/{pid}/quote")
async def save_project_quote(pid: str, body: SaveQuoteRequest):
    p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    p["saved_quote"] = body.quote
    storage.save_one(p)
    return {"ok": True}


@router.delete("/{pid}/files")
async def delete_project_file(pid: str, name: str):
    """Remove a single file from the project. Pass filename as query param: ?name=photo.jpg"""
    p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    p["files"] = [f for f in p["files"] if f["name"] != name]
    storage.save_one(p)
    return {"files": [{"name": f["name"], "kind": f["kind"]} for f in p["files"]]}


def _learning_context(current_pid: str) -> str:
    """Build a short summary of past projects so Claude can calibrate prices,
    preferred stores, and labor rates for this user."""
    recent = [
        p for pid, p in _projects.items()
        if pid != current_pid and isinstance(p.get("saved_quote"), dict)
    ]
    if not recent:
        return ""
    recent.sort(key=lambda p: p.get("_updated_at", ""), reverse=True)
    lines = ["Denna användares senaste projekterfarenhet (kalibrering av priser och butiker):"]
    for proj in recent[:5]:
        q = proj["saved_quote"]
        sections = q.get("sections", [])
        name = proj.get("name", "Projekt")
        for s in sections[:2]:
            for row in s.get("rows", [])[:3]:
                idx = row.get("selectedStoreIdx", -1)
                stores = row.get("stores", [])
                if 0 <= idx < len(stores):
                    store_name = stores[idx].get("name", "")
                    price = stores[idx].get("price", 0)
                    if store_name and price:
                        lines.append(f"- {name}: {row.get('name','')} → {store_name} {price} kr")
            for labor in s.get("laborItems", [])[:1]:
                rate = labor.get("rate", 0)
                if rate:
                    lines.append(f"- {name}: timpris {rate} kr/h")
    return "\n".join(lines) if len(lines) > 1 else ""


_BATCH_SIZE = 10  # Claude's practical per-request image limit


def _extract_sections(text: str) -> list:
    S, E = "<<<QUOTE>>>", "<<<END_QUOTE>>>"
    si, ei = text.find(S), text.find(E)
    if si == -1 or ei == -1:
        return []
    try:
        data = json_lib.loads(text[si + len(S):ei].strip())
        return data.get("sections", []) if isinstance(data, dict) else []
    except Exception:
        return []


def _analyze_stream(client: anthropic.Anthropic, content: list) -> Generator[str, None, None]:
    """Stream analyze response as SSE.

    When the project has more than _BATCH_SIZE images (e.g. a 25-page PDF),
    splits into batches of _BATCH_SIZE images and merges the QUOTE sections
    from each batch into a single final result.
    """
    text_items = [c for c in content if c.get("type") == "text"]
    image_items = [c for c in content if c.get("type") == "image"]
    prompt_item = text_items[-1]   # ANALYZE_PROMPT always last
    prefix_items = text_items[:-1] # project text + user description

    batches = (
        [image_items[i:i + _BATCH_SIZE] for i in range(0, len(image_items), _BATCH_SIZE)]
        if image_items else [[]]
    )

    all_sections: list = []
    first_batch_display = ""

    try:
        for batch_idx, img_batch in enumerate(batches):
            batch_content: list = []
            if batch_idx == 0:
                batch_content.extend(prefix_items)
            else:
                # Batch 2+: QUOTE block only — no prose, saves tokens
                batch_content.append({
                    "type": "text",
                    "text": (
                        f"Batch {batch_idx + 1}/{len(batches)}: more pages from the same project. "
                        "Return ONLY the <<<QUOTE>>> block with any NEW materials found. No other text."
                    ),
                })
                yield ": next-batch\n\n"

            batch_content.extend(img_batch)
            batch_content.append(prompt_item)

            # Batch 1: 4096 tokens — room for both readable text AND the QUOTE block
            # Batch 2+: 2048 tokens — QUOTE-only so it always fits
            max_tok = 4096 if batch_idx == 0 else 2048

            batch_text = ""
            with client.messages.stream(
                model="claude-opus-4-5",
                max_tokens=max_tok,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": batch_content}],
            ) as stream:
                for token in stream.text_stream:
                    batch_text += token
                    if batch_idx == 0:
                        yield f"data: {json_lib.dumps({'type': 'chunk', 'text': token})}\n\n"
                    else:
                        # Keep connection alive with lightweight progress ticks
                        yield ": t\n\n"

            all_sections.extend(_extract_sections(batch_text))

            if batch_idx == 0:
                S = "<<<QUOTE>>>"
                si = batch_text.find(S)
                first_batch_display = batch_text[:si].strip() if si != -1 else batch_text

        if all_sections:
            merged = json_lib.dumps({"sections": all_sections}, ensure_ascii=False)
            final = f"{first_batch_display}\n\n<<<QUOTE>>>\n{merged}\n<<<END_QUOTE>>>"
        else:
            final = first_batch_display

        yield f"data: {json_lib.dumps({'type': 'done', 'message': final})}\n\n"

    except anthropic.APIError as e:
        yield f"data: {json_lib.dumps({'type': 'error', 'message': str(e)})}\n\n"


# Max chars of text sent to Claude per file — large PDFs get truncated here,
# not at upload time, so the stored project keeps the full extraction.
_ANALYZE_TEXT_LIMIT = 30_000


@router.post("/{pid}/analyze")
async def analyze_project(pid: str, body: Optional[AnalyzeRequest] = None):
    p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    description = ((body.description if body else "") or "").strip()
    if not p["files"] and not description:
        raise HTTPException(400, "Add a description or at least one file")

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    content = []
    for f in p["files"]:
        if f["kind"] == "image":
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": f["media_type"], "data": f["data"]},
            })
        elif f["kind"] == "text":
            # Truncate large files so Claude gets focused context, not noise
            text = f["text"][:_ANALYZE_TEXT_LIMIT]
            content.append({"type": "text", "text": f"--- {f['name']} ---\n{text}"})

    if description:
        content.append({"type": "text", "text": f"Project description from user:\n{description}"})

    learning = _learning_context(pid)
    if learning:
        content.append({"type": "text", "text": learning})

    content.append({"type": "text", "text": ANALYZE_PROMPT})

    return StreamingResponse(
        _analyze_stream(client, content),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable Railway/nginx buffering
        },
    )
