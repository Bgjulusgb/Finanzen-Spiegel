"""Explainable AI - Textgeneratoren ohne LLM.

Wir nutzen Templates, die auf den berechneten Kennzahlen operieren.
Das macht jede Begruendung 100% nachvollziehbar (kein Halluzinieren).

Beantwortet:
- Warum steigt/faellt das Asset?
- Welche News beeinflussen den Markt?
- Welche politischen Risiken entstehen?
- Warum steigt die Volatilitaet?
"""

from __future__ import annotations

from typing import Any


def _sentiment_label(score: float) -> str:
    if score >= 40:
        return "stark positiv"
    if score >= 15:
        return "positiv"
    if score <= -40:
        return "stark negativ"
    if score <= -15:
        return "negativ"
    return "neutral"


def explain_direction(snapshot: dict[str, Any]) -> dict[str, str]:
    """Warum steigt/faellt das Asset?"""
    sent = snapshot.get("sentiment", {})
    score = float(sent.get("score", 0.0))
    label = _sentiment_label(score)
    forecast = snapshot.get("forecast", {})
    p_up = float(forecast.get("bullish_probability", 0.5))
    p_down = float(forecast.get("bearish_probability", 0.5))
    expected = float(forecast.get("expected_return_pct", 0.0))

    direction = "uneindeutig"
    if p_up - p_down > 0.15:
        direction = "tendenziell aufwaerts"
    elif p_down - p_up > 0.15:
        direction = "tendenziell abwaerts"

    rationale = (
        f"Das aggregierte Sentiment liegt bei {score:+.1f}/100 ({label}). "
        f"Daraus + dem Drift-Modell ergibt sich eine Aufwaertswahrscheinlichkeit von "
        f"{p_up:.0%} gegenueber {p_down:.0%} Abwaerts. Erwartete Bewegung im "
        f"{forecast.get('horizon_days', 5)}-Tage-Horizont: {expected:+.2f}%."
    )
    return {"direction": direction, "rationale": rationale}


def explain_news(snapshot: dict[str, Any], top_n: int = 5) -> dict[str, Any]:
    """Welche News beeinflussen das Asset gerade?"""
    keywords = snapshot.get("keywords", [])[:top_n]
    entities = snapshot.get("entities", {})
    summary = (
        f"Im juengsten Newsstrom dominieren {snapshot.get('n_articles', 0)} Artikel."
        f" Top-Begriffe: {', '.join(k['term'] for k in keywords) or 'keine'}."
    )
    return {
        "summary": summary,
        "top_keywords": keywords,
        "top_organizations": entities.get("organizations", [])[:8],
        "top_countries": entities.get("countries", [])[:8],
    }


def explain_political(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Welche politischen Risiken entstehen?"""
    political = snapshot.get("political_risk", {})
    score = float(political.get("score", 0.0))
    breakdown = political.get("breakdown", [])
    if score < 10:
        rationale = "Keine relevanten geopolitischen Ereignisse mit Asset-Exposure erkannt."
    else:
        top_cats = ", ".join(f"{b['category']} ({b['score']:.0f})" for b in breakdown[:3])
        rationale = (
            f"Politisches Risiko aggregiert {score:.0f}/100. Top-Kategorien: {top_cats}. "
            f"Modell: Severity × Asset-Exposure × Marktsensitivitaet × Decay({political.get('n_events', 0)} Ereignisse)."
        )
    return {"score": score, "rationale": rationale, "breakdown": breakdown}


def explain_volatility(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Warum steigt die Volatilitaet?"""
    vol = snapshot.get("volatility", {})
    sigma_daily = float(vol.get("sigma_daily", 0.0)) * 100.0
    sigma_annual = float(vol.get("sigma_annual", 0.0)) * 100.0
    clustering = float(vol.get("clustering", 0.0))
    atr_latest = float(vol.get("atr_latest", 0.0))
    rationale = (
        f"Tagesvolatilitaet (Std): {sigma_daily:.2f}%, annualisiert {sigma_annual:.2f}%. "
        f"ATR(14): {atr_latest:.2f}. Volatilitaetsclustering (Lag-1 Korrelation der "
        f"quadrierten Renditen): {clustering:+.2f}. "
        f"Panik-Wahrscheinlichkeit: {float(vol.get('panic_probability', 0.0)):.0%}; "
        f"Hype-Wahrscheinlichkeit: {float(vol.get('hype_probability', 0.0)):.0%}."
    )
    return {
        "sigma_daily_pct": sigma_daily,
        "sigma_annual_pct": sigma_annual,
        "clustering": clustering,
        "rationale": rationale,
    }


def explain_all(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "direction": explain_direction(snapshot),
        "news": explain_news(snapshot),
        "political": explain_political(snapshot),
        "volatility": explain_volatility(snapshot),
    }
