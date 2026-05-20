"""Anomalie-Erkennung.

Methoden:
- Rolling Z-Score (z = (x - mu) / sigma) auf beliebigen Serien.
- Optional: IsolationForest, falls scikit-learn verfuegbar; ohne den
  Import zu erzwingen, falls die Bibliothek fehlt.

Erkennt:
- News-Spikes (Erwaehnungs-Wellen)
- Sentiment-Stuerze
- ungewoehnliche Preis-Bewegungen
"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np


def rolling_zscore(
    values: Sequence[float],
    window: int = 30,
    min_periods: int = 5,
    inf_clip: float = 10.0,
) -> list[float]:
    """Z-Score relativ zum Fenster der letzten ``window`` Werte (ohne aktuellen Punkt).

    Ein Wert > 2.5 in absolute terms gilt als Anomalie-Kandidat.

    Edge-Case: ist die Referenz-Standardabweichung 0 (z.B. perfekt konstante
    Reihe), gilt jede Abweichung als hochsignifikante Anomalie. Wir clippen
    in dem Fall auf ``inf_clip``, damit nachgelagerte Konsumenten finite
    Werte sehen.
    """
    arr = np.asarray(values, dtype=float)
    n = len(arr)
    out = np.zeros(n, dtype=float)
    for i in range(n):
        start = max(0, i - window)
        ref = arr[start:i]
        if len(ref) < min_periods:
            continue
        mu = float(np.mean(ref))
        sd = float(np.std(ref, ddof=1)) if len(ref) > 1 else 0.0
        diff = arr[i] - mu
        if sd > 1e-12:
            out[i] = diff / sd
        elif abs(diff) > 1e-12:
            out[i] = inf_clip if diff > 0 else -inf_clip
    return out.tolist()


def detect_spikes(
    series: Sequence[dict[str, float]],
    value_key: str = "count",
    threshold: float = 2.5,
    window: int = 30,
) -> list[dict[str, object]]:
    """Findet positive Spikes (z >= threshold) in einer Zeitreihe."""
    values = [float(p.get(value_key, 0.0)) for p in series]
    zs = rolling_zscore(values, window=window)
    out: list[dict[str, object]] = []
    for i, p in enumerate(series):
        if zs[i] >= threshold:
            out.append(
                {
                    "ts": p.get("ts"),
                    "value": values[i],
                    "z": round(zs[i], 3),
                    "direction": "up",
                }
            )
    return out


def detect_drops(
    series: Sequence[dict[str, float]],
    value_key: str = "score",
    threshold: float = 2.5,
    window: int = 30,
) -> list[dict[str, object]]:
    """Findet negative Spikes (z <= -threshold)."""
    values = [float(p.get(value_key, 0.0)) for p in series]
    zs = rolling_zscore(values, window=window)
    out: list[dict[str, object]] = []
    for i, p in enumerate(series):
        if zs[i] <= -threshold:
            out.append(
                {
                    "ts": p.get("ts"),
                    "value": values[i],
                    "z": round(zs[i], 3),
                    "direction": "down",
                }
            )
    return out


def isolation_forest_outliers(
    matrix: Sequence[Sequence[float]],
    contamination: float = 0.05,
) -> list[int]:
    """IsolationForest-basierte Outlier-Indizes.

    Wenn scikit-learn fehlt, wird auf Z-Score-basiertes Mehrdimensions-Mass
    zurueckgegriffen (Mahalanobis-light via Spaltennormierung).
    """
    if not matrix:
        return []

    try:
        from sklearn.ensemble import IsolationForest

        clf = IsolationForest(contamination=float(contamination), random_state=42)
        preds = clf.fit_predict(np.asarray(matrix, dtype=float))
        return [int(i) for i, p in enumerate(preds) if int(p) == -1]
    except ImportError:
        arr = np.asarray(matrix, dtype=float)
        mu = arr.mean(axis=0)
        sd = arr.std(axis=0, ddof=0) + 1e-9
        z = np.abs((arr - mu) / sd).max(axis=1)
        thresh = np.quantile(z, 1.0 - contamination)
        return [int(i) for i, v in enumerate(z) if v >= thresh]


def summarize_anomalies(
    mention_series: Sequence[dict[str, float]] | None = None,
    sentiment_series: Sequence[dict[str, float]] | None = None,
    return_series: Sequence[float] | None = None,
    z_threshold: float = 2.5,
    window: int = 30,
) -> dict[str, object]:
    """Aggregiert alle Anomalie-Detektoren zu einer Zusammenfassung."""
    out: dict[str, object] = {
        "news_spikes": [],
        "sentiment_drops": [],
        "sentiment_spikes": [],
        "return_outliers": [],
    }

    if mention_series:
        out["news_spikes"] = detect_spikes(mention_series, "count", z_threshold, window)
    if sentiment_series:
        out["sentiment_spikes"] = detect_spikes(sentiment_series, "score", z_threshold, window)
        out["sentiment_drops"] = detect_drops(sentiment_series, "score", z_threshold, window)
    if return_series:
        n = len(return_series)
        zs = rolling_zscore(return_series, window=window)
        out["return_outliers"] = [
            {"index": i, "value": float(return_series[i]), "z": round(zs[i], 3)}
            for i in range(n)
            if abs(zs[i]) >= z_threshold
        ]
    return out
