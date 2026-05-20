"""Tests fuer NLP-Module (Sentiment/Keywords/NER)."""

from __future__ import annotations

from quant_engine.nlp import keywords as kw
from quant_engine.nlp import ner
from quant_engine.nlp import sentiment as sm


def test_lexicon_polarity_negation_en():
    pos = sm.lexicon_polarity("Strong earnings beat expectations", lang="en")
    neg = sm.lexicon_polarity("Not a strong quarter, weak guidance", lang="en")
    assert pos["polarity"] > 0
    assert neg["polarity"] < 0


def test_lexicon_polarity_negation_de():
    pos = sm.lexicon_polarity("Rekordgewinn und starkes Wachstum", lang="de")
    neg = sm.lexicon_polarity("Keine Erholung, schwache Zahlen, Gewinnwarnung", lang="de")
    assert pos["polarity"] > 0
    assert neg["polarity"] < 0


def test_analyze_returns_bounded():
    res = sm.analyze("Markets crashed amid panic and recession fears.", lang="en")
    assert -1.0 <= res["polarity"] <= 1.0
    assert 0.0 <= res["confidence"] <= 1.0


def test_keywords_mentions_count_word_boundary():
    text = "Nvidia stock rallies on AI demand. NVDA jumps after earnings. Nvidia chips lead the market."
    # 2x "Nvidia" (case-insensitiv) + 1x "NVDA"
    assert kw.mentions_count(text, ["Nvidia", "NVDA"]) == 3

    # Wortgrenze: "vidian" zaehlt nicht als "vid"
    assert kw.mentions_count("vidian invidia", ["vid"]) == 0


def test_tf_idf_returns_per_doc():
    corpus = ["chips rally on demand", "chip sales decline despite demand", "AI demand surges"]
    res = kw.tf_idf(corpus, top_k=3, lang="en")
    assert len(res) == 3
    assert all(isinstance(d, list) for d in res)


def test_rake_keyphrases_extracts_top():
    text = "Nvidia chip exports face new US sanctions. Sanctions hit revenue forecasts."
    phrases = kw.rake_keyphrases(text, lang="en", top_k=5)
    assert phrases
    assert all(isinstance(p[0], str) and p[1] >= 0 for p in phrases)


def test_ner_detects_country_and_central_bank():
    text = "The Fed and ECB warned about China tariffs while Germany held talks."
    out = ner.extract_entities(text)
    assert "China" in out["countries"]
    assert "Germany" in out["countries"]
    assert "Fed" in out["central_banks"]
    assert "ECB" in out["central_banks"]
