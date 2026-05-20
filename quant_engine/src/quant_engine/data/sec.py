"""SEC EDGAR Filings via JSON-API.

Endpoint:
    https://data.sec.gov/submissions/CIK{CIK_PADDED_10}.json

CIK muss als 10-stelliger String formatiert sein. Wir filtern auf
relevante Filing-Typen (8-K, 10-K, 10-Q, S-1) der letzten 90 Tage.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from ..cache import TTLCache
from ..logger import get_logger
from .http import fetch

_logger = get_logger("sec")
_cache = TTLCache(max_entries=100, default_ttl=86400.0)

RELEVANT_FORMS = {"8-K", "10-K", "10-Q", "S-1", "S-3", "DEF 14A", "20-F", "6-K"}


def _hash(url: str) -> str:
    return hashlib.sha1(url.lower().encode("utf-8")).hexdigest()


def _pad_cik(cik: str) -> str:
    return cik.strip().lstrip("0").zfill(10)


async def fetch_filings(cik: str, *, limit: int = 25) -> list[dict[str, Any]]:
    """Holt die juengsten Filings."""
    cik_padded = _pad_cik(cik)
    key = f"sec:{cik_padded}"
    cached = _cache.get(key)
    if cached is not None:
        return cached

    url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
    try:
        data = await fetch(url, expect_json=True, headers={"Accept": "application/json"})
    except Exception as exc:
        _logger.warning("SEC fetch failed for CIK %s: %s", cik, exc)
        return []

    recent = data.get("filings", {}).get("recent", {}) or {}
    accession = recent.get("accessionNumber", []) or []
    forms = recent.get("form", []) or []
    dates = recent.get("filingDate", []) or []
    titles = recent.get("primaryDocDescription", []) or []
    docs = recent.get("primaryDocument", []) or []

    items: list[dict[str, Any]] = []
    for i, form in enumerate(forms[:limit * 3]):
        if form not in RELEVANT_FORMS:
            continue
        if i >= len(accession) or i >= len(dates):
            continue
        acc_clean = accession[i].replace("-", "")
        doc = docs[i] if i < len(docs) else ""
        link = (
            f"https://www.sec.gov/Archives/edgar/data/{int(cik_padded)}/{acc_clean}/{doc}"
            if doc
            else f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik_padded}"
        )
        title = f"SEC {form}: {titles[i] if i < len(titles) else ''}".strip().rstrip(":")
        try:
            published_iso = (
                datetime.strptime(dates[i], "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
            )
        except ValueError:
            published_iso = None
        items.append(
            {
                "url": link,
                "url_hash": _hash(link),
                "title": title,
                "summary": titles[i] if i < len(titles) else "",
                "published_utc": published_iso,
                "fetched_utc": datetime.now(timezone.utc).isoformat(),
                "source_id": "sec_edgar",
                "source_name": "SEC EDGAR",
                "source_trust": 1.0,
                "lang": "en",
                "extra": {"form": form, "accession": accession[i]},
            }
        )
        if len(items) >= limit:
            break

    _cache.set(key, items)
    return items
