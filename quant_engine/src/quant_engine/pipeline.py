"""End-to-End Analyse-Pipeline.

Verkettet:
1) Preisdaten von Yahoo.
2) Nachrichten via Feeds + Reddit + SEC.
3) Sentiment- und Polit-Risk-Analyse je Artikel.
4) Aggregierte Kennzahlen (Sentiment-Score, Momentum, Volatilitaet,
   Anomalien, Forecast-Wahrscheinlichkeiten).
5) Alert-Erkennung.

Wird vom Scheduler periodisch aufgerufen und vom API on-demand.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from .alerts import detect_alerts
from .config import Asset, get_config
from .data import feeds as feeds_mod
from .data import prices as prices_mod
from .data import reddit as reddit_mod
from .data import sec as sec_mod
from .db import Database
from .logger import get_logger
from .nlp import keywords as kw
from .nlp import ner as ner_mod
from .nlp import sentiment as sent_mod
from .quant import anomaly as anom_mod
from .quant import forecast as fc_mod
from .quant import momentum as mom_mod
from .quant import political_risk as pr_mod
from .quant import sentiment_score as sc
from .quant import volatility as vol_mod

_logger = get_logger("pipeline")


async def collect_articles(asset: Asset, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Holt Artikel aus allen konfigurierten Quellen."""
    primary_query = asset.queries[0] if asset.queries else asset.name
    feed_task = feeds_mod.fetch_all(sources, asset.symbol, primary_query)
    reddit_task = reddit_mod.fetch_all(sources, asset.symbol, primary_query)

    sec_task: asyncio.Task[list[dict[str, Any]]] | None = None
    if asset.sec_cik:
        sec_task = asyncio.create_task(sec_mod.fetch_filings(asset.sec_cik))

    by_source, reddit_by_source = await asyncio.gather(feed_task, reddit_task)
    items: list[dict[str, Any]] = []
    for src_items in by_source.values():
        items.extend(src_items)
    for src_items in reddit_by_source.values():
        items.extend(src_items)
    if sec_task:
        try:
            items.extend(await sec_task)
        except Exception as exc:
            _logger.warning("SEC fetch error: %s", exc)
    return items


def _filter_relevant(items: list[dict[str, Any]], asset: Asset) -> list[dict[str, Any]]:
    """Behaelt nur Items, die das Asset tatsaechlich erwaehnen.

    Generische Feeds (Notenbanken, Tagesschau) bleiben drin, wenn
    sie geopolitische / makro Stichworte enthalten - die fliessen
    spaeter ins Politik-Risk ein.
    """
    out: list[dict[str, Any]] = []
    for it in items:
        text = " ".join(filter(None, [it.get("title"), it.get("summary")])).lower()
        mentions = kw.mentions_count(text, asset.queries)
        it["mentions"] = mentions
        if mentions > 0:
            out.append(it)
            continue
        # Politische / makro Quellen ohne Asset-Treffer -> trotzdem fuer Risk behalten.
        if it.get("source_id") in {"ecb_press", "fed_press", "reuters_business", "tagesschau_wirtschaft"}:
            out.append(it)
    return out


def _enrich_sentiment(items: list[dict[str, Any]], sentiment_cfg: dict[str, Any]) -> None:
    """Schreibt Sentiment-Felder in jedes Item (in-place)."""
    overrides = sentiment_cfg.get("language_lexicon_overrides", {})
    use_vader = bool(sentiment_cfg.get("use_vader", True))
    use_lexicon = bool(sentiment_cfg.get("use_lexicon", True))
    for it in items:
        text = " ".join(filter(None, [it.get("title"), it.get("summary")]))
        lang = (it.get("lang") or "en")[:2]
        sentiment = sent_mod.analyze(
            text,
            lang=lang,
            overrides=overrides,
            use_vader=use_vader,
            use_lexicon=use_lexicon,
        )
        it["polarity"] = sentiment["polarity"]
        it["confidence"] = sentiment["confidence"]
        it["sentiment_strength"] = sentiment["sentiment_strength"]
        it["sentiment_model"] = sentiment["model"]


def _build_samples(items: list[dict[str, Any]]) -> list[sc.SentimentSample]:
    samples = []
    for it in items:
        if it.get("polarity") is None:
            continue
        age_hours = sc.age_hours_from_iso(it.get("published_utc") or it.get("fetched_utc") or "")
        samples.append(
            sc.SentimentSample(
                polarity=float(it["polarity"]),
                sentiment_strength=float(it.get("sentiment_strength", abs(it["polarity"]))),
                source_trust=float(it.get("source_trust", 0.4)),
                mentions=int(it.get("mentions", 1) or 1),
                age_hours=age_hours,
            )
        )
    return samples


