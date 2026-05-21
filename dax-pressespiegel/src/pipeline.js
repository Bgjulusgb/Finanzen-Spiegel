'use strict';

const { settings, sources, dax } = require('./config');
const db = require('./database');
const { fetchSource, buildFetchPlan, runWithLimit } = require('./feed-fetcher');
const { analyzeArticle } = require('./analyzer');
const logger = require('./logger');

async function runScan(database) {
  const scanId = db.startScan(database);
  const startedAt = Date.now();
  logger.info(`Scan #${scanId} gestartet (${sources.length} Quellen, ${dax.length} Aktien)`);

  const plan = buildFetchPlan(sources, dax);
  let feeds_ok = 0, feeds_failed = 0, articles_new = 0;
  const errors = [];

  const results = await runWithLimit(plan, settings.scan.concurrent_fetches, async (job) => {
    return fetchSource(job.source, job.query);
  });

  for (let i = 0; i < plan.length; i++) {
    const job = plan[i];
    const res = results[i];
    if (!res || !res.ok) {
      feeds_failed++;
      if (res?.error) errors.push(`${job.source.id}: ${res.error}`);
      continue;
    }
    feeds_ok++;
    for (const item of res.items) {
      const analysis = analyzeArticle({ title: item.title, summary: item.summary, lang: item.lang });
      // per_stock Quellen: nur Items behalten, in denen die zugehoerige Aktie wirklich vorkommt.
      if (job.stock_symbol && !analysis.mentions[job.stock_symbol]) continue;
      if (Object.keys(analysis.mentions).length === 0) continue;

      const articleId = db.insertArticle(database, {
        ...item,
        polarity: analysis.overall.polarity,
        bull_score: analysis.overall.bull_score,
        intensity: analysis.overall.intensity,
        pos_hits: analysis.overall.pos_hits,
        neg_hits: analysis.overall.neg_hits,
        sentiment_label: analysis.overall.label,
        bull_label: analysis.overall.bull_label,
        talk_type: analysis.talk.talk_type,
      });
      if (!articleId) continue;
      db.updateArticleAnalysis(database, articleId, {
        polarity: analysis.overall.polarity,
        bull_score: analysis.overall.bull_score,
        intensity: analysis.overall.intensity,
        pos_hits: analysis.overall.pos_hits,
        neg_hits: analysis.overall.neg_hits,
        sentiment_label: analysis.overall.label,
        bull_label: analysis.overall.bull_label,
        talk_type: analysis.talk.talk_type,
      });
      // Mentions inkl. Aspekt-Sentiment pro Aktie.
      const mentionRecord = {};
      for (const [symbol, m] of Object.entries(analysis.mentions)) {
        const asp = analysis.aspect[symbol] || { polarity: null, bull_score: null };
        mentionRecord[symbol] = {
          mentions: m.mentions,
          title_hit: m.title_hit,
          aspect_polarity: asp.polarity,
          aspect_bull: asp.bull_score,
        };
      }
      db.insertMentions(database, articleId, mentionRecord);
      articles_new++;
    }
  }

  const summary = {
    feeds_ok, feeds_failed, articles_new,
    log: errors.slice(0, 30).join('\n'),
  };
  db.finishScan(database, scanId, summary);
  const durMs = Date.now() - startedAt;
  logger.info(`Scan #${scanId} fertig in ${(durMs / 1000).toFixed(1)}s: ${feeds_ok}/${plan.length} Quellen ok, ${articles_new} neue Artikel mit DAX-Treffer`);
  return { scanId, ...summary, duration_ms: durMs };
}

module.exports = { runScan };
