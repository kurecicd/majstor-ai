"""Store price search — library-first, then Claude haiku for missing stores."""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from urllib.parse import quote_plus
import json as json_lib
import re

import anthropic

from app.config import get_settings
from app import storage

router = APIRouter()

STORES = [
    {"name": "Bauhaus",  "search_template": "https://www.bauhaus.se/catalogsearch/result/?q={q}"},
    {"name": "Byggmax",  "search_template": "https://www.byggmax.se/catalogsearch/result/?q={q}"},
    {"name": "Hornbach", "search_template": "https://www.hornbach.se/sortiment/sok/?term={q}"},
]


class SearchRequest(BaseModel):
    query: str
    limit_per_store: int = 1


class StoreResult(BaseModel):
    store: str
    search_url: str
    name: Optional[str] = None
    price: Optional[float] = None
    url: Optional[str] = None
    image: Optional[str] = None
    error: Optional[str] = None


class SearchResponse(BaseModel):
    query: str
    results: List[StoreResult]


def _search_url(store_name: str, query: str) -> str:
    for s in STORES:
        if s["name"].lower() == store_name.lower():
            return s["search_template"].format(q=quote_plus(query))
    return f"https://www.google.se/search?q={quote_plus(query + ' ' + store_name)}"


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    query = req.query.strip()
    if not query:
        return SearchResponse(query=query, results=[])

    fallback_urls = {s["name"]: _search_url(s["name"], query) for s in STORES}

    # ── 1. Library first ─────────────────────────────────────────────────────
    library_hits = storage.find_picks(query, limit=3)
    results: List[StoreResult] = [
        StoreResult(
            store=h["store"],
            search_url=fallback_urls.get(h["store"], h["url"]),
            name=f"⭐ {h['name']}",
            price=h["price"],
            url=h["url"] or fallback_urls.get(h["store"], ""),
        )
        for h in library_hits
    ]
    covered = {h["store"] for h in library_hits}

    # If library already has all stores, return immediately
    if covered >= {s["name"] for s in STORES}:
        return SearchResponse(query=query, results=results)

    # ── 2. Claude haiku for missing stores ───────────────────────────────────
    missing = [s for s in STORES if s["name"] not in covered]
    store_list = ", ".join(s["name"] + " Sverige" for s in missing)

    try:
        settings = get_settings()
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": (
                    f"Du är expert på svenska byggvaruhandeln.\n\n"
                    f"En hantverkare söker: \"{query}\"\n\n"
                    f"För varje butik nedan, ge:\n"
                    "1. 'name' = exakt produktnamn som det VERKLIGEN HETER i butikens katalog "
                    "(t.ex. 'Granbräda 28×120 mm 3,6 m tryckimpregnerad klass 3') — INTE butikens namn eller domän\n"
                    "2. 'price' = rimlig prisupp skattning SEK exkl. moms\n"
                    "3. 'search_query' = 2-5 ord att skriva i butikens sökruta för att hitta produkten\n\n"
                    "Returnera ENBART detta JSON:\n"
                    + json_lib.dumps(
                        [{"store": s["name"], "name": "exakt produktnamn", "price": 0, "unit": "st", "search_query": "sökord"} for s in missing],
                        ensure_ascii=False
                    )
                    + "\n\nViktigt: 'name' ska vara det RIKTIGA produktnamnet, aldrig butikens webbadress eller 'standardsortiment'."
                ),
            }],
        )

        raw = (resp.content[0].text if resp.content else "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        m = re.search(r"\[.*\]", raw.strip(), re.DOTALL)
        items = json_lib.loads(m.group(0) if m else raw)

        for item in items:
            store = item.get("store", "")
            if store in covered:
                continue
            sq = item.get("search_query") or item.get("name") or query
            su = _search_url(store, sq)
            price = item.get("price")
            results.append(StoreResult(
                store=store,
                search_url=su,
                name=item.get("name") or None,
                price=float(price) if price else None,
                url=su,
            ))

    except Exception:
        for s in missing:
            if s["name"] not in covered:
                results.append(StoreResult(
                    store=s["name"],
                    search_url=fallback_urls[s["name"]],
                    url=fallback_urls[s["name"]],
                    error="Klicka för att söka manuellt",
                ))

    return SearchResponse(query=query, results=results)
