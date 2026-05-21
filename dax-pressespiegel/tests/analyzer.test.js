'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findStockMentions, scoreSentiment, classifyTalkType,
  aspectSentimentForStock, analyzeArticle,
} = require('../src/analyzer');

// ---------- Stock-Matching ----------

test('analyzer: findStockMentions erkennt einfache Treffer im Titel', () => {
  const m = findStockMentions('SAP hebt Prognose an', 'SAP-Chef Klein optimistisch fuer Cloud.');
  assert.ok(m['SAP.DE'], 'SAP muss matchen');
  assert.equal(m['SAP.DE'].title_hit, true);
  assert.ok(m['SAP.DE'].mentions >= 2);
  assert.ok(Array.isArray(m['SAP.DE'].positions));
});

test('analyzer: mehrere Aktien parallel', () => {
  const m = findStockMentions(
    'BMW und Mercedes-Benz Group verlieren in China',
    'Beide Auto-Konzerne berichten von schwachen Verkaeufen.'
  );
  assert.ok(m['BMW.DE']);
  assert.ok(m['MBG.DE']);
});

test('analyzer: keine Treffer ohne Aktien-Erwaehnung', () => {
  const m = findStockMentions('Wettervorhersage', 'Sonne und Wolken.');
  assert.equal(Object.keys(m).length, 0);
});

test('analyzer: Wortgrenzen verhindern Pseudo-Matches (Saphir != SAP)', () => {
  const m = findStockMentions('Saphir-Kette', 'Der Saphir glaenzt.');
  assert.equal(m['SAP.DE'], undefined);
});

test('analyzer: Synonyme matchen (Bayerische Motoren Werke -> BMW)', () => {
  const m = findStockMentions('', 'Bayerische Motoren Werke senkt Ausblick.');
  assert.ok(m['BMW.DE']);
});

// ---------- Sentiment ----------

test('analyzer: Sentiment positiv (DE)', () => {
  const r = scoreSentiment('Rheinmetall erzielt Rekordauftrag und uebertrifft Erwartungen.', 'de');
  assert.ok(r.polarity > 0.2, `polarity sollte > 0.2 sein, war ${r.polarity}`);
  assert.equal(r.label, 'positiv');
});

test('analyzer: Sentiment negativ (DE)', () => {
  const r = scoreSentiment('Bayer kassiert Gewinnwarnung und Klage, Kurssturz droht.', 'de');
  assert.ok(r.polarity < -0.2, `polarity sollte < -0.2 sein, war ${r.polarity}`);
  assert.equal(r.label, 'negativ');
});

test('analyzer: Negation kehrt Polaritaet um', () => {
  const pos = scoreSentiment('SAP erzielt Rekord.', 'de');
  const neg = scoreSentiment('SAP erzielt keinen Rekord.', 'de');
  assert.ok(pos.polarity > 0);
  assert.ok(neg.polarity <= 0, `negiert sollte <= 0 sein, war ${neg.polarity}`);
});

test('analyzer: Englisch funktioniert', () => {
  const r = scoreSentiment('Mercedes beats estimates and surges on robust growth.', 'en');
  assert.ok(r.polarity > 0.2);
  assert.equal(r.label, 'positiv');
});

test('analyzer: neutraler Text ergibt Polaritaet 0', () => {
  const r = scoreSentiment('Die Hauptversammlung findet am Donnerstag statt.', 'de');
  assert.equal(r.polarity, 0);
  assert.equal(r.label, 'neutral');
});

// ---------- Bull/Bear ----------

test('analyzer: bullisch erkennt Kursziel angehoben', () => {
  const r = scoreSentiment('Berenberg hebt das Kursziel fuer SAP an, Kaufempfehlung.', 'de');
  assert.ok(r.bull_score > 0.4, `bull_score sollte > 0.4 sein, war ${r.bull_score}`);
  assert.equal(r.bull_label, 'bullisch');
});

test('analyzer: bearisch erkennt Gewinnwarnung + Klage', () => {
  const r = scoreSentiment('Bayer mit Gewinnwarnung und neuer Sammelklage.', 'de');
  assert.ok(r.bull_score < -0.4, `bull_score sollte < -0.4 sein, war ${r.bull_score}`);
  assert.equal(r.bull_label, 'bearisch');
});

