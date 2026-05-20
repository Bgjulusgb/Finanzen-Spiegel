'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFeedXml, parseJsonFeed, detectEncoding, decode } = require('../src/feed-fetcher');

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>Test</description>
    <item>
      <title>Pinocchio Premiere an den Muenchner Kammerspielen</title>
      <link>https://example.com/pinocchio</link>
      <guid>https://example.com/pinocchio</guid>
      <pubDate>Fri, 15 May 2026 10:00:00 +0200</pubDate>
      <dc:creator>Max Muster</dc:creator>
      <description>Wu Tsang inszeniert.</description>
      <content:encoded><![CDATA[<p>Volltext mit <b>HTML</b></p>]]></content:encoded>
      <category>Theater</category>
      <category>Premiere</category>
    </item>
    <item>
      <title>Zweiter Artikel</title>
      <link>https://example.com/2</link>
      <pubDate>Thu, 14 May 2026 10:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Test</title>
  <updated>2026-05-15T10:00:00Z</updated>
  <entry>
    <title>Wallenstein-Kritik</title>
    <link href="https://example.com/wallenstein" rel="alternate"/>
    <link href="https://example.com/wallenstein.json" rel="self" type="application/json"/>
    <id>tag:example.com,2026:wallenstein</id>
    <published>2026-05-15T10:00:00Z</published>
    <updated>2026-05-15T11:00:00Z</updated>
    <summary>Schillers Wallenstein.</summary>
    <author><name>Anna Autor</name></author>
  </entry>
</feed>`;

const RDF_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.com/rdf">
    <title>RDF Test</title>
    <link>https://example.com</link>
    <description>Test</description>
  </channel>
  <item rdf:about="https://example.com/article1">
    <title>RDF Artikel</title>
    <link>https://example.com/article1</link>
    <description>Beschreibung</description>
    <dc:date>2026-05-15T10:00:00Z</dc:date>
    <dc:creator>Autor</dc:creator>
  </item>
</rdf:RDF>`;

const JSON_FEED_SAMPLE = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON Feed Test',
  items: [
    {
      id: 'a1',
      url: 'https://example.com/a1',
      title: 'JSON Artikel',
      date_published: '2026-05-15T10:00:00Z',
      content_text: 'Volltext.',
      author: { name: 'JS Autor' },
    },
  ],
});

test('parseFeedXml parst RSS 2.0 inkl. dc:creator und content:encoded', async () => {
  const result = await parseFeedXml(RSS_SAMPLE);
  assert.equal(result.title, 'Test Feed');
  assert.equal(result.items.length, 2);
  const a = result.items[0];
  assert.ok(a.title.includes('Pinocchio'));
  assert.equal(a.url, 'https://example.com/pinocchio');
  assert.equal(a.author, 'Max Muster');
  assert.ok(a.content.includes('Volltext'));
  assert.ok(a.publishedDate instanceof Date);
  assert.equal(a.publishedDate.getUTCFullYear(), 2026);
  assert.ok(a.categories.includes('Theater'));
});

test('parseFeedXml parst Atom mit mehreren link-Elementen', async () => {
  const result = await parseFeedXml(ATOM_SAMPLE);
  assert.equal(result.title, 'Atom Test');
  assert.equal(result.items.length, 1);
  const a = result.items[0];
  assert.equal(a.url, 'https://example.com/wallenstein');
  assert.equal(a.author, 'Anna Autor');
  assert.ok(a.publishedDate instanceof Date);
});

test('parseFeedXml parst RDF (RSS 1.0)', async () => {
  const result = await parseFeedXml(RDF_SAMPLE);
  assert.equal(result.items.length, 1);
  const a = result.items[0];
  assert.equal(a.title, 'RDF Artikel');
  assert.equal(a.url, 'https://example.com/article1');
  assert.equal(a.author, 'Autor');
});

test('parseJsonFeed parst JSON Feed', () => {
  const result = parseJsonFeed(JSON_FEED_SAMPLE);
  assert.equal(result.title, 'JSON Feed Test');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'JSON Artikel');
  assert.equal(result.items[0].author, 'JS Autor');
});

test('detectEncoding erkennt UTF-8 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<?xml?>')]);
  assert.equal(detectEncoding(buf, ''), 'utf-8');
});

test('detectEncoding erkennt charset aus content-type', () => {
  const buf = Buffer.from('<html></html>');
  assert.equal(detectEncoding(buf, 'text/html; charset=ISO-8859-1'), 'iso-8859-1');
});

test('detectEncoding erkennt encoding aus XML-Declaration', () => {
  const buf = Buffer.from('<?xml version="1.0" encoding="windows-1252"?><rss/>');
  assert.equal(detectEncoding(buf, 'application/xml'), 'windows-1252');
});

test('detectEncoding fallt auf utf-8 zurueck', () => {
  const buf = Buffer.from('<html></html>');
  assert.equal(detectEncoding(buf, 'text/html'), 'utf-8');
});

test('decode dekodiert ISO-8859-1 korrekt (Umlaute)', () => {
  const buf = Buffer.from([0xc4, 0xd6, 0xdc, 0xdf]);
  const utf8 = decode(buf, 'utf-8');
  const iso = decode(buf, 'iso-8859-1');
  assert.equal(iso, 'ÄÖÜß');
  assert.notEqual(utf8, 'ÄÖÜß');
});

test('parseFeedXml wirft bei unbekanntem Format', async () => {
  await assert.rejects(() => parseFeedXml('<html><body>kein feed</body></html>'));
});

test('parseFeedXml decodiert HTML-Entities in Titeln', async () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
    <item><title>Premiere &amp; Kritik &#8211; Hamlet</title><link>https://x</link></item>
  </channel></rss>`;
  const result = await parseFeedXml(xml);
  assert.ok(result.items[0].title.includes('Premiere & Kritik'));
});
