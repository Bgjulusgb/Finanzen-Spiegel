'use strict';

let franc;

async function initializeFranc() {
  if (!franc) {
    const module = await import('franc-min');
    franc = module.franc;
  }
  return franc;
}

const keywordExtractor = require('keyword-extractor');

const UMLAUT_MAP = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss' };
const UMLAUT_RE = /[äöüÄÖÜß]/g;

function normalizeUmlauts(s) {
  if (!s) return '';
  return String(s).replace(UMLAUT_RE, (c) => UMLAUT_MAP[c] || c);
}

function expandUmlautVariants(token) {
  if (!token) return [];
  const lower = String(token).toLowerCase();
  const variants = new Set([lower]);
  if (UMLAUT_RE.test(lower)) variants.add(normalizeUmlauts(lower));
  if (/ae|oe|ue|ss/.test(lower)) {
    variants.add(
      lower.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü').replace(/ss/g, 'ß')
    );
  }
  return [...variants];
}

const COMPOUND_FUGE = ['ungs', 'ions', 'tens', 'ens', 'ns', 'es', 'er', 'en', 's', 'n', 'e', ''];
const COMPOUND_PREFIXES = new Set([
  'ab',
  'an',
  'auf',
  'aus',
  'be',
  'bei',
  'durch',
  'ein',
  'ent',
  'er',
  'ge',
  'her',
  'hin',
  'mit',
  'nach',
  'ueber',
  'um',
  'un',
  'unter',
  'ver',
  'vor',
  'weg',
  'zu',
  'zer',
]);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const COMPOUND_MIN_WORD = 9;
const COMPOUND_MIN_PART = 4;

function hasVowel(s) {
  for (const c of s) if (VOWELS.has(c)) return true;
  return false;
}

const GOOD_LEFT_ENDINGS = [
  'er',
  'el',
  'en',
  'ung',
  'heit',
  'keit',
  'schaft',
  'tum',
  'or',
  'ar',
  'ik',
];
const GOOD_RIGHT_STARTS = [
  'premiere',
  'auffuehrung',
  'inszenierung',
  'urauffuehrung',
  'haus',
  'buehne',
  'theater',
  'stueck',
  'oper',
  'ballett',
  'konzert',
  'festival',
  'foerderung',
  'preis',
  'fonds',
  'minister',
  'stadt',
  'land',
  'haupt',
  'meister',
  'leitung',
  'direktor',
  'regie',
  'kritik',
  'kultur',
  'kunst',
  'film',
  'tanz',
  'literatur',
  'museum',
  'sammlung',
  'ausstellung',
  'galerie',
];

function scoreSplit(left, right, fuge) {
  let score = 0;
  if (GOOD_RIGHT_STARTS.includes(right)) score += 50;
  for (const start of GOOD_RIGHT_STARTS) {
    if (right.startsWith(start)) {
      score += 20;
      break;
    }
  }
  for (const end of GOOD_LEFT_ENDINGS) {
    if (left.endsWith(end)) {
      score += 10;
      break;
    }
  }
  if (fuge === 's' || fuge === 'n') score += 5;
  if (fuge === 'en' || fuge === 'er') score += 3;
  if (fuge === '') score += 1;
  const balance = Math.abs(left.length - right.length);
  score -= balance * 0.5;
  if (left.length < 4) score -= 10;
  if (right.length < 4) score -= 10;
  return score;
}

function germanCompoundSplit(
  word,
  { minWord = COMPOUND_MIN_WORD, minPart = COMPOUND_MIN_PART } = {}
) {
  const w = normalizeUmlauts(String(word || '').toLowerCase()).replace(/[^a-z]/g, '');
  if (!w || w.length < minWord) return [];

  const candidates = [];
  for (let cut = minPart; cut <= w.length - minPart; cut++) {
    const left = w.slice(0, cut);
    const rest = w.slice(cut);
    if (!hasVowel(left) || !hasVowel(rest)) continue;
    if (COMPOUND_PREFIXES.has(left)) continue;

    for (const fuge of COMPOUND_FUGE) {
      if (fuge && !left.endsWith(fuge)) continue;
      const leftStem = fuge ? left.slice(0, -fuge.length) : left;
      if (leftStem.length < minPart || !hasVowel(leftStem)) continue;
      if (COMPOUND_PREFIXES.has(leftStem)) continue;

      const score = scoreSplit(leftStem, rest, fuge);
      candidates.push({ left: leftStem, right: rest, score });
    }
  }
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score < 0) return [];
  return [best.left, best.right];
}

