"""Reddit JSON Fetcher (oeffentlich, ohne Auth).

Reddit liefert pro Subreddit / Search ein JSON unter ``.json``.
Vorsicht: User-Agent muss aussagekraeftig sein, sonst 429.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus

from ..cache import TTLCache
from ..logger import get_logger
from .http import fetch

_logger = get_logger("reddit")
_cache = TTLCache(max_entries=200, default_ttl=600.0)


def _hash(url: str) -> str:
    return hashlib.sha1(url.lower().encode("utf-8")).hexdigest()


async def fetch_reddit(source: dict[str, Any], symbol: str, query: str) -> list[dict[str, Any]]:
    url = source["url"].replace("{SYMBOL}", quote_plus(symbol)).replace("{QUERY}", quote_plus(query))
    key = f"reddit:{url}"
    cached = _cache.get(key)
    if cached is not None:
        return cached

    try:
        data = await fetch(url, expect_json=True, headers={"Accept": "application/json"})
    except Exception as exc:
        _logger.warning("reddit fetch failed: %s - %s", source.get("id"), exc)
        return []

    children = data.get("data", {}).get("children", []) or []
    items: list[dict[str, Any]] = []
    for child in children:
        d = child.get("data", {})
        permalink = d.get("permalink")
        link = f"https://reddit.com{permalink}" if permalink else d.get("url", "")
        if not link:
            continue
        title = (d.get("title") or "").strip()
        summary = (d.get("selftext") or "").strip()[:1000]
        created = d.get("created_utc")
        published_iso = (
            datetime.fromtimestamp(int(created), tz=timezone.utc).isoformat() if created else None
        )
        items.append(
            {
                "url": link,
                "url_hash": _hash(link),
                "title": title,
                "summary": summary,
                "published_utc": published_iso,
                "fetched_utc": datetime.now(timezone.utc).isoformat(),
                "source_id": source.get("id"),
                "source_name": source.get("name"),
                "source_trust": float(source.get("trust", 0.4)),
                "lang": source.get("lang", "en"),
                "extra": {
                    "score": d.get("score"),
                    "num_comments": d.get("num_comments"),
                    "subreddit": d.get("subreddit"),
                },
            }
        )

    _cache.set(key, items)
    return items


async def fetch_all(sources: list[dict[str, Any]], symbol: str, query: str) -> dict[str, list[dict[str, Any]]]:
    import asyncio

    matched = [s for s in sources if s.get("type") == "reddit_json"]
    if not matched:
        return {}
    tasks = [fetch_reddit(s, symbol, query) for s in matched]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: dict[str, list[dict[str, Any]]] = {}
    for src, res in zip(matched, results):
        if isinstance(res, Exception):
            _logger.warning("reddit task failed for %s: %s", src.get("id"), res)
            continue
        out[src["id"]] = res
    return out
