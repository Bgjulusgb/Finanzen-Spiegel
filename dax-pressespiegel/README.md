# DAX 40 Pressespiegel

Lokaler **Stimmungs- und Sozial-Pressespiegel** fuer den DAX 40. Sammelt
Schlagzeilen aus Wirtschaftspresse, Boersenportalen und Reddit, ordnet jede
Erwaehnung der richtigen Aktie zu und destilliert daraus:

- **Mood** &mdash; klassisches Sentiment (positiv / neutral / negativ)
- **Bull / Bear** &mdash; Kursrichtungs-Indikator (bullisch / bearisch)
- **Buzz** &mdash; Aufmerksamkeit relativ zum Median
- **Trend** &mdash; Sentiment-Veraenderung gegenueber Vorperiode
- **Talk-Type** &mdash; *wie* wird geredet: Earnings, M&amp;A, Analyst, Recht, Skandal, &hellip;
- **Konsens** &mdash; einhellig vs. geteilte Berichterstattung

Alles offline, ohne kostenpflichtige APIs, ohne Tracking.

---

## Quickstart

```bash
cd dax-pressespiegel
npm install
npm run ui                   # Web-UI auf http://127.0.0.1:4712
```

Beim Start laeuft automatisch ein Scan, danach alle 30 Minuten. Manuell:

```bash
npm run scan                 # einmaliger Scan auf der Konsole
npm run inspect 14 SAP.DE    # Tabelle + Detail zu einer Aktie
npm run list                 # Watchlist anzeigen
```

---

## Was die UI zeigt

### Hauptseite &mdash; 40 Karten

Jede Karte zeigt fuer den gewaehlten Zeitraum:

- **2 Badges**: links Mood (-100..+100), rechts Bull/Bear (-100..+100)
- **Chips** je nach Lage: Top-Thema (Earnings/M&A/Analyst/&hellip;), Buzz, Trend &uarr;/&darr;, "einhellig" / "geteilt"
- **Stimmungsbalken** mit Anteilen positiv/neutral/negativ
- **Zaehler**: Artikel gesamt, + / o / -, &uarr; / &darr; (bull/bear)
- **3 Top-Schlagzeilen** mit Sentiment-Farbgebung

Steuerleiste:

- Zeitraum (24h, 3T, 7T, 14T, 30T)
- Sortierung: meiste Artikel / bullischste / bearischste / positivstes / negativstes / Buzz / Trend &uarr; / Trend &darr; / A-Z
- Talk-Type-Filter (Earnings, M&A, Analyst, Recht, Produkt, Skandal, Makro, Guidance, Dividende, Personalie)
- Volltext-Filter (Name, Symbol, Branche, Suchwort)
- SCAN-Button fuer manuelle Aktualisierung

### Detail-Modal (Klick auf eine Karte)

- 10-Felder-Statistikblock: Mood, Bull/Bear, Trend &Delta;, Buzz, Konsens, Artikelzahl, +/o/-, Bull/Bear-Counts, Top-Thema, letzte Erwaehnung
- **Themenverteilung** mit Treffer-Zaehler pro Talk-Type
- **Sentiment-Verlauf**: SVG-Sparkline ueber Tagesmittel
- **Alle Artikel** im Zeitraum mit Aspekt-Sentiment, Bull-Score, Talk-Type-Chip und Link zur Quelle

---

## Wie das Stimmungsbild entsteht

### 1. Stock-Matching

Pro Aktie ein RegExp ueber alle Suchworte + Synonyme, mit Unicode-Wortgrenzen.
- *Bayerische Motoren Werke* &rarr; matcht BMW.DE
- *Saphir* matcht **nicht** SAP (Wortgrenze)
- Titel-Treffer zaehlen mit Bonus

Die Char-Positionen der Treffer werden gespeichert, um spaeter ein
**Aspekt-Fenster** um genau diese Aktie zu scoren.

### 2. Sentiment (Mood) und Bull/Bear &mdash; zweidimensional

Jeder Lexikoneintrag hat **zwei Gewichte**:

| Phrase                  | pol  | bull |
| ----------------------- | ---: | ---: |
| Rekordauftrag           | +0.8 | +0.8 |
| Kursziel angehoben      | +0.6 | +0.9 |
| Kaufempfehlung          | +0.5 | +0.9 |
| Dividende erhoeht       | +0.5 | +0.6 |
| Gewinnwarnung           | -0.9 | -1.0 |
| Klage                   | -0.5 | -0.6 |
| Insolvenz               | -1.0 | -1.0 |
| Kurssturz               | -0.8 | -0.9 |
| Downgrade               | -0.5 | -0.8 |

