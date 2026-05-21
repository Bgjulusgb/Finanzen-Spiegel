'use strict';

const crypto = require('crypto');

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'ref_src',
]);

function normalizeUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u.trim());
    for (const p of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(p)) url.searchParams.delete(p);
    }
    url.hash = '';
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return String(u).trim();
  }
}

function urlHash(u) {
  return crypto.createHash('sha1').update(normalizeUrl(u).toLowerCase()).digest('hex');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function isoNow() { return new Date().toISOString(); }

function parseDateLoose(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function ageHours(isoStr, now = new Date()) {
  if (!isoStr) return 0;
  const t = new Date(isoStr);
  if (Number.isNaN(t.getTime())) return 0;
  return Math.max(0, (now.getTime() - t.getTime()) / 3600000);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function expandUrlTemplate(template, query) {
  return template.replace(/\{QUERY\}/g, encodeURIComponent(query));
}

module.exports = {
  normalizeUrl, urlHash, escapeRegex, stripHtml, isoNow,
  parseDateLoose, ageHours, clamp, expandUrlTemplate,
};
