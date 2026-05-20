'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findDuplicate,
  chooseWinner,
  deduplicateBatch,
  extractFirstParagraph,
} = require('../src/deduplicator');
const { normalizeUrl } = require('../src/utils');

test('findDuplicate erkennt URL-Match', () => {
  const candidate = {
    id: 2,
    url: 'https://sz.de/artikel-1?utm_source=newsletter',
    title: 'Andere Headline',
    first_paragraph: 'Anderer Text.',
  };
  const existing = [
    {
      id: 1,
      url_normalized: normalizeUrl('https://sz.de/artikel-1'),
      title: 'Original',
      first_paragraph: 'Anderer Text.',
    },
  ];
  const result = findDuplicate(candidate, existing);
  assert.ok(result);
  assert.equal(result.reason, 'url-match');
});

test('findDuplicate erkennt Titel-Aehnlichkeit', () => {
  const candidate = {
    id: 2,
    url: 'https://merkur.de/artikel-2',
    title: 'Hamlet Premiere an den Muenchner Kammerspielen begeistert',
    first_paragraph: '',
  };
  const existing = [
    {
      id: 1,
      url_normalized: 'https://sz.de/artikel-1',
      title: 'Hamlet Premiere an den Muenchner Kammerspielen begeistern',
      first_paragraph: '',
    },
  ];
  const result = findDuplicate(candidate, existing);
  assert.ok(result);
  assert.ok(result.reason.startsWith('title-sim'));
});

test('findDuplicate erkennt Text-Aehnlichkeit', () => {
  const sharedText =
    'Muenchen (dpa) - An den Muenchner Kammerspielen feierte gestern eine ' +
    'neue Inszenierung von Shakespeares Hamlet Premiere. Die Regie ' +
    'fuehrte die Intendantin Barbara Mundel.';
  const candidate = {
    id: 2,
    url: 'https://merkur.de/artikel-2',
    title: 'Komplett anderer Titel',
    first_paragraph: sharedText,
  };
  const existing = [
    {
      id: 1,
      url_normalized: 'https://sz.de/artikel-1',
      title: 'Anderer Titel auch',
      first_paragraph: sharedText,
    },
  ];
  const result = findDuplicate(candidate, existing);
  assert.ok(result);
  assert.ok(result.reason.startsWith('text-sim'));
});

test('findDuplicate gibt null zurueck bei unterschiedlichen Artikeln', () => {
  const candidate = {
    id: 2,
    url: 'https://sz.de/artikel-2',
    title: 'Fussball-Bundesliga heute',
    first_paragraph: 'Bayern Muenchen hat gegen Dortmund verloren.',
  };
  const existing = [
    {
      id: 1,
      url_normalized: 'https://merkur.de/artikel-1',
      title: 'Hamlet Premiere Kammerspiele',
      first_paragraph: 'Die Auffuehrung war beeindruckend.',
    },
  ];
  const result = findDuplicate(candidate, existing);
  assert.equal(result, null);
});

test('chooseWinner bevorzugt Quelle mit hoeherer Prioritaet', () => {
  const sz = { id: 1, source: 'Sueddeutsche Zeitung Muenchen', published_date: '2026-01-15' };
  const merkur = { id: 2, source: 'Merkur Muenchen', published_date: '2026-01-14' };
  const winner = chooseWinner(sz, merkur);
  assert.equal(winner.id, 1);
});

test('chooseWinner bevorzugt aelteren bei gleicher Quelle', () => {
  const a = { id: 1, source: 'Merkur', published_date: '2026-01-15' };
  const b = { id: 2, source: 'Merkur', published_date: '2026-01-14' };
  const winner = chooseWinner(a, b);
  assert.equal(winner.id, 2);
});

test('deduplicateBatch filtert Duplikate', () => {
  const articles = [
    {
      url: 'https://sz.de/a',
      title: 'Hamlet Premiere',
      firstParagraph: 'Die Inszenierung von Hamlet an den Muenchner Kammerspielen ueberzeugte.',
      source: 'SZ',
      publishedDate: new Date(),
    },
    {
      url: 'https://merkur.de/a',
      title: 'Hamlet Premier',
      firstParagraph: 'Die Inszenierung von Hamlet an den Muenchner Kammerspielen ueberzeugte.',
      source: 'Merkur',
      publishedDate: new Date(),
    },
    {
      url: 'https://br.de/anderer',
      title: 'Voellig anderer Artikel',
      firstParagraph: 'Ein komplett anderes Thema, nichts mit Theater zu tun.',
      source: 'BR',
      publishedDate: new Date(),
    },
  ];
  const { uniques, duplicates } = deduplicateBatch(articles);
  assert.equal(uniques.length, 2);
  assert.equal(duplicates.length, 1);
});

test('extractFirstParagraph extrahiert ersten Absatz', () => {
  const text = 'Erster Absatz mit Inhalt.\n\nZweiter Absatz mit anderem Inhalt.';
  const result = extractFirstParagraph(text);
  assert.equal(result, 'Erster Absatz mit Inhalt.');
});

test('extractFirstParagraph behandelt leeren Text', () => {
  assert.equal(extractFirstParagraph(''), '');
  assert.equal(extractFirstParagraph(null), '');
});
