'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL,
  url_hash      TEXT NOT NULL UNIQUE,
  title         TEXT,
  summary       TEXT,
  source_id     TEXT,
  source_name   TEXT,
  source_trust  REAL DEFAULT 0.4,
  lang          TEXT,
  published_utc TEXT,
  fetched_utc   TEXT NOT NULL,
  polarity      REAL,
  pos_hits      INTEGER DEFAULT 0,
  neg_hits      INTEGER DEFAULT 0,
  sentiment_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_pub  ON articles (published_utc DESC);
CREATE INDEX IF NOT EXISTS idx_articles_fetch ON articles (fetched_utc DESC);

CREATE TABLE IF NOT EXISTS stock_mentions (
  article_id    INTEGER NOT NULL,
  stock_symbol  TEXT NOT NULL,
  mentions      INTEGER NOT NULL,
  title_hit     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, stock_symbol),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mentions_stock ON stock_mentions (stock_symbol);

CREATE TABLE IF NOT EXISTS scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_utc  TEXT NOT NULL,
  finished_utc TEXT,
  feeds_ok     INTEGER DEFAULT 0,
  feeds_failed INTEGER DEFAULT 0,
  articles_new INTEGER DEFAULT 0,
  log          TEXT
);
`;

function open(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function insertArticle(db, art) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles
      (url, url_hash, title, summary, source_id, source_name, source_trust,
       lang, published_utc, fetched_utc, polarity, pos_hits, neg_hits, sentiment_label)
    VALUES (@url, @url_hash, @title, @summary, @source_id, @source_name, @source_trust,
            @lang, @published_utc, @fetched_utc, @polarity, @pos_hits, @neg_hits, @sentiment_label)
  `);
  const info = stmt.run({
    polarity: null, pos_hits: 0, neg_hits: 0, sentiment_label: null,
    ...art,
  });
  if (info.changes > 0) return info.lastInsertRowid;
  const row = db.prepare('SELECT id FROM articles WHERE url_hash = ?').get(art.url_hash);
  return row ? row.id : null;
}

function updateArticleSentiment(db, id, polarity, pos_hits, neg_hits, label) {
  db.prepare(
    'UPDATE articles SET polarity=?, pos_hits=?, neg_hits=?, sentiment_label=? WHERE id=?'
  ).run(polarity, pos_hits, neg_hits, label, id);
}

function insertMentions(db, articleId, mentionsBySymbol) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO stock_mentions (article_id, stock_symbol, mentions, title_hit)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction((entries) => {
    for (const [symbol, m] of entries) stmt.run(articleId, symbol, m.mentions, m.title_hit ? 1 : 0);
  });
  tx(Object.entries(mentionsBySymbol));
}

function startScan(db) {
  const info = db.prepare('INSERT INTO scans (started_utc) VALUES (?)').run(new Date().toISOString());
  return info.lastInsertRowid;
}

function finishScan(db, id, summary) {
  db.prepare(
    'UPDATE scans SET finished_utc=?, feeds_ok=?, feeds_failed=?, articles_new=?, log=? WHERE id=?'
  ).run(new Date().toISOString(), summary.feeds_ok, summary.feeds_failed, summary.articles_new, summary.log || '', id);
}

function stockOverview(db, sinceIso, maxArticles = 5) {
  // pro Aktie: durchschnittliche Polaritaet (gewichtet mit source_trust + Title-Hit),
  // Artikelzahl und letzte Top-Artikel.
  const overview = db.prepare(`
    SELECT
      sm.stock_symbol AS symbol,
      COUNT(DISTINCT a.id) AS n_articles,
      SUM(CASE WHEN a.polarity > 0.1 THEN 1 ELSE 0 END) AS n_positive,
      SUM(CASE WHEN a.polarity < -0.1 THEN 1 ELSE 0 END) AS n_negative,
      SUM(CASE WHEN a.polarity BETWEEN -0.1 AND 0.1 THEN 1 ELSE 0 END) AS n_neutral,
      SUM(a.polarity * (a.source_trust + 0.2 * sm.title_hit) * sm.mentions) AS weighted_sum,
      SUM((a.source_trust + 0.2 * sm.title_hit) * sm.mentions) AS weight_sum,
      MAX(a.published_utc) AS last_seen
    FROM stock_mentions sm
    JOIN articles a ON a.id = sm.article_id
    WHERE COALESCE(a.published_utc, a.fetched_utc) >= ?
    GROUP BY sm.stock_symbol
  `).all(sinceIso);

  const result = new Map();
  for (const row of overview) {
    const score = row.weight_sum > 0 ? (row.weighted_sum / row.weight_sum) : 0;
    result.set(row.symbol, {
      symbol: row.symbol,
      n_articles: row.n_articles,
      n_positive: row.n_positive,
      n_negative: row.n_negative,
      n_neutral: row.n_neutral,
      score,                                          // -1 .. +1
      score_100: Math.round(score * 1000) / 10,       // -100 .. +100
      last_seen: row.last_seen,
      top_articles: [],
    });
  }

  const topStmt = db.prepare(`
    SELECT a.id, a.url, a.title, a.summary, a.source_name, a.source_trust,
           a.lang, a.published_utc, a.polarity, a.sentiment_label,
           sm.mentions, sm.title_hit
    FROM articles a
    JOIN stock_mentions sm ON sm.article_id = a.id
    WHERE sm.stock_symbol = ? AND COALESCE(a.published_utc, a.fetched_utc) >= ?
    ORDER BY (sm.title_hit * 2.0 + ABS(COALESCE(a.polarity, 0)) + a.source_trust) DESC,
             COALESCE(a.published_utc, a.fetched_utc) DESC
    LIMIT ?
  `);
  for (const entry of result.values()) {
    entry.top_articles = topStmt.all(entry.symbol, sinceIso, maxArticles);
  }
  return result;
}

function articlesForStock(db, symbol, sinceIso, limit = 50) {
  return db.prepare(`
    SELECT a.id, a.url, a.title, a.summary, a.source_name, a.source_trust,
           a.lang, a.published_utc, a.polarity, a.sentiment_label, a.pos_hits, a.neg_hits,
           sm.mentions, sm.title_hit
    FROM articles a
    JOIN stock_mentions sm ON sm.article_id = a.id
    WHERE sm.stock_symbol = ? AND COALESCE(a.published_utc, a.fetched_utc) >= ?
    ORDER BY COALESCE(a.published_utc, a.fetched_utc) DESC
    LIMIT ?
  `).all(symbol, sinceIso, limit);
}

function recentScans(db, n = 10) {
  return db.prepare('SELECT * FROM scans ORDER BY id DESC LIMIT ?').all(n);
}

module.exports = {
  open, insertArticle, updateArticleSentiment, insertMentions,
  startScan, finishScan, stockOverview, articlesForStock, recentScans,
};
