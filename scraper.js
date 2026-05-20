'use strict';

const { keywords, sentiment, settings } = require('./config');
const { levenshteinSimilarity } = require('./utils');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[áàâ]/g, 'a')
    .replace(/[éèê]/g, 'e')
    .replace(/[íìî]/g, 'i')
    .replace(/[óòô]/g, 'o')
    .replace(/[úùû]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ç]/g, 'c')
    .replace(/[ł]/g, 'l');
}

function preparedKeywords() {
  return {
    required: keywords.required.map(normalize),
    productions: keywords.productions.map(normalize),
    people: keywords.people.map(normalize),
    venues: (keywords.venues || []).map(normalize),
    theaterContext: (keywords.theater_context || []).map(normalize),
    exclude: keywords.exclude.map(normalize),
  };
}

const KW = preparedKeywords();

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findFuzzyMatch(haystack, needle, threshold = 0.88) {
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length < 6) return false;
  const words = haystack.split(/\s+/);
  const needleWords = needle.split(/\s+/);
  if (needleWords.length === 1) {
    for (const w of words) {
      if (w.length < 5) continue;
      if (levenshteinSimilarity(w, needle) >= threshold) return true;
    }
    return false;
  }
  for (let i = 0; i <= words.length - needleWords.length; i++) {
    const window = words.slice(i, i + needleWords.length).join(' ');
    if (levenshteinSimilarity(window, needle) >= threshold) return true;
  }
  return false;
}

function passesRequiredFilter(article) {
  const title = normalize(article.title || '');
  const text = normalize(article.fullText || '');
  const haystack = `${title} ${text}`;
  const hasRequired = KW.required.some((k) => haystack.includes(k));
  if (!hasRequired) return { passes: false, reason: 'no-required-keyword' };
  const excludeHit = KW.exclude.find((k) => haystack.includes(k));
  if (excludeHit) return { passes: false, reason: `exclude:${excludeHit}` };
  return { passes: true };
}

function detectArticleType(article) {
  const text = normalize(`${article.title || ''} ${article.fullText || ''}`);
  const indicators = (list) => list.filter((w) => text.includes(normalize(w))).length;
  const review = indicators(sentiment.review_indicators || []);
  const interview = indicators(sentiment.interview_indicators || []);
  const announcement = indicators(sentiment.announcement_indicators || []);

  const max = Math.max(review, interview, announcement);
  if (max === 0) return 'news';
  if (max === review) return 'review';
  if (max === interview) return 'interview';
  return 'announcement';
}

function isReview(article) {
  return detectArticleType(article) === 'review';
}

function findContextualMatch(text, keyword, contextWords, windowChars = 200) {
  const idx = text.indexOf(keyword);
  if (idx === -1) return false;
  const start = Math.max(0, idx - windowChars);
  const end = Math.min(text.length, idx + keyword.length + windowChars);
  const window = text.slice(start, end);
  return contextWords.some((c) => window.includes(c));
}

