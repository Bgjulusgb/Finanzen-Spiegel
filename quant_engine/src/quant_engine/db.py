"""SQLite-basierte Persistenz.

Lokal, dateibasiert, ohne externen Server. Schema ist bewusst
flach gehalten, damit pandas / numpy direkt lesen koennen.

Tabellen:
- prices            Tagespreise (OHLCV)
- articles          gespeicherte Nachrichten (dedup via url-Hash)
- sentiments        Sentiment-Score pro Artikel
- metrics           berechnete Kennzahlen (taeglich, key=asset+date+metric)
- alerts            ausgeloeste Alerts
- sources           dynamisch entdeckte Quellen
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    asset_symbol TEXT NOT NULL,
    ts_utc      TEXT NOT NULL,
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL NOT NULL,
    volume      REAL,
    source      TEXT,
    PRIMARY KEY (asset_symbol, ts_utc)
);
CREATE INDEX IF NOT EXISTS idx_prices_symbol_ts ON prices (asset_symbol, ts_utc DESC);

CREATE TABLE IF NOT EXISTS articles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_symbol    TEXT NOT NULL,
    url             TEXT NOT NULL,
    url_hash        TEXT NOT NULL,
    source_id       TEXT,
    source_name     TEXT,
    source_trust    REAL DEFAULT 0.4,
    title           TEXT,
    summary         TEXT,
    published_utc   TEXT,
    fetched_utc     TEXT NOT NULL,
    lang            TEXT,
    text_hash       TEXT,
    extra_json      TEXT,
    UNIQUE (asset_symbol, url_hash)
);
CREATE INDEX IF NOT EXISTS idx_articles_asset_pub ON articles (asset_symbol, published_utc DESC);
CREATE INDEX IF NOT EXISTS idx_articles_asset_fetched ON articles (asset_symbol, fetched_utc DESC);

CREATE TABLE IF NOT EXISTS sentiments (
    article_id          INTEGER PRIMARY KEY,
    polarity            REAL NOT NULL,
    confidence          REAL NOT NULL,
    sentiment_strength  REAL NOT NULL,
    weighted_score      REAL NOT NULL,
    model               TEXT,
    political_categories TEXT,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metrics (
    asset_symbol TEXT NOT NULL,
    date_utc     TEXT NOT NULL,
    metric       TEXT NOT NULL,
    value        REAL NOT NULL,
    payload_json TEXT,
    PRIMARY KEY (asset_symbol, date_utc, metric)
);

CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_symbol TEXT NOT NULL,
    ts_utc       TEXT NOT NULL,
    type         TEXT NOT NULL,
    severity     REAL NOT NULL,
    title        TEXT NOT NULL,
    message      TEXT,
    payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_asset_ts ON alerts (asset_symbol, ts_utc DESC);

CREATE TABLE IF NOT EXISTS sources (
    id           TEXT PRIMARY KEY,
    name         TEXT,
    url          TEXT NOT NULL,
    type         TEXT,
    trust        REAL DEFAULT 0.4,
    lang         TEXT,
    category     TEXT,
    discovered_utc TEXT,
    last_ok_utc  TEXT,
    fail_count   INTEGER DEFAULT 0,
    active       INTEGER DEFAULT 1
);
"""


