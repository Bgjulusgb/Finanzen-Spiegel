# DAX 40 Pressespiegel

Lokaler **Stimmungs- und Sozial-Pressespiegel** fuer den DAX 40. Sammelt
Schlagzeilen aus Wirtschaftspresse, Boersenportalen und Reddit, ordnet jede
Erwaehnung der richtigen Aktie zu und destilliert daraus:

- **Mood** &mdash; klassisches Sentiment (positiv / neutral / negativ)
- **Bull / Bear** &mdash; Kursrichtungs-Indikator (bullisch / bearisch)
- **Buzz** &mdash; Aufmerksamkeit relativ zum Median
- **Trend** &mdash; Sentiment-Veraenderung gegenueber Vorperiode
- **Talk-Type** &mdash; *wie* wird geredet: Earnings, M&amp;A, Analyst, Recht, Skandal, &hellip;
- **Konsens** &mdash; einhellig / eher einig / gemischt / geteilt

Lokal, ohne kostenpflichtige APIs, ohne Tracking, **ohne native Compilation**.

---

## Setup

### Voraussetzung

**Node.js 22.5 oder neuer** &mdash; nutzt das in Node eingebaute `node:sqlite`,
keine `better-sqlite3`, kein `node-gyp`, kein Visual Studio Build-Tools mehr.

```bash
node --version    # muss >= 22.5 sein, empfohlen: 24 LTS
```

