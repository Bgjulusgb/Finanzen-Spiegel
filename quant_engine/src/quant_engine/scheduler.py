"""Hintergrund-Scheduler basierend auf APScheduler.

Drei Jobs:
- prices: holt Preisdaten
- feeds: holt News + Reddit + SEC
- analysis: laeuft die Pipeline und persistiert Kennzahlen
"""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from .config import get_config
from .logger import get_logger
from .pipeline import analyze

_logger = get_logger("scheduler")
_scheduler: AsyncIOScheduler | None = None


async def _run_analysis() -> None:
    try:
        snapshot = await analyze()
        _logger.info(
            "scheduled analysis ok: %s articles, sentiment=%.1f, risk=%.1f",
            snapshot.get("n_articles"),
            snapshot.get("sentiment", {}).get("score", 0.0),
            snapshot.get("political_risk", {}).get("score", 0.0),
        )
    except Exception as exc:  # noqa: BLE001 - logging only
        _logger.exception("scheduled analysis failed: %s", exc)


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    cfg = get_config().settings.get("scheduler", {})
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_analysis,
        trigger=IntervalTrigger(minutes=int(cfg.get("analysis_minutes", 10))),
        id="analysis",
        next_run_time=None,
        replace_existing=True,
    )
    _scheduler.start()
    _logger.info("scheduler started")
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
