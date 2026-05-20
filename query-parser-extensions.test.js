'use strict';

const Fuse = require('fuse.js');
const natural = require('natural');
const leven = require('js-levenshtein');
const { LRUCache } = require('lru-cache');
const { keywords, settings, loadJson } = require('./config');
const { normalize } = require('./analyzer');
const { parseQuery, queryToBM25String, articleMatchesStructured } = require('./query-parser');
const { germanCompoundSplit, colognePhonetic, extractSnippet } = require('./text-utils');

// Configurable defaults — override via config/settings.json "search" section
const SC = settings.search || {};
const BM25_CFG = SC.bm25 || {};
const FUSE_CFG = SC.fuse || {};
const HYBRID_CFG = SC.hybrid || {};
const CACHE_CFG = SC.cache || {};
const SUGGEST_CFG = SC.suggestions || {};
const DYM_CFG = SC.did_you_mean || {};
const TOK_CFG = SC.tokenizer || {};

const STOP_CFG = SC.stopwords || {};

const CFG = {
  bm25K1: BM25_CFG.k1 ?? 1.5,
  bm25B: BM25_CFG.b ?? 0.75,
  titleBoost: BM25_CFG.title_boost ?? 4,
  summaryBoost: BM25_CFG.summary_boost ?? 1,
  bodyBoost: BM25_CFG.body_boost ?? 1,
  recencyHalfLife: BM25_CFG.recency_half_life_days ?? 30,
  recencyMode: BM25_CFG.recency_mode ?? 'exponential', // exponential | linear | none
  withCompoundSplit: BM25_CFG.with_compound_split ?? true,
  withPhonetic: BM25_CFG.with_phonetic ?? true,
  withPositions: BM25_CFG.with_positions ?? true,
  withBigrams: BM25_CFG.with_bigrams ?? true,
  bigramBoost: BM25_CFG.bigram_boost ?? 0.5,
  phraseTitleBonus: BM25_CFG.phrase_title_bonus ?? 0.3,
  fuseThreshold: FUSE_CFG.threshold ?? 0.45,
  fuseDistance: FUSE_CFG.distance ?? 200,
  fuseMinMatch: FUSE_CFG.min_match_chars ?? 3,
  hybridBm25Weight: HYBRID_CFG.bm25_weight ?? 0.65,
  hybridFuseWeight: HYBRID_CFG.fuse_weight ?? 0.35,
  defaultLimit: HYBRID_CFG.default_limit ?? 50,
  sourceBoostHighThreshold: HYBRID_CFG.source_boost_high_threshold ?? 95,
  sourceBoostHigh: HYBRID_CFG.source_boost_high ?? 1.1,
  sourceBoostMidThreshold: HYBRID_CFG.source_boost_mid_threshold ?? 80,
  sourceBoostMid: HYBRID_CFG.source_boost_mid ?? 1.05,
  cacheMax: CACHE_CFG.max_entries ?? 200,
  cacheTtl: CACHE_CFG.ttl_ms ?? 60_000,
  tokenizeCacheMax: CACHE_CFG.tokenize_cache_max ?? 5000,
  suggestMax: SUGGEST_CFG.max_results ?? 10,
  suggestMinPrefix: SUGGEST_CFG.min_prefix_length ?? 2,
  dymMinLength: DYM_CFG.min_query_length ?? 4,
  dymMaxDistance: DYM_CFG.max_distance ?? 3,
  minTokenLength: TOK_CFG.min_token_length ?? 3,
  minPhoneticLength: TOK_CFG.min_phonetic_length ?? 4,
  proximityMaxWindow: TOK_CFG.proximity_max_window ?? 8,
  stopwordsDisableDefaults: STOP_CFG.disable_defaults ?? false,
  stopwordsCustom: STOP_CFG.custom ?? [],
};

