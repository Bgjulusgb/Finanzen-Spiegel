'use strict';

const { sentiment: SENTI_CFG, dax: DAX } = require('./config');
const { escapeRegex } = require('./utils');

// ---------- Stock-Matcher ----------

function compileStockMatchers(stocks = DAX) {
  return stocks.map((s) => {
    const terms = [...new Set([...s.queries, ...(s.synonyms || [])])]
      .map((t) => t.trim()).filter(Boolean);
    const escaped = terms.map(escapeRegex).sort((a, b) => b.length - a.length);
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
    pattern.lastIndex = 0;
    const matches = combined.match(pattern);
    if (!matches || matches.length === 0) continue;
    pattern.lastIndex = 0;
    const titleMatch = pattern.test(titleTxt);
    pattern.lastIndex = 0;

    // Positionen aller Treffer (ueber kombinierten Text) sammeln,
    // damit Aspekt-Fenster spaeter berechnet werden kann.
    const positions = [];
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(combined)) !== null) {
      positions.push(m.index);
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
    pattern.lastIndex = 0;

    out[stock.symbol] = {
      mentions: matches.length,
      title_hit: titleMatch,
      positions,
    };
  }
  return out;
}

// ---------- Lexikon-Kompilation ----------

function compileLex(langCode) {
  const lc = (langCode || 'de').slice(0, 2);
  const block = SENTI_CFG.lang[lc] || SENTI_CFG.lang.de;
  const entries = [];
  for (const e of block.positive) entries.push({ t: e.t.toLowerCase(), pol: e.pol, bull: e.bull });
  for (const e of block.negative) entries.push({ t: e.t.toLowerCase(), pol: e.pol, bull: e.bull });

  // Einzelwort-Map fuer schnelles Token-Lookup.
  const single = new Map();
  // Phrasen fuer Mehrwort-Lookup (sortiert nach Wortzahl absteigend).
  const phrases = [];
  for (const e of entries) {
    if (/\s/.test(e.t)) phrases.push({ ...e, words: e.t.split(/\s+/) });
    else single.set(e.t, e);
  }
  phrases.sort((a, b) => b.words.length - a.words.length);

  const negation = new Set((SENTI_CFG.negation[lc] || SENTI_CFG.negation.de).map((w) => w.toLowerCase()));
  const intensifiers = SENTI_CFG.intensifiers[lc] || SENTI_CFG.intensifiers.de || {};

  return {
    single, phrases, negation, intensifiers,
    window: SENTI_CFG.negation_window || 4,
  };
}

const LEX_CACHE = new Map();
function getLex(lang) {
  const lc = (lang || 'de').slice(0, 2);
  if (!LEX_CACHE.has(lc)) LEX_CACHE.set(lc, compileLex(lc));
  return LEX_CACHE.get(lc);
}

// ---------- Tokenizer (Wort + Position im Originaltext) ----------

