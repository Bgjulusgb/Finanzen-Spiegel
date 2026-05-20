'use strict';

const cheerio = require('cheerio');
const logger = require('./logger');
const { fetchText, parseFeedXml } = require('./feed-fetcher');

function buildGoogleNewsUrl(query, { hl = 'de', gl = 'DE', ceid = 'DE:de' } = {}) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

function buildBingNewsUrl(query, { mkt = 'de-DE' } = {}) {
  const q = encodeURIComponent(query);
  return `https://www.bing.com/news/search?q=${q}&format=rss&mkt=${mkt}`;
}

const redirectCache = new Map();

async function resolveGoogleNewsUrl(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return googleUrl;
  if (redirectCache.has(googleUrl)) return redirectCache.get(googleUrl);
  try {
    const res = await fetchText(googleUrl, { timeout: 15000 });
    const html = res.text;
    const $ = cheerio.load(html);

    const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
    if (metaRefresh) {
      const m = metaRefresh.match(/url=(.+)$/i);
      if (m) {
        const resolved = m[1].trim().replace(/^['"]|['"]$/g, '');
        redirectCache.set(googleUrl, resolved);
        return resolved;
      }
    }

    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical && !canonical.includes('news.google.com')) {
      redirectCache.set(googleUrl, canonical);
      return canonical;
    }

    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl && !ogUrl.includes('news.google.com')) {
      redirectCache.set(googleUrl, ogUrl);
      return ogUrl;
    }

    const jsRedirect = html.match(/window\.location\.replace\(["']([^"']+)["']\)/);
    if (jsRedirect) {
      redirectCache.set(googleUrl, jsRedirect[1]);
      return jsRedirect[1];
    }

    const aTag = $('a[href]').first().attr('href');
    if (aTag && aTag.startsWith('http') && !aTag.includes('news.google.com')) {
      redirectCache.set(googleUrl, aTag);
      return aTag;
    }

    if (res.finalUrl && !res.finalUrl.includes('news.google.com')) {
      redirectCache.set(googleUrl, res.finalUrl);
      return res.finalUrl;
    }
  } catch (err) {
    logger.debug(`Konnte Google-News-Redirect nicht aufloesen: ${err.message}`);
  }
  redirectCache.set(googleUrl, googleUrl);
  return googleUrl;
}

function extractSourceFromGoogleTitle(title) {
  if (!title) return null;
  const m = title.match(/\s+-\s+([^-]+)$/);
  if (m) return m[1].trim();
  return null;
}

function cleanGoogleNewsTitle(title) {
  if (!title) return '';
  return title.replace(/\s+-\s+[^-]+$/, '').trim();
}

async function fetchGoogleNewsFeed(feed) {
  const start = Date.now();
  const queries = feed.queries || [feed.query || 'Münchner Kammerspiele'];
  const allItems = new Map();

  for (const query of queries) {
    const url = buildGoogleNewsUrl(query);
    try {
      const res = await fetchText(url, { timeout: 20000 });
      const parsed = await parseFeedXml(res.text);
      for (const item of parsed.items) {
        if (!item.url) continue;
        const sourceName = extractSourceFromGoogleTitle(item.title) || 'Google News';
        const cleanTitle = cleanGoogleNewsTitle(item.title);
        const key = `${cleanTitle}::${sourceName}`;
        if (allItems.has(key)) continue;
        allItems.set(key, {
          title: cleanTitle,
          url: item.url,
          guid: item.guid,
          publishedDate: item.publishedDate,
          summary: item.summary,
          content: item.content,
          author: item.author,
          source: `${sourceName} (via Google News)`,
          sourcePriority: feed.priority || 80,
          googleNewsRedirect: true,
          searchQuery: query,
        });
      }
    } catch (err) {
      logger.warn(`Google News Query "${query}" fehlgeschlagen: ${err.message}`);
    }
  }

  const items = Array.from(allItems.values());
  return {
    status: items.length > 0 ? 'ok' : 'error',
    title: 'Google News',
    items,
    responseTimeMs: Date.now() - start,
    error: items.length === 0 ? `Alle ${queries.length} Queries fehlgeschlagen` : null,
    feedType: 'google-news',
  };
}

async function fetchBingNewsFeed(feed) {
  const start = Date.now();
  const queries = feed.queries || [feed.query || 'Münchner Kammerspiele'];
  const allItems = new Map();

  for (const query of queries) {
    const url = buildBingNewsUrl(query);
    try {
      const res = await fetchText(url, { timeout: 20000 });
      const parsed = await parseFeedXml(res.text);
      for (const item of parsed.items) {
        if (!item.url || allItems.has(item.url)) continue;
        allItems.set(item.url, {
          ...item,
          source: feed.name || 'Bing News',
          sourcePriority: feed.priority || 70,
        });
      }
    } catch (err) {
      logger.warn(`Bing News Query "${query}" fehlgeschlagen: ${err.message}`);
    }
  }

  const items = Array.from(allItems.values());
  return {
    status: items.length > 0 ? 'ok' : 'error',
    items,
    responseTimeMs: Date.now() - start,
    feedType: 'bing-news',
    error: items.length === 0 ? 'Keine Treffer' : null,
  };
}

module.exports = {
  buildGoogleNewsUrl,
  buildBingNewsUrl,
  resolveGoogleNewsUrl,
  fetchGoogleNewsFeed,
  fetchBingNewsFeed,
  cleanGoogleNewsTitle,
  extractSourceFromGoogleTitle,
};
