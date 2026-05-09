"""Store price search via Claude.

Claude knows Swedish building supply stores (Bauhaus, Hornbach, Byggmax) and
can find the exact product or the closest reasonable equivalent.  Much more
reliable than scraping — the stores all block bots.  Results are labelled
"AI-uppskattning" in the UI so users know to click through and verify.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from urllib.parse import quote_plus
import json as json_lib

import anthropic

from app.config import get_settings

router = APIRouter()

STORES = [
    {
        "name": "Bauhaus",
        "search_template": "https://www.bauhaus.se/catalogsearch/result/?q={q}",
    },
    {
        "name": "Byggmax",
        "search_template": "https://www.byggmax.se/catalogsearch/result/?q={q}",
    },
    {
        "name": "Hornbach",
        "search_template": "https://www.hornbach.se/sortiment/sok/?term={q}",
    },
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
    return f"https://www.google.se/search?q={quote_plus(query + ' ' + store_name + ' Sverige')}"


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    query = req.query.strip()
    if not query:
        return SearchResponse(query=query, results=[])

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    prompt = f"""Du är expert på svenska byggvaruhandeln.

En hantverkare söker: "{query}"

Hitta NÄRMAST LIKNANDE produkt hos Bauhaus Sverige, Hornbach Sverige och Byggmax Sverige.
Ge produktnamnet SÅ SOM DET KALLAS i respektive butik, plus bästa sökordet att skriva i butikens sökruta.

Returnera ENBART detta JSON-format, inget annat:
[
  {{"store":"Bauhaus","name":"produktnamn som Bauhaus kallar det","price":0,"unit":"st","search_query":"bästa sökterm för Bauhaus","note":""}},
  {{"store":"Hornbach","name":"produktnamn som Hornbach kallar det","price":0,"unit":"st","search_query":"bästa sökterm för Hornbach","note":""}},
  {{"store":"Byggmax","name":"produktnamn som Byggmax kallar det","price":0,"unit":"st","search_query":"bästa sökterm för Byggmax","note":""}}
]

Regler:
- price = rimlig uppskattning i SEK exkl. moms per enhet (aldrig 0 om butiken troligtvis har produkten)
- unit = rätt enhet: st, m, m², L, kg, förp, rulle, säck etc.
- search_query = de bästa sökorden för att hitta produkten i den specifika butikens sökruta (2-4 ord)
- Om butiken sannolikt INTE har produkten: price=0, förklara i note
- Alla texter på svenska"""

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = (resp.content[0].text if resp.content else "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        items = json_lib.loads(raw.strip())
        results: List[StoreResult] = []
        for item in items:
            store = item.get("store", "")
            # Use the optimised search_query to build the URL — always a working search link
            sq = item.get("search_query") or item.get("name") or query
            su = _search_url(store, sq)
            price = item.get("price")
            note = item.get("note") or None
            results.append(
                StoreResult(
                    store=store,
                    search_url=su,
                    name=item.get("name") or None,
                    price=float(price) if price else None,
                    url=su,  # search URL is always valid; user can replace with exact product URL
                    error=note if not price else None,
                )
            )
        return SearchResponse(query=query, results=results)

    except Exception:
        return SearchResponse(
            query=query,
            results=[
                StoreResult(
                    store=s["name"],
                    search_url=s["search_template"].format(q=quote_plus(query)),
                    error="Klicka för att söka manuellt",
                )
                for s in STORES
            ],
        )
