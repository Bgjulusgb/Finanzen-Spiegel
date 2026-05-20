# Contributing

Danke, dass du zum Pressespiegel beitragen moechtest!

## Voraussetzungen

- Node.js >= 20
- Git

## Setup

```bash
git clone https://github.com/Bgjulusgb/Der-Presse-Spiegel.git
cd Der-Presse-Spiegel
npm install
cp .env.example .env
npm test
npm run ui   # Web-UI auf http://localhost:4711
```

## Workflow

1. Fork das Repository.
2. Branch: `git checkout -b feature/kurzbeschreibung` oder `fix/kurzbeschreibung`.
3. Aenderungen committen (siehe Commit-Konventionen unten).
4. Tests gruen halten: `npm test`
5. Linter durchlassen: `npm run lint`
6. PR gegen `main` oeffnen.

## Commit-Konventionen

[Conventional Commits](https://www.conventionalcommits.org/de/):

```
<type>(<scope>): <kurz>

<body optional>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`.

Beispiele:

- `feat(search): proximity boost im BM25 hinzu`
- `fix(pipeline): hang nach 4358 items vermeiden`
- `docs(readme): docker-quickstart ergaenzt`

## Code-Standards

- ESLint 9 (Flat Config), Konfiguration in `eslint.config.js`.
- Prettier mit Konfiguration in `.prettierrc.json`.
- Tests neuer Features in `tests/<modul>.test.js`.
- Keine console.log-Drops im Produktionscode (`logger` nutzen).

## Pull-Request-Checklist

- [ ] Tests gruen (`npm test`)
- [ ] Linter clean (`npm run lint`)
- [ ] CHANGELOG.md unter `[Unreleased]` ergaenzt
- [ ] README aktualisiert wenn UI/Feature
- [ ] Screenshots/GIFs bei UI-Aenderungen

## Bug Reports

Nutze das GitHub Issue-Template. Logs aus `logs/pressespiegel.log` sind hilfreich.

## Fragen

Issue oeffnen mit Label `question`.