`pol` ist *wie ist die Stimmung* (positiv / negativ).
`bull` ist *wie wirkt sich das auf den Kurs aus*.

Beispiel "Streik": negative Stimmung (`pol = -0.4`), aber nicht extrem bearish (`bull = -0.4`).
Beispiel "Kursziel angehoben": neutrale Stimmung an sich (`pol = +0.6`), aber stark bullisch (`bull = +0.9`).

**Negation** (`nicht`, `kein`, `never`, &hellip;) im 4-Wort-Fenster kehrt das Vorzeichen um.
**Intensifier** (`sehr`, `massiv`, `record`, &hellip;) skalieren die Staerke.

### 3. Aspekt-Sentiment &mdash; "ueber welche Aktie wird *wie* geredet"

Im Artikel "SAP uebertrifft Erwartungen, im Gegensatz dazu kassiert Bayer Gewinnwarnung":
- Gesamttext-Sentiment: leicht positiv (gemischt)
- Aspekt-Fenster um *SAP*: stark positiv
- Aspekt-Fenster um *Bayer*: stark negativ

Das Fenster respektiert Satzgrenzen (`.` `!` `?` `;` `:`) und harte
Kontrastwoerter (`Gegensatz`, `aber`, `jedoch`, `however`), damit das
Sentiment der Nachbar-Aktie nicht uebergreift.

### 4. Talk-Type &mdash; *wie* wird geredet

Regelbasierte Klassifikation pro Artikel anhand von Trigger-Phrasen:

| Talk-Type    | Trigger (Auszug)                                                  |
| ------------ | ----------------------------------------------------------------- |
| `earnings`   | Quartalszahlen, Q1/Q2, EPS, EBIT, Halbjahres, Umsatz steigt       |
| `mna`        | Uebernahme, Fusion, Synergie, Joint Venture, Spin-off             |
| `analyst`    | Kursziel, Rating, Buy/Sell/Hold, Berenberg, Goldman, JPMorgan     |
| `legal`      | Klage, Sammelklage, Urteil, Geldstrafe, Razzia, Vergleich         |
| `product`    | Launch, stellt vor, neues Modell, Markteinfuehrung                |
| `scandal`    | Betrug, Korruption, Manipulation, Skandal, Rueckruf, Datenleck    |
| `macro`      | Leitzins, EZB, Fed, Inflation, Rezession, Konjunktur, Zoelle      |
| `guidance`   | Prognose, Guidance, Ausblick, Jahresziel                          |
| `dividend`   | Dividende, Ausschuettung, Rueckkauf, Buyback                      |
| `personnel`  | CEO, CFO, Vorstand, tritt zurueck, Nachfolger                     |
| `general`    | Fallback                                                          |

Auf der Karte zeigen wir den **dominanten spezifischen** Typ. `general` wird
nur dann angezeigt, wenn nichts Spezifisches signifikant ist (&lt;20% der Artikel).

### 5. Aggregat pro Aktie und Fenster

```text
Mood, Bull = gewichteter Mittelwert (trust + 0.2 × title_hit) × mentions

Buzz       = n_articles / Median(n_articles ueber alle 40)
Konsens    = 1 - StdDev(sentiment ueber alle Artikel)
Trend Δ    = Mood(2. Haelfte) - Mood(1. Haelfte des Fensters)
```

---

## Konfiguration

| Datei                   | Inhalt                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `config/dax40.json`     | 40 Aktien mit Symbol, ISIN, Sektor, Suchworten, Synonymen    |
| `config/sources.json`   | RSS-Quellen + Trust + alternative URLs + per-Aktie-Templates |
| `config/sentiment.json` | Gewichtetes Lexikon DE/EN + Talk-Type-Trigger + Negation     |
| `config/settings.json`  | Port, Scan-Intervall, Timeouts, UA, UI-Defaults              |

**Aktie hinzufuegen**: neuen Eintrag in `dax40.json`, Server neu starten.
**Quelle hinzufuegen**: neuen Eintrag in `sources.json` (RSS/Atom/JSON-Feed).
**Lexikon erweitern**: neue Eintraege in `sentiment.json` &mdash; jeder mit `t` (Text), `pol`, `bull`.

---

## Quellen-Mix

