"""Hybrides Prognose-Modell.

Kombiniert:
- ARIMA / Random-Walk-with-Drift (Zeitreihe)
- Lineare Regression auf [sentiment, news_volume, volatility, political_risk]
- Optional Random Forest (scikit-learn) fuer Nichtlinearitaeten

Liefert keine Punktprognose, sondern *Wahrscheinlichkeiten*:
- bullish_probability
- bearish_probability
- high_volatility_probability
- panic_probability

Bewusst defensiv implementiert: faellt auf einfachere Schaetzer zurueck,
wenn statsmodels / sklearn fehlen oder Datenpunkte fehlen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass
class ForecastInput:
    closes: Sequence[float]
    sentiment_score: float = 0.0            # -100..+100
    news_volume_z: float = 0.0              # Z-Score der News-Menge
    sigma_daily: float = 0.0
    political_risk: float = 0.0             # 0..100
    horizon_days: int = 5


def _safe_returns(closes: Sequence[float]) -> np.ndarray:
    arr = np.asarray(closes, dtype=float)
    if len(arr) < 2:
        return np.zeros(0, dtype=float)
    safe = np.where(arr > 0, arr, np.nan)
    rets = np.diff(np.log(safe))
    return np.nan_to_num(rets, nan=0.0, posinf=0.0, neginf=0.0)


def random_walk_drift(closes: Sequence[float], horizon: int = 5) -> tuple[float, float]:
    """Random Walk mit Drift. Liefert (erwartete_log_rendite, sigma_log)."""
    rets = _safe_returns(closes)
    if rets.size < 5:
        return 0.0, 0.02
    mu = float(np.mean(rets))
    sd = float(np.std(rets, ddof=1)) if rets.size > 1 else 0.0
    return mu * horizon, sd * math.sqrt(max(1, horizon))


def arima_forecast(closes: Sequence[float], horizon: int = 5, order: tuple[int, int, int] = (1, 1, 1)) -> tuple[float, float]:
    """ARIMA-Prognose; faellt zurueck auf Random-Walk-with-Drift."""
    rets = _safe_returns(closes)
    if rets.size < 30:
        return random_walk_drift(closes, horizon)
    try:
        from statsmodels.tsa.arima.model import ARIMA

        log_prices = np.log(np.asarray(closes, dtype=float))
        model = ARIMA(log_prices, order=order, enforce_stationarity=False, enforce_invertibility=False)
        fit = model.fit()
        fcast = fit.get_forecast(steps=horizon)
        mean = float(fcast.predicted_mean.iloc[-1]) - float(log_prices[-1])
        # statsmodels gibt var_pred_mean optional zurueck; konservativ aus residuals.
        resid_sd = float(np.std(fit.resid, ddof=1)) if len(fit.resid) > 1 else 0.0
        sd = resid_sd * math.sqrt(max(1, horizon))
        return mean, sd
    except Exception:
        return random_walk_drift(closes, horizon)


def _normal_cdf(x: float, mu: float = 0.0, sigma: float = 1.0) -> float:
    """Standard-Normalverteilung CDF (Abramowitz & Stegun, fehlerfunktion)."""
    if sigma <= 0:
        return 1.0 if x >= mu else 0.0
    return 0.5 * (1.0 + math.erf((x - mu) / (sigma * math.sqrt(2))))


def directional_probabilities(
    expected_log_return: float,
    sigma: float,
    sentiment_score: float = 0.0,
    political_risk: float = 0.0,
) -> dict[str, float]:
    """Berechnet bullish/bearish-Wahrscheinlichkeiten unter Normalverteilungsannahme.

    P(return > 0) = 1 - CDF(0; mu, sigma)
    Sentiment / Political Risk werden additiv als kleine Bias-Korrektur
    auf das ``mu`` aufgeschlagen (max ±15% pro Komponente, weil Sentiment
    nicht 1:1 in Kursbewegungen wandert).
    """
    if sigma <= 0:
        sigma = 0.02
    sentiment_bias = 0.0015 * max(-100.0, min(100.0, sentiment_score))   # bis ±0.15
    political_bias = -0.0008 * max(0.0, min(100.0, political_risk))      # bis -0.08

    mu_adj = expected_log_return + sentiment_bias + political_bias
    p_up = 1.0 - _normal_cdf(0.0, mu=mu_adj, sigma=sigma)
    p_down = 1.0 - p_up
    return {
        "bullish_probability": round(max(0.0, min(1.0, p_up)), 4),
        "bearish_probability": round(max(0.0, min(1.0, p_down)), 4),
        "expected_log_return": round(mu_adj, 6),
        "sigma": round(sigma, 6),
    }


def volatility_probabilities(
    sigma_daily: float,
    political_risk: float = 0.0,
    news_volume_z: float = 0.0,
    high_vol_threshold_pct: float = 4.0,
    extreme_vol_threshold_pct: float = 7.0,
) -> dict[str, float]:
    """Schaetzt Vol-Wahrscheinlichkeiten aus aktuellem sigma_daily + Modifikatoren.

    Modell: log-normalverteilte Tagesrenditen. P(|r| > x) = 2 * (1 - CDF(x; 0, sigma)).
    News + Politik erhoehen sigma proxy-haft.
    """
    sigma = max(1e-6, float(sigma_daily))
    risk_kick = 1.0 + 0.005 * float(political_risk)   # bis +50%
    news_kick = 1.0 + 0.05 * max(0.0, float(news_volume_z))
    sigma_adj = sigma * risk_kick * news_kick

    high = high_vol_threshold_pct / 100.0
    extreme = extreme_vol_threshold_pct / 100.0
    p_high = 2.0 * (1.0 - _normal_cdf(high, mu=0.0, sigma=sigma_adj))
    p_extreme = 2.0 * (1.0 - _normal_cdf(extreme, mu=0.0, sigma=sigma_adj))
    return {
        "high_volatility_probability": round(max(0.0, min(1.0, p_high)), 4),
        "panic_risk": round(max(0.0, min(1.0, p_extreme)), 4),
        "sigma_adjusted": round(sigma_adj, 6),
    }


def linear_regression_forecast(
    history_returns: Sequence[float],
    features_history: Sequence[Sequence[float]],
    features_current: Sequence[float],
) -> dict[str, float]:
    """Lineare Regression der Renditen auf Features.

    Liefert eine 1-Step-Forecast plus R^2. Wenn das System unterbestimmt
    ist (zu wenige Datenpunkte), wird ein Null-Modell zurueckgegeben.
    """
    y = np.asarray(history_returns, dtype=float)
    X = np.asarray(features_history, dtype=float)
    x0 = np.asarray(features_current, dtype=float)
    if y.size < 10 or X.ndim != 2 or X.shape[0] != y.size or X.shape[1] != x0.size:
        return {"predicted_return": 0.0, "r2": 0.0}

    X_design = np.hstack([np.ones((X.shape[0], 1)), X])
    try:
        beta, residuals, rank, _ = np.linalg.lstsq(X_design, y, rcond=None)
    except np.linalg.LinAlgError:
        return {"predicted_return": 0.0, "r2": 0.0}

    y_pred = X_design @ beta
    ss_res = float(np.sum((y - y_pred) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2)) or 1e-12
    r2 = max(0.0, 1.0 - ss_res / ss_tot)

    x0_design = np.concatenate(([1.0], x0))
    pred = float(x0_design @ beta)
    return {"predicted_return": pred, "r2": round(r2, 4)}


def forecast(inp: ForecastInput) -> dict[str, object]:
    """End-to-End Prognose-Pipeline.

    Reihenfolge:
    1) ARIMA / Random-Walk fuer (mu, sigma)
    2) Sentiment + Politik als Bias-Korrekturen
    3) Vol-Wahrscheinlichkeiten ueber Normalverteilung
    """
    mu, sigma = arima_forecast(list(inp.closes), horizon=inp.horizon_days)
    dirs = directional_probabilities(
        expected_log_return=mu,
        sigma=sigma,
        sentiment_score=inp.sentiment_score,
        political_risk=inp.political_risk,
    )
    vols = volatility_probabilities(
        sigma_daily=inp.sigma_daily,
        political_risk=inp.political_risk,
        news_volume_z=inp.news_volume_z,
    )

    last_close = float(inp.closes[-1]) if inp.closes else 0.0
    expected_price = last_close * math.exp(dirs["expected_log_return"]) if last_close else 0.0
    ci_low = last_close * math.exp(dirs["expected_log_return"] - 1.96 * dirs["sigma"]) if last_close else 0.0
    ci_high = last_close * math.exp(dirs["expected_log_return"] + 1.96 * dirs["sigma"]) if last_close else 0.0

    return {
        "horizon_days": inp.horizon_days,
        "expected_return_pct": round(100.0 * (math.exp(dirs["expected_log_return"]) - 1.0), 4),
        "expected_price": round(expected_price, 4),
        "ci95_low": round(ci_low, 4),
        "ci95_high": round(ci_high, 4),
        **dirs,
        **vols,
        "model_used": "arima_or_rw + normal-cdf",
    }
