"""Politisches Risiko-Scoring.

Formel:
    PoliticalRiskScore = sum_i (EventSeverity_i * Exposure_i * MarketSensitivity_i * RecencyFactor_i)

Wird auf 0..100 normiert und mit Decay versehen. Severity-Werte
kommen aus ``config/settings.json`` -> ``political_risk.severity_weights``.
Exposure aus ``config/political_events.json`` -> ``exposure_map``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable


@dataclass
class PoliticalEvent:
    """Ein erkanntes politisches Ereignis."""

    category: str            # z.B. "sanctions"
    severity: float          # 0..1 (aus Settings)
    exposure: float          # 0..1 (asset-spezifisch)
    market_sensitivity: float  # 0..1 (heuristisch)
    age_hours: float
    source_trust: float = 0.5
    title: str = ""

    def contribution(self, decay_days: float = 7.0) -> float:
        """Beitrag dieses Events zum Gesamtscore."""
        decay = math.exp(-self.age_hours / max(1.0, decay_days * 24.0))
        return (
            max(0.0, min(1.0, self.severity))
            * max(0.0, min(1.0, self.exposure))
            * max(0.0, min(1.0, self.market_sensitivity))
            * max(0.0, min(1.0, self.source_trust))
            * decay
        )


def detect_categories(
    text: str,
    lexicon: dict[str, dict[str, list[str]]],
    lang: str = "en",
) -> list[str]:
    """Erkennt Kategorien anhand des Lexikons (case-insensitive Substring-Match)."""
    if not text:
        return []
    text_l = text.lower()
    hits: list[str] = []
    for category, langs in lexicon.items():
        terms = langs.get(lang) or langs.get("en", [])
        for term in terms:
            if term.lower() in text_l:
                hits.append(category)
                break
    return hits


def build_events(
    articles: Iterable[dict],
    political_lexicon: dict[str, dict[str, list[str]]],
    severity_weights: dict[str, float],
    exposure_map: dict[str, float],
    now: datetime | None = None,
    market_sensitivity_default: float = 0.5,
) -> list[PoliticalEvent]:
    """Erstellt PoliticalEvent-Objekte aus einer Artikel-Liste."""
    now = now or datetime.now(timezone.utc)
    events: list[PoliticalEvent] = []

    for art in articles:
        text = " ".join(filter(None, [art.get("title"), art.get("summary")]))
        lang = (art.get("lang") or "en")[:2]
        categories = detect_categories(text, political_lexicon, lang=lang)
        if not categories:
            continue

        published = art.get("published_utc") or art.get("fetched_utc")
        age_hours = 0.0
        if published:
            try:
                ts = datetime.fromisoformat(str(published).replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                age_hours = max(0.0, (now - ts).total_seconds() / 3600.0)
            except ValueError:
                pass

        trust = float(art.get("source_trust", 0.5))
        for cat in categories:
            severity = float(severity_weights.get(cat, 0.5))
            exposure = float(exposure_map.get(cat, 0.5))
            events.append(
                PoliticalEvent(
                    category=cat,
                    severity=severity,
                    exposure=exposure,
                    market_sensitivity=market_sensitivity_default,
                    age_hours=age_hours,
                    source_trust=trust,
                    title=str(art.get("title", "")),
                )
            )
    return events


def aggregate_risk(events: Iterable[PoliticalEvent], decay_days: float = 7.0) -> dict[str, object]:
    """Aggregiert Events zu einem Score 0..100 + Breakdown je Kategorie."""
    by_cat: dict[str, float] = {}
    total = 0.0
    n = 0
    for ev in events:
        c = ev.contribution(decay_days)
        total += c
        by_cat[ev.category] = by_cat.get(ev.category, 0.0) + c
        n += 1

    # Soft-Saturation, damit der Score nicht ueber 100 schiesst:
    # Skala so gewaehlt, dass ~3 starke Events ~ 80 ergeben.
    raw_score = 100.0 * (1.0 - math.exp(-0.7 * total))
    score = max(0.0, min(100.0, raw_score))

    breakdown = sorted(
        ({"category": c, "score": round(100.0 * (1.0 - math.exp(-0.7 * v)), 2)} for c, v in by_cat.items()),
        key=lambda x: x["score"],
        reverse=True,
    )

    return {
        "score": round(score, 2),
        "raw": round(total, 4),
        "n_events": n,
        "breakdown": breakdown,
    }


def compute_political_risk(
    articles: Iterable[dict],
    political_events_config: dict,
    severity_weights: dict[str, float],
    symbol: str,
    decay_days: float = 7.0,
    market_sensitivity_default: float = 0.5,
) -> dict[str, object]:
    """End-to-End: Artikel -> Risk-Score fuer ein Asset."""
    lexicon = political_events_config.get("categories", {})
    exposure_for_asset = political_events_config.get("exposure_map", {}).get(symbol, {})

    events = build_events(
        articles=articles,
        political_lexicon=lexicon,
        severity_weights=severity_weights,
        exposure_map=exposure_for_asset,
        market_sensitivity_default=market_sensitivity_default,
    )
    result = aggregate_risk(events, decay_days=decay_days)
    result["events_sample"] = [
        {"category": e.category, "title": e.title[:140], "age_hours": round(e.age_hours, 2)}
        for e in events[:10]
    ]
    return result
