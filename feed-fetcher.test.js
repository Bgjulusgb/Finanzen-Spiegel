'use strict';

const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const { de } = require('date-fns/locale');

const logger = require('./logger');
const { settings } = require('./config');
const { escapeHtml, truncate, safeJsonParse } = require('./utils');

const REPORTS_DIR = path.resolve(settings.reports.path);
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

const CATEGORY_LABELS = {
  sehr_relevant: { label: 'Sehr relevant', stars: '', color: '#16a34a', sort: 3 },
  relevant: { label: 'Relevant', stars: '', color: '#2563eb', sort: 2 },
  moeglich_relevant: { label: 'Moeglich relevant', stars: '', color: '#a16207', sort: 1 },
  irrelevant: { label: 'Niedrige Relevanz', stars: '', color: '#64748b', sort: 0 },
};

const SENTIMENT_BADGE = {
  positiv: { label: 'positiv', color: '#16a34a', emoji: '' },
  negativ: { label: 'negativ', color: '#dc2626', emoji: '' },
  neutral: { label: 'neutral', color: '#475569', emoji: '' },
};

function fmtDate(date, withTime = false) {
  if (!date) return '–';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '–';
  return format(d, withTime ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy', { locale: de });
}

function fmtRange(from, to) {
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

function sentimentSummary(articles) {
  const counts = { positiv: 0, negativ: 0, neutral: 0 };
  for (const a of articles) {
    const s = a.sentiment || 'neutral';
    counts[s] = (counts[s] || 0) + 1;
  }
  const total = articles.length || 1;
  return {
    counts,
    total: articles.length,
    percentages: {
      positiv: Math.round((counts.positiv / total) * 100),
      negativ: Math.round((counts.negativ / total) * 100),
      neutral: Math.round((counts.neutral / total) * 100),
    },
  };
}

function timeSeries(articles, from, to) {
  const days = new Map();
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.set(format(d, 'yyyy-MM-dd'), 0);
  }
  for (const a of articles) {
    if (!a.published_date) continue;
    const key = format(new Date(a.published_date), 'yyyy-MM-dd');
    if (days.has(key)) days.set(key, days.get(key) + 1);
  }
  return Array.from(days.entries()).map(([date, count]) => ({ date, count }));
}

function bySourceCounts(articles) {
  const counts = new Map();
  for (const a of articles) {
    const key = a.source || 'Unbekannt';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

function buildArticleDataForUi(articles) {
  return articles.map((a) => {
    const meta = typeof a.meta === 'string' ? safeJsonParse(a.meta, {}) : a.meta || {};
    const alsoOn = Array.isArray(a.also_on)
      ? a.also_on
      : typeof a.also_on === 'string'
        ? safeJsonParse(a.also_on, [])
        : [];
    return {
      id: a.id,
      title: a.title || '',
      url: a.url || '',
      source: a.source || '',
      author: a.author || '',
      published_date: a.published_date || null,
      summary: a.summary || '',
      relevance_score: a.relevance_score || 0,
      category: a.category || 'irrelevant',
      sentiment: a.sentiment || 'neutral',
      article_type: a.article_type || 'news',
      paywall: !!a.paywall,
      word_count: a.word_count || 0,
      also_on: alsoOn || [],
      reasons: (meta && meta.reasons) || [],
    };
  });
}

function safeNum(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampPct(n) {
  const v = safeNum(n, 0);
  return Math.max(0, Math.min(100, v));
}

function renderSentimentChart(sentiment) {
  if (!sentiment || safeNum(sentiment.total) === 0)
    return '<p class="empty">Keine Daten verfuegbar.</p>';
  const counts = sentiment.counts || {};
  const pct = sentiment.percentages || {};
  const segments = [
    {
      label: 'Positiv',
      value: safeNum(counts.positiv),
      percent: clampPct(pct.positiv),
      color: 'var(--c-pos)',
    },
    {
      label: 'Neutral',
      value: safeNum(counts.neutral),
      percent: clampPct(pct.neutral),
      color: 'var(--c-neu)',
    },
    {
      label: 'Negativ',
      value: safeNum(counts.negativ),
      percent: clampPct(pct.negativ),
      color: 'var(--c-neg)',
    },
  ];
  let cumulative = 0;
  const gradientStops = segments
    .map((s) => {
      const start = cumulative;
      cumulative += s.percent;
      return `${s.color} ${start.toFixed(2)}% ${clampPct(cumulative).toFixed(2)}%`;
    })
    .join(', ');
  return `
    <div class="chart-row">
      <div class="pie" style="background: conic-gradient(${gradientStops})">
        <div class="pie-center"><span>${safeNum(sentiment.total)}</span><small>Artikel</small></div>
      </div>
      <ul class="legend">
        ${segments
          .map(
            (s) => `
          <li>
            <span class="dot" style="background:${s.color}"></span>
            <strong>${s.label}</strong>
            <span class="legend-value">${s.value} (${s.percent.toFixed(0)}%)</span>
          </li>
        `
          )
          .join('')}
      </ul>
    </div>
  `;
}

function renderTimeSeries(series) {
  if (!series || !series.length) return '<p class="empty">Keine Daten verfuegbar.</p>';
  const max = Math.max(1, ...series.map((s) => safeNum(s.count)));
  return `
    <div class="bar-chart" role="img" aria-label="Artikel pro Tag">
      ${series
        .map((s) => {
          const count = safeNum(s.count);
          const heightPct = clampPct((count / max) * 100);
          return `
          <div class="bar-col" title="${s.date}: ${count} Artikel">
            <div class="bar-value">${count || ''}</div>
            <div class="bar" style="height:${heightPct.toFixed(2)}%"></div>
            <div class="bar-label">${s.date.slice(8)}.${s.date.slice(5, 7)}</div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

function renderSourcesTable(rows) {
  if (!rows || !rows.length) return '<p class="empty">Keine Daten verfuegbar.</p>';
  const max = Math.max(1, ...rows.map((r) => safeNum(r.count)));
  return `
    <table class="sources-table" aria-label="Artikel pro Quelle">
      <thead><tr><th>Quelle</th><th>Artikel</th><th>Anteil</th></tr></thead>
      <tbody>
        ${rows
          .map((r) => {
            const count = safeNum(r.count);
            const pct = clampPct((count / max) * 100);
            return `
          <tr>
            <td>${escapeHtml(r.source)}</td>
            <td class="num">${count}</td>
            <td class="bar-cell"><span class="hbar" style="width:${pct.toFixed(2)}%"></span></td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function getCss() {
  return `
:root {
  --c-bg: #f8fafc;
  --c-surface: #ffffff;
  --c-surface-2: #f1f5f9;
  --c-border: #e2e8f0;
  --c-text: #0f172a;
  --c-text-dim: #475569;
  --c-text-muted: #64748b;
  --c-pos: #16a34a;
  --c-neg: #dc2626;
  --c-neu: #475569;
  --c-cat-3: #16a34a;
  --c-cat-2: #2563eb;
  --c-cat-1: #a16207;
  --c-cat-0: #94a3b8;
  --c-accent: #1e293b;
  --c-accent-fg: #ffffff;
  --c-link: #1d4ed8;
  --c-paywall: #be185d;
  --shadow: 0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04);
  --radius: 10px;
  --radius-sm: 6px;
}
[data-theme="dark"] {
  --c-bg: #0b1120;
  --c-surface: #111827;
  --c-surface-2: #0f172a;
  --c-border: #1f2937;
  --c-text: #e2e8f0;
  --c-text-dim: #94a3b8;
  --c-text-muted: #64748b;
  --c-cat-3: #22c55e;
  --c-cat-2: #3b82f6;
  --c-cat-1: #eab308;
  --c-accent: #1e293b;
  --c-link: #93c5fd;
  --shadow: 0 1px 3px rgba(0,0,0,0.4);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  color: var(--c-text);
  background: var(--c-bg);
  line-height: 1.55;
  font-size: 15px;
}
.layout { max-width: 1280px; margin: 0 auto; padding: 24px; }
.skip-link {
  position: absolute; left: -9999px; top: 8px;
  background: var(--c-accent); color: var(--c-accent-fg); padding: 8px 12px;
  border-radius: var(--radius-sm); z-index: 100;
}
.skip-link:focus { left: 8px; }

.toolbar {
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
  background: var(--c-surface); padding: 14px 20px; border-radius: var(--radius);
  box-shadow: var(--shadow); position: sticky; top: 12px; z-index: 10;
  margin-bottom: 20px;
}
.toolbar h1 {
  margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;
  margin-right: auto;
}
.toolbar h1 small { font-weight: 400; color: var(--c-text-muted); font-size: 13px; margin-left: 8px; }
.toolbar input[type="search"], .toolbar select {
  background: var(--c-surface-2); border: 1px solid var(--c-border);
  color: var(--c-text); padding: 8px 12px; border-radius: var(--radius-sm);
  font-size: 14px; font-family: inherit;
}
.toolbar input[type="search"] { min-width: 220px; }
.toolbar input[type="search"]:focus, .toolbar select:focus {
  outline: 2px solid var(--c-link); outline-offset: 1px;
}
.toolbar button {
  background: var(--c-accent); color: var(--c-accent-fg); border: 0;
  padding: 8px 14px; border-radius: var(--radius-sm); cursor: pointer;
  font-size: 13px; font-weight: 500;
}
.toolbar button:hover { opacity: 0.9; }
.toolbar .theme-toggle {
  background: var(--c-surface-2); color: var(--c-text);
  border: 1px solid var(--c-border); width: 36px; padding: 8px;
}

.summary-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px; margin-bottom: 20px;
}
.summary-card {
  background: var(--c-surface); padding: 18px; border-radius: var(--radius);
  box-shadow: var(--shadow); border-left: 4px solid var(--c-border);
}
.summary-card .value { font-size: 30px; font-weight: 700; color: var(--c-text); line-height: 1; }
.summary-card .label {
  font-size: 11px; color: var(--c-text-muted); margin-top: 6px;
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.summary-card.positive { border-left-color: var(--c-pos); }
.summary-card.positive .value { color: var(--c-pos); }
.summary-card.negative { border-left-color: var(--c-neg); }
.summary-card.negative .value { color: var(--c-neg); }
.summary-card.high { border-left-color: var(--c-cat-3); }
.summary-card.high .value { color: var(--c-cat-3); }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
@media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

section.card {
  background: var(--c-surface); padding: 20px 24px; border-radius: var(--radius);
  box-shadow: var(--shadow); margin-bottom: 20px;
}
section.card h2 {
  margin: 0 0 16px 0; font-size: 16px; font-weight: 700;
  display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em;
}
section.card h2 small { font-weight: 400; color: var(--c-text-muted); font-size: 13px; }

.chart-row { display: grid; grid-template-columns: 180px 1fr; gap: 24px; align-items: center; }
@media (max-width: 600px) { .chart-row { grid-template-columns: 1fr; } }
.pie {
  width: 160px; height: 160px; border-radius: 50%; position: relative;
  display: flex; align-items: center; justify-content: center;
}
.pie::after {
  content: ''; position: absolute; inset: 18%;
  background: var(--c-surface); border-radius: 50%;
}
.pie-center {
  position: relative; z-index: 1; text-align: center; line-height: 1;
}
.pie-center span { font-size: 28px; font-weight: 700; display: block; }
.pie-center small { font-size: 11px; color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.legend { list-style: none; padding: 0; margin: 0; }
.legend li {
  display: flex; align-items: center; gap: 10px; padding: 4px 0;
  font-size: 14px;
}
.legend .dot {
  width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
}
.legend-value { margin-left: auto; color: var(--c-text-muted); font-variant-numeric: tabular-nums; }

.bar-chart {
  display: flex; gap: 4px; height: 200px; align-items: flex-end;
  padding: 8px 0; overflow-x: auto;
}
.bar-col {
  display: flex; flex-direction: column; align-items: center;
  gap: 4px; min-width: 32px; height: 100%; justify-content: flex-end;
}
.bar {
  background: linear-gradient(180deg, var(--c-cat-2), #60a5fa);
  width: 100%; min-height: 2px; border-radius: 3px 3px 0 0;
  transition: background 0.15s;
}
.bar-col:hover .bar { background: linear-gradient(180deg, var(--c-cat-3), #34d399); }
.bar-label { font-size: 10px; color: var(--c-text-muted); font-variant-numeric: tabular-nums; }
.bar-value { font-size: 11px; font-weight: 600; color: var(--c-text); }

.sources-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sources-table th, .sources-table td {
  padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--c-border);
}
.sources-table th {
  background: var(--c-surface-2); font-weight: 600; font-size: 12px;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-text-dim);
}
.sources-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.bar-cell { width: 40%; }
.hbar {
  display: block; height: 8px; background: linear-gradient(90deg, var(--c-cat-2), #93c5fd);
  border-radius: 4px;
}

.article-list { display: flex; flex-direction: column; gap: 12px; }
.article-card {
  background: var(--c-surface); padding: 16px 18px; border-radius: var(--radius);
  border-left: 4px solid var(--c-border); box-shadow: var(--shadow);
  page-break-inside: avoid;
}
.article-card[data-category="sehr_relevant"] { border-left-color: var(--c-cat-3); }
.article-card[data-category="relevant"] { border-left-color: var(--c-cat-2); }
.article-card[data-category="moeglich_relevant"] { border-left-color: var(--c-cat-1); }
.article-meta-top {
  display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
  margin-bottom: 6px;
}
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  color: white; font-size: 11px; font-weight: 600;
  white-space: nowrap;
}
.badge-cat-sehr_relevant { background: var(--c-cat-3); }
.badge-cat-relevant { background: var(--c-cat-2); }
.badge-cat-moeglich_relevant { background: var(--c-cat-1); }
.badge-cat-irrelevant { background: var(--c-cat-0); }
.badge-sent-positiv { background: var(--c-pos); }
.badge-sent-negativ { background: var(--c-neg); }
.badge-sent-neutral { background: var(--c-neu); }
.badge.paywall { background: var(--c-paywall); }
.badge.type {
  background: transparent; color: var(--c-text-dim);
  border: 1px solid var(--c-border);
}
.badge.score {
  background: transparent; color: var(--c-text-dim);
  border: 1px solid var(--c-border); font-variant-numeric: tabular-nums;
}
.article-title { margin: 4px 0 6px 0; font-size: 17px; font-weight: 600; line-height: 1.3; }
.article-title a { color: var(--c-text); text-decoration: none; }
.article-title a:hover { color: var(--c-link); text-decoration: underline; }
.article-source {
  font-size: 12px; color: var(--c-text-dim); margin-bottom: 8px;
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
}
.article-source .sep { color: var(--c-text-muted); }
.article-summary { margin: 4px 0 0 0; color: var(--c-text); font-size: 14px; }
.article-also { margin-top: 8px; font-size: 12px; }
.article-also summary {
  cursor: pointer; color: var(--c-text-muted); user-select: none;
  display: inline-block; padding: 2px 0;
}
.article-also summary:hover { color: var(--c-link); }
.article-also ul { margin: 6px 0 0 0; padding-left: 18px; }
.article-also a { color: var(--c-link); }
.article-reasons {
  margin-top: 6px; font-size: 11px; color: var(--c-text-muted);
}
.article-reasons code {
  background: var(--c-surface-2); padding: 1px 5px; border-radius: 3px;
  margin-right: 4px;
}

#articles-empty {
  text-align: center; padding: 40px 20px; color: var(--c-text-muted);
  background: var(--c-surface); border-radius: var(--radius);
  display: none;
}

.results-count {
  font-size: 13px; color: var(--c-text-muted); margin: 8px 0 16px 0;
}
.results-count strong { color: var(--c-text); }

footer.report-footer {
  text-align: center; color: var(--c-text-muted); font-size: 12px;
  margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--c-border);
}

.empty { color: var(--c-text-muted); font-style: italic; }

.top5 { list-style: none; padding: 0; margin: 0; counter-reset: top; }
.top5 li {
  counter-increment: top; padding: 10px 14px; border-bottom: 1px solid var(--c-border);
  display: grid; grid-template-columns: 30px 1fr auto; gap: 12px; align-items: start;
}
.top5 li::before {
  content: counter(top); font-weight: 700; font-size: 18px;
  color: var(--c-text-muted); font-variant-numeric: tabular-nums;
}
.top5 li:last-child { border-bottom: 0; }
.top5 a { color: var(--c-text); text-decoration: none; font-weight: 600; }
.top5 a:hover { color: var(--c-link); text-decoration: underline; }
.top5 .score-pill {
  background: var(--c-surface-2); color: var(--c-text-dim);
  padding: 2px 10px; border-radius: 999px; font-size: 12px;
  font-variant-numeric: tabular-nums; align-self: center;
}
.top5 .meta-line { font-size: 12px; color: var(--c-text-muted); margin-top: 2px; }

@media print {
  body { background: white; }
  .toolbar { position: static; box-shadow: none; }
  .toolbar input, .toolbar select, .toolbar button { display: none; }
  section.card { box-shadow: none; border: 1px solid var(--c-border); }
}
`;
}

function getClientScript() {
  return `
(function(){
  var STORE_KEY = 'pressespiegel-theme';
  var saved = localStorage.getItem(STORE_KEY);
  if (saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  function setTheme(t) {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(STORE_KEY, t);
  }
  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function(){
      var cur = document.documentElement.getAttribute('data-theme');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
  }

  var search = document.getElementById('filter-search');
  var fCat = document.getElementById('filter-category');
  var fSent = document.getElementById('filter-sentiment');
  var fSource = document.getElementById('filter-source');
  var fSort = document.getElementById('filter-sort');
  var cards = Array.from(document.querySelectorAll('.article-card'));
  var empty = document.getElementById('articles-empty');
  var count = document.getElementById('results-count');
  var totalCount = cards.length;

  function applyFilters() {
    var q = (search.value || '').trim().toLowerCase();
    var cat = fCat.value;
    var sent = fSent.value;
    var source = fSource.value;
    var sort = fSort.value;
    var visible = [];
    cards.forEach(function(card){
      var ok = true;
      if (cat && card.dataset.category !== cat) ok = false;
      if (sent && card.dataset.sentiment !== sent) ok = false;
      if (source && card.dataset.source !== source) ok = false;
      if (ok && q) {
        var hay = (card.dataset.text || '').toLowerCase();
        if (hay.indexOf(q) === -1) ok = false;
      }
      card.style.display = ok ? '' : 'none';
      if (ok) visible.push(card);
    });
    var container = document.getElementById('article-list');
    if (container && visible.length) {
      visible.sort(function(a, b){
        var sa, sb;
        if (sort === 'score-desc') { sa = +b.dataset.score; sb = +a.dataset.score; }
        else if (sort === 'score-asc') { sa = +a.dataset.score; sb = +b.dataset.score; }
        else if (sort === 'date-desc') { sa = b.dataset.date || ''; sb = a.dataset.date || ''; }
        else if (sort === 'date-asc') { sa = a.dataset.date || ''; sb = b.dataset.date || ''; }
        else { sa = 0; sb = 0; }
        return sa > sb ? 1 : sa < sb ? -1 : 0;
      });
      visible.forEach(function(c){ container.appendChild(c); });
    }
    empty.style.display = visible.length ? 'none' : 'block';
    if (count) count.innerHTML = '<strong>' + visible.length + '</strong> von ' + totalCount + ' Artikeln angezeigt';
  }
  [search, fCat, fSent, fSource, fSort].forEach(function(el){
    if (el) el.addEventListener('input', applyFilters);
  });
  document.addEventListener('keydown', function(e){
    if (e.key === '/' && document.activeElement !== search) {
      e.preventDefault();
      if (search) search.focus();
    }
    if (e.key === 'Escape' && document.activeElement === search) {
      search.value = '';
      applyFilters();
      search.blur();
    }
  });
  applyFilters();
})();
`;
}

function renderArticleCard(article) {
  const cat = CATEGORY_LABELS[article.category] || CATEGORY_LABELS.irrelevant;
  const sentiment = SENTIMENT_BADGE[article.sentiment] || SENTIMENT_BADGE.neutral;
  const alsoOn = Array.isArray(article.also_on) ? article.also_on : [];
  const summary = article.summary
    ? escapeHtml(truncate(article.summary, settings.reports.max_summary_length || 320))
    : '';
  const dataText = escapeHtml(
    `${article.title} ${article.source} ${article.author} ${article.summary} ${(article.reasons || []).join(' ')}`.toLowerCase()
  );
  const reasons = (article.reasons || []).slice(0, 5);
  return `
    <article class="article-card"
             data-category="${escapeHtml(article.category)}"
             data-sentiment="${escapeHtml(article.sentiment)}"
             data-source="${escapeHtml(article.source)}"
             data-score="${article.relevance_score}"
             data-date="${escapeHtml(article.published_date || '')}"
             data-text="${dataText}">
      <div class="article-meta-top">
        <span class="badge badge-cat-${escapeHtml(article.category)}">${cat.stars} ${escapeHtml(cat.label)}</span>
        <span class="badge badge-sent-${escapeHtml(article.sentiment)}">${sentiment.emoji} ${escapeHtml(sentiment.label)}</span>
        <span class="badge type">${escapeHtml(article.article_type)}</span>
        <span class="badge score">Score ${article.relevance_score}</span>
        ${article.paywall ? '<span class="badge paywall">Paywall</span>' : ''}
      </div>
      <h3 class="article-title">
        <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
      </h3>
      <div class="article-source">
        <strong>${escapeHtml(article.source || 'Unbekannt')}</strong>
        ${article.author ? `<span class="sep">·</span>${escapeHtml(article.author)}` : ''}
        <span class="sep">·</span>${fmtDate(article.published_date)}
        ${article.word_count ? `<span class="sep">·</span>${article.word_count} Worte` : ''}
      </div>
      ${summary ? `<p class="article-summary">${summary}</p>` : ''}
      ${reasons.length ? `<div class="article-reasons">${reasons.map((r) => `<code>${escapeHtml(r)}</code>`).join('')}</div>` : ''}
      ${
        alsoOn.length > 0
          ? `
        <details class="article-also">
          <summary>Auch erschienen in ${alsoOn.length} weiteren Quelle${alsoOn.length === 1 ? '' : 'n'}</summary>
          <ul>${alsoOn.map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a></li>`).join('')}</ul>
        </details>
      `
          : ''
      }
    </article>
  `;
}

function buildHtmlReport({ from, to, articles: rawArticles, title }) {
  const articles = buildArticleDataForUi(rawArticles);
  articles.sort((a, b) => {
    const catDiff =
      (CATEGORY_LABELS[b.category]?.sort || 0) - (CATEGORY_LABELS[a.category]?.sort || 0);
    if (catDiff !== 0) return catDiff;
    return b.relevance_score - a.relevance_score;
  });

  const groups = {
    sehr_relevant: articles.filter((a) => a.category === 'sehr_relevant'),
    relevant: articles.filter((a) => a.category === 'relevant'),
    moeglich_relevant: articles.filter((a) => a.category === 'moeglich_relevant'),
    irrelevant: articles.filter((a) => a.category === 'irrelevant'),
  };
  const sentiment = sentimentSummary(articles);
  const series = timeSeries(articles, from, to);
  const sourceRows = bySourceCounts(articles);
  const top5 = [...articles].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 5);
  const reportTitle = title || 'Pressespiegel Muenchner Kammerspiele';
  const sourceOptions = sourceRows
    .map(
      (r) => `<option value="${escapeHtml(r.source)}">${escapeHtml(r.source)} (${r.count})</option>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(reportTitle)} – ${fmtRange(from, to)}</title>
<style>${getCss()}</style>
</head>
<body>
<a href="#article-list" class="skip-link">Zum Inhalt springen</a>
<div class="layout">

  <header class="toolbar" role="banner">
    <h1>${escapeHtml(reportTitle)}<small>${fmtRange(from, to)}</small></h1>
    <input id="filter-search" type="search" placeholder="Suchen (Taste / fokussiert)" aria-label="Artikel durchsuchen">
    <select id="filter-category" aria-label="Kategorie filtern">
      <option value="">Alle Kategorien</option>
      <option value="sehr_relevant">Sehr relevant (${groups.sehr_relevant.length})</option>
      <option value="relevant">Relevant (${groups.relevant.length})</option>
      <option value="moeglich_relevant">Moeglich relevant (${groups.moeglich_relevant.length})</option>
    </select>
    <select id="filter-sentiment" aria-label="Sentiment filtern">
      <option value="">Alle Stimmungen</option>
      <option value="positiv">Positiv (${sentiment.counts.positiv})</option>
      <option value="neutral">Neutral (${sentiment.counts.neutral})</option>
      <option value="negativ">Negativ (${sentiment.counts.negativ})</option>
    </select>
    <select id="filter-source" aria-label="Quelle filtern">
      <option value="">Alle Quellen</option>
      ${sourceOptions}
    </select>
    <select id="filter-sort" aria-label="Sortierung">
      <option value="score-desc">Score (hoch -> niedrig)</option>
      <option value="score-asc">Score (niedrig -> hoch)</option>
      <option value="date-desc">Datum (neu -> alt)</option>
      <option value="date-asc">Datum (alt -> neu)</option>
    </select>
    <button class="theme-toggle" id="theme-toggle" aria-label="Theme umschalten" title="Hell/Dunkel umschalten">◐</button>
  </header>

  <div class="summary-grid">
    <div class="summary-card"><div class="value">${articles.length}</div><div class="label">Artikel gesamt</div></div>
    <div class="summary-card high"><div class="value">${groups.sehr_relevant.length}</div><div class="label">Sehr relevant</div></div>
    <div class="summary-card positive"><div class="value">${sentiment.counts.positiv}</div><div class="label">Positive Stimmen</div></div>
    <div class="summary-card negative"><div class="value">${sentiment.counts.negativ}</div><div class="label">Negative Stimmen</div></div>
  </div>

  <div class="grid-2">
    <section class="card">
      <h2>Sentiment-Uebersicht</h2>
      ${renderSentimentChart(sentiment)}
    </section>
    <section class="card">
      <h2>Top 5 nach Relevanz</h2>
      <ol class="top5">
        ${
          top5.length === 0
            ? '<li style="grid-template-columns:1fr">Keine Artikel im Zeitraum.</li>'
            : top5
                .map(
                  (a) => `
          <li>
            <div>
              <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>
              <div class="meta-line">${escapeHtml(a.source || '')} · ${fmtDate(a.published_date)}</div>
            </div>
            <span class="score-pill">${a.relevance_score}</span>
          </li>
        `
                )
                .join('')
        }
      </ol>
    </section>
  </div>

  <div class="grid-2">
    <section class="card">
      <h2>Zeitverlauf</h2>
      ${renderTimeSeries(series)}
    </section>
    <section class="card">
      <h2>Top-Quellen</h2>
      ${renderSourcesTable(sourceRows.slice(0, 10))}
    </section>
  </div>

  <section class="card">
    <h2>Alle Artikel <small>(filterbar, durchsuchbar)</small></h2>
    <p id="results-count" class="results-count"></p>
    <div id="article-list" class="article-list">
      ${articles.map(renderArticleCard).join('')}
    </div>
    <div id="articles-empty">Keine Artikel entsprechen den Filtern.</div>
  </section>

  <footer class="report-footer">
    Pressespiegel-Tool · Lokal generiert · ${fmtDate(new Date(), true)} · ${articles.length} Artikel
  </footer>
</div>
<script>${getClientScript()}</script>
</body>
</html>`;
}

async function writeHtml(reportHtml, filename) {
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, reportHtml, 'utf8');
  logger.info(`HTML-Report geschrieben: ${filepath}`);
  return filepath;
}

async function writePdf(reportHtml, filename) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: settings.scraping.puppeteer.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(reportHtml, { waitUntil: 'networkidle0' });
    const filepath = path.join(REPORTS_DIR, filename);
    await page.pdf({
      path: filepath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
    logger.info(`PDF-Report geschrieben: ${filepath}`);
    return filepath;
  } catch (err) {
    logger.error('PDF-Erzeugung fehlgeschlagen', { error: err.message });
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function generateReport({ from, to, articles, format: outFormat = 'html', title }) {
  const html = buildHtmlReport({ from, to, articles, title });
  const stamp = `${format(from, 'yyyy-MM-dd')}_${format(to, 'yyyy-MM-dd')}`;
  const result = { html: null, pdf: null };
  if (outFormat === 'html' || outFormat === 'both') {
    result.html = await writeHtml(html, `pressespiegel_${stamp}.html`);
  }
  if (outFormat === 'pdf' || outFormat === 'both') {
    result.pdf = await writePdf(html, `pressespiegel_${stamp}.pdf`);
  }
  if (outFormat === 'html' && !result.html) {
    result.html = await writeHtml(html, `pressespiegel_${stamp}.html`);
  }
  return result;
}

function findLatestReport() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith('.html') && f.startsWith('pressespiegel_'))
    .map((f) => ({
      name: f,
      path: path.join(REPORTS_DIR, f),
      mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

module.exports = {
  buildHtmlReport,
  generateReport,
  writeHtml,
  writePdf,
  findLatestReport,
  REPORTS_DIR,
};
