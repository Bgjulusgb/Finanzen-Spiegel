# Verbesserungs-Plan v0.3 — DAX 40 Pressespiegel

Stand: 2026-05-21

Treiber dieser Iteration:
1. Windows-Install scheiterte an `better-sqlite3` (braucht MSVC-Compilation).
2. Dependencies sollten auf die neuesten Versionen.
3. Suche / Bewertung / Filterung / Auswertung im Detail verbessern.

## 1. Plattform / Setup auf neuesten Stand

### Zero-Native-Compilation

Statt `better-sqlite3` jetzt `node:sqlite` (in Node selbst eingebaut, seit
v22.5 als `--experimental-sqlite`, stabil ab v24). Vorteile:
- keine MSVC / node-gyp / Python-Build-Tools mehr noetig
- Installation per `npm install` ist sekundenschnell
- gleiche synchron-API wie better-sqlite3, kleine Anpassungen noetig
- groesste SQLite-Pflege schon im Node-Core (Updates automatisch)

### Dependencies geupdated

| Paket        | alt        | neu     | Grund                                       |
| ------------ | ---------- | ------- | ------------------------------------------- |
| better-sqlite3 | 11.7    | **entfernt** | durch node:sqlite ersetzt              |
| express      | 4.21       | 5.x     | aktuelle Major; unsere API ist v5-kompatibel |
| undici       | 7.2        | 7.x neueste | HTTP-Client                              |
| rss-parser   | 3.13       | 3.13.x neueste | wenig Bewegung                          |
| cheerio      | 1.0        | 1.x neueste | Article-Parsing                            |

### engines.node

`>=22.5.0`. Vorher war `>=20`, aber `node:sqlite` braucht Node 22.5+.

---

## 2. Suche verbessern

### Mehr-Aktien-Disambiguierung
Porsche AG (P911.DE) vs. Porsche SE (PAH3.DE), Mercedes-Benz Group (MBG.DE)
vs. Daimler Truck (DTG.DE): wenn beide matchen wuerden, gewinnt der
laengste Treffer pro Position; Kollisionen werden nicht doppelt gezaehlt.

### Mehrwort-Phrasen prioritaer
"Munich Re" muss zuerst probiert werden, bevor "Hannover Rueck" oder andere
Substring-Matches greifen. Lexikon ist schon laengsten-zuerst sortiert,
Stock-Matcher auch (siehe `compileStockMatchers`).

### Ticker- und ISIN-Erkennung
Wenn ein Artikel `DE0007164600` oder `SAP.DE` direkt nennt, ist das ein
sehr starkes Signal. Wir matchen zusaetzlich ISIN/Ticker exakt
(case-sensitive), und geben dem Treffer einen Mention-Boost.

### Stoppen bei Negativ-Aktien-Worten
Falls "Mercedes Sosa" (Saengerin) genannt wird, sollte das nicht als
Mercedes-Benz zaehlen. Pro Aktie eine optionale `negative_terms`-Liste.

### Snippet-Erweiterung
Aktuell wird nur `<title> + <summary>` der RSS-Items gescannt. Bei vielen
Feeds ist `summary` leer / kuerzer. Optional: bei einem schwachen Treffer
(kein Title-Hit, niedriger Aspekt-Sentiment-Bias) eine zweite Anfrage auf
den Artikel-Body holen und mitscoren. Standard-Aus, per Setting aktivierbar.

---

## 3. Bewertung verbessern

### Title-Heavy Scoring
Headlines sind verdichteter und repraesentativer als Snippets. Aktuell
title_hit gibt nur +0.2 zur Gewichtung. Neu: separater
`title_polarity` + `title_bull` Score (Sentiment NUR im Titel berechnen),
gemittelt mit dem Body-Sentiment im Verhaeltnis 0.7 : 0.3.

### Quellen-Trust adaptiv
Statt fixem `source.trust` aus der Config: pro Quelle die durchschnittliche
Konsistenz-Quote berechnen (wie oft stimmt Sentiment dieser Quelle mit
3-Tages-Median ueberein?). Bei systematischer Abweichung trust-Faktor
abdaempfen. **P2.**

### Zeitabklang
Aeltere Artikel im Fenster zaehlen weniger. Half-life 24h (in
`settings.json` schon vorgesehen, aber noch nicht angewandt). Pro Artikel
ein `recency_weight = 0.5 ^ (age_hours / half_life)`.

### Reichweite / Cross-Quellen-Bestaetigung
Wenn dieselbe Nachricht in 5 Quellen auftaucht, sollte das mehr zaehlen als
1 Quelle, die 5 Variationen aussendet. Mini-Cluster-Bildung ueber
Title-Shingles (Jaccard 0.6), Cluster-Score = max(weight) statt sum.
**P1 fuer naechste Iteration.**

---

## 4. Filterung & Auswertung verbessern

### Talk-Type-Filter im API
`/api/overview?days=7&talk=earnings` filtert auf der API-Ebene.
Eingebaut, damit UI-Filter auch Server-side zaehlt.

### Sektor- und Sprach-Filter
`/api/overview?sector=auto`, `?lang=de`. Erlaubt Drill-Down auf
DAX-Sektoren oder nur deutsche Quellen.

### Konsens-Klassifikation expliziter
Neben Score `consensus`: ein Klartext-Label `consensus_label`:
- `>=0.85` &rarr; "einhellig"
- `>=0.65` &rarr; "eher einig"
- `>=0.45` &rarr; "gemischt"
- `<0.45` &rarr; "geteilt"

### "Hot Topics" — Cross-Aktien-Themen
Welche Talk-Types dominieren *insgesamt* gerade? Endpoint
`/api/topics?days=7` aggregiert: "earnings (+24%) zieht aktuell viel
Aufmerksamkeit", "legal (-12%) ruhig".

### Quellen-Health
`/api/sources/health?days=7`: pro Quelle die Erfolgs-Quote der letzten
Scans + durchschnittliche Item-Zahl. Hilft zu sehen welche Feeds
zuverlaessig liefern.

### Watchlist-Compare
2-3 Aktien direkt vergleichen (Sparklines uebereinander, Stats
nebeneinander). UI-only.

---

## 5. UI-Verbesserungen

- **Dark Mode** Toggle im Header
- Pro Karte: kleine 7-Tage-Sparkline rechts unten
- Heatmap-View: 40 Aktien als Tile-Grid, Farbe = mood_100
- Quellen-Pille im Article-Item klickbar &rarr; Filter auf nur diese Quelle
- Tastatur-Shortcuts: `/` fokussiert Suche, `r` reload, `s` scan

---

## 6. Tests

- Stock-Matcher: Disambiguierungs-Tests (Porsche AG vs. Porsche SE, Mercedes-Benz vs. Mercedes Sosa)
- ISIN-Matching
- Title-Scoring vs. Body-Scoring
- node:sqlite-Migration-Test funktioniert

---

## Reihenfolge

1. `node:sqlite` Migration in database.js
2. package.json updaten (Dependencies, engines, scripts mit Flag fuer Node 22.x)
3. Test-Datei anpassen (better-sqlite3 raus)
4. Disambiguierung im Stock-Matcher
5. ISIN/Ticker-Match
6. Title-Polarity-Boost
7. Konsens-Label
8. Talk-Filter im API + Hot-Topics-Endpoint
9. UI: Dark Mode, Sparkline auf Karte, Konsens-Label
10. README mit Setup-Hinweisen fuer Windows
11. Tests komplett gruen
12. Commit + Push