const DEFAULT_GERMAN_STOPWORDS = [
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'einen',
  'einer',
  'eines',
  'einem',
  'und',
  'oder',
  'aber',
  'denn',
  'doch',
  'sondern',
  'weil',
  'wenn',
  'dass',
  'ist',
  'sind',
  'war',
  'waren',
  'wird',
  'werden',
  'wurde',
  'wurden',
  'sein',
  'seine',
  'seiner',
  'seinem',
  'seinen',
  'ihrer',
  'ihrem',
  'ihren',
  'auf',
  'an',
  'in',
  'im',
  'aus',
  'bei',
  'mit',
  'nach',
  'von',
  'vom',
  'zu',
  'zur',
  'zum',
  'fuer',
  'fur',
  'durch',
  'ueber',
  'unter',
  'vor',
  'gegen',
  'ohne',
  'als',
  'wie',
  'auch',
  'noch',
  'nur',
  'schon',
  'sehr',
  'mehr',
  'kann',
  'koennte',
  'soll',
  'sollte',
  'will',
  'wollte',
  'muss',
  'man',
  'er',
  'sie',
  'es',
  'wir',
  'ihr',
  'ich',
  'du',
  'mich',
  'mir',
  'dir',
  'sich',
  'dem',
  'den',
  'des',
  'so',
  'nicht',
  'nichts',
  'kein',
  'keine',
  'da',
  'dort',
  'hier',
  'jetzt',
  'dann',
  'noch',
  'mal',
  'am',
];

const GERMAN_STOPWORDS = new Set(
  CFG.stopwordsDisableDefaults
    ? CFG.stopwordsCustom
    : [...DEFAULT_GERMAN_STOPWORDS, ...CFG.stopwordsCustom]
);

const tokenizer = new natural.AggressiveTokenizerDe();
const stemmer = natural.PorterStemmerDe;

const SYNONYMS_MAP = new Map();
try {
  const syn = loadJson('synonyms.json');
  for (const group of syn.groups || []) {
    const normalized = group.map((g) => stemmer.stem(normalize(g)));
    for (const t of normalized) SYNONYMS_MAP.set(t, normalized);
  }
} catch {
  /* synonyms optional */
}

function expandWithSynonyms(stems) {
  const expanded = new Set();
  for (const s of stems) {
    expanded.add(s);
    if (SYNONYMS_MAP.has(s)) {
      for (const syn of SYNONYMS_MAP.get(s)) expanded.add(syn);
    }
  }
  return [...expanded];
}

const TOKENIZE_CACHE = new LRUCache({ max: CFG.tokenizeCacheMax });

function tokenizeAndStem(text, { withSynonyms = false, withCompoundSplit = false } = {}) {
  if (!text) return [];
  const cacheKey = `${withSynonyms ? 's' : ''}${withCompoundSplit ? 'c' : ''}::${text.length}::${text.slice(0, 200)}`;
  const cached = TOKENIZE_CACHE.get(cacheKey);
  if (cached) return cached;

  const normalized = normalize(text);
  const tokens = tokenizer.tokenize(normalized) || [];
  const minLen = CFG.minTokenLength;
  const stems = [];
  for (const t of tokens) {
    if (t.length < minLen || GERMAN_STOPWORDS.has(t)) continue;
    stems.push(stemmer.stem(t));
    if (withCompoundSplit && t.length >= 9) {
      const parts = germanCompoundSplit(t);
      for (const part of parts) {
        if (part.length >= 3 && !GERMAN_STOPWORDS.has(part)) {
          stems.push(stemmer.stem(part));
        }
      }
    }
  }
  const result = withSynonyms ? expandWithSynonyms(stems) : stems;
  TOKENIZE_CACHE.set(cacheKey, result);
  return result;
}

