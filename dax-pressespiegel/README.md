# DAX 40 Pressespiegel

**Lokales Stimmungs-Pressespiegel-Tool fuer den DAX 40.**

Sammelt Artikel aus deutschen und internationalen Finanz-/Wirtschaftsnachrichten,
ordnet sie den 40 DAX-Aktien zu und berechnet je Aktie ein **Stimmungsbild**
(positiv/neutral/negativ + Sentiment-Score -100..+100).

Im Stil des Theater-Pressespiegels — gleiche Mechanik (RSS-Fetch, Sentiment-Lexikon,
Auto-Matching, Dashboard), nur dass statt Theaterproduktionen die 40 DAX-Aktien
das Watchlist-Vokabular bilden.

- ✅ vollstaendig lokal, keine kostenpflichtigen APIs
- ✅ keine Closed-Source-Abhaengigkeiten
- ✅ ~20 vorkonfigurierte Quellen (Handelsblatt, FAZ, Manager Magazin, Spiegel,
  Reuters, plus Google/Bing News pro Aktie)
- ✅ Auto-Sentiment auf Wort-Lexikon-Basis (DE/EN, mit Negationserkennung)

## Quickstart

```bash
cd dax-pressespiegel
npm install
npm run ui              # Web-UI auf http://127.0.0.1:4712
```

Beim Start wird automatisch ein Scan gestartet, danach alle 30 Minuten.

### Nur ein einmaliger Scan auf der Konsole

```bash
npm run scan
```

### Liste der ueberwachten Aktien

```bash
npm run list
```

## Wie das Stimmungsbild entsteht

Pro Artikel:
1. **Erwaehnungs-Erkennung**: alle DAX-Aktien werden mit Wortgrenzen-Matching
   im Titel + Snippet gesucht (inkl. Synonymen wie *Bayerische Motoren Werke*
   fuer BMW). Treffer im Titel zaehlen doppelt.
2. **Sentiment-Lexikon**: deutsches und englisches Finanz-Vokabular
   (z.B. *Gewinn, uebertrifft, Rekord* vs. *Verlust, Gewinnwarnung, Klage*).
   Negationen (*nicht*, *kein*) im 3-Wort-Fenster kehren das Sentiment um.
3. **Polaritaet** = (pos - neg) / (pos + neg), Skala -1 .. +1.

Pro Aktie wird ueber alle Artikel im gewaehlten Zeitfenster ein gewichteter
Mittelwert berechnet:

```
Score = Σ ( polarity_i * (source_trust_i + 0.2·title_hit_i) * mentions_i )
        --------------------------------------------------------------------
        Σ ( (source_trust_i + 0.2·title_hit_i) * mentions_i )
```

Auf -100..+100 skaliert. Eine *Stimmungsbalken*-Visualisierung zeigt zusaetzlich
das Verhaeltnis von positiven, neutralen und negativen Artikeln.

## Web-UI

- **Hauptseite**: Karten-Grid mit allen 40 DAX-Aktien. Jede Karte zeigt:
  Aktienname, Sentiment-Score, Stimmungsbalken, Artikel-Zaehler, die 3
  relevantesten Headlines.
- **Sortierung**: meiste Artikel / positivstes Sentiment / negativstes / A-Z.
- **Filter-Suche** ueber Name, Symbol, Branche oder Suchwort.
- **Klick auf eine Karte** -> Modal mit allen Artikeln im Zeitraum inkl. Sentiment-Werten.
- **SCAN**-Button stoesst manuellen Lauf an.

## Konfiguration

| Datei                          | Inhalt                                                 |
| ------------------------------ | ------------------------------------------------------ |
| `config/dax40.json`            | 40 Aktien mit ISIN, Sektor, Suchworten, Synonymen      |
| `config/sources.json`          | RSS-Quellen + Trust-Gewicht                            |
| `config/sentiment.json`        | Finanz-Lexikon DE/EN + Negationsworte                  |
| `config/settings.json`         | Server-Port, Scan-Intervall, UI-Defaults               |

Aktien hinzufuegen: einfach neuen Eintrag in `config/dax40.json`. Quellen genauso
in `config/sources.json`. Restart noetig.

## API

| Endpoint                  | Beschreibung                                |
| ------------------------- | ------------------------------------------- |
| `GET  /api/health`        | Status                                      |
| `GET  /api/overview?days` | Sentiment + Top-Artikel je Aktie            |
| `GET  /api/stock/:symbol` | Alle Artikel + Sentiment fuer eine Aktie    |
| `GET  /api/dax40`         | Watchlist                                   |
| `GET  /api/scans`         | letzte Scans (Erfolgsstatistik)             |
| `POST /api/scan`          | manuellen Scan ausloesen                    |

## Tests

```bash
npm test
```

Coverage:
- `analyzer.test.js` - Stock-Matching (Wortgrenzen, Synonyme), Sentiment DE+EN, Negationen
- `utils.test.js` - URL-Normalisierung, Hashing, Datumsparsing
- `database.test.js` - Schema, Dedup, Mentions, Overview-Aggregation
- `server.test.js` - REST-Endpoints

## Architektur

```
dax-pressespiegel/
├── bin/cli.js          CLI: ui / scan / list
├── src/
│   ├── config.js       laedt config/*.json
│   ├── database.js     better-sqlite3 + Schema
│   ├── feed-fetcher.js undici + rss-parser
│   ├── analyzer.js     Stock-Matcher + Sentiment-Lexikon
│   ├── pipeline.js     End-to-end Scan
│   ├── server.js       Express-API + Dashboard-Mount
│   ├── logger.js       Konsolen-Logger
│   └── utils.js        URL-Helper, Datumsparsing, Regex-Helfer
├── web/
│   ├── index.html      Single-Page Dashboard
│   ├── styles.css      Light-Theme Pressespiegel-Stil
│   └── app.js          Vanilla-JS UI (Karten, Modal, Filter)
├── config/             dax40.json, sources.json, sentiment.json, settings.json
├── tests/              Unit- und Integrations-Tests
└── data/               SQLite-DB (gitignored)
```

## Datenschutz

Alle Daten lokal: `data/dax-pressespiegel.db` (SQLite, WAL). Nur die konfigurierten
RSS-Feeds und Google/Bing News werden ueber HTTPS abgerufen.

## Lizenz

MIT.
