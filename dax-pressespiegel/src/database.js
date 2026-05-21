'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Tabellen-Defs (ohne Indizes auf neuen Spalten - die kommen nach migrate).
const SCHEMA_TABLES = `
CREATE TABLE IF NOT EXISTS articles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL,
  url_hash        TEXT NOT NULL UNIQUE,
  title           TEXT,
  summary         TEXT,
  source_id       TEXT,
  source_name     TEXT,
  source_trust    REAL DEFAULT 0.4,
  lang            TEXT,
  published_utc   TEXT,
  fetched_utc     TEXT NOT NULL,
  polarity        REAL,
  bull_score      REAL,
  intensity       REAL,
  pos_hits        INTEGER DEFAULT 0,
  neg_hits        INTEGER DEFAULT 0,
  sentiment_label TEXT,
  bull_label      TEXT,
  talk_type       TEXT
);

CREATE TABLE IF NOT EXISTS stock_mentions (
  article_id        INTEGER NOT NULL,
  stock_symbol      TEXT NOT NULL,
  mentions          INTEGER NOT NULL,
  title_hit         INTEGER NOT NULL DEFAULT 0,
  aspect_polarity   REAL,
  aspect_bull       REAL,
  PRIMARY KEY (article_id, stock_symbol),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

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

const SCHEMA_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_articles_pub      ON articles (published_utc DESC);
CREATE INDEX IF NOT EXISTS idx_articles_fetch    ON articles (fetched_utc DESC);
CREATE INDEX IF NOT EXISTS idx_articles_talk     ON articles (talk_type);
CREATE INDEX IF NOT EXISTS idx_mentions_stock    ON stock_mentions (stock_symbol);
`;

function migrate(db) {
  function addCol(table, col, decl) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
  addCol('articles', 'bull_score', 'REAL');
  addCol('articles', 'intensity',  'REAL');
  addCol('articles', 'bull_label', 'TEXT');
  addCol('articles', 'talk_type',  'TEXT');
  addCol('stock_mentions', 'aspect_polarity', 'REAL');
  addCol('stock_mentions', 'aspect_bull',     'REAL');
}

function open(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_TABLES);
  migrate(db);                 // Spalten zuerst sicherstellen,
  db.exec(SCHEMA_INDEXES);     // dann Indizes (manche referenzieren neue Spalten).
  return db;
}