function calculateRelevance(article, sourcePriority = 50) {
  const w = keywords.scoring_weights;
  const title = normalize(article.title || '');
  const text = normalize(article.fullText || '');
  const haystack = `${title} ${text}`;
  let score = 0;
  const reasons = [];
  const matches = {
    required: [],
    productions: [],
    people: [],
    venues: [],
    theaterContext: false,
  };

  let titleHasRequired = false;
  for (const req of KW.required) {
    if (title.includes(req)) {
      score += w.title_exact_match || 80;
      reasons.push(`Titel: "${req}"`);
      titleHasRequired = true;
      matches.required.push(req);
      break;
    }
  }
  if (!titleHasRequired) {
    for (const req of KW.required) {
      if (text.includes(req)) {
        const count = countOccurrences(text, req);
        const pts = (w.required_keyword || 10) * Math.min(count, 5);
        score += pts;
        reasons.push(`${count}x "${req}" im Text (+${pts})`);
        matches.required.push(req);
        break;
      }
    }
  }

  let productionInTitle = false;
  for (const p of KW.productions) {
    if (!p || p.length < 3) continue;
    if (title.includes(p)) {
      score += w.production_in_title || 50;
      reasons.push(`Produktion im Titel: ${p}`);
      matches.productions.push(p);
      productionInTitle = true;
    } else if (text.includes(p)) {
      const isContextual = findContextualMatch(text, p, KW.required, 400);
      const pts = isContextual
        ? w.production_match || 25
        : Math.floor((w.production_match || 25) / 2);
      score += pts;
      reasons.push(`Produktion: ${p}${isContextual ? ' (Kontext OK)' : ''} (+${pts})`);
      matches.productions.push(p);
    } else if (p.length >= 8 && findFuzzyMatch(haystack, p, 0.9)) {
      score += w.fuzzy_title_match || 30;
      reasons.push(`Produktion (fuzzy): ${p}`);
      matches.productions.push(p);
    }
  }
  if (productionInTitle && titleHasRequired) {
    score += w.title_with_production || 100;
    reasons.push('Titel: Kammerspiele + Produktion');
  }

  for (const person of KW.people) {
    if (!person || person.length < 4) continue;
    if (title.includes(person)) {
      score += w.people_in_title || 40;
      reasons.push(`Person im Titel: ${person}`);
      matches.people.push(person);
    } else if (text.includes(person)) {
      const isContextual = findContextualMatch(text, person, KW.required, 400);
      const pts = isContextual ? w.people_match || 20 : Math.floor((w.people_match || 20) / 2);
      score += pts;
      reasons.push(`Person: ${person}${isContextual ? ' (Kontext OK)' : ''} (+${pts})`);
      matches.people.push(person);
    }
  }

  for (const venue of KW.venues) {
    if (!venue || venue.length < 5) continue;
    if (text.includes(venue) || title.includes(venue)) {
      score += w.venue_match || 10;
      matches.venues.push(venue);
    }
  }

  const contextHits = KW.theaterContext.filter((c) => haystack.includes(c)).length;
  if (contextHits >= 2) {
    score += w.theater_context_bonus || 8;
    matches.theaterContext = true;
    reasons.push(`Theater-Kontext (${contextHits} Begriffe)`);
  }

  const type = detectArticleType(article);
  if (type === 'review') {
    score += w.review || 30;
    reasons.push('Typ: Kritik');
  } else if (type === 'interview') {
    score += w.interview || 25;
    reasons.push('Typ: Interview');
  } else if (type === 'announcement') {
    score += w.announcement || 20;
    reasons.push('Typ: Ankuendigung');
  }

  if (haystack.includes('premiere')) {
    score += w.premiere_bonus || 20;
    reasons.push('Premiere erwaehnt');
  }

  const wordCount =
    article.wordCount || (article.fullText || '').split(/\s+/).filter(Boolean).length;
  const minWords = keywords.thresholds.min_word_count || 50;
  const shortThreshold = keywords.thresholds.short_article_word_count || 100;
  if (wordCount > 0 && wordCount < minWords) {
    score += w.very_short_article_penalty || -50;
    reasons.push('sehr kurz');
  } else if (wordCount > 0 && wordCount < shortThreshold) {
    score += w.short_article_penalty || -20;
    reasons.push('kurz');
  }

  if (sourcePriority >= 95) {
    score += 15;
    reasons.push('Top-Quelle (+15)');
  } else if (sourcePriority >= 80) {
    score += 8;
    reasons.push('etablierte Quelle (+8)');
  }

  const category = categorize(score);
  return { score: Math.max(0, score), reasons, category, articleType: type, matches };
}

function categorize(score) {
  const t = keywords.thresholds;
  if (score >= (t.very_relevant || 80)) return 'sehr_relevant';
  if (score >= (t.relevant || 50)) return 'relevant';
  if (score >= (t.maybe_relevant || 30)) return 'moeglich_relevant';
  return 'irrelevant';
}

