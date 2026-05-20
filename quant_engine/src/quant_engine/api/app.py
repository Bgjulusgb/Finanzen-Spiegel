"""FastAPI App + Routen.

Endpoints:
- GET /api/health
- GET /api/asset                   aktuelles Asset
- GET /api/assets                  alle vordefinierten Assets
- GET /api/analysis                voller Snapshot (gecacht)
- POST /api/analysis/refresh       neu rechnen
- GET /api/prices                  OHLCV-Historie
- GET /api/sentiment               Sentiment-Block
- GET /api/sentiment/series        Tagesserie
- GET /api/momentum                Momentum-Block
- GET /api/volatility              Volatilitaets-Block
- GET /api/political_risk          Politik-Risk-Block
- GET /api/forecast                Prognose-Wahrscheinlichkeiten
- GET /api/anomalies               Anomalien
- GET /api/alerts                  letzte Alerts
- GET /api/explain                 textuelle Erklaerungen
- GET /api/articles                Nachrichten (DB)
- POST /api/sources/discover       Auto-Discovery von neuen Feeds
- GET /                             statisches Dashboard
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ..cache import TTLCache
from ..config import Asset, get_config
from ..data.discovery import discover_for_many
from ..data.prices import fetch_history, fetch_quote
from ..db import Database
from ..explain import explain_all
from ..logger import get_logger
from ..pipeline import analyze
from ..scheduler import start_scheduler, stop_scheduler

_logger = get_logger("api")
_snapshot_cache = TTLCache(max_entries=10, default_ttl=120.0)


def _resolve_asset(symbol: str | None) -> Asset:
    cfg = get_config()
    if not symbol:
        return cfg.active_asset
    for asset in cfg.assets:
        if asset.symbol == symbol:
            return asset
    # Symbol unbekannt -> dynamisch erlauben.
    return Asset(symbol=symbol, name=symbol, queries=[symbol])


async def _get_snapshot(symbol: str | None, *, refresh: bool = False) -> dict[str, Any]:
    asset = _resolve_asset(symbol)
    key = f"snapshot:{asset.symbol}"
    if not refresh:
        cached = _snapshot_cache.get(key)
        if cached is not None:
            return cached
    snap = await analyze(asset)
    _snapshot_cache.set(key, snap)
    return snap


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_config()
    db = Database(cfg.db_path)
    app.state.db = db
    app.state.config = cfg
    start_scheduler()
    _logger.info("FastAPI startup ok")
    try:
        yield
    finally:
        stop_scheduler()
        db.close()
        _logger.info("FastAPI shutdown ok")


app = FastAPI(
    title="Quant Engine API",
    version="0.1.0",
    description="Quantitative Single-Asset Intelligence System",
    lifespan=lifespan,
)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    cfg = get_config()
    return {
        "status": "ok",
        "active_asset": cfg.active_asset.symbol,
        "sources_configured": len(cfg.sources),
        "version": "0.1.0",
    }


@app.get("/api/asset")
async def get_active_asset() -> dict[str, Any]:
    asset = get_config().active_asset
    return {"symbol": asset.symbol, "name": asset.name, "type": asset.type, "queries": asset.queries}


@app.get("/api/assets")
async def list_assets() -> dict[str, Any]:
    return {
        "assets": [
            {"symbol": a.symbol, "name": a.name, "type": a.type, "queries": a.queries}
            for a in get_config().assets
        ]
    }


@app.get("/api/analysis")
async def get_analysis(symbol: str | None = Query(None)) -> dict[str, Any]:
    return await _get_snapshot(symbol)


@app.post("/api/analysis/refresh")
async def refresh_analysis(symbol: str | None = Query(None)) -> dict[str, Any]:
    return await _get_snapshot(symbol, refresh=True)


@app.get("/api/prices")
async def get_prices(
    symbol: str | None = Query(None),
    range_: str = Query("3mo", alias="range"),
    interval: str = Query("1d"),
) -> dict[str, Any]:
    asset = _resolve_asset(symbol)
    rows = await fetch_history(asset.symbol, range_=range_, interval=interval)
    quote = await fetch_quote(asset.symbol)
    return {"symbol": asset.symbol, "interval": interval, "range": range_, "rows": rows, "quote": quote}


def _slice(snapshot: dict[str, Any], key: str) -> dict[str, Any]:
    return {"symbol": snapshot["asset"]["symbol"], key: snapshot.get(key, {}), "ts_utc": snapshot.get("ts_utc")}


@app.get("/api/sentiment")
async def get_sentiment(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return _slice(snap, "sentiment")


@app.get("/api/sentiment/series")
async def get_sentiment_series(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return {"symbol": snap["asset"]["symbol"], "series": snap.get("sentiment", {}).get("series_daily", [])}


@app.get("/api/momentum")
async def get_momentum(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return _slice(snap, "momentum")


@app.get("/api/volatility")
async def get_volatility(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return _slice(snap, "volatility")


@app.get("/api/political_risk")
async def get_political_risk(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return _slice(snap, "political_risk")


@app.get("/api/forecast")
async def get_forecast(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return _slice(snap, "forecast")


@app.get("/api/anomalies")
async def get_anomalies(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return _slice(snap, "anomalies")


@app.get("/api/alerts")
async def get_alerts(symbol: str | None = Query(None), limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    asset = _resolve_asset(symbol)
    db: Database = app.state.db
    rows = db.get_alerts(asset.symbol, limit=limit)
    return {"symbol": asset.symbol, "alerts": rows}


@app.get("/api/explain")
async def get_explain(symbol: str | None = Query(None)) -> dict[str, Any]:
    snap = await _get_snapshot(symbol)
    return {"symbol": snap["asset"]["symbol"], "explanations": explain_all(snap)}


@app.get("/api/articles")
async def get_articles(
    symbol: str | None = Query(None),
    since_utc: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    asset = _resolve_asset(symbol)
    db: Database = app.state.db
    items = db.get_articles(asset.symbol, since_utc=since_utc, limit=limit)
    return {"symbol": asset.symbol, "n": len(items), "items": items}


@app.post("/api/sources/discover")
async def discover_sources(payload: dict[str, Any]) -> dict[str, Any]:
    urls = payload.get("urls") or []
    if not isinstance(urls, list) or not urls:
        raise HTTPException(status_code=400, detail="urls (list) required")
    found = await discover_for_many(urls)
    db: Database = app.state.db
    for f in found:
        db.upsert_source(
            {
                "id": f["url"],
                "name": f.get("title") or f["url"],
                "url": f["url"],
                "type": "rss",
                "trust": 0.35,
                "lang": "auto",
                "category": "discovered",
            }
        )
    return {"n_found": len(found), "sources": found}


# Statisches Dashboard
WEB_DIR = Path(__file__).resolve().parents[3] / "web"
if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def index() -> HTMLResponse:
        html_path = WEB_DIR / "index.html"
        return HTMLResponse(html_path.read_text(encoding="utf-8"))

else:
    @app.get("/")
    async def index_fallback() -> JSONResponse:
        return JSONResponse({"hint": "Dashboard nicht gefunden", "api": "/api/health"})