function tokenizeBigrams(text) {
  if (!text) return new Set();
  const normalized = normalize(text);
  const tokens = (tokenizer.tokenize(normalized) || []).filter(
    (t) => t.length >= CFG.minTokenLength && !GERMAN_STOPWORDS.has(t)
  );
  const stems = tokens.map((t) => stemmer.stem(t));
  const bigrams = new Set();
  for (let i = 0; i + 1 < stems.length; i++) {
    bigrams.add(`${stems[i]}~${stems[i + 1]}`);
  }
  return bigrams;
}

function tokenizePhonetic(text) {
  if (!text) return new Set();
  const normalized = normalize(text);
  const tokens = tokenizer.tokenize(normalized) || [];
  const minLen = CFG.minPhoneticLength;
  const codes = new Set();
  for (const t of tokens) {
    if (t.length < minLen || GERMAN_STOPWORDS.has(t)) continue;
    const code = colognePhonetic(t);
    if (code) codes.add(code);
  }
  return codes;
}

function tokenizePositions(text) {
  if (!text) return [];
  const normalized = normalize(text);
  const tokens = tokenizer.tokenize(normalized) || [];
  const positions = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 3 || GERMAN_STOPWORDS.has(tok)) continue;
    positions.push({ stem: stemmer.stem(tok), pos: i });
  }
  return positions;
}

function proximityBoost(queryStems, doc, { maxWindow = CFG.proximityMaxWindow } = {}) {
  if (!doc.positions || queryStems.length < 2) return 0;
  const uniqQuery = [...new Set(queryStems)];
  const indexByStem = new Map();
  for (const { stem, pos } of doc.positions) {
    if (!indexByStem.has(stem)) indexByStem.set(stem, []);
    indexByStem.get(stem).push(pos);
  }
  const presentTerms = uniqQuery.filter((t) => indexByStem.has(t));
  if (presentTerms.length < 2) return 0;

  let bestSpan = Infinity;
  for (let i = 0; i < presentTerms.length; i++) {
    for (let j = i + 1; j < presentTerms.length; j++) {
      const posA = indexByStem.get(presentTerms[i]);
      const posB = indexByStem.get(presentTerms[j]);
      for (const a of posA) {
        for (const b of posB) {
          const diff = Math.abs(a - b);
          if (diff < bestSpan) bestSpan = diff;
        }
      }
    }
  }
  if (!isFinite(bestSpan) || bestSpan > maxWindow * 4) return 0;
  if (bestSpan <= 1) return 0.5;
  if (bestSpan <= maxWindow) return 0.5 * (1 - (bestSpan - 1) / maxWindow);
  return 0.1 * (1 - Math.min(1, bestSpan / (maxWindow * 4)));
}

function computeRecency(article, halfLife, mode, now = Date.now()) {
  if (mode === 'none' || !article.published_date) return 1;
  const ageDays = (now - new Date(article.published_date).getTime()) / 86400000;
  const t = Math.max(0, ageDays);
  if (mode === 'linear') {
    const lifespan = halfLife * 4;
    return Math.max(0, 1 - t / lifespan);
  }
  return Math.pow(0.5, t / halfLife);
}

