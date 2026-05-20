# Pressespiegel Muenchner Kammerspiele

Lokales Desktop-Tool fuer die automatische Beobachtung der deutschsprachigen
Presse rund um die Muenchner Kammerspiele. Saemtliche Daten und Reports
bleiben auf dem eigenen Rechner.

- 80 vorkonfigurierte Quellen aus oeffentlich-rechtlichem Rundfunk,
  ueberregionalen Tageszeitungen, regionalen Lokalblaettern,
  Theater-Fachpresse, internationalen Quellen, Wirtschaft, Aggregatoren
- Universelle Pflicht-Backbone via Google News und Bing News
- Hybride Volltextsuche aus BM25, Fuse-Fuzzy und Synonym-Expansion
- Boolesche Suchsyntax mit Phrasen, Feld-, Datums-, Score- und Tag-Filtern
- Auto-Tagging in 8 Kategorien (Produktion, Person, Venue, Ereignis, Thema,
  Tonalitaet, Relevanz, Form)
- Lesezeichen, gespeicherte Suchen, CSV- und JSON-Export, OPML-Import/Export
- Webserver mit REST-API und WebSocket, Electron-Desktop-App,
  packbar als .exe, .dmg, .AppImage, .deb

## Schnellstart

**Voraussetzung: Node.js 24 LTS** (oder neuer). Aeltere Versionen werden
nicht mehr unterstuetzt. Download: https://nodejs.org/de/download/

```
git clone <repo>
cd Der-Presse-Spiegel
npm install
npm run ui          # oeffnet http://localhost:4711 im Browser
```

### Diagnose

Bei Problemen zuerst die Diagnose laufen lassen — sie prueft Node-Version,
JSON-Configs und native Module:

```
npm run doctor
```

### Troubleshooting: `Could not locate the bindings file` / better-sqlite3

Tritt der Fehler _"Could not locate the bindings file"_ oder
_"better_sqlite3.node"_ auf (haeufig nach Download als ZIP oder bei
Versions-Wechsel), gibt es drei Loesungen:

**Loesung 1 — Neuinstallation (am schnellsten):**

```
npm run fix-sqlite:clean
```

Dieser Befehl loescht `node_modules` + `package-lock.json` und installiert
alles frisch. Funktioniert, sobald die Node-Version stimmt und Netzwerk-
Zugriff fuer den Prebuild-Download da ist.

Manuell:

```
# Windows (cmd):
rmdir /s /q node_modules
del package-lock.json
npm install

# macOS / Linux:
rm -rf node_modules package-lock.json
npm install
```

**Loesung 2 — Build aus Quellcode:**

```
npm run fix-sqlite
```

Voraussetzungen:

