"""Tests fuer Alert-Engine und Explain-Modul."""

from __future__ import annotations

from quant_engine.alerts import _LAST_ALERT_AT, detect_alerts
from quant_engine.explain import explain_all


def _reset():
    _LAST_ALERT_AT.clear()


def test_no_alerts_for_quiet_snapshot():
    _reset()
    snap = {
        "sentiment": {"score": 0, "series_daily": [{"ts": "d1", "score": 0}, {"ts": "d2", "score": 1}]},
        "momentum": {"spike_detected": False, "latest_z": 0.5},
        "volatility": {"panic_probability": 0.1, "hype_probability": 0.1, "sigma_daily": 0.01},
        "political_risk": {"score": 5},
    }
    alerts = detect_alerts(snap, {})
    assert alerts == []


def test_sentiment_jump_triggers_alert():
    _reset()
    snap = {
        "sentiment": {"score": 40, "series_daily": [{"ts": "d1", "score": -20}, {"ts": "d2", "score": 40}]},
        "momentum": {"spike_detected": False, "latest_z": 0},
        "volatility": {"panic_probability": 0.0, "hype_probability": 0.0, "sigma_daily": 0.0},
        "political_risk": {"score": 0},
    }
    alerts = detect_alerts(snap, {"sentiment_jump": 25, "cooldown_minutes": 0})
    types = [a["type"] for a in alerts]
    assert "sentiment_jump" in types


def test_panic_and_political_trigger():
    _reset()
    snap = {
        "sentiment": {"score": -40, "series_daily": []},
        "momentum": {"spike_detected": True, "latest_z": 3.5},
        "volatility": {"panic_probability": 0.9, "hype_probability": 0.1, "sigma_daily": 0.07},
        "political_risk": {"score": 75, "breakdown": [{"category": "sanctions", "score": 80}]},
    }
    alerts = detect_alerts(snap, {"cooldown_minutes": 0})
    types = {a["type"] for a in alerts}
    assert "panic_risk" in types
    assert "political_escalation" in types
    assert "news_spike" in types
    assert "volatility_breakout" in types


def test_explain_all_shape():
    snap = {
        "sentiment": {"score": 22, "series_daily": []},
        "volatility": {"sigma_daily": 0.02, "sigma_annual": 0.32, "atr_latest": 1.2,
                       "clustering": 0.1, "panic_probability": 0.2, "hype_probability": 0.5},
        "political_risk": {"score": 30, "breakdown": [{"category": "tariff", "score": 30}], "n_events": 3},
        "forecast": {"bullish_probability": 0.6, "bearish_probability": 0.4, "expected_return_pct": 1.5, "horizon_days": 5},
        "n_articles": 42,
        "keywords": [{"term": "chip", "score": 1.0}],
        "entities": {"organizations": ["NVIDIA"], "countries": ["China"]},
    }
    out = explain_all(snap)
    assert "direction" in out and "news" in out and "political" in out and "volatility" in out
    assert out["direction"]["rationale"]
