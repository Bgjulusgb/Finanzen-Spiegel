# Development Guide

## Setup

```bash
git clone https://github.com/Bgjulusgb/Der-Presse-Spiegel.git
cd Der-Presse-Spiegel
npm install
cp .env.example .env
```

## Dev-Server

```bash
npm run ui          # Web-UI auf http://localhost:4711
npm run electron    # Desktop-App
```

## Tests

```bash
npm test                    # Alle Tests (~116)
npm run test:coverage       # Mit Coverage
node --test tests/search.test.js   # Einzelne Datei
```

## Linting & Formatting

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## Docker

```bash
docker compose up -d --build
# Logs: docker compose logs -f
# Stop: docker compose down
```

Volumes:

- `./data` (SQLite-DB)
- `./logs`
- `./reports`
- `./config`

## Neue Quelle hinzufuegen

`config/sources.json`:

```json
{
  "name": "Beispiel-Zeitung",
  "url": "https://example.com/rss",
  "priority": 75,
  "type": "rss",
  "category": "lokal-bw",
  "use_browser": false
}
```

Testen via UI ("Quellen" → "Testen") oder API:

```bash
curl -X POST http://localhost:4711/api/sources/test \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/rss","name":"Beispiel"}'
```

## Tags neu generieren

```bash
curl -X POST http://localhost:4711/api/tags/retag-all
```

## Datenbank inspizieren

```bash
sqlite3 data/pressespiegel.db
.tables
SELECT COUNT(*) FROM articles;
SELECT source, COUNT(*) FROM articles GROUP BY source ORDER BY 2 DESC;
```

## Logs

- Live im UI: Tab "Logs"
- Datei: `logs/pressespiegel.log`
- Format: JSON-Zeilen (Winston)

## Builds

```bash
npm run build:linux   # AppImage + .deb
npm run build:win     # NSIS-Installer + portable
npm run build:mac     # .dmg + .zip (x64 + arm64)
```

Output: `dist/`.

## Troubleshooting

| Symptom                            | Loesung                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `JSON.parse` Fehler beim Start     | `config/sources.json` validieren mit `node -e "JSON.parse(require('fs').readFileSync('config/sources.json','utf8'))"` |
| Scan haengt bei "Anreicherung ..." | `scraping.max_articles_per_scan` reduzieren oder Concurrency erhoehen                                                 |
| `ECONNREFUSED` bei einer Quelle    | Quelle deaktivieren oder `use_browser: true` setzen                                                                   |
| Encoding-Probleme                  | `iconv-lite`-Detection in `feed-fetcher.js` pruefen                                                                   |
| Tests schlagen mit DB-Sperre fehl  | `rm -rf data/test-*.db`                                                                                               |
| Electron startet nicht nach Update | `npm rebuild`                                                                                                         |