- **Windows:** [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  mit Workload _"Desktop development with C++"_ und [Python 3.x](https://www.python.org/downloads/).
  Danach: `npm config set msvs_version 2022`
- **macOS:** `xcode-select --install`
- **Linux:** `sudo apt install build-essential python3` (oder Aequivalent)

**Loesung 3 — Node-Version pruefen:**

`better-sqlite3` liefert vorgebaute Binaries fuer Node 20, 22 und 24 (x64).
Sehr neue Node-Versionen (26+) oder ARM-Windows haben evtl. keine Prebuilds.
Empfehlung: **Node 22 LTS** von https://nodejs.org/de/download/.

Nach Behebung: `npm run doctor` sollte alle Pruefungen gruen anzeigen.

Desktop-App:

```
npm run electron    # Electron-Fenster
npm run build:win   # Windows-Installer + Portable in dist/
npm run build:linux # AppImage + deb
npm run build:mac   # dmg + zip
```

## Bedienoberflaeche

Die Web-/Desktop-UI hat zwoelf Tabs:

| Tab           | Funktion                                             |
| ------------- | ---------------------------------------------------- |
| Dashboard     | Live-Uebersicht, Sentiment, Top-Quellen, Top-Artikel |
| Artikel       | Volltextsuche, Filter, Sortierung, Detail-Modal      |
| Scan          | RSS-Abruf starten, Live-Log, Feed-Gesundheit         |
| Reports       | HTML- und PDF-Reports erzeugen, oeffnen, loeschen    |
| Tags          | Auto-Tags nach Kategorien, klickbar fuer Filter      |
| Suchbegriffe  | Spielplan, Ensemble, Exclude-Liste live bearbeiten   |
| Quellen       | Feeds verwalten, einzeln testen, an/aus              |
| Lesezeichen   | Markierte Artikel                                    |
| Trends        | Wort-Wolke, Aufsteiger, Tag-Wolke                    |
| Duplikate     | Pruefung der letzten 90 Tage                         |
| Einstellungen | Scraping, Dedup, Schedule                            |
| Logs          | letzte 200 Eintraege                                 |

## Such-Algorithmus

Die Suche kombiniert mehrere Stufen:

1. **Strukturierte Filter**: Phrasen, Bool-Operatoren, Feldsuche
2. **BM25** (Term-Frequency, IDF, Stemmer, Stopwortfilter, Field-Boosts,
   Time-Decay, **Bigram-Bonus** fuer adjacente Term-Reihenfolge)
3. **Phonetik** (Koelner Verfahren) als Fallback fuer fehlende Treffer
4. **Fuse.js** mit Bitap/Levenshtein-Distance fuer Tippfehler
5. **Synonym-Expansion** ueber `config/synonyms.json`
6. **Did-you-mean** mit Levenshtein-Distanz 3
7. **Proximity-Boost** wenn Query-Terme nah beieinander stehen

Die finale Reihenfolge ergibt sich aus BM25 + Fuzzy (konfigurierbare
Gewichtung), plus Boni fuer Phrasen-Treffer im Titel und hochpriorisierte
Quellen.

### Konfiguration

Alle Parameter sind in `config/settings.json` unter `"search"` konfigurierbar:

- `bm25`: k1, b, title_boost, summary_boost, body_boost,
  recency_half_life_days, recency_mode (exponential|linear|none),
  with_compound_split, with_phonetic, with_positions, with_bigrams,
  bigram_boost, phrase_title_bonus
- `fuse`: threshold, distance, min_match_chars, weights (title/summary/source/…)
- `hybrid`: bm25*weight, fuse_weight, default_limit, source_boost*\*
- `cache`: max_entries, ttl_ms, tokenize_cache_max
- `suggestions`: max_results, min_prefix_length
- `did_you_mean`: min_query_length, max_distance
- `tokenizer`: min_token_length, min_phonetic_length, proximity_max_window
- `stopwords`: disable_defaults, custom (eigene Stopwords-Liste)

### Suchsyntax

```
Kammerspiele                       Standardsuche (BM25 + Fuzzy + Synonyme)
"Wokey Wokey"                      exakte Phrase
+Premiere                          erzwungenes muss vorkommen
Hamlet -Hamburger                  NICHT-Operator (auch: NOT/NICHT)
Wallenstein OR Mephisto            ODER (auch: ODER)
title:Premiere                     Feldsuche (Alias: t:)
title:"Münchner Kammerspiele"      Feld mit Phrase
source:nachtkritik                 Quelle (Alias: src:, s:, site:)
author:Tholl                       Autor (Alias: a:)
text:dramaturgisch                 Volltext
category:sehr_relevant             Relevanzkategorie (Alias: cat:)
sentiment:negativ                  Stimmung (Alias: sent:)
type:review                        Artikeltyp
tag:produktion:wallenstein         Tag-Filter
score:>=80                         Relevanz-Score-Bedingung (>=, >, <=, <, =)
words:>500                         Wortanzahl
reading:<=5                        Lesezeit in Minuten
lang:de                            Sprache (Alias: language:)
image:yes                          Mit Bild (auch: has:image)
after:2026-01-01                   Veroeffentlichungsdatum ab (Alias: datum:)
before:2026-12-31                  bis (Alias: bis:)
bookmark:yes                       nur Lesezeichen (auch: has:bookmark)
paywall:no                         Paywall-Filter (has:paywall = nur mit)
has:image                          Shortcut fuer image:yes
has:paywall                        Shortcut fuer paywall:yes
has:bookmark                       Shortcut fuer bookmark:yes
```

Beliebig kombinierbar, zum Beispiel:

```
"Wokey Wokey" sentiment:positiv after:2026-01-01 source:nachtkritik
+Premiere -Hamburger tag:produktion:wallenstein score:>50
has:image lang:de site:nachtkritik words:>=400
```

## Quellen-Inventar

80 vorkonfigurierte Feeds:

- **Aggregatoren**: Google News, Bing News (mit jeweils mehreren Queries)
- **Theater-Fachpresse**: nachtkritik.de
- **Oeffentlich-rechtlich**: tagesschau, BR24, Deutschlandfunk Kultur,
  Deutschlandfunk, 3sat Kulturzeit, ARD Mediathek, Deutsche Welle
- **Ueberregional**: SZ Topthemen/Kultur/Muenchen, ZEIT, FAZ Feuilleton,
  WELT, DER SPIEGEL, Spiegel Kultur, stern, taz, Handelsblatt, FOCUS,
  n-tv, t-online, NZZ Feuilleton, Der Standard Kultur
- **Muenchen**: Merkur, Abendzeitung, tz, MunichNOW, The Munich Eye
- **Bayern**: Main-Post, Augsburger Allgemeine, MUH
- **Berlin**: Tagesspiegel, Berliner Zeitung, Berliner Morgenpost
- **NRW**: Rheinische Post, Koelner Stadt-Anzeiger, Aachener Zeitung,
  Ruhr Nachrichten, Muenstersche Zeitung
- **Norddeutschland**: Hannoversche Allgemeine, Kieler Nachrichten,
  Luebecker Nachrichten, Ostsee-Zeitung, Braunschweiger Zeitung
- **Hamburg**: Morgenpost, Abendblatt
- **Baden-Wuerttemberg**: Stuttgarter Nachrichten, Stuttgart Journal,
  Badische Zeitung, Pforzheimer Zeitung
- **Ostdeutschland**: Leipziger Volkszeitung, Freie Presse, Saechsische Zeitung
- **Rheinland-Pfalz, Hessen**: Rheinpfalz, GA Bonn, Oberhessische Presse
- **Perspektiven**: neues deutschland, JUNGE FREIHEIT, junge Welt
- **International**: euronews, Reuters, The Local
- **Government**: deutschland.de, Bundesregierung

Quellen lassen sich in der UI einzeln testen, deaktivieren und ueber OPML
importieren oder exportieren.

## Fetcher

Robuste Multi-Layer-Pipeline:

- **HTTP-Client undici** mit HTTP/2 und nativen Streams
- Fuenf rotierende **User-Agents** (Firefox, Chrome, Safari)
- Vollstaendige Browser-Header inkl. Sec-Fetch-\*, Accept-Encoding
- **Auto-Encoding** via Content-Type, BOM, XML-Decl, Meta-Charset
- **Conditional GET** mit ETag und Last-Modified pro Feed
- **Multi-Format-Parser**: RSS 2.0, Atom, RDF (RSS 1.0), JSON Feed
- **HTML-Entity-Decoding** und HTML-Strip aller Feed-Items
- **Puppeteer-Fallback** fuer Cloudflare-geschuetzte Sites
- **Retry mit exponentiellem Backoff** (3 Versuche, 2s/4s/8s)
- **Rate-Limit pro Domain** (Default 1 Request/Sekunde)
- **Brotli/Gzip/Deflate** Dekompression
- **Auto-Disable** von Quellen nach acht Fehlern in Folge

Pro Artikel: `@mozilla/readability` (gleiche Engine wie Firefox-Lesemodus)
fuer saubere Volltext-Extraktion, Score-basierte Article-Body-Erkennung
als Fallback. Datum aus Meta-Tags, JSON-LD inkl. `@graph`, time-Element,
URL-Pattern, Text-Heuristik.

## Auto-Tagging

Tags werden waehrend des Scans automatisch vergeben. Konfigurierbar in
`config/tags.json` mit Pattern- und Bedingungs-Regeln.

Kategorien:

- **produktion**: Wallenstein, Pinocchio, Mephisto, Wokey Wokey, Eurydike
  und Orpheus, Tristan und Isolde, Was ihr wollt, Mein kleines Prachttier,
  Love me tender, Enjoy Schatz, Meister und Margarita, Fraeulein Else,
  Fremd, Bevor ich es vergesse, Play Auerbach, Very Rich Angels,
  Wachse oder weiche
- **person**: Mundel, Veldhoen, Hasselberg, Puls, Hess, Koch, Schmauser,
  Paulmann, Wilke, Woellisch, Merki, Telgenkaemper, Kuljic, Tsang,
  Abdel-Maksoud, Brucker, Smolar, Boehm, Schafroth, Kohm, Lilienthal,
  Held, Halmer
- **venue**: Schauspielhaus, Werkraum, Therese-Giehse-Halle, Habibi Kiosk,
  Maximilianstrasse
- **ereignis**: premiere, gastspiel, theatertreffen, spielzeit-start,
  auszeichnung, nachruf, debatte, finanzen, personalie
- **form**: kritik, interview, portraet, reportage, essay, meldung
- **thema**: politisch, queer, klima, migration, digital, inklusion,
  klassiker, musik
- **tonalitaet**: positiv, negativ, neutral (basiert auf Sentiment)
- **relevanz**: top, hoch (basiert auf Relevanz-Score)

## Duplikat-Erkennung

Dreistufig:

1. URL-Vergleich nach Entfernung aller Tracking-Parameter
2. Titel-Levenshtein-Aehnlichkeit groesser 85 Prozent
3. Text-Cosine-Aehnlichkeit auf erstem Absatz groesser 80 Prozent

Sieger nach Quellen-Prioritaet, Verlierer als Duplikat markiert mit
"auch erschienen in"-Liste.

## CLI-Befehle

```
pressespiegel ui                                GUI im Browser
pressespiegel electron                          Desktop-App

pressespiegel scan --last 7d                    Scan ueber Zeitraum
pressespiegel scan --from 2026-01-01 --to 2026-01-31

pressespiegel report --last 30d --open          HTML-Report + Browser
pressespiegel report --last 7d --format pdf     PDF
pressespiegel report --last 7d --format both    beides

pressespiegel open                              neuesten Report oeffnen
pressespiegel list-reports                      alle Reports

pressespiegel search "Pinocchio"                lokale DB-Suche
pressespiegel stats --last 30d                  Statistiken
pressespiegel health                            Feed-Gesundheit

pressespiegel test-feed <url>                   einzelnen Feed testen
pressespiegel test-all-feeds                    alle Feeds pruefen
pressespiegel dedupe --dry-run                  Duplikate suchen

pressespiegel config list                       Konfiguration
pressespiegel config add-keyword "..." --type productions
pressespiegel config add-source "..." --priority 80

pressespiegel schedule                          Cron-Modus
```

## REST-API

| Endpoint                  | Methode         | Beschreibung                   |
| ------------------------- | --------------- | ------------------------------ |
| /api/health               | GET             | Status                         |
| /api/articles             | GET             | gefilterte/durchsuchte Artikel |
| /api/article/:id          | GET             | Detail-Daten eines Artikels    |
| /api/article/:id/tags     | GET/POST/DELETE | Tags pro Artikel               |
| /api/article/:id/bookmark | POST/DELETE     | Lesezeichen                    |
| /api/stats                | GET             | Statistiken                    |
| /api/scan                 | POST            | Scan starten                   |
| /api/scan/status          | GET             | aktueller Scan-Status          |
| /api/report               | POST            | Report generieren              |
| /api/reports              | GET             | Liste aller Reports            |
| /api/reports/:filename    | GET/DELETE      | Report oeffnen/loeschen        |
| /api/sources              | GET/PUT         | Quellen-Verwaltung             |
| /api/sources/test         | POST            | einzelnen Feed live testen     |
| /api/sources/toggle       | POST            | Quelle aktivieren/deaktivieren |
| /api/sources/opml         | GET             | OPML-Export aller Feeds        |
| /api/sources/opml-import  | POST            | OPML-Import                    |
| /api/keywords             | GET/PUT         | Suchbegriffe                   |
| /api/settings             | GET/PUT         | Einstellungen                  |
| /api/tags                 | GET             | alle Tags mit Counts           |
| /api/tags/retag-all       | POST            | gesamte DB neu taggen          |
| /api/bookmarks            | GET             | Lesezeichen-Liste              |
| /api/saved-searches       | GET/POST/DELETE | gespeicherte Suchen            |
| /api/mentions             | GET             | Top-Begriffe                   |
| /api/trends               | GET             | Vergleich zweier Zeitraeume    |
| /api/did-you-mean         | GET             | Tippfehler-Korrektur           |
| /api/suggest              | GET             | Autocomplete-Vorschlaege       |
| /api/duplicates/check     | GET             | Duplikat-Pruefung              |
| /api/export               | GET             | CSV oder JSON Export           |
| /api/logs                 | GET             | letzte Log-Eintraege           |

## Tech-Stack

```
HTTP-Client       undici 8.x (HTTP/2)
Encoding          iconv-lite 0.7
XML/HTML          xml2js 0.6, cheerio 1.2, he 1.2
Browser           puppeteer 25.x (Fallback)
Readability       @mozilla/readability 0.6
Datenbank         better-sqlite3 12.x (WAL)
Suche             fuse.js 7.x, natural 8.x (Porter-Stemmer-DE),
                  js-levenshtein 1.x
Datum             date-fns 4.x
Server            express 5.x
WebSocket         ws 8.x
Scheduler         node-cron 4.x
Logging           winston 3.x
CLI               commander 14.x
Concurrency       p-limit 3.x
Desktop           electron 42.x
Build             electron-builder 26.x
Tests             Node built-in test-runner
```

## Projekt-Struktur

```
.
├── bin/cli.js                CLI-Einstiegspunkt
├── electron/
│   ├── main.js               Electron-Main
│   └── preload.js            Sandbox-Bridge
├── web/
│   ├── index.html            Single-Page-App
│   ├── styles.css            Design-System
│   └── app.js                UI-Logik + WebSocket
├── src/
│   ├── analyzer.js           Relevanz, Sentiment, Artikeltyp
│   ├── config.js             JSON + .env laden (dotenv-quiet)
│   ├── database.js           SQLite, Schema, Tags, Bookmarks
│   ├── deduplicator.js       Multi-Stufen-Dedup
│   ├── feed-fetcher.js       undici-basierter Fetch + Parser
│   ├── logger.js             Winston
│   ├── news-search.js        Google News + Bing News Connectors
│   ├── pipeline.js           Scan-Pipeline
│   ├── puppeteer-fetcher.js  Browser-Fallback
│   ├── query-parser.js       Bool-Operatoren + Felder + Filter
│   ├── reporter.js           HTML + PDF Reports
│   ├── scheduler.js          Cron-Jobs
│   ├── scraper.js            Artikel-Extraktion + Readability
│   ├── search.js             BM25 + Fuse-Hybrid + Trends
│   ├── server.js             Express + WebSocket
│   ├── tagger.js             Auto-Tagging-Engine
│   └── utils.js              URL, Date, Cosine, Levenshtein
├── config/
│   ├── sources.json          80 Feeds
│   ├── keywords.json         Spielplan, Ensemble, Exclude
│   ├── settings.json         Scraping, Dedup, Schedule
│   ├── sentiment.json        Theater-Wortbuch
│   ├── synonyms.json         Synonym-Gruppen
│   └── tags.json             Auto-Tag-Regeln
├── tests/                    114 Unit-/Integration-Tests
├── data/                     SQLite-DB (lokal)
├── logs/                     Log-Dateien (lokal)
├── reports/                  HTML/PDF-Reports (lokal)
└── package.json
```

## Tests

```
npm test
```

114 Tests, alle gruen. Coverage:

- utils.test.js URL-Normalisierung, Levenshtein, Cosine, Datum
- analyzer.test.js Relevanz-Scoring, Sentiment, Negationen, Kontext
- deduplicator.test.js Dreistufige Dedup, Sieger-Auswahl
- scraper.test.js Datums-Extraktion aus Meta/JSON-LD/URL/Text
- search.test.js BM25, Fuse-Hybrid, Stemming, did-you-mean,
  Trends, Recency-Boost
- query-parser.test.js Phrasen, Bool, Felder, Score/Date/Tag-Filter
- tagger.test.js Auto-Tagging mit Bedingungen
- feed-fetcher.test.js RSS/Atom/RDF/JSON, Encoding-Detection

## Edge Cases

- Cloudflare/Bot-Block Puppeteer-Fallback (use_browser-Flag)
- Paywall erkannt und markiert, RSS-Snippet bleibt
- Kein Datum Multi-Stage-Detection
- Falsches Encoding Auto-Detection plus iconv-lite
- RSS-Feed down source_health-Eintrag, andere Feeds laufen
- Tracking-Parameter vor URL-Vergleich entfernt
- Schwester-Theater Hamburger/Berliner/Wiener via Exclude
- Tippfehler in Suche Fuse-Hybrid plus did-you-mean
- HTML-Entities in Titeln he-Decoder
- 304 Not Modified korrekt erkannt
- Wiederholte Feed-Fehler Auto-Disable nach 8 Fails

## Datenschutz

Alle Daten bleiben lokal:

- SQLite-DB in `data/`
- Reports in `reports/`
- Logs in `logs/`
- Konfiguration in `config/`

Keine Cloud, keine API-Keys, kein E-Mail-Versand. Lediglich die
konfigurierten RSS-Feeds werden ueber HTTPS abgerufen.

## Lizenz

MIT
