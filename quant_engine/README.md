# Quant Engine

**Quantitatives Single-Asset Intelligence System.**

Lokal, frei, mathematisch transparent. Analysiert genau ein Finanzasset
(Aktie, ETF, Krypto, Rohstoff, Index) ueber Preise, Nachrichten, Sentiment,
politische Risiken, Momentum, Volatilitaet und Prognose-Wahrscheinlichkeiten.

- Keine kostenpflichtigen APIs.
- Keine Closed-Source-Abhaengigkeiten.
- Keine Systeme mit harten Rate-Limits.

## Architektur

```
quant_engine/
├── config/                       Konfigurations-JSONs (Quellen, Settings, Assets)
├── src/quant_engine/
│   ├── api/                      FastAPI (REST-Endpoints + Dashboard-Mount)
│   ├── data/                     Yahoo Finance, RSS, Reddit, SEC, Discovery
│   ├── nlp/                      Sentiment (VADER+Lexikon+optional FinBERT), Keywords, NER
│   ├── quant/                    Sentiment-Score, Momentum, Volatilitaet,
│   │                             Polit-Risk, Anomalien, Forecast
│   ├── alerts.py                 Smart-Alert-Engine mit Cooldown
│   ├── explain.py                Explainable-AI (template-basiert, kein LLM)
│   ├── pipeline.py               End-to-End Analyse-Pipeline
│   ├── scheduler.py              APScheduler-Jobs
│   ├── config.py                 Config-Loader (env + json)
│   ├── cache.py                  Thread-safe TTL-LRU-Cache
│   ├── db.py                     SQLite-Persistenz (WAL)
│   └── logger.py                 Strukturiertes Logging
├── web/                          statisches Dashboard (Vanilla JS + Chart.js)
├── tests/                        65 Unit-Tests (alle gruen)
├── Dockerfile, docker-compose.yml
├── requirements.txt, pyproject.toml
└── .env.example
```

## Quickstart - Lokal

```bash
cd quant_engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                      # Asset-Symbol anpassen
uvicorn quant_engine.api.app:app --reload --host 0.0.0.0 --port 8080
```

Dashboard: <http://localhost:8080>
API-Health: <http://localhost:8080/api/health>

## Quickstart - Docker

```bash
docker compose up --build
```

## Konfiguriertes Asset wechseln

Per Env (Default-Asset beim Start):

```bash
export QUANT_ASSET_SYMBOL=TSLA
export QUANT_ASSET_NAME="Tesla Inc"
```

Oder per API on-the-fly:

```bash
curl 'http://localhost:8080/api/analysis?symbol=BTC-USD'
```

## API-Endpoints (Auswahl)

| Endpoint                  | Beschreibung                                     |
| ------------------------- | ------------------------------------------------ |
| `GET  /api/health`        | Status, aktives Asset, Quellenzahl               |
| `GET  /api/assets`        | vordefinierte Assets                             |
| `GET  /api/analysis`      | voller Snapshot (gecacht 2 min)                  |
| `POST /api/analysis/refresh` | Snapshot frisch rechnen                       |
| `GET  /api/prices`        | OHLCV-Historie (Yahoo) + Live-Quote              |
| `GET  /api/sentiment`     | Sentiment-Block + Tagesserie                     |
| `GET  /api/momentum`      | Velocity, Acceleration, Trend, Spike-Detection   |
| `GET  /api/volatility`    | sigma, ATR, Beta, Clustering, Risk-Score         |
| `GET  /api/political_risk`| Score + Kategorien-Breakdown                     |
| `GET  /api/forecast`      | Wahrscheinlichkeiten (bullish/bearish/vol/panic) |
| `GET  /api/anomalies`     | Z-Score basierte Outlier                         |
| `GET  /api/alerts`        | letzte ausgeloesten Alerts                       |
| `GET  /api/explain`       | textuelle Erklaerungen (kein LLM)                |
| `GET  /api/articles`      | gespeicherte Nachrichten                         |
| `POST /api/sources/discover` | Auto-Discovery neuer RSS-Feeds                |

## Mathematische Modelle

### Gewichteter Sentiment-Score

```
WeightedSentiment_i = SourceTrust_i * MentionWeight_i
                    * RecencyFactor_i * SentimentStrength_i

Score = clamp(100 * Σ signed_W_i / Σ |W_i|, -100, +100)

RecencyFactor(h) = exp(-λ·h)        # Default λ ≈ 0.0289 → Halbwertszeit 24h
MentionWeight(m) = min(1.5, 1 + 0.15·log(1+m))
```

