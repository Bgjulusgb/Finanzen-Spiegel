"""Async HTTP-Client mit Retry und User-Agent.

Eine einzige httpx.AsyncClient-Instanz pro Prozess, weil das
TCP-Connection-Pooling sonst flatlined.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from ..logger import get_logger

_logger = get_logger("http")

_DEFAULT_UA = os.getenv(
    "QUANT_HTTP_USER_AGENT",
    "QuantEngine/0.1 (open-source research bot)",
)
_DEFAULT_TIMEOUT = float(os.getenv("QUANT_HTTP_TIMEOUT", "20"))

_client: httpx.AsyncClient | None = None
_lock = asyncio.Lock()


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        async with _lock:
            if _client is None:
                _client = httpx.AsyncClient(
                    timeout=httpx.Timeout(_DEFAULT_TIMEOUT, connect=10.0),
                    headers={"User-Agent": _DEFAULT_UA, "Accept": "*/*"},
                    follow_redirects=True,
                    http2=False,
                )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def fetch(
    url: str,
    *,
    retries: int = 2,
    backoff: float = 1.5,
    headers: dict[str, str] | None = None,
    expect_json: bool = False,
) -> Any:
    """GET mit Retry/Backoff. Liefert bytes oder geparstes JSON."""
    client = await get_client()
    merged_headers = dict(client.headers)
    if headers:
        merged_headers.update(headers)

    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = await client.get(url, headers=merged_headers)
            if resp.status_code in (429, 503):
                raise httpx.HTTPStatusError("rate-limited", request=resp.request, response=resp)
            resp.raise_for_status()
            if expect_json:
                return resp.json()
            return resp.content
        except Exception as exc:
            last_err = exc
            wait = backoff * (2 ** attempt)
            _logger.warning(
                "fetch attempt %s/%s failed for %s (%s); sleep %.1fs",
                attempt + 1,
                retries + 1,
                url,
                type(exc).__name__,
                wait,
            )
            if attempt >= retries:
                break
            await asyncio.sleep(wait)
    if last_err:
        raise last_err
    raise RuntimeError("fetch failed without exception")
