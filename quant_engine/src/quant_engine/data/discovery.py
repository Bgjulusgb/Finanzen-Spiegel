"""Quellen-Auto-Discovery.

Versucht zu gegebener Domain den RSS/Atom-Feed automatisch zu finden:
- <link rel="alternate" type="application/rss+xml" ...>
- Heuristisch /feed, /rss, /feeds/all.atom.xml

Liefert eine Liste neuer Quellen-Definitionen, die per
``Database.upsert_source`` in die DB wandern koennen.
"""

from __future__ import annotations

from typing import Iterable
from urllib.parse import urljoin, urlparse

import feedparser
from bs4 import BeautifulSoup

from ..logger import get_logger
from .http import fetch

_logger = get_logger("discovery")


KNOWN_PATHS = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/feeds/all.atom.xml", "/index.xml"]


def _normalize_origin(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://" + url
        parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


async def discover_for(url: str) -> list[dict[str, str]]:
    """Findet RSS/Atom-Feed-URLs zu einer Domain.

    Strategie:
    1. Homepage parsen, ``<link rel=alternate>`` einsammeln.
    2. Bekannte Pfade probieren.
    3. Jedes Kandidaten-URL kurz mit feedparser validieren.
    """
    origin = _normalize_origin(url)
    candidates: list[str] = []

    try:
        html = await fetch(origin, retries=1)
        soup = BeautifulSoup(html, "lxml")
        for link in soup.find_all("link", rel=lambda r: r and "alternate" in r):
            t = (link.get("type") or "").lower()
            href = link.get("href")
            if href and ("rss" in t or "atom" in t or "xml" in t):
                candidates.append(urljoin(origin, href))
    except Exception as exc:
        _logger.debug("discovery homepage parse failed for %s: %s", origin, exc)

    for p in KNOWN_PATHS:
        candidates.append(origin + p)

    deduped: list[str] = []
    seen: set[str] = set()
    for c in candidates:
        if c not in seen:
            seen.add(c)
            deduped.append(c)

    found: list[dict[str, str]] = []
    for cand in deduped:
        try:
            content = await fetch(cand, retries=0)
        except Exception:
            continue
        parsed = feedparser.parse(content)
        if not getattr(parsed, "entries", None):
            continue
        if parsed.bozo and not parsed.entries:
            continue
        title = (parsed.feed.get("title") or urlparse(cand).netloc).strip()
        found.append({"url": cand, "title": title})
    return found


async def discover_for_many(urls: Iterable[str]) -> list[dict[str, str]]:
    import asyncio

    tasks = [discover_for(u) for u in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[dict[str, str]] = []
    for res in results:
        if isinstance(res, list):
            out.extend(res)
    return out
