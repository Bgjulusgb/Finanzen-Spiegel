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

test('database: open initialisiert Schema', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['articles', 'stock_mentions', 'scans']) {
    assert.ok(tables.includes(t), `Tabelle ${t} fehlt`);
  }
  d.close();
});

test('database: insertArticle dedupliziert via url_hash', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const art = {
    url: 'https://x.test/a',
    url_hash: 'h1',
    title: 'Test',
    summary: 'Body',
    source_id: 's1',
    source_name: 'S1',
    source_trust: 0.7,
    lang: 'de',
    published_utc: '2026-05-20T10:00:00.000Z',
    fetched_utc: '2026-05-20T10:01:00.000Z',
  };
  const a = db.insertArticle(d, art);
  const b = db.insertArticle(d, art);
  assert.equal(Number(a), Number(b));
  const rows = d.prepare('SELECT COUNT(*) AS n FROM articles').get();
  assert.equal(rows.n, 1);
  d.close();
});

test('database: insertMentions speichert je Aktie', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const id = db.insertArticle(d, {
    url: 'https://x.test/m', url_hash: 'm1', title: 't', summary: 's',
    source_id: 's', source_name: 'S', source_trust: 0.8, lang: 'de',
    published_utc: new Date().toISOString(), fetched_utc: new Date().toISOString(),
  });
  db.insertMentions(d, id, { 'SAP.DE': { mentions: 3, title_hit: true }, 'BMW.DE': { mentions: 1, title_hit: false } });
  db.updateArticleSentiment(d, id, 0.6, 4, 1, 'positiv');
  const since = new Date(Date.now() - 86400000).toISOString();
  const ov = db.stockOverview(d, since, 5);
  assert.ok(ov.has('SAP.DE'));
  assert.ok(ov.has('BMW.DE'));
  assert.ok(ov.get('SAP.DE').score > 0);
  d.close();
});

test('database: stockOverview liefert Top-Artikel pro Aktie', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  for (let i = 0; i < 3; i++) {
    const id = db.insertArticle(d, {
      url: `https://x.test/${i}`, url_hash: `h${i}`,
      title: `SAP News ${i}`, summary: 'starkes Wachstum bei SAP',
      source_id: 's', source_name: 'S', source_trust: 0.8, lang: 'de',
      published_utc: new Date().toISOString(), fetched_utc: new Date().toISOString(),
    });
    db.updateArticleSentiment(d, id, 0.5, 3, 0, 'positiv');
    db.insertMentions(d, id, { 'SAP.DE': { mentions: 2, title_hit: true } });
  }
  const since = new Date(Date.now() - 86400000).toISOString();
  const ov = db.stockOverview(d, since, 5);
  const sap = ov.get('SAP.DE');
  assert.equal(sap.n_articles, 3);
  assert.equal(sap.top_articles.length, 3);
  d.close();
});

test('database: startScan/finishScan funktionieren', () => {
  const { path: p } = tempDb();
  const d = db.open(p);
  const id = db.startScan(d);
  db.finishScan(d, id, { feeds_ok: 5, feeds_failed: 1, articles_new: 10, log: 'ok' });
  const scans = db.recentScans(d, 5);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].feeds_ok, 5);
  assert.equal(scans[0].articles_new, 10);
  d.close();
});
