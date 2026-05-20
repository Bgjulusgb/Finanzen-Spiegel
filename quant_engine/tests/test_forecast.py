"""Tests fuer Prognose-Modul."""

from __future__ import annotations

import math

import pytest

from quant_engine.quant.forecast import (
    ForecastInput,
    directional_probabilities,
    forecast,
    linear_regression_forecast,
    random_walk_drift,
    volatility_probabilities,
)


def test_random_walk_drift_no_data():
    mu, sd = random_walk_drift([], horizon=5)
    assert mu == 0.0
    assert sd > 0


def test_random_walk_drift_scales_with_horizon():
    closes = [100, 101, 102, 103, 104, 105, 106, 107]
    mu5, sd5 = random_walk_drift(closes, horizon=5)
    mu1, sd1 = random_walk_drift(closes, horizon=1)
    assert sd5 > sd1
    assert mu5 > mu1


def test_directional_probabilities_sum_to_one():
    d = directional_probabilities(expected_log_return=0.01, sigma=0.02)
    assert d["bullish_probability"] + d["bearish_probability"] == pytest.approx(1.0, abs=1e-9)


def test_directional_sentiment_bias():
    bull = directional_probabilities(0.0, 0.02, sentiment_score=80)
    bear = directional_probabilities(0.0, 0.02, sentiment_score=-80)
    assert bull["bullish_probability"] > bear["bullish_probability"]


def test_volatility_probabilities_monotonic():
    low = volatility_probabilities(sigma_daily=0.01)
    high = volatility_probabilities(sigma_daily=0.05)
    assert high["high_volatility_probability"] > low["high_volatility_probability"]


def test_linear_regression_predicts_known_relation():
    history_returns = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12]
    feats = [[i] for i in range(12)]  # rendite = 0.01 + 0.01 * i
    out = linear_regression_forecast(history_returns, feats, features_current=[12])
    assert out["predicted_return"] == pytest.approx(0.13, abs=0.005)
    assert out["r2"] > 0.99


def test_linear_regression_underdetermined():
    out = linear_regression_forecast([0.1], [[1.0]], features_current=[2.0])
    assert out["predicted_return"] == 0.0


def test_forecast_full_pipeline():
    closes = [100 + (i % 10) * 0.5 for i in range(60)]
    inp = ForecastInput(closes=closes, sentiment_score=10.0, sigma_daily=0.015, political_risk=20.0)
    out = forecast(inp)
    for k in ("expected_return_pct", "expected_price", "ci95_low", "ci95_high",
              "bullish_probability", "bearish_probability", "high_volatility_probability", "panic_risk"):
        assert k in out
    assert math.isfinite(out["expected_return_pct"])
