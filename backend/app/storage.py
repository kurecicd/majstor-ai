"""SQLite-backed project store.

Mirrors the CoinTax pattern: thread-local connection, WAL journal mode,
schema bootstrapped on first connect. Database path comes from
MAJSTOR_DB_PATH or defaults to /data/majstor.db (Railway volume) when /data
exists, else ./data/majstor.db (local dev).

Each project is one row with a JSON-encoded 'data' blob — same shape as the
in-memory dict (id, name, files[]) so we can round-trip cleanly.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Dict


def _resolve_db_path() -> str:
    explicit = os.environ.get("MAJSTOR_DB_PATH")
    if explicit:
        return explicit
    if Path("/data").is_dir():
        return "/data/majstor.db"
    return str(Path("./data/majstor.db").resolve())


_DB_PATH = _resolve_db_path()
_local = threading.local()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
"""


def _get_conn() -> sqlite3.Connection:
    """One connection per thread, WAL mode for concurrent reads."""
    if not hasattr(_local, "conn") or _local.conn is None:
        Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        _local.conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
        _local.conn.row_factory = sqlite3.Row
        _local.conn.executescript(SCHEMA_SQL)
    return _local.conn


def load_all() -> Dict[str, dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT id, data, updated_at FROM projects").fetchall()
    out: Dict[str, dict] = {}
    for r in rows:
        try:
            proj = json.loads(r["data"])
        except json.JSONDecodeError:
            continue
        if isinstance(proj, dict) and "id" in proj:
            proj["_updated_at"] = r["updated_at"] or ""
            out[proj["id"]] = proj
    return out


def list_recent(limit: int = 10) -> list[dict]:
    """Return the most recently updated projects, summary fields only."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT id, name, data, updated_at FROM projects ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    out = []
    for r in rows:
        try:
            proj = json.loads(r["data"])
        except json.JSONDecodeError:
            proj = {}
        files = proj.get("files", [])
        quote = proj.get("saved_quote")
        sections = quote.get("sections", []) if isinstance(quote, dict) else []
        out.append({
            "id": r["id"],
            "name": r["name"],
            "updated_at": r["updated_at"] or "",
            "file_count": len(files),
            "has_quote": bool(sections),
            "section_names": [s.get("name", "") for s in sections[:3]],
        })
    return out


def save_one(project: dict) -> None:
    pid = project.get("id")
    if not pid:
        return
    conn = _get_conn()
    conn.execute(
        """INSERT INTO projects (id, name, data, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               data = excluded.data,
               updated_at = datetime('now')""",
        (pid, project.get("name", ""), json.dumps(project, ensure_ascii=False)),
    )
    conn.commit()


def delete_one(pid: str) -> None:
    conn = _get_conn()
    conn.execute("DELETE FROM projects WHERE id = ?", (pid,))
    conn.commit()


def storage_path() -> str:
    return _DB_PATH