Falls noch alte Version: [nodejs.org](https://nodejs.org) -> 24 LTS.

### Install und Start

```bash
cd dax-pressespiegel
npm install                       # ca. 5 Sekunden, keine Compilation
npm run ui                        # http://127.0.0.1:4712
```

Bei Start laeuft automatisch ein Scan, danach alle 30 Minuten. Manuell:

```bash
npm run scan                      # einmaliger Scan in der Konsole
npm run inspect 14 SAP.DE         # DB-Diagnose: Top-Buzz, Bull/Bear, Detail
npm run list                      # Watchlist anzeigen
```

### Windows-Hinweis

Wenn das alte `better-sqlite3` aus einer frueheren Installation noch
`node_modules` belegt:

```cmd
rmdir /S /Q node_modules
del package-lock.json
npm install
```

Auf Node 22.x braucht der Lauf das Flag `--experimental-sqlite` &mdash;
die `npm`-Skripte setzen es bereits automatisch. Auf Node 24+ ist es
stabil und das Flag ist optional (wird einfach ignoriert).

---

## Was die UI zeigt

### Hauptseite &mdash; 40 Karten

Jede Karte zeigt fuer den gewaehlten Zeitraum:

- **2 Badges**: links Mood (-100..+100), rechts Bull/Bear (-100..+100)
- **Chips** je nach Lage: Top-Thema (Earnings/M&A/Analyst/&hellip;), Buzz, Trend &uarr;/&darr;, Konsens
- **Stimmungsbalken** mit Anteilen positiv/neutral/negativ
- **6 Counter**: Artikel gesamt, + / o / -, &uarr; / &darr; (bull/bear)
- **3 Top-Schlagzeilen** mit Sentiment-Farbgebung

Steuerleiste:

- Zeitraum (24h, 3T, 7T, 14T, 30T)
- Sortierung: meiste Artikel / bullischste / bearischste / positivstes / negativstes / Buzz / Trend &uarr; / Trend &darr; / A-Z
- Talk-Type-Filter (Earnings, M&A, Analyst, Recht, Produkt, Skandal, Makro, Guidance, Dividende, Personalie)
- Volltext-Filter (Name, Symbol, Branche, Suchwort)
- SCAN-Button + **Dark/Light**-Toggle

Tastatur-Shortcuts: `/` Suche fokussieren &middot; `r` Neu laden &middot; `s` Scan ausloesen &middot; `Esc` Detail schliessen.

### Detail-Modal (Klick auf eine Karte)

- 10-Felder-Statistikblock: Mood, Bull/Bear, Trend &Delta;, Buzz, Konsens, Artikelzahl, +/o/-, Bull/Bear-Counts, Top-Thema, letzte Erwaehnung
- **Themenverteilung** mit Treffer-Zaehler pro Talk-Type
- **Sentiment-Verlauf**: SVG-Sparkline ueber Tagesmittel
- **Alle Artikel** im Zeitraum mit Aspekt-Sentiment, Bull-Score, Talk-Type-Chip und Link zur Quelle

---

## Wie das Stimmungsbild entsteht

### 1. Stock-Matching mit Disambiguierung (v0.3)

Pro Aktie ein RegExp ueber alle Suchworte + Synonyme, mit Unicode-Wortgrenzen.
**Disambiguierung**: bei Ueberlappung gewinnt der laengste Treffer.

- *Bayerische Motoren Werke* &rarr; matcht BMW.DE
- *Mercedes-Benz Group* &rarr; matcht MBG.DE exklusiv, nicht zusaetzlich ein anderes Mercedes-Pattern
- *Saphir* matcht **nicht** SAP (Wortgrenze)
- Titel-Treffer zaehlen mit Bonus

**ISIN- und Ticker-Match (v0.3)**: ein Artikel der `DE0007164600` oder `SAP.DE`
direkt nennt, gibt einen `id_hit = true` als zusaetzliches Vertrauenssignal.

Char-Positionen der Treffer werden gespeichert &rarr; **Aspekt-Fenster** um
genau diese Aktie wird gescort.

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

`pol` = wie ist die Stimmung. `bull` = wie wirkt sich das auf den Kurs aus.
Beispiel "Streik": negativ (`pol = -0.4`), aber nur leicht bearisch (`bull = -0.4`).
Beispiel "Kursziel angehoben": neutral im Sentiment (`pol = +0.6`), aber stark bullisch (`bull = +0.9`).

**Negation** (`nicht`, `kein`, `never`, &hellip;) im 4-Wort-Fenster kehrt das Vorzeichen um.
**Intensifier** (`sehr`, `massiv`, `record`, &hellip;) skalieren die Staerke.

### 3. Title-Heavy Scoring (v0.3)

Titel und Body werden **separat** gescort, dann gewichtet zusammengeführt
(Titel 70%, Body 30%). Headlines sind verdichtet und vermitteln das Sentiment
praeziser als die oft generischen Snippets.

### 4. Aspekt-Sentiment &mdash; "wie wird ueber *diese* Aktie geredet"

Bei einem Artikel wie *"SAP uebertrifft Erwartungen, im Gegensatz dazu kassiert Bayer Gewinnwarnung"*:
- Gesamttext-Sentiment: leicht positiv (gemischt)
- Aspekt-Fenster um *SAP*: stark positiv
- Aspekt-Fenster um *Bayer*: stark negativ

Das Fenster respektiert Satzgrenzen (`.` `!` `?` `;` `:`) und harte
Kontrastwoerter (`Gegensatz`, `aber`, `jedoch`, `however`), damit das
Sentiment der Nachbar-Aktie nicht ueberlaeuft.

### 5. Talk-Type &mdash; *wie* wird geredet

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

Auf der Karte wird der **dominante spezifische** Typ angezeigt. `general`
nur dann, wenn nichts Spezifisches signifikant ist (&lt;20% der Artikel).

### 6. Aggregat pro Aktie und Fenster

```text
Mood, Bull  = gewichteter Mittelwert (trust + 0.2 × title_hit) × mentions

Buzz        = n_articles / Median(n_articles ueber alle 40)
Konsens     = 1 - StdDev(Sentiments)
              + Label: einhellig / eher einig / gemischt / geteilt
Trend Δ     = Mood(2. Fensterhaelfte) - Mood(1. Fensterhaelfte)
```

---

## Konfiguration

| Datei                   | Inhalt                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `config/dax40.json`     | 40 Aktien mit Symbol, ISIN, Sektor, Suchworten, Synonymen    |
| `config/sources.json`   | RSS-Quellen + Trust + alternative URLs + per-Aktie-Templates |
| `config/sentiment.json` | Gewichtetes Lexikon DE/EN + Talk-Type-Trigger + Negation     |
| `config/settings.json`  | Port, Scan-Intervall, Timeouts, UI-Defaults                  |

**Aktie hinzufuegen**: neuen Eintrag in `dax40.json` (mit `negative_terms`
um false-positives zu blocken). Server neu starten.
**Quelle hinzufuegen**: neuen Eintrag in `sources.json` (RSS/Atom/JSON-Feed).
**Lexikon erweitern**: neue Eintraege in `sentiment.json` &mdash; jeder mit `t` (Text), `pol`, `bull`.

---

## Quellen-Mix

19 Basis-Quellen + 6 pro-Aktie-Aggregatoren &rarr; **bis zu 6 × 40 = 240
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

| Endpoint                                  | Beschreibung                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `GET  /api/health`                        | Status + Scan-State                                       |
| `GET  /api/overview?days=N&talk=&sector=` | Karten-Daten fuer alle 40 Aktien (optionale Filter)       |
| `GET  /api/stock/:symbol?days=N`          | Stock-Detail inkl. Tagesserie und allen Artikeln          |
| `GET  /api/topics?days=N`                 | **Hot-Topics** (v0.3): Talk-Type-Verteilung + Veraenderung |
| `GET  /api/sources/health?days=N`         | **Quellen-Health** (v0.3): Artikel-Quote pro Quelle       |
| `GET  /api/dax40`                         | Watchlist                                                 |
| `GET  /api/scans`                         | letzte Scans + Statistik                                  |
| `POST /api/scan`                          | manuellen Scan ausloesen                                  |

Antwort `/api/overview?days=7` pro Aktie:

```json
{
  "symbol": "SAP.DE", "name": "SAP", "sector": "tech",
  "n_articles": 96, "n_positive": 25, "n_neutral": 65, "n_negative": 6,
  "n_bull": 31, "n_neutral_bull": 60, "n_bear": 5,
  "mood": 0.046, "mood_100": 4.6,
  "bull": 0.059, "bull_100": 5.9,
  "intensity": 0.08, "consensus": 0.86, "consensus_label": "einhellig",
  "buzz": 1.40, "trend_delta": 5.1, "top_talk_type": "analyst",
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

**44 Tests** in 4 Dateien:

- `analyzer.test.js` &mdash; Stock-Matching, Disambiguierung, ISIN/Ticker-Match, Sentiment DE/EN, Bull/Bear, Negation, Intensifier, Talk-Type, Aspekt-Fenster, Title-Heavy
- `utils.test.js` &mdash; URL-Normalisierung, Hash, Datumsparsing
- `database.test.js` &mdash; Schema, Migration (v0.1 &rarr; v0.3), Mentions inkl. Aspekt, Aggregat, Konsens-Label
- `server.test.js` &mdash; REST-Endpoints

---

## Architektur

```
dax-pressespiegel/
├── bin/cli.js              CLI: ui | scan | list
├── scripts/inspect.js      DB-Diagnose: Top-Buzz, Bull/Bear, Talk-Verteilung, Sparkline
├── src/
│   ├── config.js           laedt config/*.json
│   ├── database.js         node:sqlite, Schema, Migration, Aggregate, Daily-Series, Konsens-Label
│   ├── feed-fetcher.js     undici, rss-parser, Retry, UA-Rotation, alt_urls, Redirect-Following
│   ├── analyzer.js         Stock-Matcher mit Disambiguierung+ISIN, Sentiment-2D, Talk-Type, Aspekt-Fenster, Title-Heavy
│   ├── pipeline.js         End-to-end Scan
│   ├── server.js           Express-API + Static-UI + Hot-Topics + Sources-Health
│   ├── logger.js           Konsolen-Logger
│   └── utils.js            URL-Normalisierung, Hash, Datumsparsing
├── web/                    Single-Page Dashboard (Vanilla HTML/CSS/JS, Light + Dark)
├── config/                 dax40 + sources + sentiment + settings (JSON)
├── tests/                  44 Tests
└── data/                   SQLite-DB (gitignored)
```

---

## Versionen

- **v0.3**: `node:sqlite` statt better-sqlite3 (keine Compilation mehr), Disambiguierung, ISIN/Ticker-Match, Title-Heavy Scoring, Konsens-Label, Hot-Topics + Sources-Health-API, Dark Mode, Tastatur-Shortcuts.
- **v0.2**: Bull/Bear-Score, Talk-Type-Klassifikation, Buzz, Trend, Konsens, Aspekt-Sentiment, gewichtetes Lexikon DE/EN.
- **v0.1**: Mood-only Pressespiegel, einfaches Polaritaets-Lexikon.

Siehe `PLAN.md` fuer naechste Iteration.

---

## Datenschutz

Alles lokal: `data/dax-pressespiegel.db` (SQLite, WAL).
Nur konfigurierte HTTPS-Feeds werden abgerufen, keine Telemetrie.

## Lizenz

MIT.