class BM25Index {
  constructor(
    articles,
    {
      k1 = CFG.bm25K1,
      b = CFG.bm25B,
      titleBoost = CFG.titleBoost,
      summaryBoost = CFG.summaryBoost,
      bodyBoost = CFG.bodyBoost,
      recencyHalfLife = CFG.recencyHalfLife,
      recencyMode = CFG.recencyMode,
      withPositions = CFG.withPositions,
      withCompoundSplit = CFG.withCompoundSplit,
      withPhonetic = CFG.withPhonetic,
      withBigrams = CFG.withBigrams,
    } = {}
  ) {
    this.k1 = k1;
    this.b = b;
    this.titleBoost = titleBoost;
    this.summaryBoost = summaryBoost;
    this.bodyBoost = bodyBoost;
    this.recencyHalfLife = recencyHalfLife;
    this.recencyMode = recencyMode;
    this.docs = [];
    this.df = new Map();
    this.avgdl = 0;
    this.withPhonetic = withPhonetic;
    this.withBigrams = withBigrams;

    const now = Date.now();
    let totalLen = 0;
    for (const article of articles) {
      const titleTokens = tokenizeAndStem(article.title, { withCompoundSplit });
      const summaryTokens = tokenizeAndStem(article.summary || '', { withCompoundSplit });
      const bodyTokens = tokenizeAndStem(article.full_text || article.fullText || '', {
        withCompoundSplit,
      });
      const allTokens = [
        ...Array(this.titleBoost).fill(titleTokens).flat(),
        ...Array(this.summaryBoost).fill(summaryTokens).flat(),
        ...Array(this.bodyBoost).fill(bodyTokens).flat(),
      ];
      const tf = new Map();
      for (const t of allTokens) tf.set(t, (tf.get(t) || 0) + 1);
      const seen = new Set(allTokens);
      for (const t of seen) this.df.set(t, (this.df.get(t) || 0) + 1);

      const recency = computeRecency(article, this.recencyHalfLife, this.recencyMode, now);

      const positions = withPositions
        ? tokenizePositions(
            `${article.title || ''} ${article.summary || ''} ${article.full_text || article.fullText || ''}`
          )
        : null;

      const phoneticCodes = withPhonetic
        ? tokenizePhonetic(`${article.title || ''} ${article.summary || ''}`)
        : null;

      const bigrams = withBigrams
        ? tokenizeBigrams(
            `${article.title || ''} ${article.summary || ''} ${article.full_text || article.fullText || ''}`
          )
        : null;

      this.docs.push({
        article,
        tf,
        len: allTokens.length,
        recency,
        sourcePriority: article.source_priority || 50,
        positions,
        titleStems: new Set(titleTokens),
        phoneticCodes,
        bigrams,
      });
      totalLen += allTokens.length;
    }
    this.avgdl = this.docs.length ? totalLen / this.docs.length : 0;
    this.N = this.docs.length;
  }

