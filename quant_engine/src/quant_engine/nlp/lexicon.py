"""Finanz-Lexikon fuer EN/DE (Default-Worte) und Helper.

Diese Listen sind bewusst klein und lassen sich ueber
``settings.sentiment.language_lexicon_overrides`` ergaenzen.
"""

from __future__ import annotations

POSITIVE_EN = {
    "beat", "beats", "beating", "outperform", "outperforms", "upgrade", "upgraded",
    "surge", "surges", "surged", "rally", "rallies", "rallied", "record", "records",
    "growth", "gain", "gains", "bullish", "strong", "strongest", "soar", "soared",
    "jump", "jumps", "jumped", "robust", "upside", "buy", "accumulate", "raise",
    "raised", "raises", "expansion", "win", "wins", "won", "milestone", "breakthrough",
    "profit", "profits", "profitable",
}

NEGATIVE_EN = {
    "miss", "misses", "missed", "downgrade", "downgraded", "plunge", "plunges",
    "plunged", "crash", "crashes", "crashed", "panic", "recession", "warning",
    "warn", "warns", "warned", "lawsuit", "fine", "fined", "loss", "losses",
    "weak", "weakest", "tumble", "tumbles", "tumbled", "slump", "slumps", "slumped",
    "sell", "bearish", "downside", "fraud", "scandal", "investigation", "probe",
    "default", "bankruptcy", "delisting", "halted",
}

POSITIVE_DE = {
    "gewinn", "gewinne", "wachstum", "rekord", "stark", "uebertrifft", "uebertraf",
    "uebertroffen", "optimistisch", "rally", "anstieg", "anstiege", "steigt",
    "stieg", "gestiegen", "anhebung", "uebernahme", "ausbau", "robust",
    "rekordergebnis", "kursplus", "rallye",
}

NEGATIVE_DE = {
    "verlust", "verluste", "rueckgang", "schwach", "krise", "rezession", "panik",
    "absturz", "warnung", "sturz", "einbruch", "abgesetzt", "klage", "skandal",
    "ermittlung", "ermittlungen", "insolvenz", "untersagt", "verbot", "gewinnwarnung",
    "kurssturz", "ausverkauf", "schock",
}

POSITIVE = {"en": POSITIVE_EN, "de": POSITIVE_DE}
NEGATIVE = {"en": NEGATIVE_EN, "de": NEGATIVE_DE}


def merged(lang: str, overrides: dict | None = None) -> tuple[set[str], set[str]]:
    """Liefert (positive, negative) inkl. Overrides aus settings.json."""
    pos = set(POSITIVE.get(lang, POSITIVE_EN))
    neg = set(NEGATIVE.get(lang, NEGATIVE_EN))
    if overrides:
        lang_overrides = overrides.get(lang) or {}
        pos.update(w.lower() for w in lang_overrides.get("positive", []))
        neg.update(w.lower() for w in lang_overrides.get("negative", []))
    return pos, neg
