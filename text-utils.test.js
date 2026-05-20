'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyze,
  analyzeSentiment,
  calculateRelevance,
  passesRequiredFilter,
  detectArticleType,
  categorize,
  generateSummary,
  findContextualMatch,
  findFuzzyMatch,
} = require('../src/analyzer');

test('passesRequiredFilter akzeptiert Kammerspiele-Artikel', () => {
  const article = {
    title: 'Hamlet an den Muenchner Kammerspielen',
    fullText: 'Eine grossartige Inszenierung an den Kammerspielen.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, true);
});

test('passesRequiredFilter lehnt irrelevante Artikel ab', () => {
  const article = {
    title: 'Fussball-Bundesliga',
    fullText: 'Bayern Muenchen hat gewonnen.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, false);
});

test('passesRequiredFilter respektiert exclude-Liste', () => {
  const article = {
    title: 'Stellenanzeige bei den Kammerspielen',
    fullText: 'Die Muenchner Kammerspiele suchen eine Stellenanzeige.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, false);
  assert.ok(result.reason.startsWith('exclude:'));
});

test('calculateRelevance gibt Titel-Match mehr Punkte', () => {
  const titleMatch = calculateRelevance(
    {
      title: 'Muenchner Kammerspiele: Hamlet-Premiere',
      fullText: 'Ein Theaterabend.',
    },
    100
  );
  const textOnly = calculateRelevance(
    {
      title: 'Premiere im Theater',
      fullText: 'Die Muenchner Kammerspiele zeigen Hamlet.',
    },
    100
  );
  assert.ok(titleMatch.score > textOnly.score);
});

test('calculateRelevance bestraft kurze Artikel', () => {
  const result = calculateRelevance(
    {
      title: 'Muenchner Kammerspiele',
      fullText: 'Kurz.',
    },
    50
  );
  const longResult = calculateRelevance(
    {
      title: 'Muenchner Kammerspiele',
      fullText: 'Lorem ipsum dolor sit amet. '.repeat(50),
    },
    50
  );
  assert.ok(longResult.score > result.score);
});

test('categorize liefert korrekte Kategorien', () => {
  assert.equal(categorize(100), 'sehr_relevant');
  assert.equal(categorize(80), 'sehr_relevant');
  assert.equal(categorize(60), 'relevant');
  assert.equal(categorize(40), 'moeglich_relevant');
  assert.equal(categorize(10), 'irrelevant');
});

test('analyzeSentiment erkennt positive Texte', () => {
  const result = analyzeSentiment('Eine grossartige, brillante und sehenswerte Inszenierung.');
  assert.equal(result.label, 'positiv');
  assert.ok(result.score > 0);
});

test('analyzeSentiment erkennt negative Texte', () => {
  const result = analyzeSentiment('Eine enttaeuschende, langweilige und missglueckte Vorstellung.');
  assert.equal(result.label, 'negativ');
  assert.ok(result.score < 0);
});

test('analyzeSentiment beruecksichtigt Negationen', () => {
  const positive = analyzeSentiment('Die Inszenierung war grossartig.');
  const negated = analyzeSentiment('Die Inszenierung war nicht grossartig.');
  assert.ok(positive.score > negated.score);
});

test('analyzeSentiment liefert neutral bei normalem Text', () => {
  const result = analyzeSentiment('Die Vorstellung dauerte zwei Stunden mit einer Pause.');
  assert.equal(result.label, 'neutral');
});

test('detectArticleType erkennt Kritiken', () => {
  const type = detectArticleType({
    title: 'Hamlet Premiere',
    fullText: 'Die Inszenierung auf der Buehne. Die Regie. Die Auffuehrung war beeindruckend.',
  });
  assert.equal(type, 'review');
});

test('detectArticleType erkennt Interviews', () => {
  const type = detectArticleType({
    title: 'Interview mit Frau Mundel',
    fullText: 'Im Gespraech sagt sie: Wir wollen mehr. Sie erklaert: Das ist wichtig.',
  });
  assert.equal(type, 'interview');
});

test('generateSummary respektiert Maximallaenge', () => {
  const article = {
    fullText: 'Lorem ipsum. '.repeat(100),
  };
  const summary = generateSummary(article, 50);
  assert.ok(summary.length <= 51);
});

test('passesRequiredFilter schliesst Hamburger Kammerspiele aus', () => {
  const article = {
    title: 'Hamburger Kammerspiele zeigen neues Stueck',
    fullText: 'Die Hamburger Kammerspiele zeigen eine neue Inszenierung.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, false);
  assert.ok(result.reason.includes('hamburger'));
});

test('calculateRelevance erkennt aktuelle Produktion "Wokey Wokey"', () => {
  const article = {
    title: 'Wokey Wokey an den Kammerspielen',
    fullText:
      'Nora Abdel-Maksoud inszeniert ihr Stueck Wokey Wokey an den Muenchner Kammerspielen.',
  };
  const result = calculateRelevance(article, 100);
  assert.ok(result.score >= 80, `erwarte sehr_relevant, score=${result.score}`);
  assert.equal(result.category, 'sehr_relevant');
});

test('calculateRelevance erkennt Ensemble-Mitglied Wiebke Puls', () => {
  const article = {
    title: 'Wiebke Puls in neuer Rolle',
    fullText:
      'Die Schauspielerin Wiebke Puls vom Ensemble der Muenchner Kammerspiele uebernimmt eine Hauptrolle. Die Inszenierung ist beeindruckend.',
  };
  const result = calculateRelevance(article, 100);
  assert.ok(result.score >= 50);
  assert.ok(result.matches.people.length > 0);
});

test('calculateRelevance gibt mehr Punkte bei Titel + Produktion', () => {
  const both = calculateRelevance(
    {
      title: 'Pinocchio an den Kammerspielen',
      fullText: 'Eine Inszenierung von Wu Tsang.',
    },
    100
  );
  const textOnly = calculateRelevance(
    {
      title: 'Theaternachricht',
      fullText: 'Bei den Muenchner Kammerspielen laeuft Pinocchio.',
    },
    100
  );
  assert.ok(both.score > textOnly.score + 30);
});

test('findFuzzyMatch erkennt aehnliche Phrasen', () => {
  const text = 'die muenchner kammerspielen zeigen wachse oder weiche';
  assert.equal(findFuzzyMatch(text, 'wachse oder weiche'), true);
});

test('findContextualMatch findet Wort in Naehe', () => {
  const text = 'an den muenchner kammerspielen feierte pinocchio premiere';
  const ctx = findContextualMatch(text, 'pinocchio', ['kammerspielen'], 100);
  assert.equal(ctx, true);
});

test('findContextualMatch ignoriert wenn zu weit weg', () => {
  const text = 'pinocchio. ' + 'foo bar baz '.repeat(200) + 'kammerspielen.';
  const ctx = findContextualMatch(text, 'pinocchio', ['kammerspielen'], 100);
  assert.equal(ctx, false);
});

test('generateSummary bevorzugt Saetze mit Schluesselwoertern', () => {
  const article = {
    title: 'Hamlet Premiere',
    fullText:
      'Das Wetter war schoen am Abend. Die Premiere von Hamlet an den Muenchner Kammerspielen war ein Erfolg. Der Verkehr stockte. Die Inszenierung beeindruckte das Publikum.',
  };
  const summary = generateSummary(article, 300);
  assert.ok(
    summary.toLowerCase().includes('kammerspielen') || summary.toLowerCase().includes('hamlet')
  );
});

test('analyze vollstaendiger Durchlauf', () => {
  const article = {
    title: 'Brillante Hamlet-Premiere an den Muenchner Kammerspielen',
    fullText:
      'Eine grossartige Inszenierung. Die Auffuehrung war beeindruckend. ' +
      'Die Regie zeigt Mut. Das Ensemble ueberzeugt. ' +
      'Premiere. '.repeat(20),
    wordCount: 60,
  };
  const result = analyze(article, 100);
  assert.equal(result.passes, true);
  assert.equal(result.sentiment, 'positiv');
  assert.ok(result.relevanceScore > 50);
  assert.ok(['relevant', 'sehr_relevant'].includes(result.category));
});
