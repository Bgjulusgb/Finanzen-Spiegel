'use strict';

const fs = require('fs');
const path = require('path');
process.env.LOG_LEVEL = 'warn';

const useProd = process.argv.includes('--prod');
const TEST_DB = useProd
  ? path.join(__dirname, '..', 'data', 'pressespiegel.db')
  : path.join(__dirname, '..', 'data', 'test-mock.db');
if (!useProd && fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const settings = require('../config/settings.json');
if (!useProd) settings.database.path = './data/test-mock.db';

const database = require('../src/database');
const { analyze } = require('../src/analyzer');
const { normalizeUrl } = require('../src/utils');
const { generateReport } = require('../src/reporter');
const { subDays, endOfDay, startOfDay } = require('date-fns');

const mockArticles = [
  {
    url: 'https://www.sueddeutsche.de/kultur/wokey-wokey-kammerspiele-premiere',
    title: 'Wokey Wokey an den Muenchner Kammerspielen: Eine fulminante Premiere',
    source: 'Sueddeutsche Zeitung - Kultur',
    sourcePriority: 100,
    author: 'Egbert Tholl',
    publishedDate: subDays(new Date(), 1),
    fullText:
      'Nora Abdel-Maksoud hat an den Muenchner Kammerspielen ihre neue Inszenierung "Wokey Wokey" zur Premiere gebracht. Der Abend war brillant, klug und ausgesprochen sehenswert. Die Schauspielerin Wiebke Puls ueberzeugt in einer Hauptrolle. Das Publikum jubelte am Ende minutenlang. Die Regie zeigt politischen Mut und feinsinnige Komik. Eine grossartige Inszenierung der Intendantin Barbara Mundel und ihres Ensembles. Premiere im Schauspielhaus.',
    paywall: false,
  },
  {
    url: 'https://www.br.de/nachrichten/kultur/pinocchio-wu-tsang-kammerspiele',
    title: 'Pinocchio: Wu Tsang inszeniert an den Kammerspielen',
    source: 'Bayerischer Rundfunk - Kultur',
    sourcePriority: 95,
    author: 'Christoph Leibold',
    publishedDate: subDays(new Date(), 2),
    fullText:
      'An den Muenchner Kammerspielen feiert "Pinocchio" Premiere. Die Regie von Wu Tsang verwandelt die bekannte Geschichte in einen visuell beeindruckenden Theaterabend. Die Inszenierung im Schauspielhaus war fesselnd. Das Ensemble der Kammerspiele zeigt sich virtuos.',
    paywall: false,
  },
  {
    url: 'https://www.nachtkritik.de/kammerspiele-tristan',
    title: 'Tristan und Isolde an den Kammerspielen - eine konfuse Aufführung',
    source: 'nachtkritik.de',
    sourcePriority: 100,
    author: 'Sabine Leucht',
    publishedDate: subDays(new Date(), 3),
    fullText:
      'Die neue Inszenierung von Tristan und Isolde an den Muenchner Kammerspielen wirkt ueberladen und unausgegoren. Die Regie verirrt sich in eigenen Konzepten. Die Auffuehrung war zaeh, ermuedend und letztlich missglueckt. Das Publikum reagierte verhalten.',
    paywall: false,
  },
  {
    url: 'https://www.zeit.de/kultur/wallenstein-kammerspiele',
    title: 'Wallenstein an den Münchner Kammerspielen: Klassiker neu gedacht',
    source: 'ZEIT - Kultur',
    sourcePriority: 90,
    author: 'Peter Kuemmel',
    publishedDate: subDays(new Date(), 4),
    fullText:
      'Schillers "Wallenstein" feierte an den Muenchner Kammerspielen Premiere. Die Inszenierung ueberzeugt mit einer kraftvollen Buehnenpraesenz und einem hervorragend agierenden Ensemble. Walter Hess und Thomas Schmauser in Hauptrollen. Eine ausgereifte Arbeit. Die Vorstellung dauerte drei Stunden.',
    paywall: false,
  },
  {
    url: 'https://www.merkur.de/kultur/eurydike-orpheus-kammerspiele',
    title: 'Eurydike und Orpheus: Anna Smolar inszeniert',
    source: 'Merkur - Kultur',
    sourcePriority: 75,
    author: null,
    publishedDate: subDays(new Date(), 5),
    fullText:
      'Die polnische Regisseurin Anna Smolar bringt "Eurydike und Orpheus" an die Muenchner Kammerspiele. Die Inszenierung gilt als gelungen. Das Stueck laeuft im Werkraum.',
    paywall: false,
  },
  {
    url: 'https://www.faz.net/feuilleton/buehne-mephisto-kammerspiele',
    title: 'Mephisto an den Kammerspielen: Aktuelle Politik im Klassiker',
    source: 'FAZ - Buehne und Konzert',
    sourcePriority: 95,
    author: 'Simon Strauss',
    publishedDate: subDays(new Date(), 6),
    fullText:
      'Klaus Manns "Mephisto" in einer Inszenierung an den Muenchner Kammerspielen. Die Regie schafft eine starke Parabel auf gegenwaertige politische Verhaeltnisse. Beeindruckend. Das Ensemble agiert hervorragend.',
    paywall: true,
  },
  {
    url: 'https://example.com/hamburger-kammerspiele',
    title: 'Premiere an den Hamburger Kammerspielen',
    source: 'Beispiel-Quelle',
    sourcePriority: 50,
    author: null,
    publishedDate: subDays(new Date(), 2),
    fullText: 'An den Hamburger Kammerspielen wird ein Stueck gespielt.',
    paywall: false,
  },
  {
    url: 'https://www.abendzeitung-muenchen.de/kultur/buehne/interview-mundel',
    title: 'Interview mit Barbara Mundel: "Theater muss provozieren"',
    source: 'Abendzeitung Muenchen - Kultur',
    sourcePriority: 75,
    author: 'Robert Braunmueller',
    publishedDate: subDays(new Date(), 1),
    fullText:
      'Im Gespraech mit der Intendantin der Muenchner Kammerspiele. Barbara Mundel erklaert: Theater muss provozieren. Sie sagt, das Ensemble sei gut aufgestellt. Frage: Wie sehen Sie die kommende Spielzeit? Antwort: Mit grosser Vorfreude.',
    paywall: false,
  },
];

console.log('Inserting mock articles...');
let inserted = 0;
for (const raw of mockArticles) {
  const analysis = analyze(raw, raw.sourcePriority);
  if (!analysis.passes) {
    console.log(`SKIP (${analysis.rejectReason}): ${raw.title}`);
    continue;
  }
  const article = {
    ...raw,
    urlNormalized: normalizeUrl(raw.url),
    firstParagraph: raw.fullText.slice(0, 500),
    wordCount: raw.fullText.split(/\s+/).length,
    summary: analysis.summary,
    relevanceScore: analysis.relevanceScore,
    sentiment: analysis.sentiment,
    sentimentScore: analysis.sentimentScore,
    category: analysis.category,
    articleType: analysis.articleType,
    meta: { reasons: analysis.relevanceReasons },
  };
  database.insertArticle(article);
  inserted++;
  console.log(
    `OK [${analysis.category}/${analysis.sentiment}/${analysis.relevanceScore}] ${raw.title}`
  );
}
console.log(`\nInserted ${inserted} articles.`);

const from = startOfDay(subDays(new Date(), 7));
const to = endOfDay(new Date());
const articles = database.getArticlesByRange(from, to);
console.log(`\nGenerating report for ${articles.length} articles...`);

generateReport({ from, to, articles, format: 'html', title: 'TESTBERICHT (Mock-Daten)' })
  .then((result) => {
    console.log(`\n✓ Report: ${result.html}`);
    database.close();
    if (!useProd) {
      if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
      if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
      if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
    }
  })
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
