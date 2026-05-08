from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel
import uuid
import base64
import mimetypes
import anthropic

from app.config import get_settings
from app import storage
from app.routes.extract import (
    _ext,
    extract_pdf,
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

ANALYZE_PROMPT = """Carefully analyze ALL uploaded files and images for this construction/renovation project.

For EACH area of work you identify:
1. Name the section clearly
2. Describe exactly what work needs to be done
3. List all materials with quantities, dimensions/specs, and estimated SEK prices (excl. VAT)
4. Note any important observations or constraints

Be thorough — include EVERYTHING visible in the files/images.
Then append the complete <<<QUOTE>>> block covering ALL sections and ALL materials."""


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
            content.append({"type": "text", "text": f"--- {f['name']} ---\n{f['text']}"})

    if description:
        content.append({"type": "text", "text": f"Project description from user:\n{description}"})

    content.append({"type": "text", "text": ANALYZE_PROMPT})

    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )

    text_parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    return {"message": "".join(text_parts) or ""}
