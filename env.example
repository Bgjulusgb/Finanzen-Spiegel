'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseQuery,
  articleMatchesStructured,
  tokenize,
  FIELD_ALIASES,
  HAS_SHORTCUTS,
} = require('../src/query-parser');

function makeArticle(props = {}) {
  return {
    id: 1,
    title: 'Test',
    full_text: '',
    summary: '',
    tags: [],
    word_count: 0,
    language: 'de',
    has_image: false,
    paywall: false,
    bookmarked: false,
    relevance_score: 50,
    article_type: 'news',
    ...props,
  };
}

test('words: Filter > 500', () => {
  const q = parseQuery('words:>500');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 600 }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 100 }), q), false);
});

test('words: Filter <=', () => {
  const q = parseQuery('words:<=100');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 80 }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 200 }), q), false);
});

test('reading: Filter <=5 Minuten', () => {
  const q = parseQuery('reading:<=5');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 800 }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 2000 }), q), false);
});

test('lang: de matched', () => {
  const q = parseQuery('lang:de');
  assert.equal(articleMatchesStructured(makeArticle({ language: 'de' }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ language: 'en' }), q), false);
});

test('image: yes matched bei has_image', () => {
  const q = parseQuery('image:yes');
  assert.equal(articleMatchesStructured(makeArticle({ has_image: true }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ has_image: false }), q), false);
});

test('tagnot: Ausschluss', () => {
  const q = parseQuery('tagnot:spam');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['kultur'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['kultur', 'spam'] }), q), false);
});

test('tag mit tagmode:all benoetigt alle', () => {
  const q = parseQuery('tag:a tag:b tagmode:all');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a', 'b'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a'] }), q), false);
});

test('tag mit tagmode:any reicht einer', () => {
  const q = parseQuery('tag:a tag:b tagmode:any');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['c'] }), q), false);
});

test('tag mit tagmode:none schliesst aus', () => {
  const q = parseQuery('tag:a tag:b tagmode:none');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['c'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a'] }), q), false);
});

test('FIELD_ALIASES: language -> lang', () => {
  const q = parseQuery('language:en');
  assert.equal(articleMatchesStructured(makeArticle({ language: 'en' }), q), true);
});

test('FIELD_ALIASES: wordcount -> words', () => {
  const q = parseQuery('wordcount:>=100');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 200 }), q), true);
});

test('+term wird als must behandelt', () => {
  const q = parseQuery('+Premiere');
  assert.ok(q.must.length === 1);
  assert.equal(q.must[0].value, 'Premiere');
  assert.equal(articleMatchesStructured(makeArticle({ title: 'Premiere München' }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ title: 'Keine Vorstellung' }), q), false);
});

test('+Phrase wird als must-phrase behandelt', () => {
  const tokens = tokenize('+"Münchner Kammerspiele"');
  assert.equal(tokens[0].type, 'must');
  assert.equal(tokens[0].value, 'Münchner Kammerspiele');
});

test('site: Alias fuer source:', () => {
  assert.equal(FIELD_ALIASES['site'], 'source');
  const q = parseQuery('site:nachtkritik');
  assert.equal(articleMatchesStructured(makeArticle({ source: 'nachtkritik.de' }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ source: 'SZ' }), q), false);
});

test('ODER als deutsche Alternative zu OR', () => {
  const tokens = tokenize('Hamlet ODER Faust');
  assert.equal(tokens[1].type, 'op');
  assert.equal(tokens[1].value, 'OR');
});

test('NICHT als deutsche Alternative zu NOT', () => {
  const tokens = tokenize('Hamlet NICHT Hamburger');
  assert.equal(tokens[1].type, 'op');
  assert.equal(tokens[1].value, 'NOT');
});

test('has:image Shortcut fuer image:yes', () => {
  assert.ok(HAS_SHORTCUTS['image']);
  const q = parseQuery('has:image');
  assert.equal(articleMatchesStructured(makeArticle({ has_image: true }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ has_image: false }), q), false);
});

test('has:paywall Shortcut fuer paywall:yes', () => {
  const q = parseQuery('has:paywall');
  assert.equal(articleMatchesStructured(makeArticle({ paywall: true }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ paywall: false }), q), false);
});

test('has:bookmark Shortcut fuer bookmark:yes', () => {
  const q = parseQuery('has:bookmark');
  assert.equal(articleMatchesStructured(makeArticle({ bookmarked: true }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ bookmarked: false }), q), false);
});

test('field:"quoted value" mit Leerzeichen', () => {
  const tokens = tokenize('title:"Münchner Kammerspiele"');
  assert.equal(tokens[0].type, 'field');
  assert.equal(tokens[0].field, 'title');
  assert.equal(tokens[0].value, 'Münchner Kammerspiele');
});

test('Kombination: site: und +term', () => {
  const q = parseQuery('+Premiere site:nachtkritik');
  assert.equal(q.must.length, 1);
  assert.ok(q.fields.source);
  const a = makeArticle({ title: 'Premiere', source: 'nachtkritik.de' });
  const b = makeArticle({ title: 'Premiere', source: 'SZ' });
  assert.equal(articleMatchesStructured(a, q), true);
  assert.equal(articleMatchesStructured(b, q), false);
});
