"""Gewichteter Sentiment-Score.

Formel:

    WeightedSentiment_i = SourceTrust_i * MentionWeight_i
                          * RecencyFactor_i * SentimentStrength_i

Aggregat (skaliert auf -100..+100):

    Score = clamp(100 * sum(W_i) / sum(|N_i|), -100, +100)

mit Normierung ueber die Summe der absoluten Gewichte (ohne
Sentiment-Vorzeichen), so dass der Score robust gegen schwache
Beimischungen bleibt und nicht durch Volumen explodiert.

Recency: exponentieller Decay
    RecencyFactor = exp(-lambda * hours_old)
Default lambda ~ 0.0289 entspricht Halbwertszeit ~ 24h.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable


@dataclass
class SentimentSample:
    """Ein einzelnes Sentiment-Sample mit Metadaten."""

    polarity: float            # -1..+1
    sentiment_strength: float  # 0..1 (Confidence oder |polarity|)
    source_trust: float        # 0..1
    mentions: int              # Anzahl Asset-Erwaehnungen im Text
    age_hours: float           # Stunden seit Veroeffentlichung

    def normalized_strength(self) -> float:
        return max(0.0, min(1.0, abs(self.sentiment_strength)))


def recency_factor(age_hours: float, lambda_per_hour: float = 0.0289) -> float:
    """Exponentieller Decay. Halbwertszeit = ln(2)/lambda.

    Bei lambda=0.0289 -> Halbwertszeit ~ 24 Stunden.
    """
    age = max(0.0, float(age_hours))
    return math.exp(-lambda_per_hour * age)


def mention_weight(
    mentions: int,
    factor: float = 0.15,
    max_weight: float = 1.5,
) -> float:
    """Mentions skalieren mit ``1 + factor*log(1+mentions)`` (gedeckelt).

    Vermeidet, dass Spam-artige Wiederholungen den Score dominieren.
    """
    if mentions <= 0:
        return 0.0
    raw = 1.0 + factor * math.log1p(mentions)
    return min(max_weight, raw)


def weighted_sample(
    sample: SentimentSample,
    lambda_per_hour: float = 0.0289,
    mention_factor: float = 0.15,
    max_mention_weight: float = 1.5,
) -> tuple[float, float]:
    """Liefert (signed_weighted, abs_weight) fuer ein Sample.

    Wird in :func:`aggregate` zur Score-Berechnung aufsummiert.
    """
    rf = recency_factor(sample.age_hours, lambda_per_hour)
    mw = mention_weight(sample.mentions, mention_factor, max_mention_weight)
    st = max(0.0, min(1.0, float(sample.source_trust)))
    strength = sample.normalized_strength()
    base = st * mw * rf * strength
    signed = base * max(-1.0, min(1.0, sample.polarity))
    return signed, base


def aggregate(
    samples: Iterable[SentimentSample],
    lambda_per_hour: float = 0.0289,
    mention_factor: float = 0.15,
    max_mention_weight: float = 1.5,
) -> dict[str, float]:
    """Aggregiert Samples zu einem skalierten Score.

    Rueckgabe:
        - ``score``: -100..+100
        - ``magnitude``: 0..1 (relatives Volumen vs. Maximum)
        - ``signed_sum``: Roh-Summe gewichteter Polaritaeten
        - ``weight_sum``: Summe absoluter Gewichte
        - ``n_samples``: Anzahl beruecksichtigter Samples
    """
    signed_sum = 0.0
    weight_sum = 0.0
    n = 0
    for s in samples:
        signed, base = weighted_sample(s, lambda_per_hour, mention_factor, max_mention_weight)
        signed_sum += signed
        weight_sum += base
        n += 1

    score = 0.0
    if weight_sum > 1e-12:
        score = 100.0 * signed_sum / weight_sum
        score = max(-100.0, min(100.0, score))

    return {
        "score": round(score, 4),
        "signed_sum": round(signed_sum, 6),
        "weight_sum": round(weight_sum, 6),
        "n_samples": n,
        "magnitude": round(min(1.0, weight_sum / max(1.0, n)), 4),
    }


def age_hours_from_iso(published_iso: str, now: datetime | None = None) -> float:
    """Hilfsfunktion: ISO-String -> Stunden seit jetzt (UTC)."""
    now = now or datetime.now(timezone.utc)
    try:
        ts = datetime.fromisoformat(published_iso.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    delta = (now - ts).total_seconds() / 3600.0
    return max(0.0, delta)
