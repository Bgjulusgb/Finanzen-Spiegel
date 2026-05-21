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

function buildOverview(database, windowDays = settings.ui.default_window_days) {
  const sinceIso = isoSinceDays(windowDays);
  const ov = db.stockOverview(database, sinceIso, settings.ui.max_articles_per_card);
  const stocks = dax.map((s) => {
    const o = ov.get(s.symbol);
    if (!o) {
      return {
        ...s,
        n_articles: 0, n_positive: 0, n_negative: 0, n_neutral: 0,
        score: 0, score_100: 0, last_seen: null, top_articles: [],
      };
    }
    return { ...s, ...o };
  });
  // Sortierung: meiste Artikel zuerst.
  stocks.sort((a, b) => b.n_articles - a.n_articles || b.score_100 - a.score_100);
  return { window_days: windowDays, since_utc: sinceIso, stocks };
}

function buildApp(database, scanState) {
  const app = express();
  app.use(express.json());

  // Statisches Dashboard
  const WEB = path.resolve(__dirname, '..', 'web');
  app.use('/static', express.static(WEB));
  app.get('/', (_req, res) => res.sendFile(path.join(WEB, 'index.html')));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', stocks: dax.length, scan: scanState });
  });

  app.get('/api/overview', (req, res) => {
    const days = Math.max(1, Math.min(60, parseInt(req.query.days, 10) || settings.ui.default_window_days));
    res.json(buildOverview(database, days));
  });

  app.get('/api/stock/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    const stock = dax.find((s) => s.symbol === symbol);
    if (!stock) return res.status(404).json({ error: 'unknown symbol' });
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || settings.ui.default_window_days));
    const sinceIso = isoSinceDays(days);
    const articles = db.articlesForStock(database, symbol, sinceIso, 200);
    const overview = db.stockOverview(database, sinceIso, settings.ui.max_articles_per_card);
    const ov = overview.get(symbol) || {
      n_articles: 0, n_positive: 0, n_negative: 0, n_neutral: 0,
      score: 0, score_100: 0, last_seen: null, top_articles: [],
    };
    res.json({ stock, window_days: days, ...ov, articles });
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

  // Optional: ersten Scan beim Start + periodisch.
  if (settings.schedule.auto_scan_on_start) {
    setImmediate(async () => {
      if (scanState.running) return;
      scanState.running = true;
      try {
        scanState.last_result = await runScan(database);
      } catch (err) {
        scanState.last_error = err.message;
        logger.error('initial scan failed:', err.message);
      } finally {
        scanState.running = false;
        scanState.finished_at = new Date().toISOString();
      }
    });
  }
  if (settings.schedule.auto_scan_minutes > 0) {
    setInterval(async () => {
      if (scanState.running) return;
      scanState.running = true;
      try {
        scanState.last_result = await runScan(database);
      } catch (err) {
        scanState.last_error = err.message;
        logger.error('scheduled scan failed:', err.message);
      } finally {
        scanState.running = false;
        scanState.finished_at = new Date().toISOString();
      }
    }, settings.schedule.auto_scan_minutes * 60000).unref();
  }

  return { server, database, scanState };
}

module.exports = { start, buildApp };
