from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from urllib.parse import urlparse
import re
import json

import httpx
from bs4 import BeautifulSoup

router = APIRouter()

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

KNOWN_STORES = {
    "bauhaus.se": "Bauhaus",
    "hornbach.se": "Hornbach",
    "byggmax.se": "Byggmax",
    "byggmax.no": "Byggmax",
    "k-rauta.se": "K-rauta",
    "krauta.se": "K-rauta",
    "jula.se": "Jula",
    "clasohlson.com": "Clas Ohlson",
}


class ScrapeRequest(BaseModel):
    url: str


class ScrapeResponse(BaseModel):
    success: bool
    name: Optional[str] = None
    price: Optional[float] = None
    store: Optional[str] = None
    image: Optional[str] = None
    error: Optional[str] = None


def _detect_store(url: str) -> Optional[str]:
    host = (urlparse(url).hostname or "").lower().lstrip("www.")
    for domain, name in KNOWN_STORES.items():
        if host.endswith(domain):
            return name
    return host or None


def _parse_price(raw) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    s = re.sub(r"[^\d,.\-]", "", s)
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _meta(soup: BeautifulSoup, prop: str) -> Optional[str]:
    el = soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})
    if el and el.get("content"):
        return el["content"].strip()
    return None


def _extract(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    name = _meta(soup, "og:title") or _meta(soup, "twitter:title")
    if not name:
        title = soup.find("title")
        if title and title.string:
            name = title.string.strip()
    if not name:
        h1 = soup.find("h1")
        if h1:
            name = h1.get_text(strip=True)

    price = None
    image = _meta(soup, "og:image")

    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            offers = item.get("offers")
            if isinstance(offers, dict):
                price = price or _parse_price(offers.get("price"))
            elif isinstance(offers, list) and offers:
                price = price or _parse_price(offers[0].get("price") if isinstance(offers[0], dict) else None)
            if not name and item.get("name"):
                name = str(item["name"]).strip()
            if not image and item.get("image"):
                img = item["image"]
                image = img if isinstance(img, str) else (img[0] if isinstance(img, list) and img else None)

    if not price:
        price = _parse_price(_meta(soup, "product:price:amount") or _meta(soup, "og:price:amount"))

    if not price:
        for sel in [
            '[data-test="product-price"]',
            '[class*="price" i]',
            '[itemprop="price"]',
        ]:
            el = soup.select_one(sel)
            if el:
                p = _parse_price(el.get("content") or el.get_text(" ", strip=True))
                if p:
                    price = p
                    break

    return {"name": name, "price": price, "image": image}


@router.post("", response_model=ScrapeResponse)
async def scrape(req: ScrapeRequest):
    parsed = urlparse(req.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")

    store = _detect_store(req.url)

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": UA, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8"},
        ) as client:
            r = await client.get(req.url)
            r.raise_for_status()
            html = r.text
    except httpx.HTTPError as e:
        return ScrapeResponse(success=False, store=store, error=f"Fetch failed: {type(e).__name__}")

    data = _extract(html)
    has_data = bool(data.get("name") or data.get("price"))
    return ScrapeResponse(
        success=has_data,
        name=data.get("name"),
        price=data.get("price"),
        store=store,
        image=data.get("image"),
        error=None if has_data else "Could not extract product info",
    )
