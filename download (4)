'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseQuery,
  tokenize,
  articleMatchesStructured,
  queryToBM25String,
} = require('../src/query-parser');

test('tokenize splittet einfache Worte', () => {
  const t = tokenize('hello welt');
  assert.equal(t.length, 2);
  assert.equal(t[0].type, 'term');
});

test('tokenize erkennt Phrasen', () => {
  const t = tokenize('"Wokey Wokey" Theater');
  assert.equal(t[0].type, 'phrase');
  assert.equal(t[0].value, 'Wokey Wokey');
});

test('tokenize erkennt NOT-Operator mit Minus', () => {
  const t = tokenize('Hamlet -Hamburger');
  assert.equal(t.length, 2);
  assert.equal(t[1].type, 'not');
  assert.equal(t[1].value, 'Hamburger');
});

test('tokenize erkennt Feld-Syntax', () => {
  const t = tokenize('title:Premiere source:nachtkritik');
  assert.equal(t[0].type, 'field');
  assert.equal(t[0].field, 'title');
  assert.equal(t[0].value, 'Premiere');
});

test('tokenize erkennt OR-Operator', () => {
  const t = tokenize('Hamlet OR Faust');
  assert.equal(t[1].type, 'op');
  assert.equal(t[1].value, 'OR');
});

test('parseQuery liefert strukturiert bei Operatoren', () => {
  const p = parseQuery('Hamlet -Hamburger');
  assert.equal(p.must.length, 1);
  assert.equal(p.mustNot.length, 1);
  assert.equal(p.isStructured, true);
});

test('articleMatchesStructured: NOT filtert', () => {
  const p = parseQuery('Premiere -Hamburger');
  const a1 = { title: 'Premiere in München' };
  const a2 = { title: 'Hamburger Premiere' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: Phrase muss exakt vorkommen', () => {
  const p = parseQuery('"Wokey Wokey"');
  const a1 = { title: 'Wokey Wokey Premiere' };
  const a2 = { title: 'Wokey ist nicht Wokey' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: Feldsuche', () => {
  const p = parseQuery('source:nachtkritik');
  const a1 = { source: 'nachtkritik.de', title: 'X' };
  const a2 = { source: 'SZ', title: 'X' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: Feldsuche kombiniert mit Term', () => {
  const p = parseQuery('Hamlet sentiment:negativ');
  const a1 = { title: 'Hamlet', sentiment: 'negativ', full_text: 'Hamlet' };
  const a2 = { title: 'Hamlet', sentiment: 'positiv', full_text: 'Hamlet' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('queryToBM25String extrahiert reine Suchbegriffe', () => {
  const p = parseQuery('Hamlet -Hamburger source:SZ');
  assert.equal(queryToBM25String(p), 'Hamlet');
});

test('parseQuery: leerer String liefert null', () => {
  assert.equal(parseQuery(''), null);
  assert.equal(parseQuery('   '), null);
});

test('articleMatchesStructured: tag-Feld', () => {
  const p = parseQuery('tag:produktion:wallenstein');
  const a1 = { title: 'X', tags: ['produktion:wallenstein'] };
  const a2 = { title: 'X', tags: ['produktion:pinocchio'] };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: score-Filter mit >=', () => {
  const p = parseQuery('score:>=80');
  const a1 = { title: 'X', relevance_score: 100 };
  const a2 = { title: 'X', relevance_score: 50 };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: score-Filter mit <', () => {
  const p = parseQuery('score:<30');
  const a1 = { title: 'X', relevance_score: 10 };
  const a2 = { title: 'X', relevance_score: 80 };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: after und before', () => {
  const p = parseQuery('after:2026-01-01 before:2026-12-31');
  const a1 = { title: 'X', published_date: '2026-06-15T10:00:00Z' };
  const a2 = { title: 'X', published_date: '2025-12-15T10:00:00Z' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: bookmark-Filter', () => {
  const p = parseQuery('bookmark:yes');
  const a1 = { title: 'X', bookmarked: true };
  const a2 = { title: 'X', bookmarked: false };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('tokenize: Field-Alias t: wird als title behandelt', () => {
  const t = tokenize('t:Premiere');
  assert.equal(t[0].type, 'field');
  assert.equal(t[0].field, 'title');
});