test('analyzer: bullisch im Englischen (price target raised)', () => {
  const r = scoreSentiment('Goldman raises SAP price target to record high.', 'en');
  assert.ok(r.bull_score > 0.4);
});

// ---------- Talk-Type ----------

test('analyzer: Talk-Type earnings', () => {
  const r = classifyTalkType('SAP veroeffentlicht Quartalszahlen, EPS steigt.');
  assert.equal(r.talk_type, 'earnings');
});
test('analyzer: Talk-Type analyst', () => {
  const r = classifyTalkType('Berenberg hebt Kursziel fuer Allianz an, Kaufempfehlung.');
  assert.equal(r.talk_type, 'analyst');
});
test('analyzer: Talk-Type legal', () => {
  const r = classifyTalkType('Sammelklage gegen Volkswagen, Razzia bei Tochter.');
  assert.equal(r.talk_type, 'legal');
});
test('analyzer: Talk-Type mna', () => {
  const r = classifyTalkType('Siemens kuendigt Uebernahme an, Synergien erwartet.');
  assert.equal(r.talk_type, 'mna');
});
test('analyzer: Talk-Type scandal', () => {
  const r = classifyTalkType('Betrugsvorwuerfe und Skandal um Bayer-Tochter.');
  assert.equal(r.talk_type, 'scandal');
});
test('analyzer: Talk-Type general als Fallback', () => {
  const r = classifyTalkType('Die Hauptversammlung findet am Donnerstag statt.');
  assert.equal(r.talk_type, 'general');
});

// ---------- Aspekt-Sentiment ----------

test('analyzer: Aspekt-Sentiment isoliert Bewertung pro Aktie', () => {
  // Im Text: SAP positiv, Bayer negativ.
  const text = 'SAP uebertrifft alle Erwartungen mit Rekordgewinn. Im Gegensatz dazu kassiert Bayer eine bittere Gewinnwarnung.';
  const r = analyzeArticle({ title: '', summary: text, lang: 'de' });
  assert.ok(r.aspect['SAP.DE'].polarity > 0.1, `SAP-Aspekt sollte positiv sein, war ${r.aspect['SAP.DE'].polarity}`);
  assert.ok(r.aspect['BAYN.DE'].polarity < -0.1, `Bayer-Aspekt sollte negativ sein, war ${r.aspect['BAYN.DE'].polarity}`);
});

test('analyzer: aspectSentimentForStock funktioniert auch alleine', () => {
  const text = 'SAP klettert auf Rekordhoch. Adidas verliert deutlich.';
  const m = findStockMentions('', text);
  const sap = aspectSentimentForStock(text, m['SAP.DE'].positions, 8, 'de');
  const ads = aspectSentimentForStock(text, m['ADS.DE'].positions, 8, 'de');
  assert.ok(sap.polarity > 0, `SAP-Fenster sollte positiv sein, war ${sap.polarity}`);
  assert.ok(ads.polarity < 0, `Adidas-Fenster sollte negativ sein, war ${ads.polarity}`);
});

// ---------- analyzeArticle (combined) ----------

test('analyzer: analyzeArticle gibt overall + talk + mentions + aspect zurueck', () => {
  const r = analyzeArticle({
    title: 'SAP hebt Prognose an',
    summary: 'Walldorfer melden Rekordgewinn, Berenberg hebt Kursziel an. Kaufempfehlung.',
    lang: 'de',
  });
  assert.ok(r.overall.polarity > 0);
  assert.ok(r.overall.bull_score > 0);
  assert.ok(['earnings', 'analyst', 'guidance', 'general'].includes(r.talk.talk_type));
  assert.ok(r.mentions['SAP.DE']);
  assert.ok(r.aspect['SAP.DE']);
});

test('analyzer: Intensifier verstaerkt Sentiment', () => {
  const plain = scoreSentiment('SAP zeigt Gewinn.', 'de');
  const strong = scoreSentiment('SAP zeigt sehr starken Gewinn.', 'de');
  assert.ok(strong.polarity >= plain.polarity);
});
