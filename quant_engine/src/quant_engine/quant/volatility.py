"""Volatilitaets- und Risiko-Kennzahlen.

Implementiert:
- Tagesrenditen (log)
- Rolling Standardabweichung (annualisiert)
- ATR (Average True Range, Wilder)
- Beta (Cov(r_a, r_b) / Var(r_b))
- Volatilitaetscluster-Mass (Autokorrelation der quadrierten Renditen)
- Risk Score: skaliert auf 0..1 (Komposit)
- Panic / Hype Probability: logistische Funktionen aus Vol + Sentiment
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

TRADING_DAYS = 252


def log_returns(closes: Sequence[float]) -> list[float]:
    """Logarithmische Tagesrenditen."""
    if len(closes) < 2:
        return []
    arr = np.asarray(closes, dtype=float)
    safe = np.where(arr > 0, arr, np.nan)
    rets = np.diff(np.log(safe))
    rets = np.nan_to_num(rets, nan=0.0, posinf=0.0, neginf=0.0)
    return rets.tolist()


def rolling_std(values: Sequence[float], window: int) -> list[float]:
    """Rolling Standardabweichung (vorgepolstert mit NaN/0 fuer Indizierung)."""
    arr = np.asarray(values, dtype=float)
    if window <= 1 or len(arr) < window:
        return [0.0] * len(arr)
    out = np.zeros(len(arr), dtype=float)
    for i in range(window - 1, len(arr)):
        window_slice = arr[i - window + 1 : i + 1]
        out[i] = float(np.std(window_slice, ddof=1))
    return out.tolist()


def annualized_volatility(returns: Sequence[float], trading_days: int = TRADING_DAYS) -> float:
    """sigma_year = sigma_day * sqrt(252)."""
    if len(returns) < 2:
        return 0.0
    sd = float(np.std(np.asarray(returns, dtype=float), ddof=1))
    return sd * math.sqrt(trading_days)


def atr(
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[float]:
    """Wilders ATR (Smoothed Average True Range).

    TR_i = max(high - low, |high - close_prev|, |low - close_prev|)
    ATR_i = (ATR_{i-1}*(period-1) + TR_i) / period
    """
    n = min(len(highs), len(lows), len(closes))
    if n < 2:
        return [0.0] * n

    h = np.asarray(highs[:n], dtype=float)
    l = np.asarray(lows[:n], dtype=float)
    c = np.asarray(closes[:n], dtype=float)

    tr = np.zeros(n, dtype=float)
    tr[0] = float(h[0] - l[0])
    for i in range(1, n):
        tr[i] = max(
            float(h[i] - l[i]),
            abs(float(h[i] - c[i - 1])),
            abs(float(l[i] - c[i - 1])),
        )

    out = np.zeros(n, dtype=float)
    if n < period:
        out[period - 1 if period - 1 < n else n - 1] = float(np.mean(tr))
        return out.tolist()

    out[period - 1] = float(np.mean(tr[:period]))
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out.tolist()


def beta(asset_returns: Sequence[float], benchmark_returns: Sequence[float]) -> float:
    """Beta = Cov(r_a, r_b) / Var(r_b)."""
    n = min(len(asset_returns), len(benchmark_returns))
    if n < 3:
        return 0.0
    a = np.asarray(asset_returns[-n:], dtype=float)
    b = np.asarray(benchmark_returns[-n:], dtype=float)
    var_b = float(np.var(b, ddof=1))
    if var_b <= 1e-12:
        return 0.0
    cov = float(np.cov(a, b, ddof=1)[0, 1])
    return cov / var_b


def volatility_clustering(returns: Sequence[float], lag: int = 1) -> float:
    """Autokorrelation der quadrierten Renditen bei Lag k.

    Hoher Wert = ausgepraegte Volatilitaetscluster (GARCH-Effekt).
    """
    n = len(returns)
    if n <= lag + 2:
        return 0.0
    r = np.asarray(returns, dtype=float) ** 2
    r0 = r[: n - lag]
    rk = r[lag:]
    if np.std(r0) <= 1e-12 or np.std(rk) <= 1e-12:
        return 0.0
    return float(np.corrcoef(r0, rk)[0, 1])


def _logistic(x: float, k: float = 6.0, x0: float = 0.5) -> float:
    """Standard-Logistik mit Steilheit k und Mittelpunkt x0."""
    return 1.0 / (1.0 + math.exp(-k * (x - x0)))


@dataclass
class VolatilitySummary:
    sigma_daily: float
    sigma_annual: float
    atr_latest: float
    beta: float
    clustering: float
    risk_score: float          # 0..1
    panic_probability: float   # 0..1
    hype_probability: float    # 0..1


def summarize_volatility(
    closes: Sequence[float],
    highs: Sequence[float] | None = None,
    lows: Sequence[float] | None = None,
    benchmark_closes: Sequence[float] | None = None,
    sentiment_score: float = 0.0,
    period_atr: int = 14,
    std_window: int = 20,
) -> VolatilitySummary:
    """Aggregiert alle Risiko-Kennzahlen zu einer Zusammenfassung.

    ``sentiment_score`` muss in -100..+100 liegen (Sentiment-Score),
    wird intern auf -1..+1 normiert.
    """
    ret = log_returns(closes)
    sd_daily = float(np.std(np.asarray(ret), ddof=1)) if len(ret) > 1 else 0.0
    sigma_annual = annualized_volatility(ret)

    atr_series: list[float] = []
    if highs is not None and lows is not None and len(highs) == len(lows) == len(closes):
        atr_series = atr(highs, lows, closes, period=period_atr)
    atr_latest = atr_series[-1] if atr_series else 0.0

    beta_value = 0.0
    if benchmark_closes is not None and len(benchmark_closes) >= 3:
        beta_value = beta(ret, log_returns(benchmark_closes))

    clustering = volatility_clustering(ret)

    # Risk Score: Kombination aus annualisierter Sigma (normalisiert)
    # und Clustering-Effekt. Skalen wurden gewaehlt damit ~30% Vol ~ 0.5.
    sigma_norm = min(1.0, sigma_annual / 0.6)
    clust_norm = max(0.0, min(1.0, abs(clustering)))
    risk_score = 0.7 * sigma_norm + 0.3 * clust_norm

    # Panic / Hype Probability: logistische Fkt aus risk + sentiment.
    sentiment_norm = max(-1.0, min(1.0, sentiment_score / 100.0))
    panic = _logistic(risk_score - 0.5 * sentiment_norm, k=8.0, x0=0.55)
    hype = _logistic(risk_score + 0.7 * sentiment_norm, k=8.0, x0=0.6)

    return VolatilitySummary(
        sigma_daily=round(sd_daily, 6),
        sigma_annual=round(sigma_annual, 6),
        atr_latest=round(atr_latest, 6),
        beta=round(beta_value, 4),
        clustering=round(clustering, 4),
        risk_score=round(risk_score, 4),
        panic_probability=round(panic, 4),
        hype_probability=round(hype, 4),
    )
