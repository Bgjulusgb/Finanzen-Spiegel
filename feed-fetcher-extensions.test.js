'use strict';

const FIELD_NAMES = new Set([
  'title',
  'source',
  'author',
  'text',
  'category',
  'sentiment',
  'type',
  'tag',
  'tagnot',
  'tagmode',
  'score',
  'after',
  'before',
  'bookmark',
  'paywall',
  'words',
  'lang',
  'image',
  'reading',
  'has',
]);

const FIELD_ALIASES = {
  t: 'title',
  src: 'source',
  s: 'source',
  site: 'source',
  a: 'author',
  cat: 'category',
  sent: 'sentiment',
  language: 'lang',
  word_count: 'words',
  wordcount: 'words',
  readingtime: 'reading',
  datum: 'after',
  bis: 'before',
};

// `has:image` → image:yes, `has:paywall` → paywall:yes, `has:bookmark` → bookmark:yes
const HAS_SHORTCUTS = {
  image: ['image', 'yes'],
  bild: ['image', 'yes'],
  paywall: ['paywall', 'yes'],
  bookmark: ['bookmark', 'yes'],
  lesezeichen: ['bookmark', 'yes'],
};

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    // Quoted phrase
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      tokens.push({ type: 'phrase', value: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    // -term or -"phrase" (NOT)
    if (c === '-' && s[i + 1] && s[i + 1] !== ' ') {
      let j = i + 1;
      if (s[j] === '"') {
        let k = j + 1;
        while (k < s.length && s[k] !== '"') k++;
        tokens.push({ type: 'not', value: s.slice(j + 1, k) });
        i = k + 1;
      } else {
        while (j < s.length && s[j] !== ' ') j++;
        tokens.push({ type: 'not', value: s.slice(i + 1, j) });
        i = j;
      }
      continue;
    }
    // +term or +"phrase" (force-must)
    if (c === '+' && s[i + 1] && s[i + 1] !== ' ') {
      let j = i + 1;
      if (s[j] === '"') {
        let k = j + 1;
        while (k < s.length && s[k] !== '"') k++;
        tokens.push({ type: 'must', value: s.slice(j + 1, k) });
        i = k + 1;
      } else {
        while (j < s.length && s[j] !== ' ') j++;
        tokens.push({ type: 'must', value: s.slice(i + 1, j) });
        i = j;
      }
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== ' ' && s[j] !== '"') j++;
    const word = s.slice(i, j);
    const upper = word.toUpperCase();
    if (upper === 'AND' || upper === 'UND') {
      tokens.push({ type: 'op', value: 'AND' });
    } else if (upper === 'OR' || upper === 'ODER') {
      tokens.push({ type: 'op', value: 'OR' });
    } else if (upper === 'NOT' || upper === 'NICHT') {
      tokens.push({ type: 'op', value: 'NOT' });
    } else if (word.includes(':')) {
      const colonIdx = word.indexOf(':');
      const rawField = word.slice(0, colonIdx);
      const rawValue = word.slice(colonIdx + 1);
      const fieldLower = rawField.toLowerCase();
      const field = FIELD_ALIASES[fieldLower] || fieldLower;
      if (field === 'has') {
        const shortcut = HAS_SHORTCUTS[rawValue.toLowerCase()];
        if (shortcut) {
          tokens.push({ type: 'field', field: shortcut[0], value: shortcut[1] });
        }
      } else if (FIELD_NAMES.has(field)) {
        // field:"quoted value" — rawValue is '' because the word scan stopped at the opening "
        if ((rawValue === '' || rawValue === '"') && j < s.length && s[j] === '"') {
          const openPos = j + 1;
          let closePos = openPos;
          while (closePos < s.length && s[closePos] !== '"') closePos++;
          tokens.push({ type: 'field', field, value: s.slice(openPos, closePos) });
          i = closePos + 1;
          continue;
        }
        // field:"value" where the quote was captured inside rawValue
        if (rawValue.startsWith('"')) {
          const openPos = i + colonIdx + 2;
          let closePos = openPos;
          while (closePos < s.length && s[closePos] !== '"') closePos++;
          tokens.push({ type: 'field', field, value: s.slice(openPos, closePos) });
          i = closePos + 1;
          continue;
        }
        tokens.push({ type: 'field', field, value: rawValue });
      } else {
        tokens.push({ type: 'term', value: word });
      }
    } else {
      tokens.push({ type: 'term', value: word });
    }
    i = j;
  }
  return tokens;
}

