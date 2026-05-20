# Roadmap & Verbesserungs-/Erweiterungsliste

Stand: 2026-05-19

Priorisierung:

- **P0** = kritisch / sofort
- **P1** = hoher Nutzen, geringer Aufwand
- **P2** = nice-to-have, mittlerer Aufwand
- **P3** = experimentell / langfristig

Erledigte Items aus dem `[Unreleased]` Block des Changelogs sind hier mit ✓ markiert.

---

## 1. Such-Algorithmus

| Pri    | Feature                                                                                                     | Status            |
| ------ | ----------------------------------------------------------------------------------------------------------- | ----------------- |
| ✓ P0   | BM25 mit Proximity-Boost, Coverage-Penalty, Title-Stem-Bonus                                                | done              |
| ✓ P1   | Synonym-Expansion aus `config/synonyms.json`                                                                | done              |
| ✓ P1   | Hybrid-Ranking BM25 + Fuse.js                                                                               | done              |
| **P1** | **Umlaut-Normalisierung** (ä↔ae, ö↔oe, ü↔ue, ß↔ss) so dass "Muller" auch "Müller" findet                    | **diese Session** |
| **P1** | **Compound-Splitting** für deutsche Komposita ("Opernpremiere" → "oper" + "premiere") via Heuristik         | **diese Session** |
| **P1** | **Phonetik-Matching (Metaphone)** für Eigennamen — robust gegen Schreibweisen wie Tschaikowsky/Tschaikowski | **diese Session** |
| **P1** | **LRU-Cache für Suchresultate** (Query + Filter-Hash → Treffer, 60s TTL)                                    | **diese Session** |
| **P1** | **Did-you-mean automatisch** in `hybridSearch` integrieren wenn <3 Treffer                                  | **diese Session** |
| **P1** | **Sentence-Boundary-Snippets** statt fester Zeichenfenster bei Highlights                                   | **diese Session** |
| P2     | Lemmatisierung statt Stemmer (wink-nlp-de) für höhere Treffergüte                                           | offen             |
| P2     | Faceted Counts in `/api/articles` (Kategorie, Sentiment, Quelle, Tag)                                       | offen             |
| P2     | Query-Autocomplete-API mit Präfix-Trie                                                                      | offen             |
| P2     | Wildcard-Operator `*` in Termen                                                                             | offen             |
| P3     | Pre-computed TF-IDF-Vektoren in DB, persistent                                                              | offen             |
| P3     | Semantische Suche via lokale Embeddings (z. B. instructor-xl, dragon-de)                                    | offen             |
| P3     | Cross-Encoder Re-Ranking bei kleinen Result-Mengen                                                          | offen             |

## 2. Filter-Algorithmus

| Pri    | Feature                                                                            | Status            |
| ------ | ---------------------------------------------------------------------------------- | ----------------- |
| ✓ P0   | Mehrwert-Filter category/sentiment/source/tag/type, kommasepariert                 | done              |
| ✓ P0   | minScore/maxScore                                                                  | done              |
| ✓ P0   | bookmark=yes/no                                                                    | done              |
| **P1** | **Tag-Modus** `tagMode=any\|all\|none` (Multi-Tag Boolean-Logik)                   | **diese Session** |
| **P1** | **`tagNot=`** Parameter für Tag-Ausschluss                                         | **diese Session** |
| **P1** | **`wordsMin`/`wordsMax`** Wortzahl-Range                                           | **diese Session** |
| **P1** | **`readingTimeMax`** geschätzte Lesezeit in Minuten                                | **diese Session** |
| **P1** | **`paywall=yes/no`**                                                               | **diese Session** |
| **P1** | **`image=yes/no`** (hat Bild im Meta)                                              | **diese Session** |
| **P1** | **`language=de\|en\|fr…`** via Spracherkennung mit `franc-min`                     | **diese Session** |
| **P1** | **`dupes=hide`** zeigt nur den jeweils ersten Artikel pro Duplikat-Cluster         | **diese Session** |
| **P1** | **`facets=true`** liefert Aggregationen pro Kategorie/Sentiment/Quelle/Tag/Sprache | **diese Session** |
| P2     | Geo-Filter (City/Region aus Quelle ableiten)                                       | offen             |
| P2     | Reading-Time-Range (Min+Max)                                                       | offen             |
| P2     | Filterprofile pro Nutzer speicherbar                                               | offen             |
| P2     | Saved-Filter mit Slug + öffentlich teilbarer URL                                   | offen             |
| P3     | Multi-Tag-Boolean mit Klammer-Ausdrücken (`(a OR b) AND -c`)                       | offen             |
| P3     | Score-Profiles (gewichtete Quellen-Reputation)                                     | offen             |

