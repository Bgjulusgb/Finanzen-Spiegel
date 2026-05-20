'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractArticleDate, extractArticleContent } = require('../src/scraper');

test('extractArticleDate findet meta article:published_time', () => {
  const html = `
    <html><head>
      <meta property="article:published_time" content="2026-01-15T10:30:00+01:00">
    </head><body><p>Text</p></body></html>
  `;
  const date = extractArticleDate(html, 'https://example.com/artikel');
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 0);
});

test('extractArticleDate findet JSON-LD datePublished', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@type":"NewsArticle","datePublished":"2026-02-20T08:00:00Z"}
      </script>
    </head><body><p>Test</p></body></html>
  `;
  const date = extractArticleDate(html, 'https://example.com/artikel');
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 1);
});

test('extractArticleDate findet time-Element', () => {
  const html = '<html><body><time datetime="2026-03-10T12:00:00">10. Maerz</time></body></html>';
  const date = extractArticleDate(html, 'https://example.com/artikel');
  assert.ok(date);
  assert.equal(date.getMonth(), 2);
});

test('extractArticleDate parst Datum aus URL', () => {
  const html = '<html><body>Kein Datum-Meta</body></html>';
  const date = extractArticleDate(html, 'https://example.com/2026/04/15/artikel.html');
  assert.ok(date);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 3);
  assert.equal(date.getUTCDate(), 15);
});

test('extractArticleDate parst deutsches Datum aus Text', () => {
  const html = '<html><body>Veroeffentlicht am 15. Januar 2026 um 10 Uhr.</body></html>';
  const date = extractArticleDate(html, 'https://example.com/x');
  assert.ok(date);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 0);
});

test('extractArticleDate gibt null zurueck wenn nichts gefunden', () => {
  const html = '<html><body>Kein Datum hier</body></html>';
  const date = extractArticleDate(html, 'https://example.com/keine-datum');
  assert.equal(date, null);
});

test('extractArticleContent extrahiert Titel und Text', () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Hamlet Premiere">
        <meta name="author" content="Max Muster">
      </head>
      <body>
        <article>
          <h1>Hamlet Premiere</h1>
          <p>Die Auffuehrung an den Muenchner Kammerspielen war beeindruckend.</p>
          <p>Die Regie ueberzeugte das Publikum mit einer modernen Inszenierung.</p>
        </article>
      </body>
    </html>
  `;
  const content = extractArticleContent(html, 'https://example.com/hamlet');
  assert.equal(content.title, 'Hamlet Premiere');
  assert.equal(content.author, 'Max Muster');
  assert.ok(content.text.includes('Kammerspielen'));
  assert.ok(content.firstParagraph.length > 0);
});

test('extractArticleContent erkennt Paywall', () => {
  const html = `
    <html><body>
      <article><p>Anfang des Artikels...</p></article>
      <div class="paywall">Bitte abonnieren</div>
    </body></html>
  `;
  const content = extractArticleContent(html, 'https://example.com/paywall');
  assert.equal(content.paywall, true);
});

test('extractArticleContent entfernt Script-Tags', () => {
  const html = `
    <html><body>
      <article>
        <p>Echter Inhalt.</p>
        <script>alert('boese')</script>
      </article>
    </body></html>
  `;
  const content = extractArticleContent(html, 'https://example.com/x');
  assert.ok(!content.text.includes('alert'));
  assert.ok(content.text.includes('Echter Inhalt'));
});