function parseScoreCondition(value) {
  const m = String(value).match(/^([<>]=?|=)?\s*(\d+)$/);
  if (!m) return null;
  const op = m[1] || '>=';
  const num = parseInt(m[2], 10);
  return { op, num };
}

function compareNumeric(actual, cond) {
  switch (cond.op) {
    case '>':
      return actual > cond.num;
    case '>=':
      return actual >= cond.num;
    case '<':
      return actual < cond.num;
    case '<=':
      return actual <= cond.num;
    case '=':
      return actual === cond.num;
    default:
      return actual >= cond.num;
  }
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T00:00:00Z');
  if (/^\d{4}-\d{2}$/.test(value)) return new Date(value + '-01T00:00:00Z');
  if (/^\d{4}$/.test(value)) return new Date(value + '-01-01T00:00:00Z');
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseBool(value) {
  const v = String(value).toLowerCase();
  return v === 'yes' || v === 'true' || v === '1' || v === 'ja';
}

function parseQuery(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const must = [];
  const should = [];
  const mustNot = [];
  const fields = {};
  let nextIsOr = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'op') {
      if (t.value === 'OR') nextIsOr = true;
      else if (t.value === 'NOT') {
        i++;
        if (i < tokens.length) mustNot.push(tokens[i]);
      }
      // AND is the default, resets OR mode
      else if (t.value === 'AND') nextIsOr = false;
      continue;
    }
    if (t.type === 'not') {
      mustNot.push(t);
      continue;
    }
    if (t.type === 'must') {
      must.push({ type: 'phrase', value: t.value });
      continue;
    }
    if (t.type === 'field') {
      if (!fields[t.field]) fields[t.field] = [];
      fields[t.field].push(t.value);
      continue;
    }
    if (nextIsOr) {
      should.push(t);
      nextIsOr = false;
    } else {
      must.push(t);
    }
  }

  const isStructured =
    mustNot.length > 0 ||
    should.length > 0 ||
    Object.keys(fields).length > 0 ||
    tokens.some((t) => t.type === 'phrase' || t.type === 'must');

  return { raw: trimmed, must, should, mustNot, fields, isStructured };
}

function termToSearchString(term) {
  if (term.type === 'phrase') return `"${term.value}"`;
  return term.value;
}

function queryToBM25String(parsed) {
  if (!parsed) return '';
  const parts = [];
  for (const m of parsed.must) parts.push(termToSearchString(m));
  for (const s of parsed.should) parts.push(termToSearchString(s));
  for (const [field, values] of Object.entries(parsed.fields)) {
    if (field === 'title' || field === 'text') {
      for (const v of values) parts.push(v);
    }
  }
  return parts.join(' ').trim();
}

