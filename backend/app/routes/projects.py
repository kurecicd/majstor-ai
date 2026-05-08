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

Even if only a text description is given (no files), generate a full material list and cost estimate.

For EACH area of work you identify:
1. Name the section clearly (in Swedish)
2. List all materials with realistic quantities, dimensions/specs, and estimated SEK prices (excl. VAT)
3. Suggest labor hours for each section

Be practical and complete — include all materials needed.
Always append the complete <<<QUOTE>>> block covering ALL sections and ALL materials, even when working from description only."""


class ProjectCreate(BaseModel):
    name: str


class RemoveFileBody(BaseModel):
    name: str


class AnalyzeRequest(BaseModel):
    description: Optional[str] = None


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
                # Also render pages as images so Claude vision can read drawings/plans
                try:
                    for img in extract_pdf_pages_as_images(data, max_pages=4):
                        if image_count >= MAX_IMAGES:
                            break
                        p["files"].append(img)
                        image_count += 1
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


@router.delete("/{pid}/files")
async def delete_project_file(pid: str, name: str):
    """Remove a single file from the project. Pass filename as query param: ?name=photo.jpg"""
    p = _projects.get(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    p["files"] = [f for f in p["files"] if f["name"] != name]
    storage.save_one(p)
    return {"files": [{"name": f["name"], "kind": f["kind"]} for f in p["files"]]}


def _analyze_stream(client: anthropic.Anthropic, content: list) -> Generator[str, None, None]:
    """Stream analyze response as SSE chunks so the connection stays alive
    for long Claude calls (large PDFs can take 60-120s)."""
    full_text = ""
    try:
        with client.messages.stream(
            model="claude-opus-4-5",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        ) as stream:
            for text in stream.text_stream:
                full_text += text
                yield f"data: {json_lib.dumps({'type': 'chunk', 'text': text})}\n\n"
        yield f"data: {json_lib.dumps({'type': 'done', 'message': full_text})}\n\n"
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

    content.append({"type": "text", "text": ANALYZE_PROMPT})

    return StreamingResponse(
        _analyze_stream(client, content),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable Railway/nginx buffering
        },
    )
