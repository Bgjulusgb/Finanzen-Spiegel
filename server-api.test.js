'use strict';

const { parse, isValid, subDays, subMonths, startOfDay, endOfDay } = require('date-fns');

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
  'referrer',
  'cmpid',
  'mc_cid',
  'mc_eid',
  'wt_mc',
  'wt_zmc',
  '_ga',
  's_cid',
  'icmp',
  'spm',
]);

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    const filtered = [];
    u.searchParams.forEach((value, key) => {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) {
        filtered.push([key, value]);
      }
    });
    u.search = '';
    filtered.sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of filtered) {
      u.searchParams.append(key, value);
    }
    let normalized = u.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase().trim();
  }
}

function parseDateRange(args) {
  const now = new Date();
  let from = null;
  let to = null;

  if (args.last) {
    const match = String(args.last).match(/^(\d+)\s*([dDmM])$/);
    if (!match) {
      throw new Error(`Ungueltiges Format fuer --last: ${args.last} (erwartet: 7d, 30d, 3m)`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    to = endOfDay(now);
    from = unit === 'd' ? startOfDay(subDays(now, value)) : startOfDay(subMonths(now, value));
    return { from, to };
  }

  if (args.from) {
    const parsed = parse(args.from, 'yyyy-MM-dd', new Date());
    if (!isValid(parsed)) {
      throw new Error(`Ungueltiges --from Datum: ${args.from} (erwartet: YYYY-MM-DD)`);
    }
    from = startOfDay(parsed);
  }

  if (args.to) {
    const parsed = parse(args.to, 'yyyy-MM-dd', new Date());
    if (!isValid(parsed)) {
      throw new Error(`Ungueltiges --to Datum: ${args.to} (erwartet: YYYY-MM-DD)`);
    }
    to = endOfDay(parsed);
  }

  if (!from) from = startOfDay(subDays(now, 7));
  if (!to) to = endOfDay(now);

  return { from, to };
}

function levenshteinSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);
  if (maxLen === 0) return 1;

  let prev = new Array(len2 + 1);
  let curr = new Array(len2 + 1);
  for (let j = 0; j <= len2; j++) prev[j] = j;

  for (let i = 1; i <= len1; i++) {
    curr[0] = i;
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return 1 - prev[len2] / maxLen;
}

function cosineSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA = new Map();
  const freqB = new Map();
  for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
  for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

  const allTokens = new Set([...freqA.keys(), ...freqB.keys()]);
  let dot = 0,
    magA = 0,
    magB = 0;
  for (const t of allTokens) {
    const a = freqA.get(t) || 0;
    const b = freqB.get(t) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonParse(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

module.exports = {
  normalizeUrl,
  parseDateRange,
  levenshteinSimilarity,
  cosineSimilarity,
  tokenize,
  sleep,
  chunk,
  truncate,
  escapeHtml,
  safeJsonParse,
};
