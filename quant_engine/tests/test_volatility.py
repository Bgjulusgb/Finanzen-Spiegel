"""Tests fuer Volatilitaets-Modul."""

from __future__ import annotations

import math

import pytest

from quant_engine.quant.volatility import (
    annualized_volatility,
    atr,
    beta,
    log_returns,
    rolling_std,
    summarize_volatility,
    volatility_clustering,
)


def test_log_returns_basic():
    closes = [100, 110, 105]
    r = log_returns(closes)
    assert len(r) == 2
    assert r[0] == pytest.approx(math.log(110 / 100), rel=1e-9)
    assert r[1] == pytest.approx(math.log(105 / 110), rel=1e-9)


def test_log_returns_handles_zero():
    closes = [100, 0, 110]
    r = log_returns(closes)
    assert len(r) == 2
    assert all(math.isfinite(x) for x in r)


def test_annualized_volatility_scaling():
    rets = [0.01, -0.01] * 25
    av = annualized_volatility(rets)
    assert av > 0
    assert av < 1.0


def test_rolling_std_window():
    out = rolling_std([1, 2, 3, 4, 5, 6, 7, 8, 9], window=3)
    assert out[0] == 0.0
    assert out[1] == 0.0
    assert out[2] == pytest.approx(1.0)
    assert out[-1] == pytest.approx(1.0)


def test_atr_grows_with_range():
    n = 30
    highs = [105 + i for i in range(n)]
    lows = [95 + i for i in range(n)]
    closes = [100 + i for i in range(n)]
    out = atr(highs, lows, closes, period=14)
    assert all(v >= 0 for v in out)
    assert out[-1] > 0


def test_beta_perfect_correlation():
    rets = [0.01, -0.02, 0.03, -0.01, 0.015, -0.025, 0.012, -0.018, 0.022, -0.011]
    bench = [r * 2 for r in rets]  # 2x leverage
    b = beta(rets, bench)
    # cov = 2*var(x), var = 4*var(x) => 0.5
    assert b == pytest.approx(0.5, rel=0.05)


def test_volatility_clustering_runs():
    rets = [0.0] * 30
    rets[10:15] = [0.05, -0.05, 0.05, -0.05, 0.05]
    c = volatility_clustering(rets)
    assert -1.0 <= c <= 1.0


def test_summarize_volatility_full():
    closes = [100 + (i % 5) for i in range(60)]
    res = summarize_volatility(closes=closes)
    assert res.sigma_daily >= 0
    assert 0 <= res.risk_score <= 1
    assert 0 <= res.panic_probability <= 1
    assert 0 <= res.hype_probability <= 1


def test_panic_hype_respond_to_sentiment():
    closes = [100 + (i % 7) * 1.5 for i in range(60)]
    bullish = summarize_volatility(closes=closes, sentiment_score=80)
    bearish = summarize_volatility(closes=closes, sentiment_score=-80)
    assert bullish.hype_probability > bearish.hype_probability
    assert bearish.panic_probability > bullish.panic_probability
