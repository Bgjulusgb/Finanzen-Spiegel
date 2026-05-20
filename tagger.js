'use strict';

const { request, Agent, setGlobalDispatcher, ProxyAgent } = require('undici');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');
const he = require('he');
const zlib = require('zlib');

const logger = require('./logger');
const { settings } = require('./config');
const { sleep } = require('./utils');

const dispatcher = new Agent({
  connect: { timeout: 15000 },
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
  pipelining: 1,
  allowH2: true,
});
setGlobalDispatcher(dispatcher);

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (e) {
    logger.warn(`Proxy konnte nicht gesetzt werden: ${e.message}`);
  }
}

const BROWSER_PROFILES = [
  {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept:
      'application/rss+xml, application/xml, text/xml, application/atom+xml, application/json;q=0.9, text/html;q=0.8, */*;q=0.5',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
    DNT: '1',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    Accept:
      'text/xml,application/xml,application/xhtml+xml,application/rss+xml,text/html;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    Accept: 'application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
    'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    DNT: '1',
  },
  {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
    Accept: 'application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
    'Accept-Language': 'de,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*;q=0.5',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  },
];

const USER_AGENTS = BROWSER_PROFILES.map((p) => p['User-Agent']);

function pickProfile(attempt = 0) {
  return BROWSER_PROFILES[attempt % BROWSER_PROFILES.length];
}

const ARD_DOMAINS = new Map([
  ['br.de', 'https://www.br.de/'],
  ['br-klassik.de', 'https://www.br-klassik.de/'],
  ['mdr.de', 'https://www.mdr.de/'],
  ['swr.de', 'https://www.swr.de/'],
  ['wdr.de', 'https://www1.wdr.de/'],
  ['rbb24.de', 'https://www.rbb24.de/'],
  ['rbb-online.de', 'https://www.rbb-online.de/'],
  ['ndr.de', 'https://www.ndr.de/'],
  ['sr.de', 'https://www.sr.de/'],
  ['ardmediathek.de', 'https://www.ardmediathek.de/'],
  ['daserste.de', 'https://www.daserste.de/'],
  ['hr.de', 'https://www.hr.de/'],
  ['hr2.de', 'https://www.hr2.de/'],
  ['deutschlandfunk.de', 'https://www.deutschlandfunk.de/'],
  ['deutschlandfunkkultur.de', 'https://www.deutschlandfunkkultur.de/'],
  ['deutschlandfunknova.de', 'https://www.deutschlandfunknova.de/'],
  ['3sat.de', 'https://www.3sat.de/'],
  ['zdf.de', 'https://www.zdf.de/'],
]);

function getReferer(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [domain, referer] of ARD_DOMAINS) {
      if (host === domain || host.endsWith('.' + domain)) return referer;
    }
  } catch {
    /* invalid url */
  }
  return null;
}

function buildHeaders({ ua, etag, lastModified, profile, url, extra = {} } = {}) {
  const p = profile || pickProfile();
  const headers = {};
  for (const [k, v] of Object.entries(p)) headers[k.toLowerCase()] = v;
  if (ua) headers['user-agent'] = ua;
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  if (url) {
    const referer = getReferer(url);
    if (referer) headers['referer'] = referer;
  }
  for (const [k, v] of Object.entries(extra)) headers[k.toLowerCase()] = v;
  return headers;
}

const DOMAIN_FAILURE_WINDOW_MS = 60_000;
const DOMAIN_COOLDOWN_MS = 5 * 60_000;
const DOMAIN_403_THRESHOLD = 3;

const domainFailures = new Map();

function getDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDomainInCooldown(url) {
  const domain = getDomain(url);
  if (!domain) return false;
  const entry = domainFailures.get(domain);
  if (!entry || !entry.cooldownUntil) return false;
  if (Date.now() < entry.cooldownUntil) return true;
  entry.cooldownUntil = 0;
  entry.failures = [];
  return false;
}

function recordDomain403(url) {
  const domain = getDomain(url);
  if (!domain) return;
  const now = Date.now();
  let entry = domainFailures.get(domain);
  if (!entry) {
    entry = { failures: [], cooldownUntil: 0 };
    domainFailures.set(domain, entry);
  }
  entry.failures = entry.failures.filter((ts) => now - ts < DOMAIN_FAILURE_WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= DOMAIN_403_THRESHOLD && !entry.cooldownUntil) {
    entry.cooldownUntil = now + DOMAIN_COOLDOWN_MS;
    logger.warn(
      `Domain-Cooldown aktiviert fuer ${domain} (${entry.failures.length}x 403 in ${DOMAIN_FAILURE_WINDOW_MS / 1000}s), ` +
        `naechster Versuch fruehestens in ${Math.round(DOMAIN_COOLDOWN_MS / 60000)} Minuten`
    );
  }
}

