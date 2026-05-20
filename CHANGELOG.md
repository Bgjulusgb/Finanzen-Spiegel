'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BM25Index,
  hybridSearch,
  tokenizeAndStem,
  highlightTerms,
  suggestQueries,
  didYouMean,
  topMentions,
  trends,
} = require('../src/search');

const articles = [
  {
    id: 1,
    title: 'Pinocchio an den Muenchner Kammerspielen',
    summary: 'Wu Tsang inszeniert Pinocchio im Schauspielhaus.',
    full_text:
      'Die Inszenierung von Wu Tsang an den Muenchner Kammerspielen begeistert. Pinocchio ist eine grossartige Auffuehrung.',
    source: 'SZ',
    author: 'Egbert Tholl',
  },
  {
    id: 2,
    title: 'Wallenstein-Premiere',
    summary: 'Schillers Wallenstein an den Kammerspielen.',
    full_text:
      'Eine kraftvolle Inszenierung von Wallenstein an den Muenchner Kammerspielen. Walter Hess ueberzeugt.',
    source: 'FAZ',
    author: null,
  },
  {
    id: 3,
    title: 'Theaterkritik: Hamlet in Hamburg',
    summary: 'Ein Hamlet jenseits der Kammerspiele.',
    full_text: 'Die Auffuehrung war konfus und enttaeuschend.',
    source: 'Welt',
    author: null,
  },
];

test('tokenizeAndStem normalisiert und stemmt deutsche Worte', () => {
  const tokens = tokenizeAndStem('Die Inszenierungen der Kammerspiele begeistern');
  assert.ok(tokens.length > 0);
  assert.ok(tokens.some((t) => t.startsWith('inszen')));
  assert.ok(tokens.some((t) => t.startsWith('kammerspiel')));
});

test('tokenizeAndStem entfernt Stopwoerter', () => {
  const tokens = tokenizeAndStem('die der das und in mit');
  assert.equal(tokens.length, 0);
});

test('BM25Index findet relevanten Artikel', () => {
  const idx = new BM25Index(articles);
  const results = idx.search('Pinocchio', 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].article.id, 1);
});

test('BM25Index bewertet Titel-Treffer hoeher', () => {
  const idx = new BM25Index(articles);
  const wallenstein = idx.search('Wallenstein', 5);
  assert.equal(wallenstein[0].article.id, 2);
});

test('hybridSearch kombiniert BM25 + Fuzzy', () => {
  const results = hybridSearch(articles, 'Pinocchio', { limit: 5 });
  assert.ok(results.length > 0);
  assert.equal(results[0].article.id, 1);
  assert.ok(results[0].score > 0);
});

test('hybridSearch findet bei Tippfehler ebenfalls Treffer', () => {
  const results = hybridSearch(articles, 'Pinokio', { limit: 5 });
  assert.ok(results.some((r) => r.article.id === 1));
});

test('hybridSearch findet Mehr-Wort-Anfragen', () => {
  const results = hybridSearch(articles, 'Wu Tsang Inszenierung', { limit: 5 });
  assert.equal(results[0].article.id, 1);
});

test('hybridSearch ohne Query liefert ungewichtet zurueck', () => {
  const results = hybridSearch(articles, '', { limit: 5 });
  assert.equal(results.length, articles.length);
});

test('highlightTerms markiert Treffer', () => {
  const out = highlightTerms('Eine Inszenierung an den Kammerspielen', 'Inszenierung');
  assert.ok(out.includes('<mark>'));
});

test('suggestQueries liefert Vorschlaege fuer Praefix', () => {
  const suggestions = suggestQueries('pino', articles);
  assert.ok(suggestions.length > 0);
});

test('suggestQueries liefert leere Liste fuer kurze Praefixe', () => {
  assert.equal(suggestQueries('p', articles).length, 0);
});

test('hybridSearch akzeptiert NOT-Operator', () => {
  const arts = [
    { id: 1, title: 'Hamlet Premiere München' },
    { id: 2, title: 'Hamburger Hamlet Premiere' },
  ];
  const results = hybridSearch(arts, 'Hamlet -Hamburger', { limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].article.id, 1);
});

