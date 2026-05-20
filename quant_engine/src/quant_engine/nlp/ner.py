"""Leichtgewichtige Entity-Extraktion ohne externe Modelle.

Heuristik:
- Kapitalisierte Wortfolgen (Pascal/Camel) als Organisations-Kandidaten.
- Bekannte Listen fuer Laender, Politiker, Notenbanken (klein gehalten).
- Konflikt-/Sanktions-Stichwoerter (siehe political_events.json).

Bewusst kein spacy/transformers, weil das Setup leicht und schnell
bleiben soll. Lassen sich aber spaeter als Plugin nachruesten.
"""

from __future__ import annotations

import re
from typing import Iterable

COUNTRIES = {
    "USA", "United States", "China", "Russia", "Russian Federation",
    "Germany", "France", "United Kingdom", "UK", "Japan", "Taiwan",
    "Saudi Arabia", "Iran", "Israel", "Ukraine", "EU", "European Union",
    "India", "Brazil", "Mexico", "Canada", "South Korea", "North Korea",
    "Deutschland", "Frankreich", "Grossbritannien", "Vereinigte Staaten",
}

CENTRAL_BANKS = {"ECB", "EZB", "Fed", "Federal Reserve", "BOJ", "PBOC", "BOE", "RBA", "SNB"}

POLITICIANS = {
    "Joe Biden", "Donald Trump", "Vladimir Putin", "Xi Jinping",
    "Olaf Scholz", "Emmanuel Macron", "Friedrich Merz", "Ursula von der Leyen",
    "Christine Lagarde", "Jerome Powell",
}

CONFLICT_TERMS = {
    "war", "invasion", "missile", "strike", "sanctions", "embargo",
    "tariff", "trade war", "krieg", "raketenangriff", "sanktionen",
    "zoll", "handelskrieg",
}

_CAP_RE = re.compile(r"\b[A-Z][A-Za-zÄÖÜäöüß-]+(?:\s+[A-Z][A-Za-zÄÖÜäöüß-]+){0,3}\b")


def _scan(text: str, terms: Iterable[str]) -> list[str]:
    if not text:
        return []
    lower = text.lower()
    return [t for t in terms if t.lower() in lower]


def extract_entities(text: str) -> dict[str, list[str]]:
    """Liefert ein Dict mit Entity-Listen je Kategorie."""
    countries = _scan(text, COUNTRIES)
    cbs = _scan(text, CENTRAL_BANKS)
    politicians = _scan(text, POLITICIANS)
    conflicts = _scan(text, CONFLICT_TERMS)

    # Organisationen (Heuristik: kapitalisierte Sequenzen, ohne Personen/Laender).
    seen: set[str] = set()
    orgs: list[str] = []
    for match in _CAP_RE.findall(text or ""):
        cleaned = match.strip()
        if cleaned in countries or cleaned in politicians or cleaned in cbs:
            continue
        if cleaned in seen or len(cleaned) < 3:
            continue
        seen.add(cleaned)
        orgs.append(cleaned)
    orgs = orgs[:20]

    return {
        "countries": list(dict.fromkeys(countries)),
        "central_banks": list(dict.fromkeys(cbs)),
        "politicians": list(dict.fromkeys(politicians)),
        "conflicts": list(dict.fromkeys(conflicts)),
        "organizations": orgs,
    }
