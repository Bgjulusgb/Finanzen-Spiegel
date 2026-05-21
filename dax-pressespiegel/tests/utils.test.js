'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, urlHash, expandUrlTemplate, ageHours, parseDateLoose } = require('../src/utils');

test('normalizeUrl entfernt UTM und Hash', () => {
  const u = normalizeUrl('https://example.com/path/?utm_source=x&utm_medium=y&id=42#frag');
  assert.equal(u, 'https://example.com/path?id=42');
});

test('normalizeUrl ist idempotent', () => {
  const a = normalizeUrl('https://x.test/a/b?z=1');
  const b = normalizeUrl(a);
  assert.equal(a, b);
});

test('urlHash ist deterministisch und ignoriert Case', () => {
  const a = urlHash('https://X.test/path');
  const b = urlHash('https://x.test/path');
  assert.equal(a, b);
  assert.equal(a.length, 40);
});

test('expandUrlTemplate ersetzt {QUERY} URL-encoded', () => {
  const u = expandUrlTemplate('https://news.google.com/rss/search?q={QUERY}', 'Mercedes-Benz Group');
  assert.ok(u.includes('Mercedes-Benz%20Group') || u.includes('Mercedes-Benz+Group'));
});

test('ageHours berechnet Stunden seit jetzt', () => {
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
  const h = ageHours(fiveHoursAgo);
  assert.ok(Math.abs(h - 5) < 0.1, `erwartet ~5, war ${h}`);
});

test('parseDateLoose akzeptiert mehrere Formate', () => {
  assert.ok(parseDateLoose('2026-05-19T12:00:00Z'));
  assert.ok(parseDateLoose('Mon, 19 May 2026 12:00:00 GMT'));
  assert.equal(parseDateLoose('garbage'), null);
  assert.equal(parseDateLoose(null), null);
});
