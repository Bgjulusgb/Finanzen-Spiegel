'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { subDays } = require('date-fns');

const logger = require('./logger');
const database = require('./database');
const { settings, loadJson, saveJson } = require('./config');
const { runScan } = require('./pipeline');
const { generateReport, REPORTS_DIR } = require('./reporter');
const { parseDateRange } = require('./utils');
const { hybridSearch, suggestQueries, didYouMean, topMentions, trends } = require('./search');
const textUtils = require('./text-utils');

function computeFacets(articles) {
  const counts = (key, getter) => {
    const m = new Map();
    for (const a of articles) {
      const v = getter(a);
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) {
        for (const x of v) m.set(x, (m.get(x) || 0) + 1);
      } else {
        m.set(v, (m.get(v) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  };
  return {
    category: counts('category', (a) => a.category),
    sentiment: counts('sentiment', (a) => a.sentiment),
    type: counts('type', (a) => a.article_type),
    source: counts('source', (a) => a.source).slice(0, 25),
    tag: counts('tag', (a) => a.tags || []).slice(0, 25),
    language: counts('language', (a) => a.language || 'de'),
    paywall: counts('paywall', (a) => (a.paywall ? 'yes' : 'no')),
    image: counts('image', (a) => (a.has_image ? 'yes' : 'no')),
  };
}

const WEB_DIR = path.resolve(__dirname, '..', 'web');

const wsClients = new Set();
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }
}

function attachLogger() {
  const winston = require('winston');
  class WsTransport extends winston.Transport {
    log(info, cb) {
      const { level, message, ...meta } = info;
      delete meta[Symbol.for('level')];
      delete meta[Symbol.for('message')];
      delete meta[Symbol.for('splat')];
      broadcast('log', { level, message, meta });
      cb && cb();
    }
  }
  logger.add(new WsTransport({ level: 'info' }));
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(express.static(WEB_DIR));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: require('../package.json').version,
      reportsDir: REPORTS_DIR,
      dbPath: path.resolve(settings.database.path),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/articles', (req, res) => {
    try {
      const opts = {
        from: req.query.from,
        to: req.query.to,
        last: req.query.last,
      };
      if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
      const { from, to } = parseDateRange(opts);
      let articles = database.getArticlesByRange(from, to);

      const tagMap = new Map();
      const allTagRows = database.db
        .prepare(
          `
        SELECT t.article_id, t.tag FROM article_tags t
        JOIN articles a ON a.id = t.article_id
        WHERE a.published_date >= @from AND a.published_date <= @to
      `
        )
        .all({ from: from.toISOString(), to: to.toISOString() });
      for (const row of allTagRows) {
        if (!tagMap.has(row.article_id)) tagMap.set(row.article_id, []);
        tagMap.get(row.article_id).push(row.tag);
      }
      const bookmarkIds = new Set(
        database.db
          .prepare('SELECT article_id FROM bookmarks')
          .all()
          .map((r) => r.article_id)
      );

      articles = articles.map((a) => {
        const enriched = {
          ...a,
          tags: tagMap.get(a.id) || [],
          bookmarked: bookmarkIds.has(a.id),
          has_image: textUtils.hasImage(a),
          reading_time_min: textUtils.estimateReadingMinutes(
            (a.full_text || a.summary || '').toString()
          ),
        };
        if (!enriched.language) {
          enriched.language = textUtils.detectLanguage((a.title || '') + ' ' + (a.summary || ''), {
            minLen: 60,
            fallback: 'de',
          });
        }
        return enriched;
      });

      const {
        category,
        sentiment,
        source,
        tag,
        tagNot,
        tagMode,
        bookmark,
        paywall,
        image,
        q,
        limit,
        minScore,
        maxScore,
        type,
        wordsMin,
        wordsMax,
        readingTimeMin,
        readingTimeMax,
        lang,
        dupes,
        facets,
      } = req.query;
      const splitMulti = (v) =>
        String(v)
          .split(/[,;|]/)
          .map((s) => s.trim())
          .filter(Boolean);
      const tagModeNorm = (tagMode || 'any').toLowerCase();

      if (category) {
        const cats = splitMulti(category);
        articles = articles.filter((a) => cats.includes(a.category));
      }
      if (sentiment) {
        const sents = splitMulti(sentiment);
        articles = articles.filter((a) => sents.includes(a.sentiment));
      }
      if (source) {
        const srcs = splitMulti(source);
        articles = articles.filter((a) => srcs.includes(a.source));
      }
      if (tag) {
        const tags = splitMulti(tag);
        if (tagModeNorm === 'all') {
          articles = articles.filter((a) => tags.every((t) => a.tags.includes(t)));
        } else if (tagModeNorm === 'none') {
          articles = articles.filter((a) => !tags.some((t) => a.tags.includes(t)));
        } else {
          articles = articles.filter((a) => tags.some((t) => a.tags.includes(t)));
        }
      }
      if (tagNot) {
        const tags = splitMulti(tagNot);
        articles = articles.filter((a) => !tags.some((t) => a.tags.includes(t)));
      }
      if (type) {
        const types = splitMulti(type);
        articles = articles.filter((a) => types.includes(a.article_type));
      }
      if (lang) {
        const langs = splitMulti(lang).map((l) => l.toLowerCase());
        articles = articles.filter((a) => langs.includes((a.language || 'de').toLowerCase()));
      }
      if (minScore !== undefined && minScore !== '') {
        const n = parseInt(minScore, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.relevance_score || 0) >= n);
      }
      if (maxScore !== undefined && maxScore !== '') {
        const n = parseInt(maxScore, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.relevance_score || 0) <= n);
      }
      if (wordsMin !== undefined && wordsMin !== '') {
        const n = parseInt(wordsMin, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.word_count || 0) >= n);
      }
      if (wordsMax !== undefined && wordsMax !== '') {
        const n = parseInt(wordsMax, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.word_count || 0) <= n);
      }
      if (readingTimeMin !== undefined && readingTimeMin !== '') {
        const n = parseInt(readingTimeMin, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.reading_time_min || 0) >= n);
      }
      if (readingTimeMax !== undefined && readingTimeMax !== '') {
        const n = parseInt(readingTimeMax, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.reading_time_min || 0) <= n);
      }
      if (bookmark === 'yes') articles = articles.filter((a) => a.bookmarked);
      if (bookmark === 'no') articles = articles.filter((a) => !a.bookmarked);
      if (paywall === 'yes') articles = articles.filter((a) => !!a.paywall);
      if (paywall === 'no') articles = articles.filter((a) => !a.paywall);
      if (image === 'yes') articles = articles.filter((a) => !!a.has_image);
      if (image === 'no') articles = articles.filter((a) => !a.has_image);
      if (dupes === 'hide') articles = articles.filter((a) => !a.duplicate_of);

      let scored = articles.map((a) => ({ article: a, score: 0 }));
      if (q && q.trim()) {
        scored = hybridSearch(articles, q, { limit: 1000 });
      }
      const max = parseInt(limit, 10) || 500;
      const results = scored.slice(0, max).map((s) => ({
        ...s.article,
        _searchScore: s.score,
        _viaDidYouMean: s._viaDidYouMean,
      }));

      const payload = {
        from: from.toISOString(),
        to: to.toISOString(),
        total: articles.length,
        returned: results.length,
        articles: results,
      };

      if (facets === 'true' || facets === '1') {
        payload.facets = computeFacets(articles);
      }
      if (q && q.trim() && scored.length > 0 && scored[0]._viaDidYouMean) {
        payload.didYouMean = scored[0]._viaDidYouMean;
      }

      res.json(payload);
    } catch (err) {
      logger.error('GET /api/articles fehlgeschlagen', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/article/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = database.db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    res.json(row);
  });

  app.get('/api/stats', (req, res) => {
    try {
      const { from, to } = parseDateRange({
        from: req.query.from,
        to: req.query.to,
        last: req.query.last || '30d',
      });
      const stats = database.getStats(from, to);
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        overview: stats.overview,
        bySource: stats.bySource,
        health: database.getSourceHealth(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/suggest', (req, res) => {
    try {
      const prefix = req.query.q || '';
      const articles = database.getArticlesByRange(subDays(new Date(), 60), new Date());
      res.json({ suggestions: suggestQueries(prefix, articles) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/did-you-mean', (req, res) => {
    try {
      const q = req.query.q || '';
      const articles = database.getArticlesByRange(subDays(new Date(), 365), new Date());
      const suggestion = didYouMean(q, articles);
      res.json({ query: q, suggestion });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/mentions', (req, res) => {
    try {
      const { from, to } = parseDateRange({
        from: req.query.from,
        to: req.query.to,
        last: req.query.last || '30d',
      });
      const articles = database.getArticlesByRange(from, to);
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        mentions: topMentions(articles, { limit: parseInt(req.query.limit || '30', 10) }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/trends', (req, res) => {
    try {
      const period = req.query.period || '30d';
      const days = parseInt(period.replace(/[^\d]/g, ''), 10) || 30;
      const now = new Date();
      const recent = database.getArticlesByRange(subDays(now, days), now);
      const previous = database.getArticlesByRange(subDays(now, days * 2), subDays(now, days));
      res.json({ trends: trends(recent, previous), period: { days } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tags', (req, res) => {
    res.json({ tags: database.getAllTags() });
  });

  app.post('/api/tags/retag-all', (req, res) => {
    try {
      const { autoTag } = require('./tagger');
      const rows = database.db
        .prepare(
          `
        SELECT id, title, full_text, summary, category, sentiment, paywall
        FROM articles WHERE deleted_at IS NULL
      `
        )
        .all();
      let added = 0;
      for (const row of rows) {
        const analysis = { category: row.category, sentiment: row.sentiment };
        const tags = autoTag({ ...row, fullText: row.full_text }, analysis);
        for (const tag of tags) {
          try {
            database.addTag(row.id, tag);
            added++;
          } catch {}
        }
      }
      res.json({ ok: true, articles: rows.length, tags_added: added });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/article/:id/tags', (req, res) => {
    res.json({ tags: database.getTagsForArticle(parseInt(req.params.id, 10)) });
  });
  app.post('/api/article/:id/tags', (req, res) => {
    const { tag } = req.body || {};
    if (!tag) return res.status(400).json({ error: 'tag erforderlich' });
    database.addTag(parseInt(req.params.id, 10), tag);
    res.json({ ok: true });
  });
  app.delete('/api/article/:id/tags/:tag', (req, res) => {
    database.removeTag(parseInt(req.params.id, 10), req.params.tag);
    res.json({ ok: true });
  });

  app.get('/api/bookmarks', (req, res) => {
    res.json({ bookmarks: database.getBookmarks() });
  });
  app.post('/api/article/:id/bookmark', (req, res) => {
    database.setBookmark(parseInt(req.params.id, 10), req.body?.note);
    res.json({ ok: true });
  });
  app.delete('/api/article/:id/bookmark', (req, res) => {
    database.removeBookmark(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  app.get('/api/saved-searches', (req, res) => {
    res.json({ searches: database.getSavedSearches() });
  });
  app.post('/api/saved-searches', (req, res) => {
    const { name, query, filters } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name erforderlich' });
    database.saveSearch(name, query, filters);
    res.json({ ok: true });
  });
  app.delete('/api/saved-searches/:name', (req, res) => {
    database.deleteSavedSearch(req.params.name);
    res.json({ ok: true });
  });

  app.get('/api/export', (req, res) => {
    try {
      const { from, to } = parseDateRange({
        from: req.query.from,
        to: req.query.to,
        last: req.query.last || '30d',
      });
      const articles = database.getArticlesByRange(from, to);
      const format = (req.query.format || 'json').toLowerCase();
      if (format === 'csv') {
        const cols = [
          'id',
          'title',
          'source',
          'author',
          'published_date',
          'url',
          'category',
          'sentiment',
          'relevance_score',
          'word_count',
          'paywall',
        ];
        const escape = (v) => {
          if (v === null || v === undefined) return '';
          const s = String(v).replace(/"/g, '""').replace(/\n/g, ' ');
          return /[",;\n]/.test(s) ? `"${s}"` : s;
        };
        let csv = cols.join(';') + '\n';
        for (const a of articles) csv += cols.map((c) => escape(a[c])).join(';') + '\n';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="pressespiegel-${format}-${Date.now()}.csv"`
        );
        return res.send('﻿' + csv);
      }
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="pressespiegel-${Date.now()}.json"`
        );
        return res.send(JSON.stringify(articles, null, 2));
      }
      res.status(400).json({ error: 'Unbekanntes Format' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources', (req, res) => {
    try {
      const sources = loadJson('sources.json');
      const health = database.getSourceHealth();
      const healthMap = new Map(health.map((h) => [h.source, h]));
      const stats = { ok: 0, degraded: 0, blocked: 0, dead: 0, unknown: 0, total: 0 };
      const feeds = (sources.feeds || []).map((f) => {
        const h = healthMap.get(f.name) || null;
        const status = database.classifyFeedHealth(h);
        stats[status] = (stats[status] || 0) + 1;
        stats.total++;
        return { ...f, health: h, healthStatus: status };
      });
      res.json({ ...sources, feeds, stats });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/test', async (req, res) => {
    try {
      const { url, name } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url erforderlich' });
      const { testFeed } = require('./scraper');
      const result = await testFeed(url, name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/toggle', (req, res) => {
    try {
      const { name, enabled } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name erforderlich' });
      database.setSourceEnabled(name, enabled);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/bulk-disable-dead', (req, res) => {
    try {
      const health = database.getSourceHealth();
      let count = 0;
      for (const h of health) {
        if (database.classifyFeedHealth(h) === 'dead' && h.enabled !== 0) {
          database.setSourceEnabled(h.source, false);
          count++;
        }
      }
      res.json({ ok: true, disabled: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/bulk-mark-blocked-browser', (req, res) => {
    try {
      const sources = loadJson('sources.json');
      const health = database.getSourceHealth();
      const blockedNames = new Set(
        health.filter((h) => database.classifyFeedHealth(h) === 'blocked').map((h) => h.source)
      );
      let count = 0;
      const feeds = (sources.feeds || []).map((f) => {
        if (blockedNames.has(f.name) && !f.use_browser) {
          count++;
          return { ...f, use_browser: true, retry_delay: f.retry_delay || 3000 };
        }
        return f;
      });
      saveJson('sources.json', { ...sources, feeds });
      res.json({ ok: true, updated: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources/opml', (req, res) => {
    try {
      const data = loadJson('sources.json');
      const escape = (s) =>
        String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const now = new Date().toISOString();
      let opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Pressespiegel Kammerspiele Feeds</title>\n    <dateCreated>${now}</dateCreated>\n  </head>\n  <body>\n`;
      const byCategory = new Map();
      for (const f of data.feeds || []) {
        const cat = f.category || 'andere';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(f);
      }
      for (const [cat, feeds] of byCategory) {
        opml += `    <outline text="${escape(cat)}" title="${escape(cat)}">\n`;
        for (const f of feeds) {
          if (f.kind === 'google-news' || f.kind === 'bing-news') continue;
          opml += `      <outline type="rss" text="${escape(f.name)}" title="${escape(f.name)}" xmlUrl="${escape(f.url)}" htmlUrl="${escape(f.url)}"/>\n`;
        }
        opml += '    </outline>\n';
      }
      opml += '  </body>\n</opml>\n';
      res.setHeader('Content-Type', 'text/x-opml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pressespiegel-feeds.opml"`);
      res.send(opml);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/opml-preview', async (req, res) => {
    try {
      const xml = req.body && req.body.opml;
      if (!xml) return res.status(400).json({ error: 'opml erforderlich' });
      const xml2js = require('xml2js');
      const parsed = await new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
      }).parseStringPromise(xml);
      const outlines = [];
      const walk = (node) => {
        if (!node) return;
        const items = Array.isArray(node) ? node : [node];
        for (const it of items) {
          if (it.xmlUrl) outlines.push(it);
          if (it.outline) walk(it.outline);
        }
      };
      walk(parsed.opml && parsed.opml.body && parsed.opml.body.outline);
      const current = loadJson('sources.json');
      const existing = new Set((current.feeds || []).map((f) => f.url));
      const { fetchRaw, classifyError } = require('./feed-fetcher');
      const pLimit = require('p-limit');
      const limit = pLimit(4);
      const previews = await Promise.all(
        outlines.map((o) =>
          limit(async () => {
            const name =
              o.title ||
              o.text ||
              (() => {
                try {
                  return new URL(o.xmlUrl).hostname;
                } catch {
                  return o.xmlUrl;
                }
              })();
            const url = o.xmlUrl;
            const isDuplicate = existing.has(url);
            const start = Date.now();
            try {
              const r = await fetchRaw(url, { timeout: 5000, maxRedirects: 2 });
              const ms = Date.now() - start;
              let level = 'ok';
              if (r.status === 403) level = 'warn';
              else if (r.status >= 400) level = 'error';
              return {
                name,
                url,
                status: r.status,
                responseTimeMs: ms,
                level,
                duplicate: isDuplicate,
              };
            } catch (err) {
              const cls = classifyError(err);
              const level = cls === 'forbidden' ? 'warn' : 'error';
              return {
                name,
                url,
                status: null,
                level,
                error: err.message,
                errorClass: cls,
                duplicate: isDuplicate,
              };
            }
          })
        )
      );
      res.json({ ok: true, count: previews.length, previews });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/opml-import', async (req, res) => {
    try {
      const xml = req.body && req.body.opml;
      if (!xml) return res.status(400).json({ error: 'opml erforderlich' });
      const xml2js = require('xml2js');
      const parsed = await new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
      }).parseStringPromise(xml);
      const outlines = [];
      const walk = (node) => {
        if (!node) return;
        const items = Array.isArray(node) ? node : [node];
        for (const it of items) {
          if (it.xmlUrl) outlines.push(it);
          if (it.outline) walk(it.outline);
        }
      };
      walk(parsed.opml && parsed.opml.body && parsed.opml.body.outline);
      const current = loadJson('sources.json');
      const existing = new Set((current.feeds || []).map((f) => f.url));
      let added = 0;
      for (const o of outlines) {
        if (existing.has(o.xmlUrl)) continue;
        current.feeds.push({
          name: o.title || o.text || new URL(o.xmlUrl).hostname,
          url: o.xmlUrl,
          priority: 70,
          type: 'rss',
          category: 'imported',
        });
        added++;
      }
      const { saveJson } = require('./config');
      saveJson('sources.json', current);
      res.json({ ok: true, added, total: current.feeds.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/sources', (req, res) => {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.feeds)) {
        return res.status(400).json({ error: 'feeds[] erforderlich' });
      }
      saveJson('sources.json', data);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/keywords', (req, res) => {
    try {
      res.json(loadJson('keywords.json'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/keywords', (req, res) => {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.required)) {
        return res.status(400).json({ error: 'required[] erforderlich' });
      }
      saveJson('keywords.json', data);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/settings', (req, res) => {
    try {
      res.json(loadJson('settings.json'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings', (req, res) => {
    try {
      saveJson('settings.json', req.body);
      res.json({ ok: true, note: 'Neustart erforderlich, damit alle Aenderungen greifen' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  let activeScan = null;
  app.post('/api/scan', async (req, res) => {
    if (activeScan) {
      return res.status(409).json({ error: 'Scan laeuft bereits', scanId: activeScan });
    }
    const scanId = `scan-${Date.now()}`;
    activeScan = scanId;
    res.json({ scanId, status: 'started' });

    setImmediate(async () => {
      try {
        const { from, to } = parseDateRange({
          from: req.body.from,
          to: req.body.to,
          last: req.body.last,
        });
        broadcast('scan-start', { scanId, from: from.toISOString(), to: to.toISOString() });
        const summary = await runScan({ from, to });
        broadcast('scan-complete', { scanId, summary });
        broadcast('scan_summary', {
          scanId,
          type: 'scan_summary',
          total_feeds: summary.total_feeds,
          ok: summary.ok,
          degraded: summary.degraded,
          blocked_403: summary.blocked_403,
          dead: summary.dead,
          new_articles: summary.new_articles,
          duplicates_removed: summary.duplicates_removed,
          duration_ms: summary.duration_ms,
        });
      } catch (err) {
        broadcast('scan-error', { scanId, error: err.message });
      } finally {
        activeScan = null;
      }
    });
  });

  app.get('/api/scan/status', (req, res) => {
    res.json({ active: activeScan });
  });

  app.post('/api/report', async (req, res) => {
    try {
      const opts = req.body || {};
      const { from, to } = parseDateRange(opts);
      const articles = database.getArticlesByRange(from, to);
      const result = await generateReport({
        from,
        to,
        articles,
        format: opts.format || 'html',
        title: opts.title,
      });
      res.json({
        ok: true,
        articleCount: articles.length,
        html: result.html ? path.basename(result.html) : null,
        pdf: result.pdf ? path.basename(result.pdf) : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/reports', (req, res) => {
    if (!fs.existsSync(REPORTS_DIR)) return res.json({ reports: [] });
    const files = fs
      .readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith('.html') || f.endsWith('.pdf'))
      .map((f) => {
        const fp = path.join(REPORTS_DIR, f);
        const stat = fs.statSync(fp);
        return {
          name: f,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          type: f.endsWith('.pdf') ? 'pdf' : 'html',
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ reports: files });
  });

  app.get('/api/reports/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('Report nicht gefunden');
    res.sendFile(filepath);
  });

  app.delete('/api/reports/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'nicht gefunden' });
    fs.unlinkSync(filepath);
    res.json({ ok: true });
  });

  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 200;
    const logFile = path.join(__dirname, '..', 'logs', 'pressespiegel.log');
    if (!fs.existsSync(logFile)) return res.json({ logs: [] });
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).slice(-limit);
    const logs = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { level: 'info', message: line };
      }
    });
    res.json({ logs });
  });

  app.get('/api/duplicates/check', (req, res) => {
    try {
      const since = req.query.since ? new Date(req.query.since) : subDays(new Date(), 90);
      const candidates = database.getRecentForDedup(since);
      const { findDuplicate } = require('./deduplicator');
      const found = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const hit = findDuplicate(
          { id: c.id, title: c.title, url: c.url_normalized, first_paragraph: c.first_paragraph },
          candidates.slice(0, i)
        );
        if (hit)
          found.push({
            id: c.id,
            title: c.title,
            source: c.source,
            duplicateOf: {
              id: hit.duplicate.id,
              title: hit.duplicate.title,
              source: hit.duplicate.source,
            },
            reason: hit.reason,
          });
      }
      res.json({ checked: candidates.length, duplicates: found });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });

  return app;
}

function findFreePort(start = 4711) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      if (start < 65535) resolve(findFreePort(start + 1));
      else reject(new Error('Kein freier Port gefunden'));
    });
    server.listen(start, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function start({ port, host = '127.0.0.1' } = {}) {
  attachLogger();
  const usePort =
    port || (await findFreePort(parseInt(process.env.PRESSESPIEGEL_PORT || '4711', 10)));
  const app = buildApp();
  const server = app.listen(usePort, host, () => {
    logger.info(`UI-Server laeuft auf http://${host}:${usePort}`);
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', payload: { ts: Date.now() } }));
    ws.on('close', () => wsClients.delete(ws));
  });

  return { server, port: usePort, host, broadcast };
}

module.exports = { start, buildApp, broadcast };
