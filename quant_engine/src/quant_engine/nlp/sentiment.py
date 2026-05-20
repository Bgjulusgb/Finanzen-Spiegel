"""Sentiment-Engine.

Drei Backends, kombinierbar:
1. **VADER**   - regelbasiertes Englisch-Sentiment (sehr schnell).
2. **Lexikon** - eigene Wortliste fuer EN/DE mit Negationserkennung.
3. **FinBERT** - optional via transformers; nur geladen wenn
   ``QUANT_USE_FINBERT=1`` und das Paket installiert ist.

Liefert eine einheitliche Struktur:
    {
      "polarity": -1..+1,
      "confidence": 0..1,
      "sentiment_strength": 0..1,
      "model": str
    }
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Iterable

from .lexicon import merged

NEGATION_EN = {"not", "no", "never", "without", "n't", "cannot", "can't", "won't", "isn't", "doesn't"}
NEGATION_DE = {"nicht", "kein", "keine", "ohne", "nie", "niemals", "nichts"}
NEGATION_WINDOW = 3

_WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß'-]+")


def _tokenize(text: str) -> list[str]:
    if not text:
        return []
    return [tok.lower() for tok in _WORD_RE.findall(text)]


@lru_cache(maxsize=1)
def _vader():
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

        return SentimentIntensityAnalyzer()
    except ImportError:
        return None


@lru_cache(maxsize=1)
def _finbert():
    """Lazy-load FinBERT, falls aktiviert und installiert.

    Standard: aus, weil ~440MB Modell-Download.
    """
    if os.getenv("QUANT_USE_FINBERT", "0") != "1":
        return None
    try:
        from transformers import pipeline  # type: ignore

        return pipeline("sentiment-analysis", model="ProsusAI/finbert")
    except Exception:
        return None


def lexicon_polarity(text: str, lang: str = "en", overrides: dict | None = None) -> dict[str, float]:
    """Lexikon-basierte Polaritaet inkl. Negationserkennung."""
    pos, neg = merged(lang, overrides)
    tokens = _tokenize(text)
    n_pos = 0
    n_neg = 0
    negation_terms = NEGATION_DE if lang == "de" else NEGATION_EN

    for i, tok in enumerate(tokens):
        window = tokens[max(0, i - NEGATION_WINDOW) : i]
        negated = any(w in negation_terms for w in window)
        if tok in pos:
            if negated:
                n_neg += 1
            else:
                n_pos += 1
        elif tok in neg:
            if negated:
                n_pos += 1
            else:
                n_neg += 1

    total_hits = n_pos + n_neg
    if total_hits == 0:
        return {"polarity": 0.0, "confidence": 0.0, "sentiment_strength": 0.0, "model": "lexicon"}

    polarity = (n_pos - n_neg) / total_hits
    total_tokens = max(1, len(tokens))
    coverage = total_hits / total_tokens
    confidence = min(1.0, 0.3 + 0.7 * coverage * 5)
    return {
        "polarity": round(polarity, 4),
        "confidence": round(confidence, 4),
        "sentiment_strength": round(abs(polarity) * confidence, 4),
        "model": "lexicon",
    }


def vader_polarity(text: str) -> dict[str, float] | None:
    """VADER (Englisch). Liefert None wenn VADER nicht installiert ist."""
    analyzer = _vader()
    if analyzer is None or not text:
        return None
    scores = analyzer.polarity_scores(text)
    compound = float(scores["compound"])
    # compound liegt bereits in [-1, +1]
    confidence = max(0.0, 1.0 - float(scores["neu"]))
    return {
        "polarity": round(compound, 4),
        "confidence": round(confidence, 4),
        "sentiment_strength": round(abs(compound) * confidence, 4),
        "model": "vader",
    }


def finbert_polarity(text: str) -> dict[str, float] | None:
    """FinBERT (Englisch, finanzdomain). Nur wenn aktiviert + installiert."""
    pipe = _finbert()
    if pipe is None or not text:
        return None
    snippet = text[:512]
    try:
        result = pipe(snippet)[0]
    except Exception:
        return None
    label = str(result.get("label", "")).lower()
    score = float(result.get("score", 0.0))
    polarity = {"positive": 1.0, "negative": -1.0, "neutral": 0.0}.get(label, 0.0) * score
    return {
        "polarity": round(polarity, 4),
        "confidence": round(score, 4),
        "sentiment_strength": round(abs(polarity), 4),
        "model": "finbert",
    }


def analyze(
    text: str,
    lang: str = "en",
    overrides: dict | None = None,
    use_vader: bool = True,
    use_lexicon: bool = True,
) -> dict[str, float]:
    """Kombiniert die verfuegbaren Backends gewichtet.

    Strategie:
    - FinBERT (wenn vorhanden) gewinnt mit 0.6.
    - VADER + Lexikon werden gemittelt (je 0.5) als Fallback.
    - Wenn VADER nicht installiert ist, Lexikon allein.
    """
    parts: list[tuple[float, dict[str, float]]] = []

    finbert = finbert_polarity(text)
    if finbert is not None:
        parts.append((0.6, finbert))

    if use_vader and lang == "en":
        v = vader_polarity(text)
        if v is not None:
            parts.append((0.4 if finbert else 0.6, v))

    if use_lexicon:
        lex = lexicon_polarity(text, lang=lang, overrides=overrides)
        weight = 0.2 if finbert else (0.4 if any(p[1]["model"] == "vader" for p in parts) else 1.0)
        parts.append((weight, lex))

    if not parts:
        return {"polarity": 0.0, "confidence": 0.0, "sentiment_strength": 0.0, "model": "none"}

    w_sum = sum(w for w, _ in parts) or 1.0
    polarity = sum(w * p["polarity"] for w, p in parts) / w_sum
    confidence = sum(w * p["confidence"] for w, p in parts) / w_sum
    sentiment_strength = abs(polarity) * confidence
    model_label = "+".join(p["model"] for _, p in parts)

    return {
        "polarity": round(max(-1.0, min(1.0, polarity)), 4),
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "sentiment_strength": round(max(0.0, min(1.0, sentiment_strength)), 4),
        "model": model_label,
    }


def batch_analyze(
    texts: Iterable[str],
    lang_default: str = "en",
    overrides: dict | None = None,
    use_vader: bool = True,
    use_lexicon: bool = True,
) -> list[dict[str, float]]:
    return [
        analyze(t or "", lang=lang_default, overrides=overrides, use_vader=use_vader, use_lexicon=use_lexicon)
        for t in texts
    ]
