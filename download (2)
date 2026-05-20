# Architektur

## System-Ueberblick

```
+-----------------------------------------------------+
|                  WEB UI / ELECTRON                  |
|              (HTML + CSS + Vanilla JS)              |
+----------------------+------------------------------+
                       | WebSocket + REST
+----------------------v------------------------------+
|                   EXPRESS SERVER                    |
|  +-----------+  +-----------+  +----------------+   |
|  |  Router   |  | WebSocket |  |   Scheduler    |   |
|  +-----------+  +-----------+  +----------------+   |
+------+---------------+----------------+-------------+
       |               |                |
+------v------+  +-----v------+  +------v--------+
|  Pipeline   |  |  Search    |  |   Reporter    |
|  Fetcher    |  |  BM25      |  |   HTML/PDF    |
|  Scraper    |  |  Fuse.js   |  +---------------+
|  Analyzer   |  +------------+
|  Tagger     |
|  Dedup      |
+------+------+
       |
+------v----------------------------------------------+
|             better-sqlite3 (lokal)                  |
|  articles | article_tags | bookmarks | scan_runs    |
|  source_health | saved_searches                     |
+-----------------------------------------------------+
```

## Datenfluss eines Scans

1. **Feed-Fetcher** (`src/feed-fetcher.js`) holt RSS/Atom/JSON-Feed mit undici (HTTP/2, ETag/Last-Modified, Retry-Backoff).
2. **News-Search** (`src/news-search.js`) erweitert um Google News / Bing News Queries.
3. **Scraper** (`src/scraper.js`) extrahiert Volltext per Cheerio + `@mozilla/readability`, ermittelt Veroeffentlichungsdatum aus Meta-Tags, JSON-LD, URL-Mustern und Fliesstext, erkennt Paywall.
4. **Analyzer** (`src/analyzer.js`) berechnet Relevanz-Score, Sentiment, Artikel-Typ (review/interview/announcement/news), Summary.
5. **Deduplicator** (`src/deduplicator.js`) prueft URL-Normalisierung, Titel-Levenshtein und Text-Cosine.
6. **Tagger** (`src/tagger.js`) wendet regel-basiertes Auto-Tagging aus `config/tags.json` an.
7. **Pipeline** (`src/pipeline.js`) orchestriert alles, schreibt in SQLite, gibt Scan-Summary zurueck.
8. **Server** (`src/server.js`) verteilt Live-Events (`log`, `scan-start`, `scan-complete`, `scan-error`) per WebSocket an die UI.

## Suche

`src/search.js` baut bei jeder Query einen BM25-Index ueber die Treffermenge. Score-Faktoren:

- **BM25** mit Porter-Stemmer (DE), `k1=1.5`, `b=0.75`, Titel x3 boost.
- **Coverage-Penalty**: Score wird mit `0.4 + 0.6 * matched/total` skaliert, damit Volltreffer gewinnen.
- **Proximity-Boost**: Nahe stehende Query-Terme im Dokument erhoehen Score bis +50%.
- **Title-Stem-Bonus**: +15% pro Title-Treffer.
- **Recency-Halbwertszeit**: 30 Tage.
- **Fuse.js**: Fuzzy-Match parallel (Gewicht 0.35), kombiniert mit BM25 (Gewicht 0.65).
- **Synonym-Expansion** aus `config/synonyms.json`.

## Such-Syntax (siehe `src/query-parser.js`)

| Operator | Beispiel                                | Effekt             |
| -------- | --------------------------------------- | ------------------ |
| Phrase   | `"Wokey Wokey"`                         | Exakte Phrase      |
| NOT      | `Hamlet -Hamburger`                     | Ausschluss         |
| OR       | `Wallenstein OR Mephisto`               | Boolesch oder      |
| Feld     | `title:Premiere`                        | Nur in diesem Feld |
| Datum    | `after:2024-01-01`, `before:2024-12-31` | Datumsfilter       |
| Score    | `score:>=50`                            | Numerisch          |
| Tag      | `tag:produktion:pinocchio`              | Tag-Filter         |
| Bookmark | `bookmark:yes`                          | Lesezeichen-Filter |

## Datenbank-Schema (vereinfacht)

```sql
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  url TEXT, url_normalized TEXT UNIQUE,
  title TEXT, source TEXT, author TEXT,
  published_date DATETIME, found_date DATETIME,
  full_text TEXT, first_paragraph TEXT, summary TEXT,
  word_count INTEGER, relevance_score INTEGER,
  sentiment TEXT, sentiment_score INTEGER,
  category TEXT, article_type TEXT,
  paywall INTEGER, duplicate_of INTEGER,
  also_on TEXT, deleted_at DATETIME, meta TEXT
);

CREATE TABLE article_tags (
  id INTEGER PRIMARY KEY, article_id INTEGER, tag TEXT,
  UNIQUE(article_id, tag)
);

CREATE TABLE bookmarks (article_id INTEGER PRIMARY KEY, note TEXT, created_at DATETIME);
CREATE TABLE saved_searches (id INTEGER PRIMARY KEY, name TEXT UNIQUE, query TEXT, filters TEXT, created_at DATETIME);
CREATE TABLE source_health (source TEXT PRIMARY KEY, last_success, last_failure, consecutive_failures, etag, last_modified, ...);
CREATE TABLE scan_runs (id INTEGER PRIMARY KEY, started_at, finished_at, sources_scanned, articles_found, articles_added, duplicates_found, errors, notes);
```

## Sicherheit

- Keine externen API-Keys.
- Alles lokal (SQLite + Filesystem).
- User-Agent-Rotation, Rate-Limiting pro Domain.
- `contextIsolation` und `sandbox: true` in Electron.