function recordDomainSuccess(url) {
  const domain = getDomain(url);
  if (!domain) return;
  const entry = domainFailures.get(domain);
  if (entry) {
    entry.failures = [];
    entry.cooldownUntil = 0;
  }
}

function getDomainFailureStats() {
  const stats = {};
  for (const [domain, entry] of domainFailures.entries()) {
    stats[domain] = {
      recentFailures: entry.failures.length,
      cooldownUntil: entry.cooldownUntil || null,
      inCooldown: entry.cooldownUntil > Date.now(),
    };
  }
  return stats;
}

function clearDomainFailures() {
  domainFailures.clear();
}

const lastRequestByDomain = new Map();
async function throttle(url) {
  try {
    const domain = new URL(url).hostname;
    const limit = settings.scraping.rate_limit_per_domain_ms || 1000;
    const last = lastRequestByDomain.get(domain) || 0;
    const wait = limit - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastRequestByDomain.set(domain, Date.now());
  } catch {
    /* invalid url */
  }
}

function detectEncoding(buffer, contentType) {
  const headerMatch = (contentType || '').match(/charset=["']?([^;"'\s]+)/i);
  if (headerMatch) return headerMatch[1].toLowerCase();
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return 'utf-8';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';
  const head = buffer.slice(0, 4096).toString('ascii');
  const xmlMatch = head.match(/<\?xml[^>]+encoding=["']([^"']+)["']/i);
  if (xmlMatch) return xmlMatch[1].toLowerCase();
  const metaMatch = head.match(/<meta[^>]+charset=["']?([^>"'\s/]+)/i);
  if (metaMatch) return metaMatch[1].toLowerCase();
  return 'utf-8';
}

function decode(buffer, encoding) {
  const enc = (encoding || 'utf-8').toLowerCase().replace(/_/g, '-');
  try {
    if (enc === 'utf-8' || enc === 'utf8') return buffer.toString('utf8');
    if (iconv.encodingExists(enc)) return iconv.decode(buffer, enc);
  } catch (err) {
    logger.warn(`Encoding ${enc} fehlgeschlagen: ${err.message}`);
  }
  return buffer.toString('utf8');
}

async function decompressBody(body, contentEncoding) {
  if (!contentEncoding) return body;
  const enc = contentEncoding.toLowerCase();
  return new Promise((resolve, reject) => {
    const cb = (err, result) => (err ? reject(err) : resolve(result));
    if (enc === 'gzip') zlib.gunzip(body, cb);
    else if (enc === 'deflate') zlib.inflate(body, cb);
    else if (enc === 'br') zlib.brotliDecompress(body, cb);
    else resolve(body);
  });
}

async function fetchRaw(
  url,
  { headers = {}, timeout, etag, lastModified, attempt = 0, maxRedirects = 6 } = {}
) {
  const reqHeaders = buildHeaders({
    profile: pickProfile(attempt),
    etag,
    lastModified,
    url,
    extra: headers,
  });
  await throttle(url);

  const t = timeout || settings.scraping.request_timeout_ms || 20000;
  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t);
    let res;
    try {
      res = await request(currentUrl, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller.signal,
        maxRedirections: 0,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      if (!location) break;
      const next = new URL(location, currentUrl).toString();
      try {
        await res.body.dump();
      } catch {}
      currentUrl = next;
      redirects++;
      continue;
    }

    const chunks = [];
    for await (const chunk of res.body) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    body = await decompressBody(body, res.headers['content-encoding']);

    return {
      status: res.statusCode,
      headers: res.headers,
      buffer: body,
      finalUrl: currentUrl,
      etag: res.headers.etag,
      lastModified: res.headers['last-modified'],
      contentType: res.headers['content-type'],
    };
  }

  throw new Error(`Zu viele Redirects (${maxRedirects})`);
}

function classifyError(err) {
  if (!err) return 'unknown';
  if (err.message && /HTTP 403/.test(err.message)) return 'forbidden';
  if (err.message && /HTTP 404/.test(err.message)) return 'notfound';
  if (err.message && /HTTP 410/.test(err.message)) return 'gone';
  if (err.message && /HTTP 5\d\d/.test(err.message)) return 'server';
  if (err.message && /HTTP 429/.test(err.message)) return 'ratelimit';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'dns';
  if (
    err.code === 'ETIMEDOUT' ||
    err.name === 'AbortError' ||
    err.code === 'UND_ERR_CONNECT_TIMEOUT'
  )
    return 'timeout';
  if (err.code === 'UND_ERR_SOCKET' || err.code === 'ECONNRESET') return 'socket';
  return 'unknown';
}

async function fetchText(url, opts = {}) {
  const maxRetries = settings.scraping.max_retries || 3;
  const backoffBase = settings.scraping.retry_backoff_ms || 2000;
  let lastErr = null;

  if (isDomainInCooldown(url)) {
    const err = new Error(`Domain im Cooldown: ${getDomain(url)}`);
    err.code = 'DOMAIN_COOLDOWN';
    err.errorClass = 'cooldown';
    throw err;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchRaw(url, { ...opts, attempt });
      if (res.status === 304) {
        recordDomainSuccess(url);
        return { status: 304, text: null, ...res };
      }
      if (res.status === 429) {
        const retryAfterSec = parseInt(res.headers['retry-after'] || '0', 10);
        const waitMs =
          retryAfterSec > 0 ? retryAfterSec * 1000 : backoffBase * Math.pow(2, attempt);
        const e = new Error(`HTTP 429 fuer ${url}`);
        e.statusCode = 429;
        e.errorClass = 'ratelimit';
        lastErr = e;
        if (attempt < maxRetries) {
          logger.warn(`HTTP 429, warte ${Math.round(waitMs / 1000)}s vor Retry: ${url}`);
          await sleep(waitMs);
          continue;
        }
        break;
      }
      if (res.status === 403) {
        const e = new Error(`HTTP 403 fuer ${url}`);
        e.statusCode = 403;
        throw e;
      }
      if (res.status >= 400) {
        const e = new Error(`HTTP ${res.status} fuer ${url}`);
        e.statusCode = res.status;
        throw e;
      }
      const encoding = detectEncoding(res.buffer, res.contentType);
      const text = decode(res.buffer, encoding);
      recordDomainSuccess(url);
      return { ...res, text, encoding };
    } catch (err) {
      lastErr = err;
      err.errorClass = err.errorClass || classifyError(err);
      if (err.errorClass === 'forbidden') {
        recordDomain403(url);
        break;
      }
      const isLast = attempt === maxRetries;
      const retryable = ['timeout', 'socket', 'dns', 'server', 'ratelimit'].includes(
        err.errorClass
      );
      logger.warn(
        `Fetch fehlgeschlagen (${attempt + 1}/${maxRetries + 1}, ${err.errorClass}): ${err.message}`,
        { url }
      );
      if (isLast || !retryable) break;
      await sleep(backoffBase * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function looksLikeAtom(text) {
  return /<feed[\s>][^]*?xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(text);
}
function looksLikeRdf(text) {
  return /<rdf:RDF/i.test(text);
}
function looksLikeRss(text) {
  return /<rss[\s>]/i.test(text) || /<channel>/i.test(text);
}
function looksLikeJsonFeed(text) {
  return text.trim().startsWith('{') && /jsonfeed\.org/i.test(text.slice(0, 1024));
}

async function parseFeedXml(text) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    explicitCharkey: false,
    trim: true,
    normalize: true,
    emptyTag: () => null,
    valueProcessors: [(val) => he.decode(val || '')],
  });
  const parsed = await parser.parseStringPromise(text);
  if (!parsed) throw new Error('Leeres XML');

  if (parsed.rss && parsed.rss.channel) {
    const ch = parsed.rss.channel;
    return { title: textOf(ch.title), items: arr(ch.item).map(rssItemToArticle) };
  }
  if (parsed.feed && (parsed.feed.entry || parsed.feed.title)) {
    return {
      title: textOf(parsed.feed.title),
      items: arr(parsed.feed.entry).map(atomEntryToArticle),
    };
  }
  if (parsed['rdf:RDF']) {
    const rdf = parsed['rdf:RDF'];
    return {
      title: rdf.channel ? textOf(rdf.channel.title) : null,
      items: arr(rdf.item).map(rdfItemToArticle),
    };
  }
  throw new Error('Unbekanntes Feed-Format');
}

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}
function textOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return he.decode(x);
  if (typeof x === 'object') {
    if (typeof x._ === 'string') return he.decode(x._);
    if (typeof x['$t'] === 'string') return he.decode(x['$t']);
  }
  return String(x);
}
function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rssItemToArticle(item) {
  return {
    title: stripHtml(textOf(item.title)),
    url: textOf(item.link || item.guid),
    guid: textOf(item.guid),
    publishedDate: parseDateSafe(item.pubDate || item['dc:date'] || item.date),
    summary: stripHtml(textOf(item.description || item.summary || '')),
    content: stripHtml(textOf(item['content:encoded'] || item.content || '')),
    author: stripHtml(textOf(item['dc:creator'] || item.author || '')),
    categories: arr(item.category).map(textOf).filter(Boolean),
  };
}

function atomEntryToArticle(entry) {
  let link = '';
  if (entry.link) {
    const links = arr(entry.link);
    const altLink = links.find((l) => !l.rel || l.rel === 'alternate') || links[0];
    link = altLink ? altLink.href || textOf(altLink) : '';
  }
  return {
    title: stripHtml(textOf(entry.title)),
    url: link,
    guid: textOf(entry.id),
    publishedDate: parseDateSafe(entry.published || entry.updated),
    summary: stripHtml(textOf(entry.summary || '')),
    content: stripHtml(textOf(entry.content || '')),
    author: entry.author ? stripHtml(textOf(entry.author.name || entry.author)) : '',
    categories: arr(entry.category)
      .map((c) => c.term || textOf(c))
      .filter(Boolean),
  };
}

function rdfItemToArticle(item) {
  return {
    title: stripHtml(textOf(item.title)),
    url: textOf(item.link || item['rdf:about']),
    guid: textOf(item.link || item['rdf:about']),
    publishedDate: parseDateSafe(item['dc:date'] || item.date),
    summary: stripHtml(textOf(item.description || '')),
    content: stripHtml(textOf(item['content:encoded'] || item.content || '')),
    author: stripHtml(textOf(item['dc:creator'] || '')),
    categories: arr(item['dc:subject']).map(textOf).filter(Boolean),
  };
}

function parseJsonFeed(text) {
  const data = JSON.parse(text);
  const items = (data.items || []).map((item) => ({
    title: item.title || '',
    url: item.url || item.id,
    guid: item.id,
    publishedDate: parseDateSafe(item.date_published),
    summary: item.summary || '',
    content: item.content_text || item.content_html || '',
    author: item.author?.name || item.authors?.[0]?.name || '',
    categories: item.tags || [],
  }));
  return { title: data.title, items };
}

function cleanUrl(url) {
  if (!url) return '';
  return url.trim().replace(/&amp;/g, '&');
}

async function tryPuppeteerFallback(feed, reason) {
  try {
    const { fetchFeedViaBrowser } = require('./puppeteer-fetcher');
    logger.info(`Puppeteer-Fallback fuer ${feed.url} (${reason})`);
    const res = await fetchFeedViaBrowser(feed);
    if (res.status === 'ok') recordDomainSuccess(feed.url);
    return res;
  } catch (err) {
    logger.warn(`Puppeteer-Fallback nicht verfuegbar: ${err.message}`);
    return null;
  }
}

async function fetchFeed(feed, { etag, lastModified, allowAutoBrowserFallback = true } = {}) {
  const start = Date.now();
  try {
    if (feed.kind === 'google-news') {
      const { fetchGoogleNewsFeed } = require('./news-search');
      return await fetchGoogleNewsFeed(feed);
    }
    if (feed.kind === 'bing-news') {
      const { fetchBingNewsFeed } = require('./news-search');
      return await fetchBingNewsFeed(feed);
    }

    if (feed.use_browser === true) {
      const browserRes = await tryPuppeteerFallback(feed, 'use_browser=true');
      if (browserRes && browserRes.status === 'ok') return browserRes;
    }

    const res = await fetchText(feed.url, { etag, lastModified });
    if (res.status === 304) {
      return {
        status: 'not-modified',
        items: [],
        responseTimeMs: Date.now() - start,
        etag,
        lastModified,
      };
    }

    let parsed;
    if (looksLikeJsonFeed(res.text)) parsed = parseJsonFeed(res.text);
    else if (looksLikeRss(res.text) || looksLikeAtom(res.text) || looksLikeRdf(res.text))
      parsed = await parseFeedXml(res.text);
    else throw new Error('Inhalt ist kein erkennbarer Feed');

    const items = parsed.items
      .map((it) => ({
        ...it,
        url: cleanUrl(it.url),
        source: feed.name,
        sourcePriority: feed.priority || 50,
      }))
      .filter((it) => it.url);

    return {
      status: 'ok',
      title: parsed.title,
      items,
      responseTimeMs: Date.now() - start,
      etag: res.etag,
      lastModified: res.lastModified,
      contentType: res.contentType,
    };
  } catch (err) {
    const errorClass = err.errorClass || classifyError(err);
    if (errorClass === 'forbidden' && allowAutoBrowserFallback && !feed.use_browser) {
      const fallback = await tryPuppeteerFallback(feed, 'HTTP 403');
      if (fallback && fallback.status === 'ok') {
        return { ...fallback, viaAutoBrowserFallback: true };
      }
      if (fallback) {
        return { ...fallback, viaAutoBrowserFallback: true, originalError: err.message };
      }
    }
    return {
      status: 'error',
      error: err.message,
      errorClass,
      items: [],
      responseTimeMs: Date.now() - start,
    };
  }
}

function findLatestItemDate(items) {
  let latest = null;
  for (const it of items || []) {
    const d = it.publishedDate ? new Date(it.publishedDate) : null;
    if (d && !isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
  }
  return latest;
}

async function testFeed(feedUrl, name) {
  const start = Date.now();
  try {
    if (feedUrl && feedUrl.startsWith('google-news:')) {
      const { fetchGoogleNewsFeed } = require('./news-search');
      const result = await fetchGoogleNewsFeed({
        name,
        queries: [feedUrl.slice('google-news:'.length)],
        priority: 80,
      });
      const latest = findLatestItemDate(result.items);
      return {
        ok: result.status === 'ok',
        type: 'google-news',
        itemCount: result.items.length,
        latestItemDate: latest ? latest.toISOString() : null,
        sample: result.items
          .slice(0, 3)
          .map((i) => ({ title: i.title, url: i.url, published: i.publishedDate })),
        responseTimeMs: Date.now() - start,
        title: 'Google News',
        viaBrowser: false,
        error: result.error,
      };
    }
    let res,
      viaBrowser = false,
      parsed = null,
      feedType = 'unknown';
    let statusCode = null;
    try {
      res = await fetchText(feedUrl, { timeout: 10000 });
      statusCode = res.status;
      if (looksLikeJsonFeed(res.text)) {
        parsed = parseJsonFeed(res.text);
        feedType = 'json';
      } else if (looksLikeAtom(res.text)) {
        parsed = await parseFeedXml(res.text);
        feedType = 'atom';
      } else if (looksLikeRdf(res.text)) {
        parsed = await parseFeedXml(res.text);
        feedType = 'rdf';
      } else if (looksLikeRss(res.text)) {
        parsed = await parseFeedXml(res.text);
        feedType = 'rss';
      } else throw new Error('Inhalt ist kein erkennbarer Feed');
    } catch (firstErr) {
      const cls = firstErr.errorClass || classifyError(firstErr);
      const m = firstErr.message && firstErr.message.match(/HTTP (\d+)/);
      if (m) statusCode = parseInt(m[1], 10);
      if (cls === 'forbidden') {
        try {
          const { fetchFeedViaBrowser } = require('./puppeteer-fetcher');
          const browserRes = await fetchFeedViaBrowser({ name, url: feedUrl, priority: 50 });
          if (browserRes.status === 'ok') {
            viaBrowser = true;
            parsed = { title: browserRes.title, items: browserRes.items };
            feedType = 'rss/atom (browser)';
            statusCode = 200;
          } else {
            throw new Error(browserRes.error || 'Browser-Fallback fehlgeschlagen', {
              cause: firstErr,
            });
          }
        } catch (puErr) {
          return {
            ok: false,
            error: firstErr.message,
            errorClass: cls,
            statusCode,
            viaBrowser: false,
            puppeteerError: puErr.message,
            responseTimeMs: Date.now() - start,
          };
        }
      } else {
        return {
          ok: false,
          error: firstErr.message,
          errorClass: cls,
          statusCode,
          viaBrowser: false,
          responseTimeMs: Date.now() - start,
        };
      }
    }

    const latest = findLatestItemDate(parsed.items);
    return {
      ok: true,
      status: statusCode,
      statusCode,
      type: feedType,
      title: parsed.title,
      itemCount: parsed.items.length,
      latestItemDate: latest ? latest.toISOString() : null,
      sample: parsed.items
        .slice(0, 3)
        .map((i) => ({ title: i.title, url: i.url, published: i.publishedDate })),
      responseTimeMs: Date.now() - start,
      contentType: res ? res.contentType : null,
      encoding: res ? res.encoding : null,
      viaBrowser,
    };
  } catch (err) {
    return { ok: false, error: err.message, responseTimeMs: Date.now() - start };
  }
}

module.exports = {
  fetchRaw,
  fetchText,
  fetchFeed,
  testFeed,
  parseFeedXml,
  parseJsonFeed,
  detectEncoding,
  decode,
  classifyError,
  USER_AGENTS,
  BROWSER_PROFILES,
  buildHeaders,
  getReferer,
  isDomainInCooldown,
  recordDomain403,
  recordDomainSuccess,
  getDomainFailureStats,
  clearDomainFailures,
};
