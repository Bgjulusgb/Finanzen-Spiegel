"""Keyword-Extraktion ohne externe ML-Libs.

Implementiert:
- TF-IDF auf einem Corpus.
- RAKE-aehnliches Verfahren fuer einzelne Dokumente (single-doc Keyphrase).
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Iterable

_TOKEN_RE = re.compile(r"[A-Za-zÄÖÜäöüß0-9'-]{2,}")

STOPWORDS_EN = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "her",
    "was", "one", "our", "out", "had", "with", "from", "this", "that", "have",
    "his", "she", "they", "their", "will", "your", "what", "when", "where", "which",
    "who", "whom", "why", "how", "into", "than", "then", "them", "these", "those",
    "some", "such", "also", "been", "were", "more", "most", "over", "could", "would",
    "should", "about", "after", "before", "between", "while", "during",
    "said", "says", "say",
}

STOPWORDS_DE = {
    "der", "die", "das", "und", "ist", "fuer", "mit", "von", "auf", "zum", "zur",
    "den", "des", "dem", "ein", "eine", "einen", "einer", "eines", "auch", "aber",
    "oder", "sein", "wird", "werden", "wurde", "wurden", "hat", "haben", "hatte",
    "nach", "nicht", "noch", "schon", "gegen", "ohne", "ueber", "unter", "vor",
    "bei", "aus", "als", "wie", "wenn", "weil", "dass", "soll", "wollen", "kann",
    "koennen", "muessen", "muss", "sich", "sie", "ihm", "ihn", "ihr", "ihre",
}


def _tokens(text: str, lang: str = "en") -> list[str]:
    stop = STOPWORDS_DE if lang == "de" else STOPWORDS_EN
    return [t.lower() for t in _TOKEN_RE.findall(text or "") if t.lower() not in stop]


def tf_idf(corpus: list[str], top_k: int = 20, lang: str = "en") -> list[list[tuple[str, float]]]:
    """TF-IDF pro Dokument. Liefert pro Dokument die Top-K Begriffe."""
    docs = [_tokens(doc, lang=lang) for doc in corpus]
    n_docs = len(docs)
    if n_docs == 0:
        return []

    df: Counter[str] = Counter()
    for d in docs:
        df.update(set(d))

    out = []
    for d in docs:
        counts = Counter(d)
        total = sum(counts.values()) or 1
        scored = []
        for term, c in counts.items():
            tf = c / total
            idf = math.log((1 + n_docs) / (1 + df[term])) + 1.0
            scored.append((term, tf * idf))
        scored.sort(key=lambda x: x[1], reverse=True)
        out.append(scored[:top_k])
    return out


def rake_keyphrases(text: str, lang: str = "en", top_k: int = 10) -> list[tuple[str, float]]:
    """Einfaches RAKE: Phrasen zwischen Stopwords, Score = Sum(word_score).

    word_score(w) = deg(w) / freq(w). deg = Anzahl Mitvorkommen in Phrasen.
    """
    stop = STOPWORDS_DE if lang == "de" else STOPWORDS_EN
    sentences = re.split(r"[.!?;\n]+", text or "")
    phrases: list[list[str]] = []
    for s in sentences:
        words = [w.lower() for w in _TOKEN_RE.findall(s)]
        current: list[str] = []
        for w in words:
            if w in stop:
                if current:
                    phrases.append(current)
                    current = []
            else:
                current.append(w)
        if current:
            phrases.append(current)

    freq: Counter[str] = Counter()
    degree: Counter[str] = Counter()
    for ph in phrases:
        for w in ph:
            freq[w] += 1
            degree[w] += len(ph) - 1

    word_score = {w: (degree[w] + freq[w]) / max(1, freq[w]) for w in freq}
    phrase_scores: list[tuple[str, float]] = []
    seen: set[str] = set()
    for ph in phrases:
        key = " ".join(ph)
        if key in seen:
            continue
        seen.add(key)
        phrase_scores.append((key, sum(word_score.get(w, 0.0) for w in ph)))

    phrase_scores.sort(key=lambda x: x[1], reverse=True)
    return phrase_scores[:top_k]


def mentions_count(text: str, queries: Iterable[str]) -> int:
    """Zaehlt Vorkommen einer Asset-Bezeichnung im Text (case-insensitive, ganzes Wort)."""
    if not text:
        return 0
    n = 0
    lower = text.lower()
    for q in queries:
        q = q.strip().lower()
        if not q:
            continue
        n += sum(1 for _ in re.finditer(rf"\b{re.escape(q)}\b", lower))
    return n
