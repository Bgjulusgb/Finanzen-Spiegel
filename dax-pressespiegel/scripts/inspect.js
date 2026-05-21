#!/usr/bin/env node
'use strict';

const { settings, dax } = require('../src/config');
const db = require('../src/database');
const { buildApp } = require('../src/server');

const database = db.open(settings.database.path);

function isoSinceDays(d) { return new Date(Date.now() - d * 86400000).toISOString(); }

const days = parseInt(process.argv[2], 10) || 14;
const sinceIso = isoSinceDays(days);
const ov = db.stockOverview(database, sinceIso, null, 5);
const splitIso = isoSinceDays(Math.floor(days / 2));
const ovPrev = db.stockOverview(database, isoSinceDays(days), splitIso, 0);
const ovNow  = db.stockOverview(database, splitIso, null, 0);

const rows = dax.map((s) => {
  const a = ov.get(s.symbol);
  if (!a) return { ...s, n_articles: 0, mood_100: 0, bull_100: 0, buzz: 0, trend_delta: 0, top_talk: '-', consensus: 1 };
  const now = ovNow.get(s.symbol);
  const prev = ovPrev.get(s.symbol);
  const trend = (now && prev) ? (now.mood_100 - prev.mood_100) : 0;
  return {
    ...s, n_articles: a.n_articles, mood_100: a.mood_100, bull_100: a.bull_100,
    buzz: a.buzz, trend_delta: trend, top_talk: a.top_talk_type || '-', consensus: a.consensus,
    talk_dist: a.talk_distribution,
  };
});
rows.sort((a, b) => b.n_articles - a.n_articles);

console.log(`\n=== TOP 15 BUZZ (${days}d) ===`);
console.log('SYMBOL    NAME                    ART   MOOD    BULL   BUZZ   TREND   TOP_TALK    CONS');
for (const r of rows.slice(0, 15)) {
  const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
  console.log(`${r.symbol.padEnd(9)} ${r.name.slice(0,22).padEnd(22)} ${String(r.n_articles).padStart(4)}  ${sign(r.mood_100).padStart(6)}  ${sign(r.bull_100).padStart(6)}  ${r.buzz.toFixed(2).padStart(5)}  ${sign(r.trend_delta).padStart(6)}  ${r.top_talk.padEnd(11)} ${r.consensus.toFixed(2)}`);
}

console.log(`\n=== BULLISCHSTE 5 ===`);
const bull = rows.filter((r) => r.n_articles >= 3).sort((a, b) => b.bull_100 - a.bull_100);
for (const r of bull.slice(0, 5)) console.log(`  ${r.symbol.padEnd(9)} bull=${r.bull_100.toFixed(1).padStart(6)} (${r.n_articles} Artikel, top: ${r.top_talk})`);

console.log(`\n=== BEARISCHSTE 5 ===`);
const bear = rows.filter((r) => r.n_articles >= 3).sort((a, b) => a.bull_100 - b.bull_100);
for (const r of bear.slice(0, 5)) console.log(`  ${r.symbol.padEnd(9)} bull=${r.bull_100.toFixed(1).padStart(6)} (${r.n_articles} Artikel, top: ${r.top_talk})`);

console.log(`\n=== TALK-TYPE-VERTEILUNG GLOBAL ===`);
const talk = {};
for (const r of rows) for (const [t, n] of Object.entries(r.talk_dist || {})) talk[t] = (talk[t] || 0) + n;
for (const [t, n] of Object.entries(talk).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(12)} ${n}`);

const focus = process.argv[3] || 'SIE.DE';
console.log(`\n=== DETAIL: ${focus} ===`);
const focusRow = rows.find((r) => r.symbol === focus);
if (focusRow) {
  console.log(`Mood: ${focusRow.mood_100.toFixed(1)}, Bull: ${focusRow.bull_100.toFixed(1)}, Buzz: ${focusRow.buzz.toFixed(2)}x, Trend: ${focusRow.trend_delta.toFixed(1)}`);
  console.log(`Top-Talk: ${focusRow.top_talk}, Konsens: ${focusRow.consensus.toFixed(2)}`);
  console.log(`Verteilung: ${JSON.stringify(focusRow.talk_dist || {})}`);
  const articles = db.articlesForStock(database, focus, sinceIso, 8);
  console.log(`Top-Schlagzeilen:`);
  for (const a of articles.slice(0, 5)) {
    const p = a.aspect_polarity != null ? a.aspect_polarity : a.polarity;
    const b = a.aspect_bull != null ? a.aspect_bull : a.bull_score;
    console.log(`  [${(p||0).toFixed(2).padStart(5)}|${(b||0).toFixed(2).padStart(5)}|${(a.talk_type||'-').padEnd(8)}] ${(a.title || '').slice(0, 90)}`);
  }
  const series = db.dailySentimentSeries(database, focus, sinceIso);
  console.log(`Tages-Sentiment-Verlauf:`);
  for (const p of series.slice(-7)) {
    const bar = p.mood > 0 ? '+'.repeat(Math.min(20, Math.round(p.mood * 20))) : '-'.repeat(Math.min(20, Math.round(-p.mood * 20)));
    console.log(`  ${p.day}  n=${String(p.n).padStart(3)}  mood=${p.mood.toFixed(2).padStart(5)}  ${bar}`);
  }
}
database.close();
