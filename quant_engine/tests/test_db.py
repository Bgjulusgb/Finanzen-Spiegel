"""Tests fuer die SQLite-Persistenz."""

from __future__ import annotations

from pathlib import Path

from quant_engine.db import Database


def test_prices_roundtrip(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    rows = [
        {"ts_utc": "2026-01-01T00:00:00+00:00", "close": 100.0, "open": 99, "high": 101, "low": 98, "volume": 1000},
        {"ts_utc": "2026-01-02T00:00:00+00:00", "close": 102.0, "open": 100, "high": 103, "low": 99, "volume": 1200},
    ]
    n = db.upsert_prices("X", rows)
    assert n == 2
    got = db.get_prices("X", limit=10)
    assert len(got) == 2
    assert got[0]["close"] == 100.0


def test_articles_dedup(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    art = {
        "url": "https://x.test/a",
        "url_hash": "h1",
        "source_id": "s1",
        "source_name": "S1",
        "source_trust": 0.5,
        "title": "Hello",
        "summary": "World",
        "published_utc": "2026-05-01T00:00:00+00:00",
        "fetched_utc": "2026-05-01T00:00:00+00:00",
        "lang": "en",
        "extra": {"x": 1},
    }
    a = db.upsert_article("X", art)
    b = db.upsert_article("X", art)
    assert a == b  # gleiche ID bei Dedup
    items = db.get_articles("X", limit=10)
    assert len(items) == 1


def test_sentiment_and_metric_and_alert(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    art = {"url": "https://x.test/a", "url_hash": "h1", "fetched_utc": "2026-05-01T00:00:00+00:00"}
    aid = db.upsert_article("X", art)
    assert aid is not None
    db.upsert_sentiment(aid, {
        "polarity": 0.3, "confidence": 0.7,
        "sentiment_strength": 0.21, "weighted_score": 0.1,
        "model": "lexicon", "political_categories": [],
    })

    db.upsert_metric("X", "2026-05-01", "sentiment_score", 12.5)
    series = db.get_metric_series("X", "sentiment_score")
    assert len(series) == 1
    assert series[0]["value"] == 12.5

    db.insert_alert("X", {"type": "panic", "severity": 0.8, "title": "T", "message": "M"})
    alerts = db.get_alerts("X")
    assert len(alerts) == 1
    assert alerts[0]["type"] == "panic"