def _persist(db: Database, asset: Asset, prices_rows: list[dict[str, Any]], items: list[dict[str, Any]]) -> None:
    db.upsert_prices(asset.symbol, prices_rows)
    for it in items:
        article_id = db.upsert_article(asset.symbol, it)
        if not article_id:
            continue
        if it.get("polarity") is not None:
            db.upsert_sentiment(
                article_id,
                {
                    "polarity": float(it["polarity"]),
                    "confidence": float(it.get("confidence", 0.6)),
                    "sentiment_strength": float(it.get("sentiment_strength", 0.0)),
                    "weighted_score": float(it.get("weighted_score", 0.0)),
                    "model": it.get("sentiment_model", "lexicon"),
                    "political_categories": it.get("political_categories", []),
                },
            )


async def analyze(asset: Asset | None = None, *, persist: bool = True) -> dict[str, Any]:
    """Voller Analyse-Lauf fuer ein Asset. Liefert ein JSON-faehiges Dict."""
    cfg = get_config()
    asset = asset or cfg.active_asset
    db = Database(cfg.db_path)
    settings = cfg.settings

    _logger.info("starting analysis for %s (%s)", asset.symbol, asset.name)

    sources_global = list(cfg.sources)
    sources_db = db.list_sources()
    if sources_db:
        sources_global = sources_global + sources_db

    items_raw = await collect_articles(asset, sources_global)
    items = _filter_relevant(items_raw, asset)
    _enrich_sentiment(items, settings.get("sentiment", {}))

    # Preise
    asset_cfg = settings.get("asset", {})
    range_ = asset_cfg.get("yahoo_chart_range", "3mo")
    interval = asset_cfg.get("yahoo_chart_interval", "1d")
    prices_rows = await prices_mod.fetch_history(asset.symbol, range_=range_, interval=interval)

    benchmark_symbol = settings.get("volatility", {}).get("beta_benchmark", "^GSPC")
    benchmark_rows = await prices_mod.fetch_history(benchmark_symbol, range_=range_, interval=interval)
    quote = await prices_mod.fetch_quote(asset.symbol)

    closes = [r["close"] for r in prices_rows]
    highs = [r.get("high") or r["close"] for r in prices_rows]
    lows = [r.get("low") or r["close"] for r in prices_rows]
    benchmark_closes = [r["close"] for r in benchmark_rows]

    # Sentiment-Aggregat
    sent_cfg = settings.get("sentiment", {})
    samples = _build_samples(items)
    sent_summary = sc.aggregate(
        samples,
        lambda_per_hour=float(sent_cfg.get("recency_lambda_per_hour", 0.0289)),
        mention_factor=float(sent_cfg.get("mention_weight_factor", 0.15)),
        max_mention_weight=float(sent_cfg.get("max_mention_weight", 1.5)),
    )

    # Sentiment-Serie nach Tag (fuer Momentum / Anomalien).
    daily_sent = _daily_sentiment_series(items, sent_cfg)
    mention_ts = [it.get("published_utc") or it.get("fetched_utc") for it in items]

    momentum = mom_mod.summarize_momentum(
        [t for t in mention_ts if t],
        sentiment_series=daily_sent,
        granularity="hour",
        ema_alpha=float(settings.get("momentum", {}).get("ema_alpha", 0.3)),
        spike_z_threshold=float(settings.get("momentum", {}).get("spike_z_threshold", 2.5)),
    )

    volatility = vol_mod.summarize_volatility(
        closes=closes,
        highs=highs,
        lows=lows,
        benchmark_closes=benchmark_closes,
        sentiment_score=sent_summary["score"],
        period_atr=int(settings.get("volatility", {}).get("atr_period", 14)),
        std_window=int(settings.get("volatility", {}).get("std_window", 20)),
    )

    political = pr_mod.compute_political_risk(
        articles=items,
        political_events_config=cfg.political_events,
        severity_weights=settings.get("political_risk", {}).get("severity_weights", {}),
        symbol=asset.symbol,
        decay_days=float(settings.get("political_risk", {}).get("decay_days", 7.0)),
        market_sensitivity_default=float(settings.get("political_risk", {}).get("market_sensitivity_default", 0.5)),
    )

    anomalies = anom_mod.summarize_anomalies(
        mention_series=momentum["mention_series"],
        sentiment_series=daily_sent,
        return_series=vol_mod.log_returns(closes),
        z_threshold=float(settings.get("anomaly", {}).get("z_threshold", 2.5)),
        window=int(settings.get("anomaly", {}).get("rolling_window", 30)),
    )

    fc_inp = fc_mod.ForecastInput(
        closes=closes,
        sentiment_score=sent_summary["score"],
        news_volume_z=float(momentum["latest_z"]),
        sigma_daily=volatility.sigma_daily,
        political_risk=political["score"],
        horizon_days=int(settings.get("forecast", {}).get("horizon_days", 5)),
    )
    forecast_result = fc_mod.forecast(fc_inp)

    entities = _collect_entities(items)
    top_keywords = _top_keywords(items)

    snapshot = {
        "asset": {
            "symbol": asset.symbol,
            "name": asset.name,
            "type": asset.type,
            "queries": asset.queries,
        },
        "quote": quote,
        "n_articles": len(items),
        "sentiment": {
            "score": sent_summary["score"],
            "weight_sum": sent_summary["weight_sum"],
            "n_samples": sent_summary["n_samples"],
            "series_daily": daily_sent,
        },
        "momentum": momentum,
        "volatility": {
            "sigma_daily": volatility.sigma_daily,
            "sigma_annual": volatility.sigma_annual,
            "atr_latest": volatility.atr_latest,
            "beta": volatility.beta,
            "clustering": volatility.clustering,
            "risk_score": volatility.risk_score,
            "panic_probability": volatility.panic_probability,
            "hype_probability": volatility.hype_probability,
        },
        "political_risk": political,
        "anomalies": anomalies,
        "forecast": forecast_result,
        "entities": entities,
        "keywords": top_keywords,
        "ts_utc": datetime.now(timezone.utc).isoformat(),
    }

    alerts = detect_alerts(snapshot, settings.get("alerts", {}))
    snapshot["alerts"] = alerts

    if persist:
        _persist(db, asset, prices_rows, items)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for metric_name, value in [
            ("sentiment_score", sent_summary["score"]),
            ("news_volume", float(len(items))),
            ("risk_score", volatility.risk_score),
            ("panic_probability", volatility.panic_probability),
            ("hype_probability", volatility.hype_probability),
            ("political_risk", political["score"]),
            ("sigma_daily", volatility.sigma_daily),
            ("bullish_probability", forecast_result.get("bullish_probability", 0.0)),
        ]:
            db.upsert_metric(asset.symbol, today, metric_name, float(value))
        for alert in alerts:
            db.insert_alert(asset.symbol, alert)

    return snapshot


