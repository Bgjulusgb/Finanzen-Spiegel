'use strict';

const { request } = require('undici');
const Parser = require('rss-parser');
const { settings } = require('./config');
const { expandUrlTemplate, normalizeUrl, urlHash, stripHtml, parseDateLoose, isoNow } = require('./utils');
const logger = require('./logger');

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const ALT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const UA = settings.scan.user_agent && settings.scan.user_agent !== 'auto'
  ? settings.scan.user_agent
  : DEFAULT_UA;

const parser = new Parser({
  timeout: settings.scan.request_timeout_ms,
  headers: { 'User-Agent': UA },
  customFields: { item: ['media:content', 'dc:creator'] },
});

async function _doFetch(url, ua) {
  // undici folgt 3xx-Antworten standardmaessig nicht selbststaendig;
  // wir behandeln es per Hand fuer Aggregator-URLs (Google News -> Redirect).
  return await _doFetchWithRedirects(url, ua, 5);
}

async function _doFetchWithRedirects(url, ua, hops) {
  const { body, statusCode, headers } = await request(url, {
    method: 'GET',
    headers: {
      'User-Agent': ua,
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, application/json;q=0.8, text/xml;q=0.8, */*;q=0.5',
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.7,en;q=0.6',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
    },
    headersTimeout: settings.scan.request_timeout_ms,
    bodyTimeout: settings.scan.request_timeout_ms,
  });
  if (statusCode >= 300 && statusCode < 400 && headers.location && hops > 0) {
    await body.dump();
    const next = new URL(headers.location, url).toString();
    return _doFetchWithRedirects(next, ua, hops - 1);
  }
  if (statusCode >= 400) {
    await body.dump();
    const err = new Error(`HTTP ${statusCode}`);
    err.statusCode = statusCode;
    throw err;
  }
  return await body.text();
}

async function fetchText(url) {
  // Erst Default-UA, bei 403/429 mit alternativer Identitaet und kurzem Backoff erneut.
  try {
    return await _doFetch(url, UA);
  } catch (err) {
    if (err.statusCode === 403 || err.statusCode === 429 || err.statusCode === 503) {
      await new Promise((r) => setTimeout(r, 800));
      return await _doFetch(url, ALT_UA);
    }
    throw err;
  }
}

function normalizeItem(item, source) {
  const link = normalizeUrl(item.link || item.guid || item.id || '');
  if (!link) return null;
  return {
    url: link,
    url_hash: urlHash(link),
    title: stripHtml(item.title || ''),
    summary: stripHtml(item.contentSnippet || item.content || item.summary || item.description || ''),
    source_id: source.id,
    source_name: source.name,
    source_trust: Number(source.trust ?? 0.4),
    lang: source.lang || 'de',
    published_utc: parseDateLoose(item.isoDate || item.pubDate || item.published || item.date),
    fetched_utc: isoNow(),
  };
}

async function _tryParseFeed(url) {
  const text = await fetchText(url);
  // Heuristik: wenn es JSON-Feed ist, in RSS-Form bringen ist Aufwand - dann fallback erkennen.
  if (text.trim().startsWith('{')) {
    const j = JSON.parse(text);
    const items = (j.items || []).map((it) => ({
      title: it.title, link: it.url || it.id, content: it.content_html || it.content_text,
      isoDate: it.date_published, id: it.id, guid: it.id,
    }));
    return { items };
  }
  return await parser.parseString(text);
}

async function fetchSource(source, query = null) {
  const baseUrl = source.per_stock && query ? expandUrlTemplate(source.url, query) : source.url;
  const altUrls = (source.alt_urls || []).map((u) => source.per_stock && query ? expandUrlTemplate(u, query) : u);
  const urls = [baseUrl, ...altUrls];

  let lastErr = null;
  for (const url of urls) {
    try {
      const feed = await _tryParseFeed(url);
      const items = (feed.items || [])
        .slice(0, settings.scan.max_articles_per_source)
        .map((it) => normalizeItem(it, source))
        .filter(Boolean);
      return { ok: true, items, source_id: source.id, source_url: url };
    } catch (err) {
      lastErr = err;
      logger.debug(`feed-try-fail ${source.id} ${url}: ${err.message}`);
    }
  }
  logger.warn(`feed-fail ${source.id}: ${lastErr?.message || 'unknown'}`);
  return { ok: false, items: [], source_id: source.id, error: lastErr?.message || 'unknown' };
}

function buildFetchPlan(sources, stocks) {
  const plan = [];
  for (const s of sources) {
    if (s.per_stock) {
      for (const st of stocks) {
        const baseQ = st.queries[0];
        const q = s.lang === 'en' ? `${baseQ} stock` : `${baseQ} Aktie`;
        plan.push({ source: s, query: q, stock_symbol: st.symbol });
      }
    } else {
      plan.push({ source: s, query: null, stock_symbol: null });
    }
  }
  return plan;
}

async function runWithLimit(plan, limit, worker) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < plan.length) {
      const i = idx++;
      try { results[i] = await worker(plan[i]); }
      catch (err) { results[i] = { ok: false, items: [], error: err.message }; }
    }
  }
  const runners = Array.from({ length: Math.min(limit, plan.length) }, () => next());
  await Promise.all(runners);
  return results;
}

module.exports = { fetchSource, buildFetchPlan, runWithLimit, fetchText };
