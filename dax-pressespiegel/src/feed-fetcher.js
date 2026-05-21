'use strict';

const { request } = require('undici');
const Parser = require('rss-parser');
const { settings } = require('./config');
const { expandUrlTemplate, normalizeUrl, urlHash, stripHtml, parseDateLoose, isoNow } = require('./utils');
const logger = require('./logger');

const parser = new Parser({
  timeout: settings.scan.request_timeout_ms,
  headers: { 'User-Agent': settings.scan.user_agent },
});

async function fetchText(url) {
  const { body, statusCode, headers } = await request(url, {
    method: 'GET',
    headers: {
      'User-Agent': settings.scan.user_agent,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Language': 'de,en;q=0.7',
      'Accept-Encoding': 'identity',
    },
    headersTimeout: settings.scan.request_timeout_ms,
    bodyTimeout: settings.scan.request_timeout_ms,
  });
  if (statusCode >= 400) {
    const err = new Error(`HTTP ${statusCode} for ${url}`);
    err.statusCode = statusCode;
    throw err;
  }
  return await body.text();
}

function normalizeItem(item, source) {
  const link = normalizeUrl(item.link || item.guid || item.id || '');
  if (!link) return null;
  return {
    url: link,
    url_hash: urlHash(link),
    title: stripHtml(item.title || ''),
    summary: stripHtml(item.contentSnippet || item.content || item.summary || ''),
    source_id: source.id,
    source_name: source.name,
    source_trust: Number(source.trust ?? 0.4),
    lang: source.lang || 'de',
    published_utc: parseDateLoose(item.isoDate || item.pubDate || item.published || item.date),
    fetched_utc: isoNow(),
  };
}

async function fetchSource(source, query = null) {
  const url = source.per_stock && query ? expandUrlTemplate(source.url, query) : source.url;
  try {
    const xml = await fetchText(url);
    const feed = await parser.parseString(xml);
    const items = (feed.items || [])
      .slice(0, settings.scan.max_articles_per_source)
      .map((it) => normalizeItem(it, source))
      .filter(Boolean);
    return { ok: true, items, source_id: source.id, source_url: url };
  } catch (err) {
    logger.warn(`feed-fail ${source.id} (${url}): ${err.message}`);
    return { ok: false, items: [], source_id: source.id, error: err.message };
  }
}

// Liste der zu holenden (source, query) Paare.
// Quellen mit per_stock=true werden pro DAX-Aktie ein Mal expandiert (1 Hauptname).
function buildFetchPlan(sources, stocks) {
  const plan = [];
  for (const s of sources) {
    if (s.per_stock) {
      for (const st of stocks) {
        // ein Such-Query pro Aktie: erster query-Eintrag + "Aktie" / "stock" je nach Sprache
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

module.exports = { fetchSource, buildFetchPlan, runWithLimit };