class Database:
    """Thread-safe SQLite-Wrapper."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = self._connect()
        return self._conn

    def _init_schema(self) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.executescript(SCHEMA)

    @contextmanager
    def cursor(self) -> Iterator[sqlite3.Cursor]:
        with self._lock:
            cur = self.conn.cursor()
            try:
                yield cur
            finally:
                cur.close()

    # ---- Prices --------------------------------------------------

    def upsert_prices(self, asset: str, rows: Iterable[dict[str, Any]], source: str = "yahoo") -> int:
        n = 0
        with self.cursor() as cur:
            for r in rows:
                cur.execute(
                    """
                    INSERT OR REPLACE INTO prices
                        (asset_symbol, ts_utc, open, high, low, close, volume, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        asset,
                        r["ts_utc"],
                        r.get("open"),
                        r.get("high"),
                        r.get("low"),
                        r["close"],
                        r.get("volume"),
                        source,
                    ),
                )
                n += 1
        return n

    def get_prices(self, asset: str, limit: int = 500) -> list[dict[str, Any]]:
        with self.cursor() as cur:
            cur.execute(
                """SELECT ts_utc, open, high, low, close, volume
                   FROM prices WHERE asset_symbol = ?
                   ORDER BY ts_utc DESC LIMIT ?""",
                (asset, limit),
            )
            rows = [dict(r) for r in cur.fetchall()]
        return list(reversed(rows))

    # ---- Articles ------------------------------------------------

    def upsert_article(self, asset: str, data: dict[str, Any]) -> int | None:
        with self.cursor() as cur:
            cur.execute(
                """INSERT OR IGNORE INTO articles
                       (asset_symbol, url, url_hash, source_id, source_name, source_trust,
                        title, summary, published_utc, fetched_utc, lang, text_hash, extra_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    asset,
                    data["url"],
                    data["url_hash"],
                    data.get("source_id"),
                    data.get("source_name"),
                    float(data.get("source_trust", 0.4)),
                    data.get("title"),
                    data.get("summary"),
                    data.get("published_utc"),
                    data.get("fetched_utc", datetime.now(timezone.utc).isoformat()),
                    data.get("lang"),
                    data.get("text_hash"),
                    json.dumps(data.get("extra", {}), ensure_ascii=False),
                ),
            )
            if cur.rowcount == 0:
                cur.execute(
                    "SELECT id FROM articles WHERE asset_symbol = ? AND url_hash = ?",
                    (asset, data["url_hash"]),
                )
                row = cur.fetchone()
                return int(row["id"]) if row else None
            return int(cur.lastrowid) if cur.lastrowid else None

    def get_articles(
        self,
        asset: str,
        since_utc: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        with self.cursor() as cur:
            if since_utc:
                cur.execute(
                    """SELECT a.*, s.polarity, s.confidence, s.sentiment_strength,
                               s.weighted_score, s.political_categories
                        FROM articles a
                        LEFT JOIN sentiments s ON s.article_id = a.id
                        WHERE a.asset_symbol = ? AND COALESCE(a.published_utc, a.fetched_utc) >= ?
                        ORDER BY COALESCE(a.published_utc, a.fetched_utc) DESC LIMIT ?""",
                    (asset, since_utc, limit),
                )
            else:
                cur.execute(
                    """SELECT a.*, s.polarity, s.confidence, s.sentiment_strength,
                               s.weighted_score, s.political_categories
                        FROM articles a
                        LEFT JOIN sentiments s ON s.article_id = a.id
                        WHERE a.asset_symbol = ?
                        ORDER BY COALESCE(a.published_utc, a.fetched_utc) DESC LIMIT ?""",
                    (asset, limit),
                )
            return [dict(r) for r in cur.fetchall()]

    # ---- Sentiments ----------------------------------------------

    def upsert_sentiment(self, article_id: int, sentiment: dict[str, Any]) -> None:
        with self.cursor() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO sentiments
                       (article_id, polarity, confidence, sentiment_strength, weighted_score,
                        model, political_categories)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    int(article_id),
                    float(sentiment["polarity"]),
                    float(sentiment.get("confidence", 0.6)),
                    float(sentiment["sentiment_strength"]),
                    float(sentiment["weighted_score"]),
                    sentiment.get("model", "vader+lexicon"),
                    json.dumps(sentiment.get("political_categories", []), ensure_ascii=False),
                ),
            )

    # ---- Metrics -------------------------------------------------

    def upsert_metric(
        self,
        asset: str,
        date_utc: str,
        metric: str,
        value: float,
        payload: dict[str, Any] | None = None,
    ) -> None:
        with self.cursor() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO metrics (asset_symbol, date_utc, metric, value, payload_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    asset,
                    date_utc,
                    metric,
                    float(value),
                    json.dumps(payload or {}, ensure_ascii=False),
                ),
            )

    def get_metric_series(self, asset: str, metric: str, limit: int = 90) -> list[dict[str, Any]]:
        with self.cursor() as cur:
            cur.execute(
                """SELECT date_utc, value, payload_json FROM metrics
                   WHERE asset_symbol = ? AND metric = ?
                   ORDER BY date_utc DESC LIMIT ?""",
                (asset, metric, limit),
            )
            rows = [dict(r) for r in cur.fetchall()]
        return list(reversed(rows))

    # ---- Alerts --------------------------------------------------

    def insert_alert(self, asset: str, alert: dict[str, Any]) -> int:
        with self.cursor() as cur:
            cur.execute(
                """INSERT INTO alerts (asset_symbol, ts_utc, type, severity, title, message, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    asset,
                    alert.get("ts_utc", datetime.now(timezone.utc).isoformat()),
                    alert["type"],
                    float(alert.get("severity", 0.5)),
                    alert["title"],
                    alert.get("message", ""),
                    json.dumps(alert.get("payload", {}), ensure_ascii=False),
                ),
            )
            return int(cur.lastrowid or 0)

    def get_alerts(self, asset: str, limit: int = 50) -> list[dict[str, Any]]:
        with self.cursor() as cur:
            cur.execute(
                """SELECT * FROM alerts WHERE asset_symbol = ?
                   ORDER BY ts_utc DESC LIMIT ?""",
                (asset, limit),
            )
            return [dict(r) for r in cur.fetchall()]

    # ---- Sources -------------------------------------------------

    def upsert_source(self, src: dict[str, Any]) -> None:
        with self.cursor() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO sources
                       (id, name, url, type, trust, lang, category, discovered_utc, last_ok_utc, fail_count, active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    src["id"],
                    src.get("name"),
                    src["url"],
                    src.get("type", "rss"),
                    float(src.get("trust", 0.4)),
                    src.get("lang"),
                    src.get("category"),
                    src.get("discovered_utc", datetime.now(timezone.utc).isoformat()),
                    src.get("last_ok_utc"),
                    int(src.get("fail_count", 0)),
                    int(src.get("active", 1)),
                ),
            )

    def list_sources(self) -> list[dict[str, Any]]:
        with self.cursor() as cur:
            cur.execute("SELECT * FROM sources WHERE active = 1")
            return [dict(r) for r in cur.fetchall()]

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
