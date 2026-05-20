"""Strukturiertes Logging."""

from __future__ import annotations

import logging
import os
import sys
from logging import Logger


def get_logger(name: str = "quant_engine") -> Logger:
    """Liefert einen konfigurierten Logger.

    Level via ``QUANT_LOG_LEVEL`` (Default INFO). Format ist
    bewusst kompakt, damit Tools wie ``docker logs`` lesbar bleiben.
    """
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    level = os.getenv("QUANT_LOG_LEVEL", "INFO").upper()
    logger.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False
    return logger