## 3. RSS-/Feed-Quellen

| Pri    | Item                                                                                            | Status            |
| ------ | ----------------------------------------------------------------------------------------------- | ----------------- |
| ✓ P0   | Auto-Disable nach n Fehlern                                                                     | done              |
| ✓ P0   | KSTA, ARD Mediathek entfernt                                                                    | done              |
| **P1** | **+25 neue Feeds** (ÖR-Kultur, Theater-Fachpresse, Kulturmagazine, internationale Kulturmedien) | **diese Session** |
| P2     | Feed-Validierung via Cron, Reaktivierung wenn Fehler-Counter alt                                | offen             |
| P2     | Podcast-Feeds (MP3-Enclosures mit Transcript via Whisper)                                       | offen             |
| P2     | YouTube/Mastodon-Kultur-Listen                                                                  | offen             |
| P3     | OPML-Import/Export                                                                              | offen             |
| P3     | Sitemap-Crawler statt RSS für Quellen ohne Feed                                                 | offen             |

## 4. Daten-Pipeline

| Pri  | Item                                                            | Status |
| ---- | --------------------------------------------------------------- | ------ |
| ✓ P0 | Chunked Enrichment + Progress-Log + ETA                         | done   |
| ✓ P0 | `max_articles_per_scan`-Cap                                     | done   |
| P2   | Worker-Threads für Analyzer (CPU-bound)                         | offen  |
| P2   | Streaming-RSS-Parser für sehr große Feeds                       | offen  |
| P2   | HTTP-Response-Cache auf Disk (zusätzlich zu ETag/Last-Modified) | offen  |
| P2   | Compress `full_text` in DB (gzip)                               | offen  |
| P3   | Job-Queue (bullmq) statt eigener Pipeline                       | offen  |
| P3   | Distributed-Lock für Multi-Instance                             | offen  |

## 5. NLP & Analyse

| Pri    | Item                                                      | Status            |
| ------ | --------------------------------------------------------- | ----------------- |
| ✓ P0   | Sentiment-Klassifikation                                  | done              |
| ✓ P0   | Artikeltyp-Erkennung (review/interview/announcement/news) | done              |
| ✓ P0   | Regel-basiertes Auto-Tagging                              | done              |
| **P1** | **Sprache-Erkennung** pro Artikel (franc-min)             | **diese Session** |
| **P1** | **Keyword-Extraction** via `keyword-extractor`            | **diese Session** |
| P2     | Named Entity Recognition (Personen, Orte, Produktionen)   | offen             |
| P2     | Quote-Extraction                                          | offen             |
| P2     | TextRank-Summarization als Zweit-Variante                 | offen             |
| P2     | Topic-Modeling (LDA/NMF) für Trends                       | offen             |
| P3     | Per-Entity-Sentiment                                      | offen             |

## 6. UI / UX

