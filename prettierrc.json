'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  hybridSearch,
  snippetFor,
  multiSnippetsFor,
  queryTerms,
  tokenizeAndStem,
  tokenizeBigrams,
  tokenizePhonetic,
  clearSearchCache,
  computeRecency,
  BM25Index,
} = require('../src/search');

const now = new Date().toISOString();
const articles = [
  {
    id: 1,
    title: 'Hamlet-Inszenierung an den Kammerspielen',
    summary: 'Ein neuer Hamlet von Regisseur Karin Mueller.',
    full_text: 'Die Kammerspielepremiere war herausragend. Hamlet im Mittelpunkt.',
    source: 'SZ',
    source_priority: 90,
    published_date: now,
    relevance_score: 80,
  },
  {
    id: 2,
    title: 'Opernpremiere am Nationaltheater',
    summary: 'Die neue Opernpremiere begeisterte das Publikum.',
    full_text: 'Eine glanzvolle Opernaufführung im Nationaltheater München.',
    source: 'SZ',
    source_priority: 80,
    published_date: now,
    relevance_score: 70,
  },
  {
    id: 3,
    title: 'Tschaikowski-Konzert in Berlin',
    summary: 'Pjotr Tschaikowski wird gespielt.',
    full_text: 'Tschaikowski-Werke standen im Mittelpunkt.',
    source: 'taz',
    source_priority: 70,
    published_date: now,
    relevance_score: 60,
  },
];

test('hybridSearch: Compound-Split findet "opern" in "Opernpremiere"', () => {
  clearSearchCache();
  const results = hybridSearch(articles, 'opern', { limit: 5 });
  assert.ok(results.length >= 1, 'Should find at least one article');
  const ids = results.map((r) => r.article.id);
  assert.ok(ids.includes(2), 'Opernpremiere should be found via compound split');
});

test('hybridSearch: Compound-Split findet "kammerspiele" in "Kammerspielen"', () => {
  clearSearchCache();
  const results = hybridSearch(articles, 'kammerspiele', { limit: 5 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].article.id, 1);
});

test('hybridSearch: Phonetik findet Tschaikowsky via Tschaikowski', () => {
  clearSearchCache();
  const results = hybridSearch(articles, 'Tschaikowsky', { limit: 5 });
  assert.ok(results.length >= 1, 'Phonetic search should find similar names');
  const ids = results.map((r) => r.article.id);
  assert.ok(ids.includes(3), 'Tschaikowsky article should be found via phonetic match');
});

test('hybridSearch: LRU-Cache liefert konsistente Ergebnisse', () => {
  clearSearchCache();
  const first = hybridSearch(articles, 'hamlet', { limit: 5 });
  const second = hybridSearch(articles, 'hamlet', { limit: 5 });
  assert.equal(first.length, second.length);
  assert.equal(first[0].article.id, second[0].article.id);
});

test('hybridSearch: cache:false umgeht den Cache', () => {
  clearSearchCache();
  const first = hybridSearch(articles, 'hamlet', { limit: 5, cache: false });
  assert.ok(first.length >= 1);
});

test('hybridSearch: NOT-Operator bleibt vom DidYouMean-Fallback unberuehrt', () => {
  clearSearchCache();
  const arts = [
    { id: 1, title: 'Hamlet Premiere München' },
    { id: 2, title: 'Hamburger Hamlet Premiere' },
  ];
  const results = hybridSearch(arts, 'Hamlet -Hamburger', { limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].article.id, 1);
});

test('snippetFor: liefert Satz mit Query-Term', () => {
  clearSearchCache();
  const snippet = snippetFor(articles[0], 'Hamlet');
  assert.ok(snippet.includes('Hamlet') || snippet.includes('hamlet'));
});

test('snippetFor: leeres Article-Objekt liefert leeren String', () => {
  assert.equal(snippetFor(null, 'x'), '');
});

test('queryTerms: extrahiert Begriffe aus Query', () => {
  const terms = queryTerms('hamlet kammerspiele');
  assert.ok(terms.includes('hamlet'));
});