  idf(term) {
    const n = this.df.get(term) || 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  score(
    queryStems,
    doc,
    {
      applyRecency = true,
      applyProximity = true,
      applyCoverage = true,
      phoneticCodes = null,
      queryBigrams = null,
    } = {}
  ) {
    let score = 0;
    let matched = 0;
    for (const term of queryStems) {
      const tf = doc.tf.get(term) || 0;
      if (tf === 0) continue;
      matched++;
      const idf = this.idf(term);
      const norm = 1 - this.b + this.b * (doc.len / (this.avgdl || 1));
      score += idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
    }
    if (
      score === 0 &&
      phoneticCodes &&
      doc.phoneticCodes &&
      phoneticCodes.size &&
      doc.phoneticCodes.size
    ) {
      let phoneticHits = 0;
      for (const code of phoneticCodes) {
        if (doc.phoneticCodes.has(code)) phoneticHits++;
      }
      if (phoneticHits > 0) {
        score = 0.3 * phoneticHits;
        matched = phoneticHits;
      }
    }
    if (score === 0) return 0;
    if (applyCoverage && queryStems.length > 1) {
      const coverage = matched / queryStems.length;
      score *= 0.3 + 0.7 * coverage;
    }
    if (applyProximity && doc.positions && queryStems.length >= 2) {
      score *= 1 + proximityBoost(queryStems, doc);
    }
    // Bigram bonus: if query has adjacent stems that also appear adjacent in the doc
    if (queryBigrams && doc.bigrams && queryBigrams.size && doc.bigrams.size) {
      let bigramHits = 0;
      for (const bg of queryBigrams) {
        if (doc.bigrams.has(bg)) bigramHits++;
      }
      if (bigramHits > 0) score *= 1 + CFG.bigramBoost * bigramHits;
    }
    if (doc.titleStems && doc.titleStems.size) {
      const titleHits = queryStems.filter((t) => doc.titleStems.has(t)).length;
      if (titleHits > 0) score *= 1 + 0.15 * titleHits;
    }
    if (applyRecency) score *= 0.5 + doc.recency;
    return score;
  }

  search(
    query,
    {
      limit = CFG.defaultLimit,
      withSynonyms = true,
      applyRecency = true,
      applyProximity = true,
      withPhonetic = true,
    } = {}
  ) {
    if (!query || !query.trim()) return [];
    const stems = tokenizeAndStem(query, { withSynonyms, withCompoundSplit: true });
    if (stems.length === 0) return [];
    const phoneticCodes = withPhonetic ? tokenizePhonetic(query) : null;
    const queryBigrams = this.withBigrams ? tokenizeBigrams(query) : null;
    const scored = this.docs
      .map((doc) => ({
        article: doc.article,
        score: this.score(stems, doc, {
          applyRecency,
          applyProximity,
          phoneticCodes,
          queryBigrams,
        }),
      }))
      .filter((r) => r.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

function buildFuse(articles) {
  const weights = (SC.fuse && SC.fuse.weights) || {};
  return new Fuse(articles, {
    keys: [
      { name: 'title', weight: weights.title ?? 0.5 },
      { name: 'summary', weight: weights.summary ?? 0.3 },
      { name: 'source', weight: weights.source ?? 0.1 },
      { name: 'author', weight: weights.author ?? 0.05 },
      { name: 'full_text', weight: weights.full_text ?? 0.05 },
    ],
    threshold: CFG.fuseThreshold,
    distance: CFG.fuseDistance,
    ignoreLocation: true,
    minMatchCharLength: CFG.fuseMinMatch,
    includeScore: true,
    useExtendedSearch: true,
    findAllMatches: false,
  });
}

const SEARCH_CACHE = new LRUCache({
  max: CFG.cacheMax,
  ttl: CFG.cacheTtl,
  allowStale: false,
  updateAgeOnGet: false,
});

function cacheKey(articles, query, opts) {
  const ids =
    articles.length > 0
      ? articles[0].id + ':' + articles[articles.length - 1].id + ':' + articles.length
      : 'empty';
  return `${ids}|${query}|${JSON.stringify(opts)}`;
}

function clearSearchCache() {
  SEARCH_CACHE.clear();
  TOKENIZE_CACHE.clear();
}

function runHybridSearch(articles, query, { limit, withSynonyms, applyRecency }) {
  const parsed = parseQuery(query);
  let filteredArticles = articles;
  if (parsed && parsed.isStructured) {
    filteredArticles = articles.filter((a) => articleMatchesStructured(a, parsed));
    if (filteredArticles.length === 0) {
      return { results: [], filteredCount: 0 };
    }
  }

  const bm25Query = parsed ? queryToBM25String(parsed) || query : query;
  const bm25 = new BM25Index(filteredArticles);
  const bm25Results = bm25.search(bm25Query, { limit: limit * 2, withSynonyms, applyRecency });
  const bm25Map = new Map(bm25Results.map((r) => [r.article.id, r.score]));

  const fuse = buildFuse(filteredArticles);
  const fuseResults = fuse.search(bm25Query, { limit: limit * 2 });
  const fuseMap = new Map(fuseResults.map((r) => [r.item.id, 1 - (r.score || 0)]));

  const allIds = new Set([...bm25Map.keys(), ...fuseMap.keys()]);
  const maxBm25 = Math.max(...bm25Results.map((r) => r.score), 1);
  const w1 = CFG.hybridBm25Weight;
  const w2 = CFG.hybridFuseWeight;

  const combined = [];
  for (const id of allIds) {
    const article = filteredArticles.find((a) => a.id === id);
    if (!article) continue;
    const bm25Norm = (bm25Map.get(id) || 0) / maxBm25;
    const fuseNorm = fuseMap.get(id) || 0;
    let score = bm25Norm * w1 + fuseNorm * w2;

    if (parsed && parsed.must.some((t) => t.type === 'phrase')) {
      const titleLower = (article.title || '').toLowerCase();
      for (const phrase of parsed.must.filter((t) => t.type === 'phrase')) {
        if (titleLower.includes(phrase.value.toLowerCase())) score += CFG.phraseTitleBonus;
      }
    }

    const sp = article.source_priority || 0;
    if (sp >= CFG.sourceBoostHighThreshold) score *= CFG.sourceBoostHigh;
    else if (sp >= CFG.sourceBoostMidThreshold) score *= CFG.sourceBoostMid;

    combined.push({ article, score, bm25: bm25Norm, fuzzy: fuseNorm });
  }
  combined.sort((a, b) => b.score - a.score);
  return { results: combined.slice(0, limit), filteredCount: filteredArticles.length };
}

function hybridSearch(articles, query, opts = {}) {
  const {
    limit = CFG.defaultLimit,
    withSynonyms = true,
    applyRecency = true,
    cache = true,
    didYouMeanFallback = true,
  } = opts;
  if (!query || !query.trim()) {
    return articles.slice(0, limit).map((a) => ({ article: a, score: 0 }));
  }

  const key = cache ? cacheKey(articles, query, { limit, withSynonyms, applyRecency }) : null;
  if (key) {
    const cached = SEARCH_CACHE.get(key);
    if (cached) return cached;
  }

  const { results: initialResults, filteredCount } = runHybridSearch(articles, query, {
    limit,
    withSynonyms,
    applyRecency,
  });
  let results = initialResults;

  const hasStructuredOperators = /[+\-:"]|\b(AND|OR|NOT)\b/.test(query);
  if (didYouMeanFallback && results.length === 0 && filteredCount > 0 && !hasStructuredOperators) {
    const suggestion = didYouMean(query, articles);
    if (suggestion && suggestion !== query) {
      const fallback = runHybridSearch(articles, suggestion, { limit, withSynonyms, applyRecency });
      if (fallback.results.length > 0) {
        results = fallback.results.map((r) => ({ ...r, _viaDidYouMean: suggestion }));
      }
    }
  }

  if (key) SEARCH_CACHE.set(key, results);
  return results;
}

function queryTerms(query) {
  const parsed = parseQuery(query);
  const literals = [];
  if (parsed) {
    for (const m of [...parsed.must, ...parsed.should]) {
      if (m.value && m.value.length >= 3) literals.push(m.value);
    }
  } else if (query) {
    literals.push(...query.split(/\s+/).filter((t) => t.length >= 3));
  }
  const stems = [...new Set(tokenizeAndStem(query || ''))];
  return [...new Set([...literals, ...stems])];
}

function highlightTerms(text, query) {
  if (!query || !text) return text;
  const all = queryTerms(query);
  if (!all.length) return text;
  const escaped = all.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function snippetFor(article, query, { maxLen = 240 } = {}) {
  if (!article) return '';
  const text = article.summary || article.full_text || article.fullText || '';
  if (!query || !text) return text.slice(0, maxLen);
  const terms = queryTerms(query);
  return extractSnippet(text, terms, { maxLen });
}

function multiSnippetsFor(article, query, { maxLen = 200, count = 3 } = {}) {
  if (!article) return [];
  const text = article.full_text || article.fullText || article.summary || '';
  if (!query || !text) return [text.slice(0, maxLen)].filter(Boolean);
  const terms = queryTerms(query).map((t) => t.toLowerCase());
  if (!terms.length) return [text.slice(0, maxLen)];
  const lower = text.toLowerCase();
  const hits = [];
  for (const term of terms) {
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(term, from);
      if (idx === -1) break;
      hits.push(idx);
      from = idx + term.length;
    }
  }
  if (!hits.length) return [text.slice(0, maxLen)];
  hits.sort((a, b) => a - b);
  // Cluster nearby hits so we don't emit overlapping snippets
  const snippets = [];
  let lastEnd = -1;
  for (const idx of hits) {
    if (idx < lastEnd) continue;
    const start = Math.max(0, idx - Math.floor(maxLen / 3));
    const end = Math.min(text.length, start + maxLen);
    snippets.push(
      (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '')
    );
    lastEnd = end;
    if (snippets.length >= count) break;
  }
  return snippets;
}

function suggestQueries(prefix, articles) {
  if (!prefix || prefix.length < CFG.suggestMinPrefix) return [];
  const lower = normalize(prefix);
  const candidates = new Map();

  function add(term, weight = 1) {
    if (!term) return;
    candidates.set(term, (candidates.get(term) || 0) + weight);
  }

  for (const a of articles) {
    if (a.source && normalize(a.source).startsWith(lower)) add(a.source, 5);
    const words = normalize(a.title || '').split(/\s+/);
    for (const w of words) {
      if (w.length >= 3 && w.startsWith(lower)) add(w, 2);
    }
  }
  for (const kw of [
    ...(keywords.productions || []),
    ...(keywords.people || []),
    ...(keywords.venues || []),
  ]) {
    if (kw && normalize(kw).startsWith(lower)) add(kw, 10);
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CFG.suggestMax)
    .map(([term]) => term);
}

function didYouMean(query, articles, { threshold = CFG.dymMaxDistance } = {}) {
  if (!query || query.length < CFG.dymMinLength) return null;
  const allTerms = new Set();
  for (const a of articles) {
    for (const w of normalize(a.title || '').split(/\s+/)) {
      if (w.length >= 4) allTerms.add(w);
    }
  }
  for (const kw of [...(keywords.productions || []), ...(keywords.people || [])]) {
    for (const w of normalize(kw).split(/\s+/)) if (w.length >= 4) allTerms.add(w);
  }
  const queryTerms = normalize(query).split(/\s+/);
  const suggestions = [];
  for (const qt of queryTerms) {
    if (qt.length < 4) {
      suggestions.push(qt);
      continue;
    }
    if (allTerms.has(qt)) {
      suggestions.push(qt);
      continue;
    }
    let best = null,
      bestDist = Infinity;
    for (const term of allTerms) {
      if (Math.abs(term.length - qt.length) > threshold) continue;
      const d = leven(qt, term);
      if (d > 0 && d <= threshold && d < bestDist) {
        bestDist = d;
        best = term;
      }
    }
    suggestions.push(best || qt);
  }
  const result = suggestions.join(' ');
  return result.toLowerCase() === normalize(query).toLowerCase() ? null : result;
}

function topMentions(articles, { minLen = 4, limit = 30 } = {}) {
  const counts = new Map();
  for (const a of articles) {
    const text = (a.title || '') + ' ' + (a.summary || '');
    const tokens = tokenizeAndStem(text);
    const seen = new Set();
    for (const t of tokens) {
      if (t.length < minLen || seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function trends(articlesA, articlesB) {
  const a = topMentions(articlesA, { limit: 100 });
  const b = topMentions(articlesB, { limit: 100 });
  const bMap = new Map(b.map((x) => [x.term, x.count]));
  return a
    .map(({ term, count }) => {
      const prev = bMap.get(term) || 0;
      const diff = count - prev;
      return { term, count, previous: prev, change: diff };
    })
    .sort((x, y) => y.change - x.change);
}

module.exports = {
  BM25Index,
  buildFuse,
  hybridSearch,
  highlightTerms,
  snippetFor,
  multiSnippetsFor,
  queryTerms,
  suggestQueries,
  didYouMean,
  topMentions,
  trends,
  tokenizeAndStem,
  tokenizeBigrams,
  tokenizePhonetic,
  clearSearchCache,
  computeRecency,
  GERMAN_STOPWORDS,
  CFG: { ...CFG },
};
