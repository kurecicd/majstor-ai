"""Store price search using Claude with web_search tool.

Claude searches the actual store websites to find real product pages,
prices and URLs — not guesses or hallucinated links.
"""

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
    {"name": "Bauhaus",  "domain": "bauhaus.se",  "search_template": "https://www.bauhaus.se/catalogsearch/result/?q={q}"},
    {"name": "Byggmax",  "domain": "byggmax.se",  "search_template": "https://www.byggmax.se/catalogsearch/result/?q={q}"},
    {"name": "Hornbach", "domain": "hornbach.se",  "search_template": "https://www.hornbach.se/sortiment/sok/?term={q}"},
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


def _fallback_url(store_name: str, query: str) -> str:
    for s in STORES:
        if s["name"].lower() == store_name.lower():
            return s["search_template"].format(q=quote_plus(query))
    return f"https://www.google.se/search?q={quote_plus(query + ' ' + store_name)}"


def _parse_price(s: str) -> Optional[float]:
    m = re.search(r"[\d\s.,]+", str(s).replace("\xa0", ""))
    if not m:
        return None
    raw = m.group(0).strip().replace(" ", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    query = req.query.strip()
    if not query:
        return SearchResponse(query=query, results=[])

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    fallback_urls = {s["name"]: _fallback_url(s["name"], query) for s in STORES}

    # ── Library first ───────────────────────────────────────────────────────
    # Check if user has picked this product before — return library hits as
    # top results so they don't have to search again.
    library_hits = storage.find_picks(query, limit=3)
    if library_hits:
        results = [
            StoreResult(
                store=h["store"],
                search_url=fallback_urls.get(h["store"], h["url"]),
                name=f"⭐ {h['name']}",  # star prefix = library result
                price=h["price"],
                url=h["url"] or fallback_urls.get(h["store"], ""),
                error=None,
                image=None,
            )
            for h in library_hits
        ]
        # Fill in missing stores with normal search only if we have fewer than 3 library hits
        covered = {h["store"] for h in library_hits}
        if len(covered) < len(STORES):
            pass  # run Claude below and merge missing stores
        else:
            return SearchResponse(query=query, results=results)
    else:
        results = []

    try:
        resp = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=2000,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=[{
                "role": "user",
                "content": (
                    f"Sök efter produkten \"{query}\" på dessa svenska byggvarubutiker: "
                    "bauhaus.se, byggmax.se, hornbach.se.\n\n"
                    "För varje butik, hitta den bäst matchande produkten och returnera:\n"
                    "- Exakt produktnamn på svenska\n"
                    "- Pris i SEK exkl. moms\n"
                    "- Direktlänk till produktsidan\n\n"
                    "Returnera ENBART detta JSON-format efter dina sökningar, inget annat:\n"
                    "[\n"
                    "  {\"store\":\"Bauhaus\",\"name\":\"...\",\"price\":0,\"unit\":\"st\",\"url\":\"https://...\"},\n"
                    "  {\"store\":\"Byggmax\",\"name\":\"...\",\"price\":0,\"unit\":\"st\",\"url\":\"https://...\"},\n"
                    "  {\"store\":\"Hornbach\",\"name\":\"...\",\"price\":0,\"unit\":\"st\",\"url\":\"https://...\"}\n"
                    "]\n\n"
                    "Om produkten inte finns i en butik, sätt price=0 och url till butikens sök-URL."
                ),
            }],
        )

        # Extract the final text block from the response (after tool use)
        raw = ""
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                raw = block.text.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        # Find JSON array in the text
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        if m:
            raw = m.group(0)

        items = json_lib.loads(raw)
        covered = {h["store"] for h in library_hits}
        for item in items:
            store = item.get("store", "")
            if store in covered:
                continue  # library result already covers this store
            price = item.get("price")
            url = item.get("url") or fallback_urls.get(store, "")
            results.append(StoreResult(
                store=store,
                search_url=fallback_urls.get(store, url),
                name=item.get("name") or None,
                price=float(price) if price else None,
                url=url,
            ))
        return SearchResponse(query=query, results=results)

    except Exception:
        # Fallback: library results + search links for uncovered stores
        covered = {h["store"] for h in library_hits}
        for s in STORES:
            if s["name"] not in covered:
                results.append(StoreResult(
                    store=s["name"],
                    search_url=fallback_urls[s["name"]],
                    url=fallback_urls[s["name"]],
                        error="Klicka för att söka manuellt",
                ))
        return SearchResponse(query=query, results=results)
