'use strict';

const logger = require('./logger');
const { settings } = require('./config');

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: settings.scraping.puppeteer.headless !== false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    browser.on('disconnected', () => {
      browserPromise = null;
    });
    return browser;
  })();
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    try {
      (await browserPromise).close();
    } catch {}
    browserPromise = null;
  }
}

async function fetchViaBrowser(url, { timeout = 30000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    });
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    if (!response) throw new Error('Keine Antwort');

    const status = response.status();
    if (status >= 400) throw new Error(`HTTP ${status}`);

    let body = await response.text();
    let contentType = response.headers()['content-type'] || '';

    if (
      contentType.includes('html') &&
      !body.trim().startsWith('<?xml') &&
      !body.includes('<rss') &&
      !body.includes('<feed')
    ) {
      const pre = await page.$('pre');
      if (pre) {
        const preText = await page.evaluate((el) => el.textContent, pre);
        if (
          preText &&
          (preText.includes('<rss') ||
            preText.includes('<feed') ||
            preText.trim().startsWith('<?xml'))
        ) {
          body = preText;
          contentType = 'application/xml';
        }
      }
    }

    return {
      status,
      text: body,
      contentType,
      finalUrl: response.url(),
      etag: response.headers().etag,
      lastModified: response.headers()['last-modified'],
    };
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

async function fetchFeedViaBrowser(feed) {
  const start = Date.now();
  try {
    logger.info(`Puppeteer-Fetch: ${feed.name}`);
    const res = await fetchViaBrowser(feed.url, { timeout: 30000 });
    const { parseFeedXml, parseJsonFeed } = require('./feed-fetcher');
    let parsed;
    const text = res.text;
    if (text.trim().startsWith('{')) parsed = parseJsonFeed(text);
    else parsed = await parseFeedXml(text);

    return {
      status: 'ok',
      title: parsed.title,
      items: parsed.items
        .map((it) => ({
          ...it,
          source: feed.name,
          sourcePriority: feed.priority || 50,
        }))
        .filter((i) => i.url),
      responseTimeMs: Date.now() - start,
      etag: res.etag,
      lastModified: res.lastModified,
      contentType: res.contentType,
      viaBrowser: true,
    };
  } catch (err) {
    return {
      status: 'error',
      error: `Puppeteer: ${err.message}`,
      items: [],
      responseTimeMs: Date.now() - start,
    };
  }
}

module.exports = { fetchViaBrowser, fetchFeedViaBrowser, closeBrowser };
