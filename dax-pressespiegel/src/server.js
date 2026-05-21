'use strict';

const path = require('path');
const express = require('express');
const { settings, dax } = require('./config');
const db = require('./database');
const { runScan } = require('./pipeline');
const logger = require('./logger');

function isoSinceDays(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function emptyEntry(s) {
  return {
    ...s,
    n_articles: 0, n_positive: 0, n_neutral: 0, n_negative: 0,
    n_bull: 0, n_neutral_bull: 0, n_bear: 0,
    mood: 0, mood_100: 0, bull: 0, bull_100: 0,
    intensity: 0, consensus: 1, buzz: 0,
    top_talk_type: null, talk_distribution: {},
    last_seen: null, top_articles: [],
    trend_delta: 0, mood_prev_100: null,
  };
}

function buildOverview(database, windowDays = settings.ui.default_window_days) {
  const sinceIso = isoSinceDays(windowDays);
  const ov = db.stockOverview(database, sinceIso, null, settings.ui.max_articles_per_card);

  // Trend-Delta: aktuelles Drittel vs. vorheriges Drittel des Fensters.
  const splitDays = Math.max(1, Math.floor(windowDays / 2));
  const splitIso = isoSinceDays(splitDays);
  const ovPrev = db.stockOverview(database, isoSinceDays(windowDays), splitIso, 0);
  const ovNow  = db.stockOverview(database, splitIso, null, 0);

  const stocks = dax.map((s) => {
    const o = ov.get(s.symbol);
    if (!o) return emptyEntry(s);
    const now = ovNow.get(s.symbol);
    const prev = ovPrev.get(s.symbol);
    const trendDelta = ((now?.mood_100 ?? null) !== null && (prev?.mood_100 ?? null) !== null)
      ? (now.mood_100 - prev.mood_100)
      : 0;
    return {
      ...s, ...o,
      trend_delta: Math.round(trendDelta * 10) / 10,
      mood_prev_100: prev ? prev.mood_100 : null,
    };
  });

  stocks.sort((a, b) => b.n_articles - a.n_articles || b.mood_100 - a.mood_100);
  return { window_days: windowDays, since_utc: sinceIso, stocks };
}

function buildApp(database, scanState) {
  const app = express();
  app.use(express.json());

  const WEB = path.resolve(__dirname, '..', 'web');
  app.use('/static', express.static(WEB));
  app.get('/', (_req, res) => res.sendFile(path.join(WEB, 'index.html')));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', stocks: dax.length, scan: scanState });
  });

  app.get('/api/overview', (req, res) => {
    const days = Math.max(1, Math.min(60, parseInt(req.query.days, 10) || settings.ui.default_window_days));
    const result = buildOverview(database, days);
    // optionale Server-Filter
    const { talk, sector, lang } = req.query;
    if (talk)   result.stocks = result.stocks.filter((s) => s.top_talk_type === talk);
    if (sector) result.stocks = result.stocks.filter((s) => s.sector === sector);
    if (lang) {
      // schwacher Filter: lang gilt fuer die Quelle, nicht direkt fuer Aktie -
      // wir filtern Karten weg, deren top_articles alle anderssprachig sind.
      result.stocks = result.stocks.filter((s) =>
        !s.top_articles?.length || s.top_articles.some((a) => a.lang === lang)
      );
    }
    res.json(result);
  });

  // Hot Topics: aggregierte Talk-Type-Verteilung ueber alle 40 Aktien.
  app.get('/api/topics', (req, res) => {
    const days = Math.max(1, Math.min(60, parseInt(req.query.days, 10) || settings.ui.default_window_days));
    const sinceIso = isoSinceDays(days);
    const halfIso = isoSinceDays(Math.floor(days / 2));
    const all  = db.stockOverview(database, sinceIso, null, 0);
    const now  = db.stockOverview(database, halfIso, null, 0);
    const prev = db.stockOverview(database, sinceIso, halfIso, 0);
    function agg(map) {
      const out = {};
      for (const a of map.values()) {
        for (const [t, n] of Object.entries(a.talk_distribution || {})) {
          out[t] = (out[t] || 0) + n;
        }
      }
      return out;
    }
    const totalAll = agg(all);
    const totalNow = agg(now);
    const totalPrev = agg(prev);
    const topics = Object.entries(totalAll).map(([t, n]) => {
      const a = totalNow[t] || 0;
      const b = totalPrev[t] || 0;
      const denom = (a + b) / 2 || 1;
      const change_pct = ((a - b) / denom) * 100;
      return { talk_type: t, n, n_recent: a, n_prev: b, change_pct: Math.round(change_pct * 10) / 10 };
    }).sort((a, b) => b.n - a.n);
    res.json({ window_days: days, topics });
  });

  // Quellen-Health: Erfolgs-Quote der letzten Scans (aus log-Feld pars'd nicht moeglich -
  // wir aggregieren stattdessen pro Quelle die Anzahl Artikel und juengsten Eintrag).
  app.get('/api/sources/health', (req, res) => {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days, 10) || 7));
    const sinceIso = isoSinceDays(days);
    const rows = database.prepare(`
      SELECT source_id, source_name, source_trust,
             COUNT(*) AS n_articles,
             MAX(fetched_utc) AS last_fetch,
             AVG(polarity) AS avg_polarity,
             AVG(bull_score) AS avg_bull
        FROM articles
       WHERE COALESCE(published_utc, fetched_utc) >= ?
       GROUP BY source_id
       ORDER BY n_articles DESC
    `).all(sinceIso);
    res.json({ window_days: days, sources: rows });
  });

  app.get('/api/stock/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    const stock = dax.find((s) => s.symbol === symbol);
    if (!stock) return res.status(404).json({ error: 'unknown symbol' });
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || settings.ui.default_window_days));
    const sinceIso = isoSinceDays(days);
    const articles = db.articlesForStock(database, symbol, sinceIso, 300);
    const overview = db.stockOverview(database, sinceIso, null, settings.ui.max_articles_per_card);
    const series = db.dailySentimentSeries(database, symbol, sinceIso);
    const agg = overview.get(symbol) || {
      n_articles: 0, n_positive: 0, n_neutral: 0, n_negative: 0,
      n_bull: 0, n_neutral_bull: 0, n_bear: 0,
      mood: 0, mood_100: 0, bull: 0, bull_100: 0,
      intensity: 0, consensus: 1, buzz: 0,
      top_talk_type: null, talk_distribution: {},
      last_seen: null, top_articles: [],
    };
    res.json({ stock, window_days: days, ...agg, articles, series });
  });

  app.get('/api/scans', (_req, res) => {
    res.json({ scans: db.recentScans(database, 20) });
  });

  app.get('/api/dax40', (_req, res) => res.json({ stocks: dax }));

  app.post('/api/scan', async (_req, res) => {
    if (scanState.running) return res.status(409).json({ error: 'scan already running' });
    scanState.running = true;
    scanState.started_at = new Date().toISOString();
    res.json({ status: 'started', started_at: scanState.started_at });
    try {
      const result = await runScan(database);
      scanState.last_result = result;
    } catch (err) {
      logger.error('scan failed:', err.message);
      scanState.last_error = err.message;
    } finally {
      scanState.running = false;
      scanState.finished_at = new Date().toISOString();
    }
  });

  return app;
}

async function start({ port = settings.server.port, host = settings.server.host } = {}) {
  const database = db.open(settings.database.path);
  const scanState = { running: false };
  const app = buildApp(database, scanState);
  const server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });
  logger.info(`UI bereit auf http://${host}:${port}/`);

  if (settings.schedule.auto_scan_on_start) {
    setImmediate(async () => {
      if (scanState.running) return;
      scanState.running = true;
      try { scanState.last_result = await runScan(database); }
      catch (err) { scanState.last_error = err.message; logger.error('initial scan failed:', err.message); }
      finally { scanState.running = false; scanState.finished_at = new Date().toISOString(); }
    });
  }
  if (settings.schedule.auto_scan_minutes > 0) {
    setInterval(async () => {
      if (scanState.running) return;
      scanState.running = true;
      try { scanState.last_result = await runScan(database); }
      catch (err) { scanState.last_error = err.message; logger.error('scheduled scan failed:', err.message); }
      finally { scanState.running = false; scanState.finished_at = new Date().toISOString(); }
    }, settings.schedule.auto_scan_minutes * 60000).unref();
  }

  return { server, database, scanState };
}

module.exports = { start, buildApp };