function colognePhonetic(input) {
  if (!input) return '';
  let s = normalizeUmlauts(String(input).toLowerCase()).replace(/[^a-z]/g, '');
  if (!s) return '';

  s = s.replace(/ph/g, 'f');

  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : '';
    const next = i + 1 < s.length ? s[i + 1] : '';
    let code;

    switch (c) {
      case 'a':
      case 'e':
      case 'i':
      case 'j':
      case 'o':
      case 'u':
      case 'y':
        code = '0';
        break;
      case 'h':
        code = '';
        break;
      case 'b':
        code = '1';
        break;
      case 'p':
        code = next === 'h' ? '3' : '1';
        break;
      case 'd':
      case 't':
        code = next === 'c' || next === 's' || next === 'z' ? '8' : '2';
        break;
      case 'f':
      case 'v':
      case 'w':
        code = '3';
        break;
      case 'g':
      case 'k':
      case 'q':
        code = '4';
        break;
      case 'c':
        if (i === 0) {
          code = 'ahkloqrux'.includes(next) ? '4' : '8';
        } else if (prev === 's' || prev === 'z') {
          code = '8';
        } else if ('ahkoqux'.includes(next)) {
          code = '4';
        } else {
          code = '8';
        }
        break;
      case 'x':
        code = prev === 'c' || prev === 'k' || prev === 'q' ? '8' : '48';
        break;
      case 'l':
        code = '5';
        break;
      case 'm':
      case 'n':
        code = '6';
        break;
      case 'r':
        code = '7';
        break;
      case 's':
      case 'z':
        code = '8';
        break;
      default:
        code = '';
    }
    out.push(code);
  }

  const joined = out.join('');
  let prev = '';
  const dedup = [];
  for (const ch of joined) {
    if (ch !== prev) dedup.push(ch);
    prev = ch;
  }
  const joined2 = dedup.join('');
  const result = dedup[0] === '0' ? joined2.replace(/0+/g, '0') : joined2.replace(/0+/g, '');
  return result || (dedup[0] === '0' ? '0' : '');
}

const LANG_MAP = {
  deu: 'de',
  eng: 'en',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  pol: 'pl',
  rus: 'ru',
  tur: 'tr',
  ces: 'cs',
  dan: 'da',
  swe: 'sv',
  nob: 'no',
  fin: 'fi',
  ell: 'el',
  ukr: 'uk',
  ron: 'ro',
  hun: 'hu',
  bul: 'bg',
  cat: 'ca',
  slv: 'sl',
  srp: 'sr',
  hrv: 'hr',
};

async function detectLanguage(text, { minLen = 80, fallback = 'de' } = {}) {
  if (!text) return fallback;
  const s = String(text).trim();
  if (s.length < minLen) return fallback;
  const sample = s.length > 4000 ? s.slice(0, 4000) : s;
  const francFunc = await initializeFranc();
  const code = francFunc(sample, { minLength: minLen });
  if (!code || code === 'und') return fallback;
  return LANG_MAP[code] || code.slice(0, 2);
}

function countWords(text) {
  if (!text) return 0;
  return (String(text).trim().match(/\S+/g) || []).length;
}

function estimateReadingMinutes(text, { wpm = 200 } = {}) {
  const words = countWords(text);
  return Math.max(1, Math.round(words / wpm));
}

function extractTopKeywords(text, { limit = 8, lang = 'de' } = {}) {
  if (!text) return [];
  try {
    const language = lang === 'de' ? 'german' : 'english';
    const kws = keywordExtractor.extract(String(text), {
      language,
      remove_digits: true,
      return_changed_case: true,
      remove_duplicates: true,
    });
    const counts = new Map();
    for (const k of kws) {
      if (k.length < 4) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k]) => k);
  } catch {
    return [];
  }
}

function splitSentences(text) {
  if (!text) return [];
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [cleaned];
  return sentences.map((s) => s.trim()).filter(Boolean);
}

function extractSnippet(text, terms, { maxLen = 240, minLen = 80 } = {}) {
  if (!text) return '';
  if (!terms || !terms.length) return String(text).slice(0, maxLen);

  const lowerTerms = terms
    .map((t) => normalizeUmlauts(String(t).toLowerCase()))
    .filter((t) => t.length >= 2);
  if (!lowerTerms.length) return String(text).slice(0, maxLen);

  const sentences = splitSentences(text);
  const scored = sentences.map((sent, idx) => {
    const lower = normalizeUmlauts(sent.toLowerCase());
    let score = 0;
    for (const t of lowerTerms) {
      if (lower.includes(t)) score += 1;
    }
    return { sent, idx, score, len: sent.length };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  if (!scored.length || scored[0].score === 0) {
    return String(text).slice(0, maxLen) + (text.length > maxLen ? '…' : '');
  }

  const picked = [];
  let used = 0;
  for (const item of scored) {
    if (item.score === 0) break;
    if (used > 0 && used + item.len > maxLen) break;
    picked.push(item);
    used += item.len + 2;
    if (used >= minLen && picked.length >= 2) break;
    if (used >= maxLen) break;
  }
  picked.sort((a, b) => a.idx - b.idx);
  const result = picked.map((p) => p.sent).join(' ');
  if (result.length > maxLen) return result.slice(0, maxLen - 1) + '…';
  return result;
}

function hasImage(article) {
  if (!article) return false;
  if (article.image_url) return true;
  if (article.meta && typeof article.meta === 'object') {
    if (article.meta.image || article.meta.og_image || article.meta.twitter_image) return true;
  }
  if (typeof article.meta === 'string') {
    try {
      const m = JSON.parse(article.meta);
      if (m && (m.image || m.og_image || m.twitter_image)) return true;
    } catch {
      /* ignore */
    }
  }
  if (article.full_text && /<img\s/i.test(article.full_text)) return true;
  return false;
}

module.exports = {
  normalizeUmlauts,
  expandUmlautVariants,
  germanCompoundSplit,
  colognePhonetic,
  detectLanguage,
  countWords,
  estimateReadingMinutes,
  extractTopKeywords,
  splitSentences,
  extractSnippet,
  hasImage,
};