test('tokenizeAndStem: Compound-Split-Option erweitert Tokens', () => {
  const tokens = tokenizeAndStem('Opernpremiere', { withCompoundSplit: true });
  assert.ok(tokens.length >= 2, 'Compound split should produce multiple tokens');
});

test('tokenizePhonetic: liefert Set von Codes', () => {
  const codes = tokenizePhonetic('Müller Tschaikowski Hamlet');
  assert.ok(codes.size >= 2);
});

test('tokenizeBigrams: liefert benachbarte Token-Paare', () => {
  const bigrams = tokenizeBigrams('Münchner Kammerspiele Premiere');
  assert.ok(bigrams.size >= 1);
  const arr = [...bigrams];
  assert.ok(arr.every((b) => b.includes('~')));
});

test('computeRecency: exponential decay halbiert nach halfLife Tagen', () => {
  const today = new Date();
  const past = new Date(today.getTime() - 30 * 86400000);
  const r = computeRecency(
    { published_date: past.toISOString() },
    30,
    'exponential',
    today.getTime()
  );
  assert.ok(r > 0.45 && r < 0.55, `recency at halfLife should be ~0.5, got ${r}`);
});

test('computeRecency: linear mode', () => {
  const today = new Date();
  const past = new Date(today.getTime() - 60 * 86400000);
  const r = computeRecency({ published_date: past.toISOString() }, 30, 'linear', today.getTime());
  assert.ok(r >= 0 && r < 1);
});

test('computeRecency: mode "none" liefert immer 1', () => {
  const past = new Date(Date.now() - 1000 * 86400000);
  assert.equal(computeRecency({ published_date: past.toISOString() }, 30, 'none'), 1);
});

test('multiSnippetsFor: liefert mehrere Snippets bei Mehrfach-Treffer', () => {
  const article = {
    full_text:
      'Hamlet ist ein Stück. ' +
      'Lorem ipsum dolor sit amet, '.repeat(20) +
      'Hamlet erscheint hier nochmal.',
  };
  const snippets = multiSnippetsFor(article, 'Hamlet', { maxLen: 100, count: 3 });
  assert.ok(snippets.length >= 2, `expected ≥2 snippets, got ${snippets.length}`);
  for (const s of snippets) assert.ok(s.toLowerCase().includes('hamlet'));
});

test('multiSnippetsFor: leeres Article-Objekt liefert leeres Array', () => {
  assert.deepEqual(multiSnippetsFor(null, 'x'), []);
});

test('BM25Index: bigram-Bonus bevorzugt benachbarte Reihenfolge', () => {
  const articles = [
    {
      id: 1,
      title: 'Münchner Kammerspiele Premiere',
      full_text: 'Eine Premiere an den Münchner Kammerspielen.',
      published_date: new Date().toISOString(),
    },
    {
      id: 2,
      title: 'Kammerspiele in Hamburg, München erwähnt am Rand',
      full_text: 'München und Kammerspiele sind separat erwähnt, ohne Bezug.',
      published_date: new Date().toISOString(),
    },
  ];
  const idx = new BM25Index(articles, { withBigrams: true });
  const results = idx.search('Münchner Kammerspiele');
  assert.equal(results[0].article.id, 1, 'bigram-Match sollte zuerst kommen');
});

test('BM25Index: recencyMode "none" deaktiviert Decay', () => {
  const old = new Date(Date.now() - 365 * 86400000).toISOString();
  const idx = new BM25Index(
    [{ id: 1, title: 'Hamlet', full_text: 'Hamlet ist toll.', published_date: old }],
    { recencyMode: 'none' }
  );
  const r = idx.search('Hamlet');
  assert.ok(r[0].score > 0);
});

test('BM25Index: konfigurierbarer summaryBoost', () => {
  const idx = new BM25Index([{ id: 1, title: 'X', summary: 'Wokey wokey', full_text: 'lorem' }], {
    summaryBoost: 5,
  });
  assert.equal(idx.summaryBoost, 5);
  const r = idx.search('Wokey');
  assert.ok(r.length === 1);
});
