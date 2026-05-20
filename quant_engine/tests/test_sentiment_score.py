"""Tests fuer den Sentiment-Score (Weighted)."""

from __future__ import annotations

import math

import pytest

from quant_engine.quant.sentiment_score import (
    SentimentSample,
    aggregate,
    age_hours_from_iso,
    mention_weight,
    recency_factor,
    weighted_sample,
)


def test_recency_factor_decay():
    assert recency_factor(0) == pytest.approx(1.0)
    assert recency_factor(24, lambda_per_hour=0.0289) == pytest.approx(0.5, rel=0.02)
    assert recency_factor(48, lambda_per_hour=0.0289) == pytest.approx(0.25, rel=0.05)


def test_recency_factor_monotonically_decreasing():
    prev = 1.0
    for hours in [1, 6, 24, 72, 168]:
        cur = recency_factor(hours)
        assert cur < prev
        prev = cur


def test_mention_weight_cap():
    assert mention_weight(0) == 0.0
    assert mention_weight(1) == pytest.approx(1.0 + 0.15 * math.log(2))
    assert mention_weight(10**6, max_weight=1.5) == 1.5


def test_weighted_sample_signed_vs_abs():
    s = SentimentSample(polarity=0.6, sentiment_strength=0.8, source_trust=0.9, mentions=3, age_hours=12)
    signed, base = weighted_sample(s)
    assert base > 0
    assert 0 < signed <= base


def test_aggregate_empty():
    res = aggregate([])
    assert res["score"] == 0.0
    assert res["n_samples"] == 0


def test_aggregate_mixed_polarities_scaled():
    pos = SentimentSample(polarity=0.8, sentiment_strength=0.9, source_trust=1.0, mentions=3, age_hours=0)
    neg = SentimentSample(polarity=-0.4, sentiment_strength=0.5, source_trust=0.5, mentions=1, age_hours=24)
    res = aggregate([pos, neg])
    assert -100.0 <= res["score"] <= 100.0
    assert res["score"] > 0


def test_aggregate_clamping():
    samples = [
        SentimentSample(polarity=1.0, sentiment_strength=1.0, source_trust=1.0, mentions=10, age_hours=0)
        for _ in range(50)
    ]
    res = aggregate(samples)
    assert res["score"] <= 100.0
    assert res["score"] >= 99.0


def test_age_hours_from_iso_basic():
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    iso = (now - timedelta(hours=10)).isoformat()
    assert age_hours_from_iso(iso, now=now) == pytest.approx(10.0, rel=0.01)


def test_age_hours_from_iso_invalid():
    assert age_hours_from_iso("not-a-date") == 0.0