function matchesAnyStem(token, stems) {
  if (stems.has(token)) return true;
  for (const stem of stems) {
    if (stem.length < 4) continue;
    if (token.length >= stem.length && token.length <= stem.length + 4 && token.startsWith(stem)) {
      return true;
    }
  }
  return false;
}

function analyzeSentiment(text) {
  if (!text) return { label: 'neutral', score: 0, positiveHits: [], negativeHits: [] };
  const normalized = normalize(text);
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const positiveSet = new Set(sentiment.positive.map(normalize));
  const negativeSet = new Set(sentiment.negative.map(normalize));
  const negations = new Set(sentiment.negations.map(normalize));
  const intensifiers = new Set(sentiment.intensifiers.map(normalize));

  let score = 0;
  const positiveHits = [];
  const negativeHits = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let weight = 1;
    let polarity = 0;
    if (matchesAnyStem(tok, positiveSet)) polarity = 1;
    else if (matchesAnyStem(tok, negativeSet)) polarity = -1;
    if (polarity === 0) continue;

    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (negations.has(tokens[j])) polarity = -polarity;
      if (intensifiers.has(tokens[j])) weight = 2;
    }

    score += polarity * weight;
    if (polarity > 0) positiveHits.push(tok);
    else negativeHits.push(tok);
  }

  const t = sentiment.thresholds || { positive: 2, negative: -2 };
  let label = 'neutral';
  if (score >= (t.positive || 2)) label = 'positiv';
  else if (score <= (t.negative || -2)) label = 'negativ';

  return { label, score, positiveHits, negativeHits };
}

function generateSummary(article, maxLength) {
  const limit = maxLength || (settings.reports && settings.reports.max_summary_length) || 320;
  const text = (article.fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text.slice(0, limit) + '…';
  const normalizedTitle = normalize(article.title || '');
  const requiredHits = KW.required;
  const productionHits = KW.productions;

  const scored = sentences.slice(0, 30).map((s, idx) => {
    const ns = normalize(s);
    let sc = 0;
    if (idx === 0) sc += 3;
    if (idx < 3) sc += 1;
    for (const r of requiredHits) if (ns.includes(r)) sc += 4;
    for (const p of productionHits) if (p.length >= 4 && ns.includes(p)) sc += 3;
    if (
      normalizedTitle &&
      levenshteinSimilarity(ns.slice(0, 80), normalizedTitle.slice(0, 80)) > 0.3
    )
      sc += 1;
    if (s.length < 30) sc -= 2;
    return { s, sc, idx };
  });
  scored.sort((a, b) => b.sc - a.sc || a.idx - b.idx);

  let summary = '';
  const used = new Set();
  for (const { s, idx } of scored) {
    if ((summary + ' ' + s).trim().length > limit) continue;
    used.add(idx);
    summary = (summary + ' ' + s).trim();
    if (summary.length >= limit * 0.7) break;
  }
  if (!summary) summary = text.slice(0, limit) + '…';
  return summary;
}

function analyze(article, sourcePriority = 50) {
  const filter = passesRequiredFilter(article);
  const relevance = calculateRelevance(article, sourcePriority);
  const sentimentResult = analyzeSentiment(`${article.title} ${article.fullText || ''}`);
  const summary = generateSummary(article);
  return {
    passes: filter.passes,
    rejectReason: filter.reason,
    relevanceScore: relevance.score,
    relevanceReasons: relevance.reasons,
    relevanceMatches: relevance.matches,
    category: relevance.category,
    articleType: relevance.articleType,
    sentiment: sentimentResult.label,
    sentimentScore: sentimentResult.score,
    sentimentHits: {
      positive: sentimentResult.positiveHits,
      negative: sentimentResult.negativeHits,
    },
    summary,
  };
}

module.exports = {
  analyze,
  analyzeSentiment,
  calculateRelevance,
  passesRequiredFilter,
  detectArticleType,
  isReview,
  generateSummary,
  categorize,
  findContextualMatch,
  findFuzzyMatch,
  normalize,
};
