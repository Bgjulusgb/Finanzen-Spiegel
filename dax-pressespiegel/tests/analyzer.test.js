'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findStockMentions, scoreSentiment } = require('../src/analyzer');

test('analyzer: findStockMentions findet einfache Treffer', () => {
  const m = findStockMentions('SAP hebt Prognose an', 'SAP-Chef Klein optimistisch fuer Cloud.');
  assert.ok(m['SAP.DE'], 'SAP muss matchen');
  assert.equal(m['SAP.DE'].title_hit, true);
  assert.ok(m['SAP.DE'].mentions >= 2);
});

test('analyzer: erkennt mehrere Aktien in einem Text', () => {
  const m = findStockMentions(
    'BMW und Mercedes-Benz Group verlieren in China',
    'Beide Auto-Konzerne berichten von schwachen Verkaeufen.'
  );
  assert.ok(m['BMW.DE']);
  assert.ok(m['MBG.DE']);
});

test('analyzer: keine Treffer wenn keine Aktie genannt wird', () => {
  const m = findStockMentions('Wettervorhersage fuer Bayern', 'Sonne und Wolken im Wechsel.');
  assert.equal(Object.keys(m).length, 0);
});

test('analyzer: Wortgrenzen verhindern Pseudo-Matches', () => {
  // "Sap" als Teil von "Saphir" oder "Sapropel" darf NICHT als SAP matchen.
  const m = findStockMentions('Saphir Kette', 'Der Saphir glaenzt.');
  assert.equal(m['SAP.DE'], undefined);
});

test('analyzer: Synonyme matchen (BMW -> Bayerische Motoren Werke)', () => {
  const m = findStockMentions('', 'Bayerische Motoren Werke senkt Ausblick.');
  assert.ok(m['BMW.DE']);
});

test('analyzer: Sentiment positiv (DE)', () => {
  const r = scoreSentiment('Rheinmetall erzielt Rekordauftrag und uebertrifft Erwartungen.', 'de');
  assert.ok(r.polarity > 0.2, `polarity sollte positiv sein, war ${r.polarity}`);
  assert.equal(r.label, 'positiv');
});

test('analyzer: Sentiment negativ (DE)', () => {
  const r = scoreSentiment('Bayer kassiert Gewinnwarnung, Klage und Kurssturz.', 'de');
  assert.ok(r.polarity < -0.2, `polarity sollte negativ sein, war ${r.polarity}`);
  assert.equal(r.label, 'negativ');
});

test('analyzer: Negation kehrt Polaritaet um (DE)', () => {
  const pos = scoreSentiment('SAP erzielt Rekord.', 'de');
  const neg = scoreSentiment('SAP erzielt keinen Rekord.', 'de');
  assert.ok(pos.polarity > 0);
  assert.ok(neg.polarity <= 0, `negiert sollte <= 0 sein, war ${neg.polarity}`);
});

test('analyzer: Sentiment englisch funktioniert ebenso', () => {
  const r = scoreSentiment('Mercedes beats estimates and surges on robust growth.', 'en');
  assert.ok(r.polarity > 0.2);
  assert.equal(r.label, 'positiv');
});

test('analyzer: neutrale Texte ergeben Polaritaet 0', () => {
  const r = scoreSentiment('Die Hauptversammlung findet am Donnerstag statt.', 'de');
  assert.equal(r.polarity, 0);
  assert.equal(r.label, 'neutral');
});
