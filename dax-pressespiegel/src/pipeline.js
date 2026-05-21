'use strict';

const { settings, sources, dax } = require('./config');
const db = require('./database');
const { fetchSource, buildFetchPlan, runWithLimit } = require('./feed-fetcher');
const { findStockMentions, scoreSentiment } = require('./analyzer');
const logger = require('./logger');

async function runScan(database) {
  const scanId = db.startScan(database);
  const startedAt = Date.now();
  logger.info(`Scan #${scanId} gestartet (${sources.length} Quellen, ${dax.length} Aktien)`);

  const plan = buildFetchPlan(sources, dax);
  let feeds_ok = 0;
  let feeds_failed = 0;
  let articles_new = 0;
  const errors = [];

  const results = await runWithLimit(plan, settings.scan.concurrent_fetches, async (job) => {
    return fetchSource(job.source, job.query);
  });

  // Items pro Plan-Eintrag verarbeiten.
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
      const fullText = `${item.title}. ${item.summary}`;
      // per_stock Quellen: nur Items behalten, in denen die zugehoerige Aktie wirklich vorkommt.
      const mentions = findStockMentions(item.title, item.summary);
      if (job.stock_symbol && !mentions[job.stock_symbol]) continue;
      if (Object.keys(mentions).length === 0) continue;

      const sentiment = scoreSentiment(fullText, item.lang);
      const articleId = db.insertArticle(database, {
        ...item,
        polarity: sentiment.polarity,
        pos_hits: sentiment.pos_hits,
        neg_hits: sentiment.neg_hits,
        sentiment_label: sentiment.label,
      });
      if (!articleId) continue;
      // Update sentiment (falls Artikel schon existierte ohne Sentiment, jetzt nachtragen).
      db.updateArticleSentiment(database, articleId, sentiment.polarity, sentiment.pos_hits, sentiment.neg_hits, sentiment.label);
      db.insertMentions(database, articleId, mentions);
      articles_new++;
    }
  }

  const summary = {
    feeds_ok,
    feeds_failed,
    articles_new,
    log: errors.slice(0, 20).join('\n'),
  };
  db.finishScan(database, scanId, summary);
  const durMs = Date.now() - startedAt;
  logger.info(`Scan #${scanId} fertig in ${(durMs / 1000).toFixed(1)}s: ${feeds_ok}/${plan.length} Quellen ok, ${articles_new} neue Artikel mit DAX-Treffer`);
  return { scanId, ...summary, duration_ms: durMs };
}

module.exports = { runScan };