// Helper: Transaktion ueber node:sqlite (keine eingebaute transaction()-API).
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function insertArticle(db, art) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles
      (url, url_hash, title, summary, source_id, source_name, source_trust,
       lang, published_utc, fetched_utc, polarity, bull_score, intensity,
       pos_hits, neg_hits, sentiment_label, bull_label, talk_type)
    VALUES (@url, @url_hash, @title, @summary, @source_id, @source_name, @source_trust,
            @lang, @published_utc, @fetched_utc, @polarity, @bull_score, @intensity,
            @pos_hits, @neg_hits, @sentiment_label, @bull_label, @talk_type)
  `);
  const info = stmt.run({
    polarity: null, bull_score: null, intensity: null,
    pos_hits: 0, neg_hits: 0, sentiment_label: null, bull_label: null, talk_type: null,
    ...art,
  });
  if (info.changes > 0) return Number(info.lastInsertRowid);
  const row = db.prepare('SELECT id FROM articles WHERE url_hash = ?').get(art.url_hash);
  return row ? Number(row.id) : null;
}

function updateArticleAnalysis(db, id, data) {
  db.prepare(`
    UPDATE articles
       SET polarity=?, bull_score=?, intensity=?, pos_hits=?, neg_hits=?,
           sentiment_label=?, bull_label=?, talk_type=?
     WHERE id=?
  `).run(
    data.polarity, data.bull_score, data.intensity,
    data.pos_hits, data.neg_hits,
    data.sentiment_label, data.bull_label, data.talk_type,
    id
  );
}

function insertMentions(db, articleId, mentionsBySymbol) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO stock_mentions
      (article_id, stock_symbol, mentions, title_hit, aspect_polarity, aspect_bull)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const entries = Object.entries(mentionsBySymbol);
  transaction(db, () => {
    for (const [symbol, m] of entries) {
      stmt.run(
        articleId, symbol, m.mentions, m.title_hit ? 1 : 0,
        m.aspect_polarity ?? null, m.aspect_bull ?? null
      );
    }
  });
}

function startScan(db) {
  const info = db.prepare('INSERT INTO scans (started_utc) VALUES (?)').run(new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function finishScan(db, id, summary) {
  db.prepare(
    'UPDATE scans SET finished_utc=?, feeds_ok=?, feeds_failed=?, articles_new=?, log=? WHERE id=?'
  ).run(new Date().toISOString(), summary.feeds_ok, summary.feeds_failed, summary.articles_new, summary.log || '', id);
}

// ---------- Aggregate / Overview ----------

function _aggregate(rows) {
  const n = rows.length;
  if (n === 0) return null;
  // Aspekt-Polaritaet bevorzugen, falls vorhanden, sonst Artikel-polaritaet.
  let wMood = 0, sMood = 0;
  let wBull = 0, sBull = 0;
  let pos = 0, neu = 0, neg = 0;
  let bullN = 0, bearN = 0, bullNeu = 0;
  let intSum = 0;
  const sentValues = [];
  const bullValues = [];
  const talkCount = {};
  let lastSeen = null;

  for (const r of rows) {
    const pol  = r.aspect_polarity ?? r.polarity ?? 0;
    const bull = r.aspect_bull     ?? r.bull_score ?? 0;
    const w = Math.max(0.1, (r.source_trust || 0.4) + 0.2 * (r.title_hit || 0)) * (r.mentions || 1);
    sMood += pol  * w; wMood += w;
    sBull += bull * w; wBull += w;
    sentValues.push(pol);
    bullValues.push(bull);
    if (pol > 0.1) pos++; else if (pol < -0.1) neg++; else neu++;
    if (bull > 0.2) bullN++; else if (bull < -0.2) bearN++; else bullNeu++;
    intSum += (r.intensity ?? 0);
    if (r.talk_type) talkCount[r.talk_type] = (talkCount[r.talk_type] || 0) + 1;
    const ts = r.published_utc || r.fetched_utc;
    if (ts && (!lastSeen || ts > lastSeen)) lastSeen = ts;
  }
  const mood = wMood > 0 ? sMood / wMood : 0;
  const bull = wBull > 0 ? sBull / wBull : 0;
  // Konsens via Standardabweichung (umgedreht: kleiner = mehr Konsens).
  const mean = sentValues.reduce((a, b) => a + b, 0) / n;
  const variance = sentValues.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sigma = Math.sqrt(variance);
  const consensus = Math.max(0, 1 - sigma);  // 0..1
  const consensus_label =
    consensus >= 0.85 ? 'einhellig' :
    consensus >= 0.65 ? 'eher einig' :
    consensus >= 0.45 ? 'gemischt' : 'geteilt';
  // Top-Talk: "general" nur als Fallback - bevorzuge spezifische Themen,
  // wenn sie mindestens 20% der Artikel ausmachen.
  let topTalk = null, topTalkN = 0;
  const specific = Object.entries(talkCount).filter(([t]) => t !== 'general');
  specific.sort((a, b) => b[1] - a[1]);
  if (specific.length > 0 && specific[0][1] >= Math.max(2, n * 0.2)) {
    topTalk = specific[0][0]; topTalkN = specific[0][1];
  } else {
    for (const [t, c] of Object.entries(talkCount)) if (c > topTalkN) { topTalk = t; topTalkN = c; }
  }

  return {
    n_articles: n,
    n_positive: pos, n_neutral: neu, n_negative: neg,
    n_bull: bullN, n_neutral_bull: bullNeu, n_bear: bearN,
    mood, mood_100: Math.round(mood * 1000) / 10,
    bull, bull_100: Math.round(bull * 1000) / 10,
    intensity: intSum / n,
    consensus,
    consensus_label,
    top_talk_type: topTalk,
    talk_distribution: talkCount,
    last_seen: lastSeen,
  };
}

function stockOverview(db, sinceIso, beforeIso = null, maxArticles = 5) {
  const params = beforeIso ? [sinceIso, beforeIso] : [sinceIso];
  const beforeClause = beforeIso ? 'AND COALESCE(a.published_utc, a.fetched_utc) < ?' : '';
  const rows = db.prepare(`
    SELECT a.id, a.title, a.summary, a.source_name, a.source_trust, a.lang,
           a.published_utc, a.fetched_utc,
           a.polarity, a.bull_score, a.intensity, a.sentiment_label, a.bull_label, a.talk_type,
           sm.stock_symbol, sm.mentions, sm.title_hit, sm.aspect_polarity, sm.aspect_bull
      FROM stock_mentions sm
      JOIN articles a ON a.id = sm.article_id
     WHERE COALESCE(a.published_utc, a.fetched_utc) >= ?
       ${beforeClause}
  `).all(...params);

  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.stock_symbol)) bySymbol.set(r.stock_symbol, []);
    bySymbol.get(r.stock_symbol).push(r);
  }

  // Buzz-Skala: relativ zum Median der Aktien mit >0 Artikeln.
  const counts = [...bySymbol.values()].map((rs) => rs.length).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] || 1 : 1;

  const result = new Map();
  for (const [symbol, rs] of bySymbol.entries()) {
    const agg = _aggregate(rs);
    if (!agg) continue;
    agg.symbol = symbol;
    agg.buzz = agg.n_articles / Math.max(median, 1);
    agg.top_articles = pickTopArticles(rs, maxArticles);
    result.set(symbol, agg);
  }
  return result;
}

function pickTopArticles(rows, maxN) {
  const scored = rows.map((r) => ({
    row: r,
    rank: (r.title_hit ? 2 : 0)
        + Math.abs(r.aspect_polarity ?? r.polarity ?? 0)
        + (r.source_trust || 0)
        + 0.2 * (r.intensity || 0),
  }));
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, maxN).map(({ row }) => ({
    id: row.id, url: row.url || null, title: row.title, summary: row.summary,
    source_name: row.source_name, source_trust: row.source_trust,
    lang: row.lang, published_utc: row.published_utc,
    polarity: row.aspect_polarity ?? row.polarity,
    bull_score: row.aspect_bull ?? row.bull_score,
    sentiment_label: row.sentiment_label, bull_label: row.bull_label,
    talk_type: row.talk_type,
    mentions: row.mentions, title_hit: row.title_hit,
  }));
}

function articlesForStock(db, symbol, sinceIso, limit = 200) {
  return db.prepare(`
    SELECT a.id, a.url, a.title, a.summary, a.source_name, a.source_trust,
           a.lang, a.published_utc, a.polarity, a.bull_score, a.intensity,
           a.sentiment_label, a.bull_label, a.talk_type, a.pos_hits, a.neg_hits,
           sm.mentions, sm.title_hit, sm.aspect_polarity, sm.aspect_bull
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

// Sentiment ueber Tage fuer eine Aktie (Sparkline-Daten).
function dailySentimentSeries(db, symbol, sinceIso) {
  return db.prepare(`
    SELECT DATE(COALESCE(a.published_utc, a.fetched_utc)) AS day,
           AVG(COALESCE(sm.aspect_polarity, a.polarity)) AS mood,
           AVG(COALESCE(sm.aspect_bull, a.bull_score))   AS bull,
           COUNT(*) AS n
      FROM stock_mentions sm
      JOIN articles a ON a.id = sm.article_id
     WHERE sm.stock_symbol = ? AND COALESCE(a.published_utc, a.fetched_utc) >= ?
     GROUP BY day
     ORDER BY day ASC
  `).all(symbol, sinceIso);
}

module.exports = {
  open, insertArticle, updateArticleAnalysis, insertMentions,
  startScan, finishScan, stockOverview, articlesForStock, recentScans,
  dailySentimentSeries,
  // intern, fuer Tests:
  _aggregate,
};