test('hybridSearch akzeptiert exakte Phrase', () => {
  const arts = [
    { id: 1, title: 'Wokey Wokey Premiere' },
    { id: 2, title: 'Wokey Bar Wokey' },
  ];
  const results = hybridSearch(arts, '"Wokey Wokey"', { limit: 5 });
  assert.equal(results[0].article.id, 1);
});

test('hybridSearch nutzt Synonyme (Premiere -> Erstauffuehrung)', () => {
  const arts = [
    { id: 1, title: 'Erstauffuehrung von Hamlet' },
    { id: 2, title: 'Tanz' },
  ];
  const results = hybridSearch(arts, 'Premiere', { limit: 5, withSynonyms: true });
  assert.ok(results.length >= 1);
  assert.equal(results[0].article.id, 1);
});

test('didYouMean korrigiert Tippfehler', () => {
  const arts = [{ id: 1, title: 'Pinocchio Wu Tsang Premiere Kammerspiele' }];
  const suggestion = didYouMean('Pinokio', arts);
  assert.ok(suggestion && suggestion.toLowerCase().includes('pinocchio'));
});

test('didYouMean gibt null wenn alles korrekt', () => {
  const arts = [{ id: 1, title: 'Hamlet' }];
  assert.equal(didYouMean('Hamlet', arts), null);
});

test('topMentions liefert haeufigste Begriffe sortiert', () => {
  const arts = [{ title: 'Wallenstein Wallenstein Pinocchio' }, { title: 'Wallenstein' }];
  const m = topMentions(arts, { limit: 5 });
  assert.equal(m[0].term.startsWith('wallen'), true);
});

test('trends vergleicht zwei Zeitraeume', () => {
  const a = [
    { title: 'Hamlet Premiere' },
    { title: 'Hamlet Kritik' },
    { title: 'Hamlet Interview' },
  ];
  const b = [{ title: 'Hamlet' }];
  const result = trends(a, b);
  const hamlet = result.find((t) => t.term.startsWith('haml'));
  assert.ok(hamlet);
  assert.ok(hamlet.change >= 1);
});

test('BM25Index gibt Recency-Bonus', () => {
  const now = Date.now();
  const dayAgo = new Date(now - 86400000).toISOString();
  const yearAgo = new Date(now - 365 * 86400000).toISOString();
  const arts = [
    { id: 1, title: 'Hamlet Premiere', published_date: yearAgo },
    { id: 2, title: 'Hamlet Premiere', published_date: dayAgo },
  ];
  const idx = new BM25Index(arts);
  const results = idx.search('Hamlet', { applyRecency: true });
  assert.equal(results[0].article.id, 2);
});

test('BM25Index gibt Proximity-Bonus fuer nahe Terme', () => {
  const arts = [
    {
      id: 1,
      title: 'Wallenstein Premiere',
      full_text: 'Wallenstein Premiere an den Kammerspielen war ein Ereignis.',
    },
    {
      id: 2,
      title: 'Wallenstein Premiere',
      full_text:
        'Wallenstein wird gegeben. Sehr viele weitere unwichtige Worte trennen die Begriffe. Dann ist die Premiere.',
    },
  ];
  const idx = new BM25Index(arts);
  const results = idx.search('Wallenstein Premiere Kammerspielen', { applyRecency: false });
  assert.equal(results[0].article.id, 1, 'naehere Treffer sollten hoeher ranken');
});

test('BM25Index Coverage-Penalty: vollstaendige Matches gewinnen', () => {
  const arts = [
    {
      id: 1,
      title: 'Wallenstein Premiere',
      full_text: 'Wallenstein wird oft erwaehnt. Wallenstein Wallenstein Wallenstein.',
    },
    {
      id: 2,
      title: 'Wallenstein Premiere Kammerspielen',
      full_text: 'Wallenstein hatte Premiere an den Kammerspielen.',
    },
  ];
  const idx = new BM25Index(arts);
  const results = idx.search('Wallenstein Premiere Kammerspielen', { applyRecency: false });
  assert.equal(results[0].article.id, 2, 'Artikel mit allen drei Termen sollte gewinnen');
});
