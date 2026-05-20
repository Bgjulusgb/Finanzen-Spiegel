"""Tests fuer politisches Risiko."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from quant_engine.quant.political_risk import (
    PoliticalEvent,
    aggregate_risk,
    build_events,
    compute_political_risk,
    detect_categories,
)


LEXICON = {
    "war": {"en": ["war", "invasion"], "de": ["krieg", "invasion"]},
    "sanctions": {"en": ["sanction", "sanctions"], "de": ["sanktion"]},
    "tariff": {"en": ["tariff"], "de": ["zoll"]},
}


def test_detect_categories_en():
    cats = detect_categories("US sanctions Russia, new tariff regime", LEXICON, lang="en")
    assert "sanctions" in cats
    assert "tariff" in cats


def test_detect_categories_de():
    cats = detect_categories("EZB ueber Sanktion gegen Russland - Krieg eskaliert", LEXICON, lang="de")
    assert "sanctions" in cats
    assert "war" in cats


def test_detect_categories_empty_text():
    assert detect_categories("", LEXICON) == []


def test_event_contribution_decays():
    fresh = PoliticalEvent(category="sanctions", severity=0.9, exposure=0.9, market_sensitivity=0.5, age_hours=0)
    old = PoliticalEvent(category="sanctions", severity=0.9, exposure=0.9, market_sensitivity=0.5, age_hours=24 * 14)
    assert fresh.contribution() > old.contribution()


def test_aggregate_risk_score_bounded():
    events = [
        PoliticalEvent("sanctions", 0.9, 0.9, 0.7, 1.0, 1.0) for _ in range(50)
    ]
    res = aggregate_risk(events)
    assert 0 <= res["score"] <= 100


def test_build_events_uses_age():
    now = datetime.now(timezone.utc)
    articles = [
        {"title": "US announces new sanctions on chipmakers",
         "summary": "tariff on imports",
         "lang": "en",
         "published_utc": (now - timedelta(hours=2)).isoformat(),
         "source_trust": 1.0},
    ]
    events = build_events(
        articles,
        political_lexicon=LEXICON,
        severity_weights={"sanctions": 0.9, "tariff": 0.7},
        exposure_map={"sanctions": 0.9, "tariff": 0.8},
    )
    cats = [e.category for e in events]
    assert "sanctions" in cats and "tariff" in cats
    assert events[0].age_hours == pytest.approx(2.0, abs=0.1)


def test_compute_political_risk_end_to_end():
    cfg = {
        "categories": LEXICON,
        "exposure_map": {"NVDA": {"sanctions": 0.9, "tariff": 0.85}},
    }
    weights = {"sanctions": 0.9, "tariff": 0.7}
    articles = [
        {"title": "US sanctions on chip imports", "summary": "tariff regime", "lang": "en",
         "published_utc": datetime.now(timezone.utc).isoformat(), "source_trust": 1.0},
    ]
    res = compute_political_risk(articles, cfg, weights, symbol="NVDA")
    assert res["score"] > 0
    assert isinstance(res["breakdown"], list)
