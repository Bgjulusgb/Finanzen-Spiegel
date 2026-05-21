'use strict';

const { sentiment: SENTI_CFG, dax: DAX } = require('./config');
const { escapeRegex } = require('./utils');

// Vorberechnen: pro Aktie ein RegExp ueber alle Suchworte (case-insensitive, Wortgrenzen).
function compileStockMatchers(stocks = DAX) {
  return stocks.map((s) => {
    const terms = [...new Set([...s.queries, ...(s.synonyms || [])])]
      .map((t) => t.trim())
      .filter(Boolean);
    const escaped = terms.map(escapeRegex).sort((a, b) => b.length - a.length);
    // Wortgrenzen funktionieren mit Unicode-Buchstaben so leider nicht universell;
    // wir setzen vor/nach: Anfang/Ende oder Nicht-Buchstabe.
    const pattern = new RegExp(`(?<![\\p{L}\\d])(?:${escaped.join('|')})(?![\\p{L}\\d])`, 'giu');
    return { stock: s, pattern, terms };
  });
}

const STOCK_MATCHERS = compileStockMatchers();

function findStockMentions(title, body) {
  const titleTxt = String(title || '');
  const bodyTxt = String(body || '');
  const combined = titleTxt + '\n' + bodyTxt;
  const out = {};
  for (const { stock, pattern } of STOCK_MATCHERS) {
    const matches = combined.match(pattern);
    if (!matches || matches.length === 0) continue;
    const titleMatch = pattern.test(titleTxt);
    pattern.lastIndex = 0; // reset stateful regex (global flag)
    out[stock.symbol] = {
      mentions: matches.length,
      title_hit: titleMatch,
    };
  }
  return out;
}

// --- Sentiment ---

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .normalize('NFC')
    .match(/[\p{L}\p{N}'-]+/gu) || [];
}

function buildLex(langCode) {
  const lc = (langCode || 'de').slice(0, 2);
  const block = SENTI_CFG.lang[lc] || SENTI_CFG.lang.de;
  return {
    pos: new Set(block.positive.map((w) => w.toLowerCase())),
    neg: new Set(block.negative.map((w) => w.toLowerCase())),
    negation: new Set((SENTI_CFG.negation[lc] || SENTI_CFG.negation.de).map((w) => w.toLowerCase())),
    window: SENTI_CFG.negation_window || 3,
  };
}

const LEX_CACHE = new Map();
function getLex(lang) {
  if (!LEX_CACHE.has(lang)) LEX_CACHE.set(lang, buildLex(lang));
  return LEX_CACHE.get(lang);
}

function scoreSentiment(text, lang = 'de') {
  const lex = getLex(lang);
  const toks = tokenize(text);
  let pos = 0, neg = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isPos = lex.pos.has(t);
    const isNeg = lex.neg.has(t);
    if (!isPos && !isNeg) continue;
    let negated = false;
    for (let j = Math.max(0, i - lex.window); j < i; j++) {
      if (lex.negation.has(toks[j])) { negated = true; break; }
    }
    if (isPos) negated ? neg++ : pos++;
    else if (isNeg) negated ? pos++ : neg++;
  }
  const total = pos + neg;
  const polarity = total === 0 ? 0 : (pos - neg) / total;
  let label = 'neutral';
  if (polarity > 0.15) label = 'positiv';
  else if (polarity < -0.15) label = 'negativ';
  return { polarity, pos_hits: pos, neg_hits: neg, label };
}

module.exports = {
  findStockMentions, scoreSentiment, compileStockMatchers,
  STOCK_MATCHERS,
};