def _daily_sentiment_series(items: list[dict[str, Any]], sentiment_cfg: dict[str, Any]) -> list[dict[str, float]]:
    """Aggregiert Sentiment pro Tag (UTC) zu einem Score -100..+100."""
    bucket: dict[str, list[sc.SentimentSample]] = {}
    for it in items:
        if it.get("polarity") is None:
            continue
        ts = it.get("published_utc") or it.get("fetched_utc")
        if not ts:
            continue
        day = str(ts)[:10]
        sample = sc.SentimentSample(
            polarity=float(it["polarity"]),
            sentiment_strength=float(it.get("sentiment_strength", abs(it["polarity"]))),
            source_trust=float(it.get("source_trust", 0.4)),
            mentions=int(it.get("mentions", 1) or 1),
            age_hours=0.0,  # innerhalb des Tages: kein Decay
        )
        bucket.setdefault(day, []).append(sample)

    out = []
    for day in sorted(bucket.keys()):
        agg = sc.aggregate(
            bucket[day],
            lambda_per_hour=float(sentiment_cfg.get("recency_lambda_per_hour", 0.0289)),
        )
        out.append({"ts": day, "score": agg["score"], "n": agg["n_samples"]})
    return out


def _collect_entities(items: list[dict[str, Any]]) -> dict[str, list[str]]:
    counters: dict[str, dict[str, int]] = {
        "countries": {},
        "politicians": {},
        "central_banks": {},
        "conflicts": {},
        "organizations": {},
    }
    for it in items[:200]:
        text = " ".join(filter(None, [it.get("title"), it.get("summary")]))
        ents = ner_mod.extract_entities(text)
        for cat, vals in ents.items():
            for v in vals:
                counters[cat][v] = counters[cat].get(v, 0) + 1
    return {
        cat: [k for k, _ in sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:15]]
        for cat, d in counters.items()
    }


def _top_keywords(items: list[dict[str, Any]], top_k: int = 15) -> list[dict[str, float]]:
    if not items:
        return []
    corpus = [(it.get("title") or "") + " " + (it.get("summary") or "") for it in items]
    lang = (items[0].get("lang") or "en")[:2]
    rake = kw.rake_keyphrases(" \n".join(corpus), lang=lang, top_k=top_k)
    return [{"term": term, "score": round(score, 3)} for term, score in rake]