### Politisches Risiko

```
Risk = sum_i (Severity_i * Exposure_i * MarketSensitivity_i * Trust_i * decay)
Score = 100 * (1 - exp(-0.7 * Risk))   # weiche Saturation, 0..100
```

### Volatilitaet & Risk-Score

```
σ_daily   = std(log_returns)
σ_annual  = σ_daily * sqrt(252)
ATR_t     = (ATR_{t-1}·(N-1) + TR_t) / N         # Wilder
β         = Cov(r_a, r_b) / Var(r_b)
cluster   = corr(r²_t, r²_{t-1})                 # Vol-Cluster (GARCH-Heuristik)
RiskScore = 0.7 * min(1, σ_annual/0.6) + 0.3 * |cluster|
panic     = σ(8·(RiskScore - 0.5·sentiment_norm - 0.55))
hype      = σ(8·(RiskScore + 0.7·sentiment_norm - 0.6))
```

### Momentum

```
v_t  = mentions_t  - mentions_{t-1}
a_t  = v_t         - v_{t-1}
EMA  = α·x_t + (1-α)·EMA_{t-1}
spike = (count_t - μ_ref) / σ_ref  ≥ z_thresh
```

### Prognose-Wahrscheinlichkeiten

ARIMA(1,1,1) (mit Random-Walk-Fallback) liefert (μ, σ). Sentiment- und
Politik-Bias schlagen additiv auf μ. Wahrscheinlichkeiten dann aus
Normalverteilungs-CDF:

```
P(up)    = 1 - Φ(0; μ_adj, σ)
P(panic) = 2·(1 - Φ(σ_extreme; 0, σ_adj))
```

## Anomalie-Erkennung

- Rolling Z-Score auf Mentions, Sentiment, Renditen.
- IsolationForest fuer mehrdimensionale Outlier (Fallback: Spalten-Mahalanobis).

## Quellen

Default 20 vorkonfigurierte Quellen mit Trust-Gewichten (Reuters=1.0,
ECB/Fed=1.0, Reddit=0.35..0.5, Aggregator=0.55..0.6). Quellen mit
`per_asset: true` werden pro Asset templated. Auto-Discovery findet neue
RSS/Atom-Feeds via `<link rel=alternate>` und bekannten Pfaden.

## Tests

```bash
pytest -v
# 65 passed
```

Coverage:
- `test_sentiment_score.py` (9)  Decay, Mention-Cap, Aggregat, Clamping
- `test_momentum.py`       (8)  Series, Velocity, EMA, Trend, Spike
- `test_volatility.py`     (9)  log-returns, ATR, β, Clustering, Panic/Hype
- `test_political_risk.py` (7)  Lexikon-EN/DE, Severity, Decay, End-to-End
- `test_anomaly.py`        (6)  Z-Score, Spike/Drop, Isolation, Edge-Case σ=0
- `test_forecast.py`       (8)  Random-Walk, ARIMA-Fallback, Bias, Probas
- `test_nlp.py`            (7)  Lexikon, VADER, Keywords, NER, RAKE
- `test_alerts_and_explain.py` (4)  Trigger-Schwellen, Cooldown
- `test_db.py`             (3)  Prices/Articles/Sentiment/Metrics/Alerts
- `test_cache.py`          (4)  TTL, LRU, Clear

## Tech-Stack

```
Web         FastAPI + Uvicorn
Async HTTP  httpx
Daten       feedparser, beautifulsoup4, lxml
Quant       numpy, pandas, scipy, statsmodels, scikit-learn
NLP         vaderSentiment, eigenes Lexikon
            (optional: transformers + FinBERT, via QUANT_USE_FINBERT=1)
DB          sqlite3 (stdlib, WAL)
Scheduler   APScheduler
Tests       pytest
Frontend    HTML + CSS + Vanilla JS + Chart.js (CDN)
```

## Erlaubt / Verboten

- ✅ RSS, Atom, oeffentliche JSON-Endpoints (Yahoo, Reddit, SEC).
- ✅ Lokale ML-Modelle (VADER, optional FinBERT).
- ❌ OpenAI/Claude/Gemini-APIs.
- ❌ kostenpflichtige Boersenfeeds.
- ❌ Systeme mit niedrigen Rate-Limits.

## Datenschutz

Alles lokal. SQLite-DB liegt unter `data/quant.db`. Keine Telemetrie,
keine Cloud, keine API-Keys.

## Lizenz

MIT.
