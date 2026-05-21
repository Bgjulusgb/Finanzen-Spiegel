'use strict';

const { sentiment: SENTI_CFG, dax: DAX } = require('./config');
const { escapeRegex } = require('./utils');

// ---------- Stock-Matcher ----------

function compileStockMatchers(stocks = DAX) {
  return stocks.map((s) => {
    const terms = [...new Set([...s.queries, ...(s.synonyms || [])])]
      .map((t) => t.trim()).filter(Boolean);
    // Laengste Suchbegriffe zuerst -> "Mercedes-Benz Group" gewinnt vor "Mercedes".
    const escaped = terms.map(escapeRegex).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(?<![\\p{L}\\d])(?:${escaped.join('|')})(?![\\p{L}\\d])`, 'giu');
    // Optional: negative_terms blockieren Treffer.
    const negTerms = s.negative_terms || [];
    const negPattern = negTerms.length
      ? new RegExp(`(?<![\\p{L}\\d])(?:${negTerms.map(escapeRegex).join('|')})(?![\\p{L}\\d])`, 'giu')
      : null;
    // ISIN + Ticker als Bonus-Pattern (case-sensitive, eindeutige Identifikatoren).
    const idTokens = [s.symbol];
    if (s.isin) idTokens.push(s.isin);
    const idPattern = new RegExp(`(?<![\\p{L}\\d])(?:${idTokens.map(escapeRegex).join('|')})(?![\\p{L}\\d])`, 'g');
    return { stock: s, pattern, negPattern, idPattern, terms };
  });
}

const STOCK_MATCHERS = compileStockMatchers();

// Disambiguierung: alle Treffer ueber alle Aktien sammeln, dann pro
// Char-Position den laengsten Treffer gewinnen lassen. Verhindert dass z.B.
// "Mercedes-Benz Group" sowohl bei MBG.DE als auch bei einem hypothetischen
// "Mercedes"-Eintrag matched.
function findStockMentions(title, body) {
  const titleTxt = String(title || '');
  const bodyTxt = String(body || '');
  const combined = titleTxt + '\n' + bodyTxt;
  const titleEnd = titleTxt.length;

  // Phase 1: pro Aktie alle Hits + ID-Hits einsammeln.
  const raw = []; // {symbol, start, length, isTitle, isId}
  for (const { stock, pattern, negPattern, idPattern } of STOCK_MATCHERS) {
    if (negPattern) {
      negPattern.lastIndex = 0;
      if (negPattern.test(combined)) continue;
    }
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(combined)) !== null) {
      raw.push({ symbol: stock.symbol, start: m.index, length: m[0].length, isTitle: m.index < titleEnd, isId: false });
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
    idPattern.lastIndex = 0;
    while ((m = idPattern.exec(combined)) !== null) {
      raw.push({ symbol: stock.symbol, start: m.index, length: m[0].length, isTitle: m.index < titleEnd, isId: true });
      if (m.index === idPattern.lastIndex) idPattern.lastIndex++;
    }
  }
  if (raw.length === 0) return {};

  // Phase 2: bei Ueberschneidungen den laengsten Treffer behalten.
  raw.sort((a, b) => a.start - b.start || b.length - a.length);
  const kept = [];
  let occupiedUntil = -1;
  for (const h of raw) {
    if (h.start < occupiedUntil) continue; // ueberlappt mit vorherigem (laengeren) Treffer
    kept.push(h);
    occupiedUntil = h.start + h.length;
  }

  // Phase 3: aggregieren pro Symbol.
  const out = {};
  for (const h of kept) {
    if (!out[h.symbol]) out[h.symbol] = { mentions: 0, title_hit: false, id_hit: false, positions: [] };
    out[h.symbol].mentions += 1;
    if (h.isTitle) out[h.symbol].title_hit = true;
    if (h.isId) out[h.symbol].id_hit = true;
    out[h.symbol].positions.push(h.start);
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

// Titel- und Body-Sentiment getrennt scoren, dann gewichtet zusammenfuehren.
// Headlines sind verdichteter und repraesentativer.
function blendTitleBody(titleR, bodyR, titleWeight = 0.7) {
  // Wenn der Titel keine Wertungstreffer hat, faellt das Mischen auf den Body zurueck.
  if (titleR.hits === 0 && bodyR.hits === 0) {
    return { polarity: 0, bull_score: 0, intensity: 0, hits: 0,
             label: 'neutral', bull_label: 'neutral', pos_hits: 0, neg_hits: 0 };
  }
  if (titleR.hits === 0) return bodyR;
  if (bodyR.hits === 0)  return titleR;
  const tw = titleWeight, bw = 1 - titleWeight;
  const polarity = titleR.polarity * tw + bodyR.polarity * bw;
  const bull_score = titleR.bull_score * tw + bodyR.bull_score * bw;
  const intensity = titleR.intensity * tw + bodyR.intensity * bw;
  return {
    polarity, bull_score, intensity,
    hits: titleR.hits + bodyR.hits,
    label: moodLabel(polarity),
    bull_label: bullLabel(bull_score),
    pos_hits: polarity > 0 ? (titleR.hits + bodyR.hits) : 0,
    neg_hits: polarity < 0 ? (titleR.hits + bodyR.hits) : 0,
  };
}

function analyzeArticle({ title, summary, lang = 'de' }) {
  const titleTxt = String(title || '');
  const bodyTxt  = String(summary || '');
  const combined = titleTxt + '\n' + bodyTxt;

  // Titel und Body getrennt scoren, dann blenden (Title-Heavy).
  const titleR = scoreSentiment(titleTxt, lang);
  const bodyR  = scoreSentiment(bodyTxt, lang);
  const overall = blendTitleBody(titleR, bodyR, 0.7);

  // Talk-Type aus Volltext.
  const talk = classifyTalkType(combined);
  // Stock-Erwaehnungen mit Disambiguierung.
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
      pos_hits: overall.pos_hits,
      neg_hits: overall.neg_hits,
      title_polarity: titleR.polarity,
      title_bull: titleR.bull_score,
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