function tokenizeWithSpans(text) {
  const out = [];
  if (!text) return out;
  const re = /[\p{L}\p{N}'-]+/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------- Sentiment-Scoring ----------

function scoreTokens(tokens, lex, fromIdx = 0, toIdx = tokens.length) {
  let pol = 0, bull = 0, n = 0, polAbs = 0;

  function applyNegation(i) {
    for (let j = Math.max(fromIdx, i - lex.window); j < i; j++) {
      if (lex.negation.has(tokens[j].word)) return true;
    }
    return false;
  }
  function applyIntensifier(i) {
    for (let j = Math.max(fromIdx, i - 2); j < i; j++) {
      const f = lex.intensifiers[tokens[j].word];
      if (f) return f;
    }
    return 1.0;
  }

  // Phrasen zuerst (greedy, laengste zuerst), Treffer-Tokens markieren.
  const used = new Uint8Array(toIdx - fromIdx);
  for (const ph of lex.phrases) {
    const L = ph.words.length;
    for (let i = fromIdx; i + L <= toIdx; i++) {
      if (used[i - fromIdx]) continue;
      let match = true;
      for (let k = 0; k < L; k++) {
        if (tokens[i + k].word !== ph.words[k]) { match = false; break; }
      }
      if (!match) continue;
      const negated = applyNegation(i);
      const inten = applyIntensifier(i);
      const sign = negated ? -1 : 1;
      pol  += sign * ph.pol  * inten;
      bull += sign * ph.bull * inten;
      polAbs += Math.abs(ph.pol) * inten;
      n++;
      for (let k = 0; k < L; k++) used[i + k - fromIdx] = 1;
    }
  }
  // Einzelne Tokens (ohne bereits konsumierte).
  for (let i = fromIdx; i < toIdx; i++) {
    if (used[i - fromIdx]) continue;
    const tok = tokens[i].word;
    const e = lex.single.get(tok);
    if (!e) continue;
    const negated = applyNegation(i);
    const inten = applyIntensifier(i);
    const sign = negated ? -1 : 1;
    pol  += sign * e.pol  * inten;
    bull += sign * e.bull * inten;
    polAbs += Math.abs(e.pol) * inten;
    n++;
  }

  // Normalisierung auf -1..+1.
  const denom = Math.max(n, 1);
  return {
    polarity: clamp(pol / denom, -1, 1),
    bull_score: clamp(bull / denom, -1, 1),
    hits: n,
    intensity: clamp(polAbs / Math.max(toIdx - fromIdx, 1) * 4, 0, 1),
  };
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function moodLabel(p) {
  if (p > 0.15) return 'positiv';
  if (p < -0.15) return 'negativ';
  return 'neutral';
}
function bullLabel(b) {
  if (b > 0.2) return 'bullisch';
  if (b < -0.2) return 'bearisch';
  return 'neutral';
}

// scoreSentiment: scored den ganzen Text. Rueckwaertskompatibel.
function scoreSentiment(text, lang = 'de') {
  const lex = getLex(lang);
  const toks = tokenizeWithSpans(text);
  const r = scoreTokens(toks, lex);
  return {
    polarity: r.polarity,
    bull_score: r.bull_score,
    intensity: r.intensity,
    hits: r.hits,
    label: moodLabel(r.polarity),
    bull_label: bullLabel(r.bull_score),
    // Backwards-Compat: pos_hits / neg_hits aus Vorzeichen abgeleitet, ohne grosse Genauigkeit
    pos_hits: r.polarity > 0 ? r.hits : 0,
    neg_hits: r.polarity < 0 ? r.hits : 0,
  };
}

// aspectSentimentForStock: scored ein Fenster um die Aktien-Position.
// Respektiert Satzgrenzen (. ! ? ; :) und harte Trenner zwischen
// Sequenzen wie "Gegensatz dazu" / "however" / "waehrend" — damit Sentiment
// einer Nachbar-Aktie nicht ueberspringt.
const HARD_BREAK_TOKENS = new Set([
  'gegensatz', 'aber', 'jedoch', 'allerdings', 'waehrend', 'dafuer', 'dagegen',
  'however', 'meanwhile', 'although', 'whereas', 'but',
]);

function aspectSentimentForStock(combinedText, positions, windowTokens = 8, lang = 'de') {
  const lex = getLex(lang);
  const toks = tokenizeWithSpans(combinedText);
  if (toks.length === 0 || !positions || positions.length === 0) {
    return { polarity: 0, bull_score: 0, intensity: 0, hits: 0 };
  }
  function tokIndexAtChar(charPos) {
    let lo = 0, hi = toks.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (toks[mid].start <= charPos) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }
  function hasBreakBetween(a, b) {
    // Zeichen zwischen Token-Ende a und Token-Start b auf Satzgrenze pruefen.
    if (a < 0 || a >= toks.length || b < 0 || b >= toks.length) return false;
    const chunk = combinedText.slice(toks[a].end, toks[b].start);
    return /[.!?;:\n]/.test(chunk);
  }
  function expandWindow(idx) {
    let from = idx, to = idx;
    // links bis Satzgrenze oder Hard-Break-Wort oder bis Limit
    for (let k = 1; k <= windowTokens && idx - k >= 0; k++) {
      const prev = idx - k;
      if (hasBreakBetween(prev, prev + 1)) break;
      if (HARD_BREAK_TOKENS.has(toks[prev].word)) break;
      from = prev;
    }
    // rechts
    for (let k = 1; k <= windowTokens && idx + k < toks.length; k++) {
      const next = idx + k;
      if (hasBreakBetween(next - 1, next)) break;
      if (HARD_BREAK_TOKENS.has(toks[next].word)) break;
      to = next;
    }
    return { from, to: to + 1 };
  }

  let pol = 0, bull = 0, hits = 0, inten = 0;
  for (const pos of positions) {
    const idx = tokIndexAtChar(pos);
    const { from, to } = expandWindow(idx);
    const r = scoreTokens(toks, lex, from, to);
    pol  += r.polarity;
    bull += r.bull_score;
    inten += r.intensity;
    hits += r.hits;
  }
  const n = positions.length;
  return {
    polarity: pol / n,
    bull_score: bull / n,
    intensity: inten / n,
    hits,
  };
}

// ---------- Talk-Type ----------

function classifyTalkType(text) {
  const lc = String(text || '').toLowerCase();
  const triggers = SENTI_CFG.talk_type_triggers || {};
  const scores = {};
  for (const [type, patterns] of Object.entries(triggers)) {
    let hits = 0;
    for (const p of patterns) {
      // Wortgrenze: vorgaengiges und nachgaengiges Nicht-Buchstaben-Zeichen.
      const re = new RegExp(`(?<![\\p{L}\\d])${escapeRegex(p)}(?![\\p{L}\\d])`, 'iu');
      if (re.test(lc)) hits++;
    }
    if (hits > 0) scores[type] = hits;
  }
  let best = 'general', bestN = 0;
  for (const [t, n] of Object.entries(scores)) {
    if (n > bestN) { best = t; bestN = n; }
  }
  return { talk_type: best, talk_type_scores: scores };
}

// ---------- Combined article analysis ----------

function analyzeArticle({ title, summary, lang = 'de' }) {
  const titleTxt = String(title || '');
  const bodyTxt  = String(summary || '');
  const combined = titleTxt + '\n' + bodyTxt;

  // Gesamttext-Sentiment.
  const overall = scoreSentiment(combined, lang);
  // Talk-Type aus Volltext.
  const talk = classifyTalkType(combined);
  // Stock-Erwaehnungen.
  const mentions = findStockMentions(titleTxt, bodyTxt);

  // Pro Aktie zusaetzliches Aspekt-Sentiment (Worte direkt drumherum).
  const aspectByStock = {};
  for (const [symbol, m] of Object.entries(mentions)) {
    aspectByStock[symbol] = aspectSentimentForStock(combined, m.positions, 8, lang);
  }

  return {
    overall: {
      polarity: overall.polarity,
      bull_score: overall.bull_score,
      intensity: overall.intensity,
      hits: overall.hits,
      label: overall.label,
      bull_label: overall.bull_label,
    },
    talk,
    mentions,
    aspect: aspectByStock,
  };
}

module.exports = {
  findStockMentions,
  scoreSentiment,
  aspectSentimentForStock,
  classifyTalkType,
  analyzeArticle,
  compileStockMatchers,
  moodLabel,
  bullLabel,
  STOCK_MATCHERS,
};
