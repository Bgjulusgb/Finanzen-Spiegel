'use strict';

const logger = require('./logger');
const database = require('./database');
const { gatherFromFeeds, enrichItems } = require('./scraper');
const { analyze } = require('./analyzer');
const { findDuplicate, chooseWinner } = require('./deduplicator');
const { sources } = require('./config');
const { normalizeUrl } = require('./utils');
const { autoTag } = require('./tagger');

function applyTags(articleId, article, analysis) {
  const tags = autoTag(article, analysis);
  for (const tag of tags) {
    try {
      database.addTag(articleId, tag);
    } catch (e) {
      logger.debug(`Tag-Fehler ${tag}: ${e.message}`);
    }
  }
  return tags;
}

function summariseFeedHealth() {
  const all = database.getSourceHealth();
  const summary = { ok: 0, degraded: 0, blocked: 0, dead: 0, unknown: 0, total: all.length };
  for (const h of all) {
    const cls = database.classifyFeedHealth(h);
    summary[cls] = (summary[cls] || 0) + 1;
  }
  return summary;
}

async function runScan({ from, to }) {
  const startedAt = Date.now();
  const runId = database.startScanRun(from, to);
  const summary = {
    sourcesScanned: sources.feeds.length,
    articlesFound: 0,
    articlesAdded: 0,
    duplicatesFound: 0,
    errors: 0,
    notes: '',
  };

  try {
    logger.info(`Scan gestartet: ${from.toISOString()} bis ${to.toISOString()}`);
    const rssItems = await gatherFromFeeds();
    summary.articlesFound = rssItems.length;
    logger.info(`Gesammelt: ${rssItems.length} RSS-Eintraege`);

    const enriched = await enrichItems(rssItems, { from, to });
    logger.info(`Angereichert: ${enriched.length} Artikel im Zeitraum`);

    // Sort enriched articles by date (newest first) so dedup processes recent items first.
    // This ensures the freshest version of a duplicated story wins by default.
    enriched.sort((a, b) => {
      const ta = a.publishedDate ? new Date(a.publishedDate).getTime() : 0;
      const tb = b.publishedDate ? new Date(b.publishedDate).getTime() : 0;
      return tb - ta;
    });

    const lookbackFrom = new Date(from);
    lookbackFrom.setDate(lookbackFrom.getDate() - 30);
    const existing = database.getRecentForDedup(lookbackFrom);

    for (const raw of enriched) {
      try {
        const analysis = analyze(raw, raw.sourcePriority || 50);
        if (!analysis.passes) {
          logger.debug(`Verworfen: ${raw.title} (${analysis.rejectReason})`);
          continue;
        }

        const article = {
          ...raw,
          summary: analysis.summary,
          relevanceScore: analysis.relevanceScore,
          sentiment: analysis.sentiment,
          sentimentScore: analysis.sentimentScore,
          category: analysis.category,
          articleType: analysis.articleType,
          meta: { ...raw.meta, reasons: analysis.relevanceReasons },
        };

        const candidate = {
          id: null,
          url: article.url,
          url_normalized: article.urlNormalized,
          title: article.title,
          first_paragraph: article.firstParagraph,
          source: article.source,
        };
        const dupHit = findDuplicate(candidate, existing);

        if (dupHit) {
          const winner = chooseWinner(
            { ...candidate, published_date: article.publishedDate },
            dupHit.duplicate
          );
          if (winner === dupHit.duplicate) {
            const inserted = database.insertArticle(article);
            database.markAsDuplicate(inserted.id, dupHit.duplicate.id, article.url);
            summary.duplicatesFound++;
            if (inserted.inserted) {
              summary.articlesAdded++;
              applyTags(inserted.id, article, analysis);
            }
            logger.info(
              `Duplikat erkannt -> bestehend behalten: "${article.title}" (${dupHit.reason})`
            );
          } else {
            const inserted = database.insertArticle(article);
            if (inserted.inserted) {
              summary.articlesAdded++;
              applyTags(inserted.id, article, analysis);
            }
            database.markAsDuplicate(
              dupHit.duplicate.id,
              inserted.id,
              dupHit.duplicate.url || normalizeUrl(dupHit.duplicate.url_normalized)
            );
            summary.duplicatesFound++;
            existing.push({
              id: inserted.id,
              url_normalized: article.urlNormalized,
              title: article.title,
              first_paragraph: article.firstParagraph,
              source: article.source,
              published_date: article.publishedDate ? article.publishedDate.toISOString() : null,
            });
            logger.info(`Duplikat erkannt -> neuer Artikel wird Sieger: "${article.title}"`);
          }
        } else {
          const inserted = database.insertArticle(article);
          if (inserted.inserted) {
            summary.articlesAdded++;
            applyTags(inserted.id, article, analysis);
            existing.push({
              id: inserted.id,
              url_normalized: article.urlNormalized,
              title: article.title,
              first_paragraph: article.firstParagraph,
              source: article.source,
              published_date: article.publishedDate ? article.publishedDate.toISOString() : null,
            });
          }
        }
      } catch (err) {
        summary.errors++;
        logger.error(`Fehler bei Artikel-Verarbeitung: ${raw.url}`, { error: err.message });
      }
    }

    database.finishScanRun(runId, summary);
    const health = summariseFeedHealth();
    const finalSummary = {
      ...summary,
      duration_ms: Date.now() - startedAt,
      total_feeds: health.total,
      ok: health.ok,
      degraded: health.degraded,
      blocked_403: health.blocked,
      dead: health.dead,
      new_articles: summary.articlesAdded,
      duplicates_removed: summary.duplicatesFound,
      runId,
    };
    logger.info(`Scan abgeschlossen`, finalSummary);
    return finalSummary;
  } catch (err) {
    summary.errors++;
    summary.notes = err.message;
    database.finishScanRun(runId, summary);
    throw err;
  }
}

module.exports = { runScan, summariseFeedHealth };
