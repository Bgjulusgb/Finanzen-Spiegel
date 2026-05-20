'use strict';

const { settings, sources } = require('./config');
const { normalizeUrl, levenshteinSimilarity, cosineSimilarity } = require('./utils');
const logger = require('./logger');

const TITLE_THRESHOLD = settings.deduplication.title_similarity_threshold || 0.85;
const TEXT_THRESHOLD = settings.deduplication.text_similarity_threshold || 0.8;
const FIRST_PARA_CHARS = settings.deduplication.first_paragraph_chars || 800;

function getSourcePriority(sourceName) {
  if (!sourceName) return sources.source_priorities.default || 50;
  for (const [key, priority] of Object.entries(sources.source_priorities)) {
    if (key === 'default') continue;
    if (sourceName.toLowerCase().includes(key.toLowerCase())) {
      return priority;
    }
  }
  return sources.source_priorities.default || 50;
}

function extractFirstParagraph(text) {
  if (!text) return '';
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  const firstBlock = cleaned.split(/\n\s*\n/)[0];
  return firstBlock.slice(0, FIRST_PARA_CHARS);
}

function findDuplicate(candidate, candidates) {
  const candidateUrl = normalizeUrl(candidate.url);
  const candidateTitle = (candidate.title || '').trim();
  const candidateFirst = candidate.first_paragraph || candidate.firstParagraph || '';

  for (const existing of candidates) {
    if (!existing || !existing.id) continue;
    if (candidate.id && existing.id === candidate.id) continue;

    if (existing.url_normalized && candidateUrl && existing.url_normalized === candidateUrl) {
      return { duplicate: existing, reason: 'url-match' };
    }

    const titleSim = levenshteinSimilarity(candidateTitle, existing.title || '');
    if (titleSim >= TITLE_THRESHOLD) {
      return { duplicate: existing, reason: `title-sim:${titleSim.toFixed(2)}` };
    }

    if (candidateFirst && existing.first_paragraph) {
      const textSim = cosineSimilarity(candidateFirst, existing.first_paragraph);
      if (textSim >= TEXT_THRESHOLD) {
        return { duplicate: existing, reason: `text-sim:${textSim.toFixed(2)}` };
      }
    }
  }
  return null;
}

function chooseWinner(a, b) {
  const prioA = getSourcePriority(a.source);
  const prioB = getSourcePriority(b.source);
  if (prioA !== prioB) {
    return prioA > prioB ? a : b;
  }
  const dateA = a.published_date ? new Date(a.published_date).getTime() : 0;
  const dateB = b.published_date ? new Date(b.published_date).getTime() : 0;
  if (dateA && dateB && dateA !== dateB) {
    return dateA < dateB ? a : b;
  }
  return (a.id || Infinity) < (b.id || Infinity) ? a : b;
}

function deduplicateBatch(articles) {
  const uniques = [];
  const duplicates = [];
  for (const article of articles) {
    const candidates = uniques.map((u) => ({
      id: u.tempId,
      title: u.title,
      url_normalized: normalizeUrl(u.url),
      first_paragraph: u.firstParagraph,
      source: u.source,
      published_date: u.publishedDate,
    }));
    const hit = findDuplicate(
      {
        title: article.title,
        url: article.url,
        firstParagraph: article.firstParagraph,
        source: article.source,
      },
      candidates
    );
    if (!hit) {
      article.tempId = uniques.length + 1;
      uniques.push(article);
    } else {
      duplicates.push({ article, duplicateOf: hit.duplicate, reason: hit.reason });
    }
  }
  logger.debug('Batch-Dedup abgeschlossen', {
    eingang: articles.length,
    unique: uniques.length,
    duplicate: duplicates.length,
  });
  return { uniques, duplicates };
}

module.exports = {
  findDuplicate,
  chooseWinner,
  deduplicateBatch,
  extractFirstParagraph,
  getSourcePriority,
};
