"""Store price search.

For each store:
1. Claude haiku generates the correct Swedish product name + best search query
2. We scrape the store's search results to find the FIRST actual product URL
3. If scraping finds a real product page → return it (user clicks to exact product)
4. If scraping fails → return the search URL honestly (user does the search)

Frontend distinguishes real product URLs from search URLs and labels accordingly.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from urllib.parse import quote_plus, urljoin
import asyncio
import json as json_lib
import re

import httpx
from bs4 import BeautifulSoup
import anthropic

from app.config import get_settings
from app import storage

router = APIRouter()

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

STORES = [
    {
        "name": "Bauhaus",
        "base": "https://www.bauhaus.se",
        "search_template": "https://www.bauhaus.se/catalogsearch/result/?q={q}",
        "product_selectors": [
            "a.product-item-link",
            "a.product-item-name",
            "[data-testid*='product'] a[href]",
            "li.product-item a.product-item-photo",
        ],
    },
    {
        "name": "Byggmax",
        "base": "https://www.byggmax.se",
        "search_template": "https://www.byggmax.se/catalogsearch/result/?q={q}",
        "product_selectors": [
            "a.product-item-link",
            "a.product-item-name",
            "[class*='ProductCard'] a[href]",
            "li.product-item a.product-item-photo",
        ],
    },
    {
        "name": "Hornbach",
        "base": "https://www.hornbach.se",
        "search_template": "https://www.hornbach.se/sortiment/sok/?term={q}",
        "product_selectors": [
            "a[class*='ProductTile']",
            "a[class*='product-tile']",
            "[class*='ProductCard'] a[href]",
            "article a[href]",
        ],
    },
]

# URL patterns that indicate a search results page (not a product page)
_SEARCH_PATTERNS = re.compile(
    r"catalogsearch|/search|[?&]q=|[?&]term=|/sok\?|/search\?|google\."
)


class SearchRequest(BaseModel):
    query: str
    limit_per_store: int = 1


class StoreResult(BaseModel):
    store: str
    search_url: str
    name: Optional[str] = None
    price: Optional[float] = None
    url: Optional[str] = None
    is_product_url: bool = False
    image: Optional[str] = None
    error: Optional[str] = None


class SearchResponse(BaseModel):
    query: str
    results: List[StoreResult]


def _build_search_url(store: dict, query: str) -> str:
    return store["search_template"].format(q=quote_plus(query))


async def _scrape_first_product(
    client: httpx.AsyncClient, store: dict, search_url: str
) -> Optional[str]:
    """Fetch search results page and extract the first real product URL."""
    try:
        r = await client.get(search_url)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for sel in store["product_selectors"]:
            el = soup.select_one(sel)
            if el and el.get("href"):
                href = str(el["href"])
                if href.startswith("/"):
                    href = store["base"] + href
                # Only accept URLs that look like product pages, not more search pages
                if href.startswith("http") and not _SEARCH_PATTERNS.search(href):
                    return href
    except Exception:
        pass
    return None


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    query = req.query.strip()
    if not query:
        return SearchResponse(query=query, results=[])

    fallback_urls = {s["name"]: _build_search_url(s, query) for s in STORES}

    # ── 1. Library first ─────────────────────────────────────────────────────
    library_hits = storage.find_picks(query, limit=3)
    results: List[StoreResult] = [
        StoreResult(
            store=h["store"],
            search_url=fallback_urls.get(h["store"], h["url"]),
            name=f"⭐ {h['name']}",
            price=h["price"],
            url=h["url"] or fallback_urls.get(h["store"], ""),
            is_product_url=bool(h["url"] and not _SEARCH_PATTERNS.search(h["url"])),
        )
        for h in library_hits
    ]
    covered = {h["store"] for h in library_hits}
    missing = [s for s in STORES if s["name"] not in covered]

    if not missing:
        return SearchResponse(query=query, results=results)

    # ── 2. Claude haiku — product names + search queries ─────────────────────
    settings = get_settings()
    client_ai = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    store_list = ", ".join(s["name"] + " Sverige" for s in missing)
    ai_results: dict[str, dict] = {}

    try:
        resp = client_ai.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": (
                    f"Du är expert på svenska byggvaruhandeln.\n\n"
                    f"Produkt: \"{query}\"\n\n"
                    f"För varje butik ({store_list}), ge:\n"
                    "- 'name': exakt produktnamn som det VERKLIGEN heter i butikens katalog "
                    "(t.ex. 'Granbräda 28×120 mm 3,6 m tryckimpregnerad klass 3')\n"
                    "- 'price': uppskattning SEK exkl. moms\n"
                    "- 'search_query': 3-5 ord att söka på i butikens sökruta\n\n"
                    "Returnera ENBART JSON:\n"
                    + json_lib.dumps(
                        [{"store": s["name"], "name": "...", "price": 0, "search_query": "..."} for s in missing],
                        ensure_ascii=False,
                    )
                    + "\n\nViktigt: 'name' = riktigt produktnamn, ALDRIG butikens domän eller 'standardsortiment'."
                ),
            }],
        )
        raw = (resp.content[0].text if resp.content else "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        items = json_lib.loads(m.group(0) if m else raw)
        for item in items:
            ai_results[item.get("store", "")] = item
    except Exception:
        pass

    # ── 3. Scrape search results to find real product URLs ───────────────────
    async with httpx.AsyncClient(
        timeout=8.0,
        follow_redirects=True,
        headers={"User-Agent": UA, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8"},
    ) as http:
        async def process_store(store: dict) -> StoreResult:
            ai = ai_results.get(store["name"], {})
            sq = ai.get("search_query") or query
            search_url = _build_search_url(store, sq)
            price = ai.get("price")
            name = ai.get("name") or None

            # Try to find a real product page
            product_url = await _scrape_first_product(http, store, search_url)
            is_product = bool(product_url)

            return StoreResult(
                store=store["name"],
                search_url=search_url,
                name=name,
                price=float(price) if price else None,
                url=product_url or search_url,
                is_product_url=is_product,
            )

        store_results = await asyncio.gather(
            *[process_store(s) for s in missing], return_exceptions=True
        )

    for sr in store_results:
        if isinstance(sr, StoreResult):
            results.append(sr)
        # Silently skip exceptions — covered by fallback_urls

    return SearchResponse(query=query, results=results)