function articleMatchesStructured(article, parsed) {
  if (!parsed) return true;
  const text = (
    (article.title || '') +
    ' ' +
    (article.full_text || article.fullText || '') +
    ' ' +
    (article.summary || '')
  ).toLowerCase();

  for (const not of parsed.mustNot) {
    if (text.includes(not.value.toLowerCase())) return false;
  }

  for (const must of parsed.must) {
    if (must.type === 'phrase') {
      if (!text.includes(must.value.toLowerCase())) return false;
    } else {
      if (!text.includes(must.value.toLowerCase()) && parsed.should.length === 0) return false;
    }
  }

  if (parsed.should.length > 0) {
    const anyMatch = parsed.should.some((s) => text.includes(s.value.toLowerCase()));
    if (!anyMatch && parsed.must.length === 0) return false;
  }

  for (const [field, values] of Object.entries(parsed.fields)) {
    let fieldValue;
    switch (field) {
      case 'title':
        fieldValue = (article.title || '').toLowerCase();
        break;
      case 'source':
        fieldValue = (article.source || '').toLowerCase();
        break;
      case 'author':
        fieldValue = (article.author || '').toLowerCase();
        break;
      case 'text':
        fieldValue = (article.full_text || article.fullText || '').toLowerCase();
        break;
      case 'category':
        fieldValue = (article.category || '').toLowerCase();
        break;
      case 'sentiment':
        fieldValue = (article.sentiment || '').toLowerCase();
        break;
      case 'type':
        fieldValue = (article.article_type || article.articleType || '').toLowerCase();
        break;
      case 'tag': {
        const tagList = Array.isArray(article.tags)
          ? article.tags.map((t) => String(t).toLowerCase())
          : [];
        const modeArr = parsed.fields.tagmode;
        const mode = modeArr && modeArr[0] ? modeArr[0].toLowerCase() : 'any';
        const lowerVals = values.map((v) => v.toLowerCase());
        if (mode === 'all') {
          if (!lowerVals.every((v) => tagList.includes(v))) return false;
        } else if (mode === 'none') {
          if (lowerVals.some((v) => tagList.includes(v))) return false;
        } else {
          if (!lowerVals.some((v) => tagList.includes(v))) return false;
        }
        continue;
      }
      case 'tagnot': {
        const tagList = Array.isArray(article.tags)
          ? article.tags.map((t) => String(t).toLowerCase())
          : [];
        if (values.some((v) => tagList.includes(v.toLowerCase()))) return false;
        continue;
      }
      case 'tagmode':
        continue;
      case 'words': {
        const wc = article.word_count || 0;
        if (
          !values.every((v) => {
            const c = parseScoreCondition(v);
            return !c || compareNumeric(wc, c);
          })
        )
          return false;
        continue;
      }
      case 'reading': {
        const minutes = Math.max(1, Math.round((article.word_count || 0) / 200));
        if (
          !values.every((v) => {
            const c = parseScoreCondition(v);
            return !c || compareNumeric(minutes, c);
          })
        )
          return false;
        continue;
      }
      case 'score': {
        const scoreVal = article.relevance_score || 0;
        if (
          !values.every((v) => {
            const c = parseScoreCondition(v);
            return !c || compareNumeric(scoreVal, c);
          })
        )
          return false;
        continue;
      }
      case 'lang': {
        const lang = (article.language || article.lang || '').toLowerCase();
        if (!values.some((v) => lang === v.toLowerCase())) return false;
        continue;
      }
      case 'image': {
        const want = parseBool(values[0]);
        if (want !== !!article.has_image) return false;
        continue;
      }
      case 'after': {
        const target = parseDate(values[0]);
        const ad = article.published_date ? new Date(article.published_date) : null;
        if (!target || !ad || ad < target) return false;
        continue;
      }
      case 'before': {
        const target = parseDate(values[0]);
        const ad = article.published_date ? new Date(article.published_date) : null;
        if (!target || !ad || ad > target) return false;
        continue;
      }
      case 'bookmark': {
        const want = parseBool(values[0]);
        if (want !== !!article.bookmarked) return false;
        continue;
      }
      case 'paywall': {
        const want = parseBool(values[0]);
        if (want !== !!article.paywall) return false;
        continue;
      }
      default:
        continue;
    }
    const anyMatch = values.some((v) => fieldValue.includes(v.toLowerCase()));
    if (!anyMatch) return false;
  }

  return true;
}

module.exports = {
  parseQuery,
  tokenize,
  queryToBM25String,
  articleMatchesStructured,
  parseScoreCondition,
  parseDate,
  parseBool,
  FIELD_NAMES,
  FIELD_ALIASES,
  HAS_SHORTCUTS,
};
