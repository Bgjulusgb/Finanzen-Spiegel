# Verbesserungs-Plan v0.2 — DAX 40 Pressespiegel

Stand: 2026-05-21

Ausgangslage v0.1 hatte ein einfaches polaritaets-basiertes Sentiment.
Das ist zu duenn, um zu sagen *"wie wird ueber die Aktie geredet"*.

## Ziele

1. Aus jedem Artikel **mehrere unabhaengige Signale** extrahieren statt nur ±Polaritaet.
2. Quellen-Mix robuster machen (weniger 403/404 in der Praxis).
3. UI zeigt klar: **Bullisch / Bearisch**, **Buzz**, **Talk-Type**, **Konsens vs. Streit**.
4. Aktien-Erwaehnungen sind **kontext-sensitiv** bewertet (Worte unmittelbar um die
   Aktie zaehlen mehr als Worte am Artikelende).

## Neue Signal-Dimensionen pro Artikel

| Signal           | Skala        | Interpretation                                                                 |
| ---------------- | ------------ | ------------------------------------------------------------------------------ |
| `polarity`       | -1 .. +1     | klassisch: positiv / negativ                                                   |
| `bull_score`     | -1 .. +1     | bullisch (Kaufgrund, Kursziel hoch, kaufen) vs. bearisch (Verkauf, Short, Crash) |
| `talk_type`      | enum         | `earnings`, `mna`, `legal`, `analyst`, `product`, `macro`, `scandal`, `general` |
| `intensity`      | 0 .. 1       | wie aufgeladen ist der Text (Anteil starker Wertungswoerter)                   |
| `aspect_polarity`| -1 .. +1     | Sentiment **im 12-Wort-Fenster um die Aktie**, nicht im ganzen Text            |

## Neue Aggregate pro Aktie

| Metrik           | Berechnung                                                            |
| ---------------- | --------------------------------------------------------------------- |
| `mood_100`       | gewichteter Mittelwert von `polarity` (-100..+100)                    |
| `bull_bear_100`  | gewichteter Mittelwert von `bull_score` (-100..+100)                  |
| `buzz`           | Artikelzahl relativ zum Median ueber alle 40 Aktien (1.0 = Median)    |
| `consensus`      | 1 - Streuung des Sentiments (1 = einhellig, 0 = volatil)              |
| `trend_delta`    | mood_100 letzte 3 Tage - mood_100 davor                               |
| `top_talk_type`  | haeufigster `talk_type` im Fenster                                    |

## Bull/Bear-Lexikon (DE/EN, gewichtet)

Nicht jedes Wort gleich stark. Beispiele:
- "Kursziel angehoben" = +0.8 bullisch, +0.6 polarity
- "Kaufempfehlung" = +1.0 bullisch
- "Gewinnwarnung" = -1.0 bullisch, -0.9 polarity
- "Klage" = -0.6 bullisch, -0.5 polarity
- "Rekordauftrag" = +0.8 bullisch, +0.7 polarity
- "Squeeze-Out" = +0.5 bullisch
- "Insolvenz" = -1.0 bullisch, -1.0 polarity
- "Streik" = -0.3 bullisch, -0.4 polarity

Gewichte werden additiv pro Treffer angesetzt, dann durch Trefferzahl normalisiert.

## Talk-Type-Klassifikation

Regelbasiert, Trigger-Phrasen pro Klasse:
- `earnings`: "Q1", "Q2", "Q3", "Q4", "Quartalszahlen", "Gewinn vor", "Umsatz steigt", "EPS"
- `mna`: "Uebernahme", "kauft", "Fusion", "Merger", "Tender", "Synergie"
- `legal`: "Klage", "Urteil", "Vergleich", "Geldstrafe", "Ermittlung", "Razzia"
- `analyst`: "Kursziel", "Bewertung", "Rating", "Buy/Sell/Hold", "Analyst"
- `product`: "Launch", "stellt vor", "neues Modell", "Markteinfuehrung"
- `macro`: "Leitzins", "EZB", "Fed", "Inflation", "Rezession", "Konjunktur"
- `scandal`: "Betrug", "Korruption", "Manipulation", "Skandal", "Rueckruf"
- `general`: Fallback

## Aspekt-Sentiment (Kontextfenster)

Statt nur den Artikel-Gesamttext zu scoren, suchen wir **±12 Worte um die Aktien-Erwaehnung**
und scoren dieses Fenster. Wirkt gegen Artikel, in denen 5 Aktien gemeinsam genannt werden,
aber unterschiedlich bewertet sind.

## Fetching-Verbesserungen

Aktueller Stand: viele dt. Verlage liefern HTTP 403, weil sie Bot-User-Agents blocken.

Massnahmen:
- realistischer Browser-User-Agent (Mozilla Firefox-Latest), nicht der Pseudo-Bot
- `Accept: ... ; q=...` Header voll setzen
- pro Request 1 Retry mit 1s Backoff
- mehrere alternative Feed-URLs pro Quelle (z.B. mehrere Endpoints von Handelsblatt)
- Atom + RSS + JSON-Feed alle akzeptieren
- zusaetzliche Quellen die zuverlaessig liefern:
  - Yahoo Finance RSS pro Aktie
  - DGAP / EQS Adhoc-News
  - Boersengefluester
  - Aktien.guide RSS
  - Trading-Economics-Calendar nicht relevant fuer Sentiment
  - Reddit r/MauerstrassenWetten + r/Aktien (RSS-Endpoint von Reddit)

## UI-Verbesserungen

Auf der Karte zusaetzlich:
- **2 Badges** statt 1: links MOOD, rechts BULL/BEAR
- kleine **Buzz**-Pille ("◗◗◗" / 3/3 = ueberdurchschnittlich)
- **Trend-Pfeil** ▲ / ▼ wenn `|trend_delta| > 10`
- **Talk-Type-Chip** ("Earnings", "M&A", "Legal", ...)

Im Detail-Modal:
- Sentiment-Trend ueber Zeit (kleine Sparkline)
- Verteilung Talk-Types
- "wie geredet wird"-Zusammenfassung (Top-3 Phrasen, Konsens-Indikator)

## Reihenfolge

1. ✅ Plan
2. Lexikon erweitern (DE/EN), Bull/Bear-Lexikon, Talk-Type-Trigger
3. Analyzer umbauen (Aspekt-Fenster, Bull/Bear-Score, Talk-Type)
4. DB-Schema erweitern (article: bull_score, talk_type, intensity, aspect_polarity)
5. Pipeline und Aggregate (consensus, buzz, trend_delta, top_talk_type)
6. Fetching haerten (UA, Retry, mehr Quellen)
7. Server-API um neue Felder erweitern
8. UI: Badges, Pillen, Trend-Pfeile, Talk-Chips
9. README neu schreiben
10. Tests aktualisieren + neue Tests fuer Bull/Bear, Talk-Type, Aspekt
11. End-to-End-Smoketest
12. Commit + Push
