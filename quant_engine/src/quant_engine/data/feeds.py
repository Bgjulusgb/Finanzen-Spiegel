"""RSS/Atom/JSON Feed-Fetcher.

Nutzt feedparser fuer den Parser und httpx fuer den eigentlichen HTTP-Call,
damit wir Retries/Header/Timeouts kontrollieren.

URL-Templates duerfen die Platzhalter ``{SYMBOL}`` und ``{QUERY}`` enthalten,
die pro Asset ersetzt werden.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus

import feedparser

from ..cache import TTLCache
from ..logger import get_logger
from .http import fetch

_logger = get_logger("feeds")
_cache = TTLCache(max_entries=200, default_ttl=600.0)


def url_hash(url: str) -> str:
    return hashlib.sha1(url.strip().lower().encode("utf-8")).hexdigest()


def expand_url(template: str, symbol: str, query: str) -> str:
    """Ersetzt Platzhalter im URL-Template."""
    return template.replace("{SYMBOL}", quote_plus(symbol)).replace("{QUERY}", quote_plus(query))


def _parse_published(entry: dict[str, Any]) -> str | None:
    for key in ("published_parsed", "updated_parsed"):
        tm = entry.get(key)
        if tm:
            try:
                return datetime(*tm[:6], tzinfo=timezone.utc).isoformat()
            except (TypeError, ValueError):
                continue
    return None


def _clean(text: str | None) -> str:
    if not text:
        return ""
    # feedparser kann HTML mitliefern. Wir entfernen rudimentaer Tags.
    import re

    cleaned = re.sub(r"<[^>]+>", " ", str(text))
    return re.sub(r"\s+", " ", cleaned).strip()


def parse_feed_bytes(content: bytes, source: dict[str, Any]) -> list[dict[str, Any]]:
    """Parst Feed-Bytes mit feedparser und normalisiert Felder."""
    parsed = feedparser.parse(content)
    items = []
    for entry in parsed.entries:
        url = entry.get("link", "") or ""
        if not url:
            continue
        title = _clean(entry.get("title"))
        summary = _clean(entry.get("summary") or entry.get("description"))
        published = _parse_published(entry)
        items.append(
            {
                "url": url,
                "url_hash": url_hash(url),
                "title": title,
                "summary": summary,
                "published_utc": published,
                "fetched_utc": datetime.now(timezone.utc).isoformat(),
                "source_id": source.get("id"),
                "source_name": source.get("name"),
                "source_trust": float(source.get("trust", 0.4)),
                "lang": source.get("lang", "en"),
                "extra": {"category": source.get("category")},
            }
        )
    return items


async def fetch_feed(source: dict[str, Any], symbol: str, query: str) -> list[dict[str, Any]]:
    """Holt einen einzelnen Feed und liefert normalisierte Items."""
    url = expand_url(source["url"], symbol=symbol, query=query)
    key = f"feed:{url}"
    cached = _cache.get(key)
    if cached is not None:
        return cached

    headers = {"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"}
    try:
        content = await fetch(url, headers=headers)
    except Exception as exc:
        _logger.warning("feed fetch failed: %s - %s", source.get("id"), exc)
        return []

    items = parse_feed_bytes(content, source)
    _cache.set(key, items)
    return items


async def fetch_all(sources: list[dict[str, Any]], symbol: str, query: str) -> dict[str, list[dict[str, Any]]]:
    """Holt alle relevanten Feeds parallel.

    Quellen ohne ``per_asset=True`` werden trotzdem geholt, weil sie
    Markt-Hintergrund liefern (Notenbanken, Tagesschau Wirtschaft etc.).
    """
    import asyncio

    tasks = []
    matched: list[dict[str, Any]] = []
    for src in sources:
        if src.get("type") not in ("rss", "atom"):
            continue
        matched.append(src)
        tasks.append(fetch_feed(src, symbol, query))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: dict[str, list[dict[str, Any]]] = {}
    for src, res in zip(matched, results):
        if isinstance(res, Exception):
            _logger.warning("feed task failed for %s: %s", src.get("id"), res)
            continue
        out[src["id"]] = res
    return out
