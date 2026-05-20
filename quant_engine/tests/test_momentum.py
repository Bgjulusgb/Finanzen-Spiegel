"""Tests fuer Momentum-Modul."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from quant_engine.quant.momentum import (
    acceleration,
    ema,
    mention_series,
    sentiment_momentum,
    summarize_momentum,
    trend_strength,
    velocity,
)


def _iso(now, hours_ago):
    return (now - timedelta(hours=hours_ago)).isoformat()


def test_mention_series_hourly():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    ts = [_iso(now, h) for h in (0, 0, 1, 3)]
    series = mention_series(ts, granularity="hour", fill_zeros=False)
    assert sum(p["count"] for p in series) == 4


def test_mention_series_fills_zeros():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    ts = [_iso(now, h) for h in (0, 5)]
    series = mention_series(ts, granularity="hour", lookback=6)
    assert len(series) == 6
    zeros = [p for p in series if p["count"] == 0]
    assert len(zeros) >= 4


def test_velocity_and_acceleration_simple():
    series = [{"ts": "a", "count": 2.0}, {"ts": "b", "count": 5.0}, {"ts": "c", "count": 6.0}]
    v = velocity(series)
    assert [round(p["value"], 1) for p in v] == [0.0, 3.0, 1.0]
    a = acceleration(v)
    assert [round(p["value"], 1) for p in a] == [0.0, 3.0, -2.0]


def test_ema_smoothing():
    values = [1, 1, 1, 10]
    smoothed = ema(values, alpha=0.5)
    assert smoothed[0] == 1.0
    assert smoothed[-1] < 10.0
    assert smoothed[-1] > 1.0


def test_trend_strength_rising():
    s = trend_strength([1, 2, 3, 4, 5], window=5)
    assert s == pytest.approx(1.0, abs=1e-6)


def test_trend_strength_flat():
    assert trend_strength([3, 3, 3, 3], window=4) == 0.0


def test_sentiment_momentum_signals():
    series = [{"ts": f"d{i}", "score": s} for i, s in enumerate([-10, -5, 0, 8, 15])]
    out = sentiment_momentum(series, alpha=0.5)
    assert len(out["velocity"]) == 5
    assert out["velocity"][-1]["value"] == pytest.approx(7.0)


def test_summarize_detects_spike():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    # 1 mention per hour for 24h, then a sudden burst of 30 in the last hour.
    ts = [_iso(now, h) for h in range(1, 25)]
    ts.extend([_iso(now, 0) for _ in range(30)])
    res = summarize_momentum(ts, granularity="hour", spike_z_threshold=2.0)
    assert res["spike_detected"] is True
    assert res["latest_z"] > 2.0
