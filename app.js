'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const F = require('../src/feed-fetcher');

beforeEach(() => F.clearDomainFailures());

test('BROWSER_PROFILES enthaelt 5 vollstaendige Profile', () => {
  assert.equal(F.BROWSER_PROFILES.length, 5);
  for (const p of F.BROWSER_PROFILES) {
    assert.ok(p['User-Agent'], 'User-Agent fehlt');
    assert.ok(p['Accept'], 'Accept fehlt');
    assert.ok(p['Accept-Language'], 'Accept-Language fehlt');
    assert.ok(p['Accept-Encoding'], 'Accept-Encoding fehlt');
  }
});

test('USER_AGENTS bleibt aus Profilen abgeleitet', () => {
  assert.equal(F.USER_AGENTS.length, F.BROWSER_PROFILES.length);
});

test('buildHeaders fuer br.de setzt Referer auf https://www.br.de/', () => {
  const h = F.buildHeaders({ url: 'https://www.br.de/nachrichten/meldungen/index.rss' });
  assert.equal(h['referer'], 'https://www.br.de/');
});

test('buildHeaders fuer Subdomains von ARD-Sendern setzt Referer', () => {
  const h = F.buildHeaders({ url: 'https://www1.wdr.de/nachrichten/kultur/index.feed' });
  assert.equal(h['referer'], 'https://www1.wdr.de/');
});

test('buildHeaders fuer mdr.de, swr.de, deutschlandfunkkultur.de setzt Referer', () => {
  assert.equal(F.buildHeaders({ url: 'https://www.mdr.de/x.rss' }).referer, 'https://www.mdr.de/');
  assert.equal(F.buildHeaders({ url: 'https://www.swr.de/x' }).referer, 'https://www.swr.de/');
  assert.equal(
    F.buildHeaders({ url: 'https://www.deutschlandfunkkultur.de/x.rss' }).referer,
    'https://www.deutschlandfunkkultur.de/'
  );
});

test('buildHeaders fuer Nicht-ARD setzt KEINEN Referer', () => {
  const h = F.buildHeaders({ url: 'https://example.com/feed.xml' });
  assert.equal(h['referer'], undefined);
});

test('getReferer null-safe', () => {
  assert.equal(F.getReferer(null), null);
  assert.equal(F.getReferer(''), null);
  assert.equal(F.getReferer('not-a-url'), null);
});

test('classifyError: HTTP 403 -> forbidden', () => {
  assert.equal(F.classifyError({ message: 'HTTP 403 fuer x' }), 'forbidden');
});

test('classifyError: HTTP 404 -> notfound', () => {
  assert.equal(F.classifyError({ message: 'HTTP 404 fuer x' }), 'notfound');
});

test('classifyError: HTTP 410 -> gone', () => {
  assert.equal(F.classifyError({ message: 'HTTP 410 fuer x' }), 'gone');
});

test('classifyError: HTTP 500 -> server', () => {
  assert.equal(F.classifyError({ message: 'HTTP 503 fuer x' }), 'server');
});

test('classifyError: HTTP 429 -> ratelimit', () => {
  assert.equal(F.classifyError({ message: 'HTTP 429' }), 'ratelimit');
});

test('classifyError: ENOTFOUND/EAI_AGAIN -> dns', () => {
  assert.equal(F.classifyError({ code: 'ENOTFOUND' }), 'dns');
  assert.equal(F.classifyError({ code: 'EAI_AGAIN' }), 'dns');
});

test('classifyError: ETIMEDOUT/AbortError -> timeout', () => {
  assert.equal(F.classifyError({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(F.classifyError({ name: 'AbortError' }), 'timeout');
});

test('classifyError: ECONNRESET -> socket', () => {
  assert.equal(F.classifyError({ code: 'ECONNRESET' }), 'socket');
});

test('Domain-Cooldown: 2x 403 reicht nicht', () => {
  F.recordDomain403('https://example.com/feed');
  F.recordDomain403('https://example.com/feed');
  assert.equal(F.isDomainInCooldown('https://example.com/feed'), false);
});

test('Domain-Cooldown: 3x 403 in 60s -> 5min Cooldown', () => {
  F.recordDomain403('https://example.com/feed');
  F.recordDomain403('https://example.com/feed');
  F.recordDomain403('https://example.com/feed');
  assert.equal(F.isDomainInCooldown('https://example.com/feed'), true);
});

test('Domain-Cooldown: Pfad-unabhaengig (host-basiert)', () => {
  F.recordDomain403('https://example.com/a');
  F.recordDomain403('https://example.com/b');
  F.recordDomain403('https://example.com/c');
  assert.equal(F.isDomainInCooldown('https://example.com/d'), true);
});

test('Domain-Cooldown: recordDomainSuccess setzt Counter zurueck', () => {
  F.recordDomain403('https://example.com/x');
  F.recordDomain403('https://example.com/x');
  F.recordDomainSuccess('https://example.com/x');
  F.recordDomain403('https://example.com/x');
  F.recordDomain403('https://example.com/x');
  assert.equal(F.isDomainInCooldown('https://example.com/x'), false);
});

test('Domain-Cooldown: Stats liefern Strukturierte Info', () => {
  F.recordDomain403('https://example.com/x');
  F.recordDomain403('https://example.com/x');
  F.recordDomain403('https://example.com/x');
  const stats = F.getDomainFailureStats();
  assert.ok(stats['example.com']);
  assert.equal(stats['example.com'].recentFailures, 3);
  assert.equal(stats['example.com'].inCooldown, true);
});

test('clearDomainFailures: setzt Cooldown global zurueck', () => {
  F.recordDomain403('https://a.com/x');
  F.recordDomain403('https://a.com/x');
  F.recordDomain403('https://a.com/x');
  F.clearDomainFailures();
  assert.equal(F.isDomainInCooldown('https://a.com/x'), false);
});

test('isDomainInCooldown: null-safe', () => {
  assert.equal(F.isDomainInCooldown('not-a-url'), false);
  assert.equal(F.isDomainInCooldown(''), false);
});

test('buildHeaders: profile-Auswahl rotiert mit attempt', () => {
  const p1 = F.buildHeaders({ profile: F.BROWSER_PROFILES[0] })['user-agent'];
  const p2 = F.buildHeaders({ profile: F.BROWSER_PROFILES[1] })['user-agent'];
  assert.notEqual(p1, p2);
});

test('buildHeaders: extra headers ueberschreiben', () => {
  const h = F.buildHeaders({ extra: { 'X-Custom': 'yes', accept: 'override/*' } });
  assert.equal(h['x-custom'], 'yes');
  assert.equal(h['accept'], 'override/*');
});

test('buildHeaders: etag und if-modified-since werden gesetzt', () => {
  const h = F.buildHeaders({ etag: 'abc', lastModified: 'Sun, 19 May 2026 00:00:00 GMT' });
  assert.equal(h['if-none-match'], 'abc');
  assert.equal(h['if-modified-since'], 'Sun, 19 May 2026 00:00:00 GMT');
});
