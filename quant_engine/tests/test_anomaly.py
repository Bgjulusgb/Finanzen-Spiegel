"""Tests fuer Anomalie-Erkennung."""

from __future__ import annotations

from quant_engine.quant.anomaly import (
    detect_drops,
    detect_spikes,
    isolation_forest_outliers,
    rolling_zscore,
    summarize_anomalies,
)


def test_rolling_zscore_flat():
    z = rolling_zscore([5.0] * 20, window=10)
    assert all(abs(v) < 1e-9 for v in z)


def test_rolling_zscore_detects_spike():
    series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 10]
    z = rolling_zscore(series, window=10)
    assert z[-1] > 3.0


def test_detect_spikes_returns_index_and_z():
    series = [{"ts": str(i), "count": 1} for i in range(10)]
    series.append({"ts": "10", "count": 20})
    out = detect_spikes(series, value_key="count", threshold=2.0, window=10)
    assert any(s["ts"] == "10" for s in out)


def test_detect_drops_negative_only():
    series = [{"ts": str(i), "score": 5} for i in range(10)]
    series.append({"ts": "10", "score": -50})
    out = detect_drops(series, value_key="score", threshold=2.0, window=10)
    assert all(s["z"] < 0 for s in out)


def test_isolation_forest_fallback_runs():
    matrix = [[1.0, 1.0]] * 20 + [[10.0, 10.0]]
    out = isolation_forest_outliers(matrix, contamination=0.1)
    assert isinstance(out, list)
    assert 20 in out or len(out) >= 1


def test_summarize_anomalies_all_kinds():
    mention_series = [{"ts": str(i), "count": 1} for i in range(20)] + [{"ts": "20", "count": 30}]
    sentiment_series = [{"ts": str(i), "score": 0} for i in range(20)] + [{"ts": "20", "score": -80}]
    returns = [0.0] * 20 + [0.2]
    out = summarize_anomalies(
        mention_series=mention_series,
        sentiment_series=sentiment_series,
        return_series=returns,
        z_threshold=2.0,
        window=20,
    )
    assert out["news_spikes"]
    assert out["sentiment_drops"]
    assert out["return_outliers"]
