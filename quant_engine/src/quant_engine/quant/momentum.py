"""Momentum-Analyse fuer News-Volumen und Sentiment.

Formeln:
    Velocity     = mentions_today - mentions_yesterday
    Acceleration = velocity_today - velocity_yesterday
    EMA          = alpha * x_t + (1 - alpha) * EMA_{t-1}

Sentiment-Momentum ist analog: erste Ableitung des Sentiment-Scores.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Iterable, Sequence


def _bucket(dt: datetime, granularity: str = "hour") -> str:
    if granularity == "hour":
        return dt.strftime("%Y-%m-%dT%H")
    if granularity == "day":
        return dt.strftime("%Y-%m-%d")
    raise ValueError(f"unbekannte Granularitaet: {granularity}")


def mention_series(
    timestamps_utc: Iterable[str],
    granularity: str = "hour",
    fill_zeros: bool = True,
    lookback: int = 72,
) -> list[dict[str, float]]:
    """Zaehlt Erwaehnungen je Zeitfenster (Stunde/Tag).

    Fuellt fehlende Buckets mit 0, damit Differenzen sauber definiert sind.
    """
    counts: Counter[str] = Counter()
    parsed: list[datetime] = []
    for ts in timestamps_utc:
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        parsed.append(dt)
        counts[_bucket(dt, granularity)] += 1

    if not parsed:
        return []

    end = max(parsed)
    if fill_zeros:
        step = timedelta(hours=1) if granularity == "hour" else timedelta(days=1)
        start = end - step * max(0, lookback - 1)
        cur = start
        out = []
        while cur <= end:
            out.append({"ts": _bucket(cur, granularity), "count": float(counts.get(_bucket(cur, granularity), 0))})
            cur += step
        return out
    return [{"ts": k, "count": float(v)} for k, v in sorted(counts.items())]


def velocity(series: Sequence[dict[str, float]]) -> list[dict[str, float]]:
    """Erste Differenz: count_t - count_{t-1}."""
    if len(series) < 2:
        return [{"ts": p["ts"], "value": 0.0} for p in series]
    out = [{"ts": series[0]["ts"], "value": 0.0}]
    for i in range(1, len(series)):
        out.append({"ts": series[i]["ts"], "value": series[i]["count"] - series[i - 1]["count"]})
    return out


def acceleration(velocity_series: Sequence[dict[str, float]]) -> list[dict[str, float]]:
    """Zweite Differenz: velocity_t - velocity_{t-1}."""
    if len(velocity_series) < 2:
        return [{"ts": p["ts"], "value": 0.0} for p in velocity_series]
    out = [{"ts": velocity_series[0]["ts"], "value": 0.0}]
    for i in range(1, len(velocity_series)):
        out.append(
            {
                "ts": velocity_series[i]["ts"],
                "value": velocity_series[i]["value"] - velocity_series[i - 1]["value"],
            }
        )
    return out


def ema(values: Sequence[float], alpha: float = 0.3) -> list[float]:
    """Exponentieller gleitender Mittelwert."""
    if not values:
        return []
    a = max(0.0, min(1.0, float(alpha)))
    out = [float(values[0])]
    for v in values[1:]:
        out.append(a * float(v) + (1 - a) * out[-1])
    return out


def sentiment_momentum(
    sentiment_series: Sequence[dict[str, float]],
    alpha: float = 0.3,
) -> dict[str, list[dict[str, float]]]:
    """Sentiment-Verlauf -> Velocity + EMA der Velocity."""
    values = [float(p.get("score", 0.0)) for p in sentiment_series]
    if len(values) < 2:
        return {"velocity": [], "ema_velocity": [], "acceleration": []}

    diffs = [0.0] + [values[i] - values[i - 1] for i in range(1, len(values))]
    smoothed = ema(diffs, alpha)
    accel = [0.0] + [diffs[i] - diffs[i - 1] for i in range(1, len(diffs))]

    return {
        "velocity": [{"ts": p["ts"], "value": d} for p, d in zip(sentiment_series, diffs)],
        "ema_velocity": [{"ts": p["ts"], "value": s} for p, s in zip(sentiment_series, smoothed)],
        "acceleration": [{"ts": p["ts"], "value": a} for p, a in zip(sentiment_series, accel)],
    }


def trend_strength(values: Sequence[float], window: int = 10) -> float:
    """Pearson-Korrelation zwischen Index-Reihe und Werten als Trendstaerke.

    Reichweite: -1 (fallend) .. +1 (steigend). 0 = kein Trend.
    """
    n = min(len(values), window)
    if n < 3:
        return 0.0
    xs = list(range(n))
    ys = [float(v) for v in values[-n:]]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    den_x = math.sqrt(sum((xs[i] - mean_x) ** 2 for i in range(n)))
    den_y = math.sqrt(sum((ys[i] - mean_y) ** 2 for i in range(n)))
    if den_x == 0 or den_y == 0:
        return 0.0
    return max(-1.0, min(1.0, num / (den_x * den_y)))


def summarize_momentum(
    mention_timestamps_utc: Iterable[str],
    sentiment_series: Sequence[dict[str, float]] | None = None,
    granularity: str = "hour",
    ema_alpha: float = 0.3,
    spike_z_threshold: float = 2.5,
) -> dict[str, object]:
    """Zentrale Aggregat-Funktion fuer das Dashboard."""
    series = mention_series(mention_timestamps_utc, granularity=granularity)
    vel = velocity(series)
    acc = acceleration(vel)
    counts = [p["count"] for p in series]

    spike = False
    z = 0.0
    if len(counts) >= 5:
        recent = counts[:-1]
        mean = sum(recent) / len(recent)
        var = sum((x - mean) ** 2 for x in recent) / max(1, len(recent) - 1)
        std = math.sqrt(var) if var > 0 else 0.0
        if std > 0:
            z = (counts[-1] - mean) / std
            spike = z >= spike_z_threshold

    sent_mom = sentiment_momentum(sentiment_series or [], alpha=ema_alpha)
    trend = trend_strength(counts, window=min(20, len(counts)))

    return {
        "mention_series": series,
        "velocity": vel,
        "acceleration": acc,
        "trend_strength": round(trend, 4),
        "latest_z": round(z, 3),
        "spike_detected": spike,
        "sentiment_momentum": sent_mom,
    }
