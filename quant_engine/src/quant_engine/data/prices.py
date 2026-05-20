"""Yahoo-Finance-Preisdaten via oeffentlichem Chart-Endpoint.

Endpoint:
    https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range={range}&interval={interval}

Liefert OHLCV als JSON ohne API-Key. Rate-Limits sind moderat, wir
gehen mit Retry/Backoff defensiv um und cachen aggressiv.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..cache import TTLCache
from ..logger import get_logger
from .http import fetch

_logger = get_logger("prices")
_cache = TTLCache(max_entries=500, default_ttl=300.0)


CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range}&interval={interval}"
QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/options/{symbol}"


def _parse_chart(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Yahoo Chart JSON -> Liste von OHLCV-Dicts."""
    try:
        result = payload["chart"]["result"][0]
        timestamps = result.get("timestamp", []) or []
        indicators = result.get("indicators", {}).get("quote", [{}])[0]
        opens = indicators.get("open", []) or []
        highs = indicators.get("high", []) or []
        lows = indicators.get("low", []) or []
        closes = indicators.get("close", []) or []
        vols = indicators.get("volume", []) or []
    except (KeyError, IndexError, TypeError):
        return []

    out: list[dict[str, Any]] = []
    for i, ts in enumerate(timestamps):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        out.append(
            {
                "ts_utc": datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat(),
                "open": opens[i] if i < len(opens) else None,
                "high": highs[i] if i < len(highs) else None,
                "low": lows[i] if i < len(lows) else None,
                "close": float(c),
                "volume": vols[i] if i < len(vols) else None,
            }
        )
    return out


async def fetch_history(symbol: str, *, range_: str = "3mo", interval: str = "1d") -> list[dict[str, Any]]:
    """Holt historische OHLCV-Daten. Mit Cache (TTL 5min)."""
    key = f"history:{symbol}:{range_}:{interval}"
    cached = _cache.get(key)
    if cached is not None:
        return cached

    url = CHART_URL.format(symbol=symbol, range=range_, interval=interval)
    try:
        data = await fetch(url, expect_json=True)
    except Exception as exc:
        _logger.error("history fetch failed for %s: %s", symbol, exc)
        return []
    rows = _parse_chart(data)
    _cache.set(key, rows)
    return rows


async def fetch_quote(symbol: str) -> dict[str, Any] | None:
    """Letzter Kurs (Options-Endpoint enthaelt einen 'quote'-Block).

    Bewusst Options-Endpoint, weil der v7-Quote-Endpoint von Yahoo
    inzwischen Cookie+Crumb verlangt.
    """
    key = f"quote:{symbol}"
    cached = _cache.get(key)
    if cached is not None:
        return cached

    url = QUOTE_URL.format(symbol=symbol)
    try:
        data = await fetch(url, expect_json=True)
        chain = data.get("optionChain", {}).get("result") or []
        if not chain:
            return None
        quote = chain[0].get("quote", {})
    except Exception as exc:
        _logger.warning("quote fetch failed for %s: %s", symbol, exc)
        return None

    result = {
        "symbol": symbol,
        "price": float(quote.get("regularMarketPrice", 0.0) or 0.0),
        "currency": quote.get("currency"),
        "change_pct": float(quote.get("regularMarketChangePercent", 0.0) or 0.0),
        "previous_close": quote.get("regularMarketPreviousClose"),
        "day_high": quote.get("regularMarketDayHigh"),
        "day_low": quote.get("regularMarketDayLow"),
        "volume": quote.get("regularMarketVolume"),
        "exchange": quote.get("fullExchangeName"),
        "ts_utc": datetime.now(timezone.utc).isoformat(),
    }
    _cache.set(key, result, ttl=60.0)
    return result