19 Basis-Quellen + 6 pro-Aktie-Aggregatoren &rarr; **bis zu 6 × 40 = 240 zusaetzliche
Sub-Queries** pro Scan.

- Deutsche Wirtschaftspresse: Tagesschau, Handelsblatt, Manager Magazin, Wirtschaftswoche, FAZ, SZ, ZEIT, Spiegel, n-tv
- Boersenportale: boerse-online, finanzen.net, Ariva, boerse-frankfurt, boersengefluester
- Regulatorisch: DGAP / EQS Adhoc-News
- Wires: Reuters, MarketWatch
- Pro-Aktie: Google News DE/EN, Bing News DE, Yahoo Finance via Google
- Social: Reddit r/Aktien, r/Mauerstrassenwetten, r/Finanzen, r/stocks

Fetcher haertet gegen Bot-Blocking:
- realistischer Firefox-UA, bei 403/429/503 Retry mit Safari-UA
- folgt 3xx-Redirects manuell (Google News leitet auf Quellen weiter)
- alternative URLs pro Quelle (`alt_urls`)
- RSS + Atom + JSON-Feed parsing

---

## API

| Endpoint                       | Beschreibung                                              |
| ------------------------------ | --------------------------------------------------------- |
| `GET  /api/health`             | Status + Scan-State                                       |
| `GET  /api/overview?days=N`    | Karten-Daten fuer alle 40 Aktien                          |
| `GET  /api/stock/:symbol?days` | Stock-Detail inkl. Tagesserie und allen Artikeln          |
| `GET  /api/dax40`              | Watchlist                                                 |
| `GET  /api/scans`              | letzte Scans + Statistik                                  |
| `POST /api/scan`               | manuellen Scan ausloesen                                  |

Antwort `/api/overview?days=7` pro Aktie:

```json
{
  "symbol": "SAP.DE", "name": "SAP", "sector": "tech",
  "n_articles": 96, "n_positive": 25, "n_neutral": 65, "n_negative": 6,
  "n_bull": 31, "n_neutral_bull": 60, "n_bear": 5,
  "mood": 0.04, "mood_100": 4.0,
  "bull": 0.053, "bull_100": 5.3,
  "intensity": 0.08, "consensus": 0.86, "buzz": 1.12,
  "trend_delta": 4.5, "top_talk_type": "earnings",
  "talk_distribution": {"earnings": 22, "analyst": 18, "general": 56},
  "last_seen": "2026-05-21T03:22:00Z",
  "top_articles": [ ... ]
}
```

---

## Tests

```bash
npm test
```

**39 Tests** in 4 Dateien:

- `analyzer.test.js` &mdash; Stock-Matching, Sentiment DE/EN, Bull/Bear, Negation, Intensifier, Talk-Type, Aspekt-Fenster
- `utils.test.js` &mdash; URL-Normalisierung, Hash, Datumsparsing
- `database.test.js` &mdash; Schema, Migration (v0.1 &rarr; v0.2), Mentions inkl. Aspekt, Aggregat
- `server.test.js` &mdash; REST-Endpoints

---

## Architektur

```
dax-pressespiegel/
├── bin/cli.js              CLI: ui | scan | list
├── scripts/inspect.js      DB-Diagnose: Top-Buzz, Top-Bull/Bear, Talk-Verteilung, Sparkline
├── src/
│   ├── config.js           laedt config/*.json
│   ├── database.js         better-sqlite3, Schema, Migration, Aggregate, Daily-Series
│   ├── feed-fetcher.js     undici, rss-parser, Retry, UA-Rotation, alt_urls
│   ├── analyzer.js         Stock-Matcher, Sentiment-2D (mood+bull), Talk-Type, Aspekt-Fenster
│   ├── pipeline.js         End-to-end Scan
│   ├── server.js           Express-API + Static-UI + Trend-Delta-Aggregat
│   ├── logger.js           Konsolen-Logger
│   └── utils.js            URL-Normalisierung, Hash, Datumsparsing
├── web/                    Single-Page Dashboard (Vanilla HTML/CSS/JS)
├── config/                 dax40 + sources + sentiment + settings (JSON)
├── tests/                  39 Tests
└── data/                   SQLite-DB (gitignored)
```

---

## Datenschutz

Alles lokal: `data/dax-pressespiegel.db` (SQLite, WAL).
Nur konfigurierte HTTPS-Feeds werden abgerufen, keine Telemetrie.

## Lizenz

MIT.
