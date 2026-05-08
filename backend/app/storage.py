"""On-disk persistence for projects.

One JSON file per project, atomic writes via temp-file + rename.

Storage location:
- PROJECTS_DIR env var if set
- /data/projects when /data exists (Railway volume mount convention)
- ./data/projects otherwise (local dev)

A project file is the same dict shape used by the in-memory store, so we
can serialize directly with json.dump.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Dict


def _resolve_dir() -> Path:
    explicit = os.getenv("PROJECTS_DIR")
    if explicit:
        return Path(explicit)
    if Path("/data").is_dir():
        return Path("/data/projects")
    return Path("./data/projects")


_DIR = _resolve_dir()


def _ensure_dir() -> Path:
    _DIR.mkdir(parents=True, exist_ok=True)
    return _DIR


def load_all() -> Dict[str, dict]:
    """Read every *.json file in the storage dir into a {pid: project} map."""
    out: Dict[str, dict] = {}
    if not _DIR.exists():
        return out
    for f in _DIR.glob("*.json"):
        if f.name.startswith("."):
            continue  # skip temp files
        try:
            with f.open("r", encoding="utf-8") as fp:
                proj = json.load(fp)
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(proj, dict) and "id" in proj:
            out[proj["id"]] = proj
    return out


def save_one(project: dict) -> None:
    """Atomically persist a single project's JSON to disk."""
    pid = project.get("id")
    if not pid:
        return
    d = _ensure_dir()
    target = d / f"{pid}.json"
    # Write to temp file in the same dir, then atomic rename.
    fd, tmp_path = tempfile.mkstemp(prefix=f".{pid}-", suffix=".json.tmp", dir=str(d))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fp:
            json.dump(project, fp, ensure_ascii=False)
        os.replace(tmp_path, target)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise


def delete_one(pid: str) -> None:
    target = _ensure_dir() / f"{pid}.json"
    if target.exists():
        target.unlink()


def storage_path() -> str:
    return str(_DIR)