| Pri  | Item                                                 | Status |
| ---- | ---------------------------------------------------- | ------ |
| ✓ P0 | Dark-Mode-Kontrast                                   | done   |
| ✓ P0 | Active-Filter-Chips, Quick-Pills, Saved Searches     | done   |
| ✓ P0 | Keyboard-Shortcuts-Overlay                           | done   |
| P1   | Erweiterte-Filter-Drawer (mit den neuen API-Filtern) | offen  |
| P1   | Did-you-mean-Suggestion-Banner unter dem Suchfeld    | offen  |
| P1   | Faceted-Counts in Sidebar                            | offen  |
| P2   | Virtualisierte Liste für tausende Artikel            | offen  |
| P2   | Reading-Mode (klare Volltext-Ansicht im Modal)       | offen  |
| P2   | Snippet-Preview in Trefferliste                      | offen  |
| P3   | Browser-Extension zum Manuell-Speichern              | offen  |
| P3   | Mobile-PWA                                           | offen  |

## 7. Reports

| Pri  | Item                                                      | Status |
| ---- | --------------------------------------------------------- | ------ |
| ✓ P0 | HTML/PDF, Sentiment-Pie, Time-Series, Source-Distribution | done   |
| ✓ P0 | NaN-safe CSS                                              | done   |
| P2   | E-Mail-Versand (SMTP via nodemailer)                      | offen  |
| P2   | Markdown- und JSON-Export                                 | offen  |
| P2   | Wöchentlich-/Monatlich-Digest-Mail mit Top-N              | offen  |
| P3   | Custom-Report-Templates                                   | offen  |

## 8. Infrastruktur

| Pri  | Item                                                | Status |
| ---- | --------------------------------------------------- | ------ |
| ✓ P0 | CI/CD (GitHub Actions), Dependabot, Issue-Templates | done   |
| ✓ P0 | Dockerfile + docker-compose                         | done   |
| ✓ P0 | ESLint 9 Flat-Config + Prettier                     | done   |
| P2   | OpenAPI-bedienbares UI (swagger-ui-express)         | offen  |
| P2   | Health/Metrics-Endpoint mit Details                 | offen  |
| P2   | `helmet` + `compression` + `express-rate-limit`     | offen  |
| P2   | Joi/Zod-Validierung der API-Eingaben                | offen  |
| P3   | TypeScript-Migration / JSDoc-types                  | offen  |
| P3   | Prometheus-Metriken                                 | offen  |

## 9. Operations

| Pri  | Item                                               | Status |
| ---- | -------------------------------------------------- | ------ |
| ✓ P0 | Tägliche Cron-Scans + Reports                      | done   |
| P2   | Automatische DB-Backups (zusätzlich zu `--backup`) | offen  |
| P2   | Backup-Restore-UI                                  | offen  |
| P3   | Webhooks bei neuen Artikeln                        | offen  |

---

## Diese-Session-Implementierung (P1)

Konkret werden umgesetzt:

1. **Module hinzufügen**: `lru-cache`, `franc-min`, `keyword-extractor`. Eigene Metaphone- + Compound-Splitting-Helfer als Modul `src/text-utils.js` (kein externes Paket weil deutsche Pakete entweder veraltet oder zu groß sind).
2. **`src/text-utils.js`** mit: `normalizeUmlauts`, `expandUmlautVariants`, `germanCompoundSplit`, `metaphoneDe`, `detectLanguage`, `estimateReadingMinutes`, `extractTopKeywords`, `extractSnippet`.
3. **`src/search.js`** erweitern: LRU-Cache, Umlaut-/Compound-Token-Expansion, Phonetik-Matching, automatischer Did-you-mean-Fallback, sentence-boundary Snippets.
4. **`src/query-parser.js`** erweitern: neue Feldnamen `words`, `lang`, `image`, `dupe`, `tagmode`, `tagnot`.
5. **`src/server.js`** `/api/articles` erweitern: neue Filter-Parameter + optionaler `facets=true` Aggregations-Block.
6. **`config/sources.json`** ~25 neue Feeds.
7. **Tests** in `tests/text-utils.test.js`, `tests/search-extended.test.js`, `tests/query-parser-extended.test.js`, `tests/api-filters.test.js`.

Aufwand-Schätzung: ~600 LOC + 150 LOC Tests. Tests müssen weiterhin 116+ neue passen.
