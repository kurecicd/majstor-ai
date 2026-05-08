from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from urllib.parse import quote_plus, urljoin
import asyncio
import json
import re

import httpx
import anthropic
from bs4 import BeautifulSoup

from app.config import get_settings

router = APIRouter()

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Per-store config. Each store has a search URL template and a list of candidate
# selectors we try in order. Designed to fail gracefully — if scraping returns
# nothing, the search_url is always returned so the user can click through.
STORES = [
    {
        "name": "Bauhaus",
        "base": "https://www.bauhaus.se",
        "search_template": "https://www.bauhaus.se/sok?q={q}",
        "card_selectors": [
            "[data-testid*='product']",
            "article.product",
            "[class*='ProductCard']",
            "[class*='product-card']",
            "li.product",
        ],
    },
    {
        "name": "Byggmax",
        "base": "https://www.byggmax.se",
        "search_template": "https://www.byggmax.se/catalogsearch/result/?q={q}",
        "card_selectors": [
            "[data-testid*='product']",
            ".product-tile",
            "[class*='ProductCard']",
            "[class*='product-card']",
            "li.product",
        ],
    },
    {
        "name": "Hornbach",
        "base": "https://www.hornbach.se",
        "search_template": "https://www.hornbach.se/sortiment/sok/?term={q}",
        "card_selectors": [
            "[data-testid*='product']",
            "article[class*='product']",
            "[class*='ProductTile']",
            "[class*='product-tile']",
            "li.product",
        ],
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


def _parse_price(raw) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw)
    m = re.search(r"\d[\d\s.,]*", s)
    if not m:
        return None
    s = m.group(0).strip().replace("\xa0", "").replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _first_product_from_jsonld(soup: BeautifulSoup, base: str) -> Optional[dict]:
    """Try to find the first Product or first ItemList item in JSON-LD blocks."""
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            t = item.get("@type")
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                return _normalize_product(item, base)
            if t == "ItemList" and isinstance(item.get("itemListElement"), list):
                for entry in item["itemListElement"]:
                    if isinstance(entry, dict):
                        prod = entry.get("item") if isinstance(entry.get("item"), dict) else entry
                        if isinstance(prod, dict) and (
                            prod.get("@type") == "Product" or "Product" in str(prod.get("@type", ""))
                        ):
                            return _normalize_product(prod, base)
    return None


def _normalize_product(item: dict, base: str) -> dict:
    name = item.get("name")
    image = item.get("image")
    if isinstance(image, list) and image:
        image = image[0]
    elif isinstance(image, dict):
        image = image.get("url") or image.get("contentUrl")
    url = item.get("url") or item.get("@id")
    if url and url.startswith("/"):
        url = urljoin(base, url)
    price = None
    offers = item.get("offers")
    if isinstance(offers, dict):
        price = _parse_price(offers.get("price") or offers.get("lowPrice"))
    elif isinstance(offers, list) and offers:
        first = offers[0] if isinstance(offers[0], dict) else {}
        price = _parse_price(first.get("price") or first.get("lowPrice"))
    return {"name": name, "price": price, "url": url, "image": image}


def _scrape_card(card, base: str) -> Optional[dict]:
    """Best-effort extraction from a product card element."""
    name = None
    for sel in ["h2", "h3", "[class*='title' i]", "[class*='name' i]", "a[title]"]:
        el = card.select_one(sel)
        if el:
            name = el.get("title") or el.get_text(" ", strip=True)
            if name:
                break

    price = None
    for sel in [
        "[itemprop='price']",
        "[data-testid*='price' i]",
        "[class*='Price' i]",
        "[class*='price' i]",
    ]:
        el = card.select_one(sel)
        if el:
            price = _parse_price(el.get("content") or el.get_text(" ", strip=True))
            if price:
                break

    url = None
    a = card.find("a", href=True)
    if a:
        href = a["href"]
        url = href if href.startswith("http") else urljoin(base, href)

    img = card.find("img")
    image = None
    if img:
        image = img.get("src") or img.get("data-src")
        if image and image.startswith("/"):
            image = urljoin(base, image)

    if not (name or price):
        return None
    return {"name": name, "price": price, "url": url, "image": image}


async def _search_store(client: httpx.AsyncClient, store: dict, query: str) -> StoreResult:
    search_url = store["search_template"].format(q=quote_plus(query))
    base_result = StoreResult(store=store["name"], search_url=search_url)

    try:
        r = await client.get(search_url)
        r.raise_for_status()
    except httpx.HTTPError as e:
        base_result.error = f"Fetch failed: {type(e).__name__}"
        return base_result

    soup = BeautifulSoup(r.text, "html.parser")

    # Pass 1: JSON-LD
    prod = _first_product_from_jsonld(soup, store["base"])
    if prod and (prod.get("name") or prod.get("price")):
        base_result.name = prod.get("name")
        base_result.price = prod.get("price")
        base_result.url = prod.get("url") or search_url
        base_result.image = prod.get("image")
        return base_result

    # Pass 2: try each card selector
    for sel in store["card_selectors"]:
        cards = soup.select(sel)
        for card in cards[:5]:
            data = _scrape_card(card, store["base"])
            if data and data.get("name"):
                base_result.name = data.get("name")
                base_result.price = data.get("price")
                base_result.url = data.get("url") or search_url
                base_result.image = data.get("image")
                return base_result

    base_result.error = "No products extracted — open search manually"
    return base_result


def _to_swedish(query: str) -> str:
    """Translate a material/product query to Swedish so Swedish store searches work.

    Uses claude-haiku for speed and low cost. Falls back to original query on any error.
    """
    try:
        settings = get_settings()
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{
                "role": "user",
                "content": (
                    "Translate this building material or product name to Swedish. "
                    "Return ONLY the Swedish translation — no explanations, no punctuation. "
                    "If it is already in Swedish, return it unchanged.\n\n" + query
                ),
            }],
        )
        result = resp.content[0].text.strip() if resp.content else ""
        return result or query
    except Exception:
        return query


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    query = req.query.strip()
    if not query:
        return SearchResponse(query=query, results=[])

    # Translate to Swedish so searches on Swedish store sites work
    query = _to_swedish(query)

    async with httpx.AsyncClient(
        timeout=8.0,
        follow_redirects=True,
        headers={"User-Agent": UA, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8"},
    ) as client:
        tasks = [_search_store(client, s, query) for s in STORES]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    out: List[StoreResult] = []
    for r, store in zip(results, STORES):
        if isinstance(r, Exception):
            out.append(
                StoreResult(
                    store=store["name"],
                    search_url=store["search_template"].format(q=quote_plus(query)),
                    error=f"Internal error: {type(r).__name__}",
                )
            )
        else:
            out.append(r)
    return SearchResponse(query=query, results=out)
