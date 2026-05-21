'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/database');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daxps-'));
  return { path: path.join(dir, 'test.db'), dir };
}

test('database: open initialisiert Schema (inkl. neuer Spalten)', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['articles', 'stock_mentions', 'scans']) {
    assert.ok(tables.includes(t), `Tabelle ${t} fehlt`);
  }
  const cols = d.prepare('PRAGMA table_info(articles)').all().map((c) => c.name);
  for (const c of ['polarity', 'bull_score', 'intensity', 'sentiment_label', 'bull_label', 'talk_type']) {
    assert.ok(cols.includes(c), `Artikel-Spalte ${c} fehlt`);
  }
  const mcols = d.prepare('PRAGMA table_info(stock_mentions)').all().map((c) => c.name);
  for (const c of ['aspect_polarity', 'aspect_bull']) {
    assert.ok(mcols.includes(c), `Mentions-Spalte ${c} fehlt`);
  }
  d.close();
});

test('database: insertArticle dedupliziert via url_hash', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const art = {
    url: 'https://x.test/a', url_hash: 'h1', title: 'Test', summary: 'Body',
    source_id: 's1', source_name: 'S1', source_trust: 0.7, lang: 'de',
    published_utc: '2026-05-20T10:00:00.000Z', fetched_utc: '2026-05-20T10:01:00.000Z',
  };
  const a = db.insertArticle(d, art);
  const b = db.insertArticle(d, art);
  assert.equal(Number(a), Number(b));
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 1);
  d.close();
});

test('database: insertMentions speichert Aspekt-Sentiment je Aktie', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const id = db.insertArticle(d, {
    url: 'https://x.test/m', url_hash: 'm1', title: 't', summary: 's',
    source_id: 's', source_name: 'S', source_trust: 0.8, lang: 'de',
    published_utc: new Date().toISOString(), fetched_utc: new Date().toISOString(),
  });
  db.insertMentions(d, id, {
    'SAP.DE': { mentions: 3, title_hit: true,  aspect_polarity:  0.7, aspect_bull:  0.6 },
    'BMW.DE': { mentions: 1, title_hit: false, aspect_polarity: -0.4, aspect_bull: -0.3 },
  });
  db.updateArticleAnalysis(d, id, {
    polarity: 0.3, bull_score: 0.3, intensity: 0.2,
    pos_hits: 2, neg_hits: 1,
    sentiment_label: 'positiv', bull_label: 'bullisch', talk_type: 'analyst',
  });
  const since = new Date(Date.now() - 86400000).toISOString();
  const ov = db.stockOverview(d, since, null, 5);
  assert.ok(ov.has('SAP.DE'));
  assert.ok(ov.has('BMW.DE'));
  // SAP nutzt aspect_polarity (0.7) statt overall (0.3).
  assert.ok(ov.get('SAP.DE').mood > 0.4, `SAP mood sollte > 0.4 sein (aspect), war ${ov.get('SAP.DE').mood}`);
  assert.ok(ov.get('BMW.DE').mood < 0, `BMW mood sollte negativ sein (aspect), war ${ov.get('BMW.DE').mood}`);
  d.close();
});

test('database: stockOverview liefert Top-Artikel und neue Felder', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  for (let i = 0; i < 3; i++) {
    const id = db.insertArticle(d, {
      url: `https://x.test/${i}`, url_hash: `h${i}`,
      title: `SAP News ${i}`, summary: 'starker Gewinn bei SAP',
      source_id: 's', source_name: 'S', source_trust: 0.8, lang: 'de',
      published_utc: new Date().toISOString(), fetched_utc: new Date().toISOString(),
    });
    db.updateArticleAnalysis(d, id, {
      polarity: 0.5, bull_score: 0.4, intensity: 0.2,
      pos_hits: 3, neg_hits: 0,
      sentiment_label: 'positiv', bull_label: 'bullisch', talk_type: 'earnings',
    });
    db.insertMentions(d, id, { 'SAP.DE': { mentions: 2, title_hit: true, aspect_polarity: 0.5, aspect_bull: 0.4 } });
  }
  const since = new Date(Date.now() - 86400000).toISOString();
  const ov = db.stockOverview(d, since, null, 5);
  const sap = ov.get('SAP.DE');
  assert.equal(sap.n_articles, 3);
  assert.equal(sap.top_articles.length, 3);
  assert.equal(sap.top_talk_type, 'earnings');
  assert.ok(sap.bull_100 > 0);
  assert.ok(sap.consensus >= 0.9, `consensus sollte hoch sein, war ${sap.consensus}`);
  d.close();
});

test('database: startScan/finishScan', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const id = db.startScan(d);
  db.finishScan(d, id, { feeds_ok: 5, feeds_failed: 1, articles_new: 10, log: 'ok' });
  const scans = db.recentScans(d, 5);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].feeds_ok, 5);
  d.close();
});

test('database: Migration faegt Spalten zu alten DBs hinzu', () => {
  const { path: p } = tempDb();
  // Alte DB ohne neue Spalten erzeugen.
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(p);
  old.exec(`
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT, url_hash TEXT UNIQUE, title TEXT, summary TEXT,
      source_id TEXT, source_name TEXT, source_trust REAL,
      lang TEXT, published_utc TEXT, fetched_utc TEXT,
      polarity REAL, pos_hits INTEGER, neg_hits INTEGER, sentiment_label TEXT
    );
    CREATE TABLE stock_mentions (
      article_id INTEGER, stock_symbol TEXT, mentions INTEGER, title_hit INTEGER,
      PRIMARY KEY (article_id, stock_symbol)
    );
    CREATE TABLE scans (id INTEGER PRIMARY KEY AUTOINCREMENT, started_utc TEXT);
  `);
  old.close();
  // Mit unserer open() Funktion oeffnen - Migration sollte greifen.
  const d = db.open(p);
  const cols = d.prepare('PRAGMA table_info(articles)').all().map((c) => c.name);
  assert.ok(cols.includes('bull_score'));
  assert.ok(cols.includes('talk_type'));
  d.close();
});
