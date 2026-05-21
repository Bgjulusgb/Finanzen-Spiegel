'use strict';

const els = {
  grid: document.getElementById('grid'),
  windowSelect: document.getElementById('window-select'),
  sortSelect: document.getElementById('sort-select'),
  talkFilter: document.getElementById('talk-filter'),
  filterInput: document.getElementById('filter-input'),
  scanBtn: document.getElementById('scan-btn'),
  themeBtn: document.getElementById('theme-btn'),
  statusPill: document.getElementById('status-pill'),
  sumPos: document.getElementById('sum-pos'),
  sumNeu: document.getElementById('sum-neu'),
  sumNeg: document.getElementById('sum-neg'),
  sumBull: document.getElementById('sum-bull'),
  sumBear: document.getElementById('sum-bear'),
  sumArt: document.getElementById('sum-art'),
  sumScan: document.getElementById('sum-scan'),
  modal: document.getElementById('detail-modal'),
  modalBody: document.getElementById('modal-body'),
  modalClose: document.getElementById('modal-close'),
  footerTs: document.getElementById('footer-ts'),
};

let lastOverview = { stocks: [] };

function setStatus(text, cls = '') {
  els.statusPill.className = 'pill ' + cls;
  els.statusPill.textContent = text;
}

async function api(path, init = {}) {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

function moodClass(v) {
  if (v > 10) return 'pos';
  if (v < -10) return 'neg';
  return '';
}
function bullClass(v) {
  if (v > 20) return 'bull';
  if (v < -20) return 'bear';
  return '';
}
function bullSign(v) { return v >= 0 ? '+' + v.toFixed(0) : v.toFixed(0); }

function fmtDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso.slice(0, 16).replace('T', ' '); }
}

const TALK_LABELS = {
  earnings:  'Earnings',  mna: 'M&A',         legal: 'Recht',     analyst: 'Analyst',
  product:   'Produkt',   scandal: 'Skandal', macro: 'Makro',     guidance: 'Guidance',
  dividend:  'Dividende', personnel: 'Personalie', general: 'Allgemein',
};

function buzzGlyph(b) {
  if (b >= 3) return '◗◗◗';
  if (b >= 2) return '◗◗◗';
  if (b >= 1.5) return '◗◗';
  if (b >= 1) return '◗◗';
  if (b >= 0.5) return '◗';
  return '';
}

function buildCard(stock) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.symbol = stock.symbol;
  const total = (stock.n_positive || 0) + (stock.n_neutral || 0) + (stock.n_negative || 0);
  const posPct = total ? (stock.n_positive / total) * 100 : 0;
  const negPct = total ? (stock.n_negative / total) * 100 : 0;
  const neuPct = total ? 100 - posPct - negPct : 100;

  const mCls = moodClass(stock.mood_100);
  const bCls = bullClass(stock.bull_100);
  const moodTxt = stock.n_articles > 0 ? bullSign(stock.mood_100) : '-';
  const bullTxt = stock.n_articles > 0 ? bullSign(stock.bull_100) : '-';
  const lastSeen = stock.last_seen ? fmtDate(stock.last_seen) : '-';

  // Chips
  const chips = [];
  if (stock.top_talk_type) {
    const t = stock.top_talk_type;
    chips.push(`<span class="chip talk-${t}">${escape(TALK_LABELS[t] || t)}</span>`);
  }
  const buzz = stock.buzz || 0;
  if (buzz >= 0.5) {
    chips.push(`<span class="chip buzz">${buzzGlyph(buzz)} buzz ${buzz.toFixed(1)}x</span>`);
  }
  if (Math.abs(stock.trend_delta || 0) >= 10) {
    if (stock.trend_delta > 0) chips.push(`<span class="chip trend-up">▲ ${stock.trend_delta.toFixed(0)}</span>`);
    else chips.push(`<span class="chip trend-down">▼ ${Math.abs(stock.trend_delta).toFixed(0)}</span>`);
  }
  if (stock.n_articles >= 3 && stock.consensus_label) {
    const c = stock.consensus_label;
    if (c === 'einhellig' || c === 'eher einig')
      chips.push(`<span class="chip consensus">${c}</span>`);
    else if (c === 'geteilt' || c === 'gemischt')
      chips.push(`<span class="chip divisive">${c}</span>`);
  }

  const articlesHtml = (stock.top_articles && stock.top_articles.length)
    ? stock.top_articles.slice(0, 3).map((a) => {
        const ac = moodClass((a.polarity || 0) * 100);
        const talkChip = a.talk_type && a.talk_type !== 'general'
          ? `<span class="chip talk-${a.talk_type}" style="padding:1px 6px; font-size:9px;">${TALK_LABELS[a.talk_type] || a.talk_type}</span>` : '';
        return `<div class="headline ${ac}">
          ${escape(a.title || '(ohne Titel)')}
          <div class="meta">
            <span>${escape(a.source_name || '')}${talkChip ? ' &middot; ' + talkChip : ''}</span>
            <span>${fmtDate(a.published_utc)}</span>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Noch keine Treffer im gewaehlten Zeitraum.</div>';

  card.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-title">${escape(stock.name)}</div>
        <div class="card-symbol">${stock.symbol} &middot; <span class="card-sector">${escape(stock.sector || '')}</span></div>
      </div>
      <div class="badges">
        <div class="badge ${mCls}"><div class="v">${moodTxt}</div><div class="k">Mood</div></div>
        <div class="badge ${bCls}"><div class="v">${bullTxt}</div><div class="k">Bull/Bear</div></div>
      </div>
    </div>
    <div class="chip-row">${chips.join('')}</div>
    <div class="mood-bar">
      <span class="pos" style="width:${posPct.toFixed(1)}%"></span>
      <span class="neu" style="width:${neuPct.toFixed(1)}%"></span>
      <span class="neg" style="width:${negPct.toFixed(1)}%"></span>
    </div>
    <div class="counts">
      <span>Art <strong>${stock.n_articles || 0}</strong></span>
      <span>+ <strong>${stock.n_positive || 0}</strong></span>
      <span>○ <strong>${stock.n_neutral || 0}</strong></span>
      <span>− <strong>${stock.n_negative || 0}</strong></span>
      <span>↑ <strong>${stock.n_bull || 0}</strong></span>
      <span>↓ <strong>${stock.n_bear || 0}</strong></span>
    </div>
    <div class="headlines">${articlesHtml}</div>
    <div class="counts" style="border-top:1px solid var(--border); padding-top:8px;">
      <span style="margin-left:auto;">zuletzt: ${lastSeen}</span>
    </div>
  `;
  card.addEventListener('click', () => openDetail(stock.symbol));
  return card;
}

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sortStocks(stocks, mode) {
  const copy = [...stocks];
  switch (mode) {
    case 'best':           copy.sort((a, b) => b.mood_100 - a.mood_100); break;
    case 'worst':          copy.sort((a, b) => a.mood_100 - b.mood_100); break;
    case 'bullish':        copy.sort((a, b) => b.bull_100 - a.bull_100); break;
    case 'bearish':        copy.sort((a, b) => a.bull_100 - b.bull_100); break;
    case 'buzz':           copy.sort((a, b) => b.buzz - a.buzz || b.n_articles - a.n_articles); break;
    case 'trending_up':    copy.sort((a, b) => (b.trend_delta||0) - (a.trend_delta||0)); break;
    case 'trending_down':  copy.sort((a, b) => (a.trend_delta||0) - (b.trend_delta||0)); break;
    case 'name':           copy.sort((a, b) => a.name.localeCompare(b.name, 'de')); break;
    default:               copy.sort((a, b) => b.n_articles - a.n_articles || b.mood_100 - a.mood_100);
  }
  return copy;
}

function filterStocks(stocks, q, talkFilter) {
  let result = stocks;
  if (talkFilter) result = result.filter((s) => s.top_talk_type === talkFilter);
  if (q) {
    const ql = q.toLowerCase();
    result = result.filter((s) =>
      s.name.toLowerCase().includes(ql)
      || s.symbol.toLowerCase().includes(ql)
      || (s.sector || '').toLowerCase().includes(ql)
      || (s.queries || []).some((qq) => qq.toLowerCase().includes(ql))
    );
  }
  return result;
}

function renderSummary(stocks) {
  let pos = 0, neu = 0, neg = 0, bull = 0, bear = 0, art = 0;
  for (const s of stocks) {
    pos += s.n_positive || 0; neu += s.n_neutral || 0; neg += s.n_negative || 0;
    bull += s.n_bull || 0; bear += s.n_bear || 0;
    art += s.n_articles || 0;
  }
  els.sumPos.textContent = pos; els.sumNeu.textContent = neu; els.sumNeg.textContent = neg;
  els.sumBull.textContent = bull; els.sumBear.textContent = bear; els.sumArt.textContent = art;
}

function render() {
  if (!lastOverview.stocks) return;
  const filtered = filterStocks(lastOverview.stocks, els.filterInput.value.trim(), els.talkFilter.value);
  const sorted = sortStocks(filtered, els.sortSelect.value);
  els.grid.innerHTML = '';
  for (const s of sorted) els.grid.appendChild(buildCard(s));
  renderSummary(sorted);
}

async function loadOverview() {
  setStatus('lade ...', 'busy');
  try {
    const days = parseInt(els.windowSelect.value, 10);
    const ov = await api(`/api/overview?days=${days}`);
    lastOverview = ov;
    render();
    setStatus(`aktualisiert ${new Date().toLocaleTimeString('de-DE')}`, 'ok');
    els.footerTs.textContent = 'Stand: ' + new Date().toLocaleString('de-DE');
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

function sparklineSvg(series, key = 'mood') {
  if (!series || series.length === 0) return '<div class="empty">keine Verlaufsdaten</div>';
  const W = 600, H = 100, padX = 8, padY = 8;
  const xs = series.map((_, i) => padX + (i * (W - 2 * padX)) / Math.max(1, series.length - 1));
  const ys = series.map((d) => {
    const v = d[key] || 0;
    return (H / 2) - v * ((H / 2) - padY);
  });
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const lastV = (series[series.length - 1][key] * 100).toFixed(0);
  const cls = lastV > 10 ? 'pos' : lastV < -10 ? 'neg' : '';
  const stroke = cls === 'pos' ? 'var(--pos)' : cls === 'neg' ? 'var(--neg)' : 'var(--neu)';
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Sentiment-Verlauf">
      <line x1="${padX}" y1="${H/2}" x2="${W-padX}" y2="${H/2}" stroke="var(--border)" stroke-width="1" />
      <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="counts" style="justify-content:space-between;">
      <span>${series[0].day}</span><span>${series[series.length-1].day}</span>
    </div>
  `;
}

async function openDetail(symbol) {
  setStatus('lade Detail ...', 'busy');
  try {
    const days = parseInt(els.windowSelect.value, 10);
    const data = await api(`/api/stock/${encodeURIComponent(symbol)}?days=${days}`);
    const s = data.stock;
    const mCls = moodClass(data.mood_100);
    const bCls = bullClass(data.bull_100);
    const items = (data.articles || []).map((a) => {
      const pol = a.aspect_polarity != null ? a.aspect_polarity : (a.polarity || 0);
      const ac = moodClass(pol * 100);
      const talkChip = a.talk_type ? `<span class="chip talk-${a.talk_type}" style="padding:1px 6px; font-size:9px;">${TALK_LABELS[a.talk_type] || a.talk_type}</span>` : '';
      return `<li class="${ac}">
        <a href="${escape(a.url)}" target="_blank" rel="noopener noreferrer">${escape(a.title || '(ohne Titel)')}</a>
        <div class="meta">
          <span>${escape(a.source_name || '')}</span>
          <span>${fmtDate(a.published_utc)}</span>
          <span>Mood: <strong>${pol.toFixed(2)}</strong></span>
          <span>Bull: <strong>${(a.aspect_bull != null ? a.aspect_bull : (a.bull_score || 0)).toFixed(2)}</strong></span>
          <span>Erw.: ${a.mentions}${a.title_hit ? ' (Titel)' : ''}</span>
          ${talkChip}
        </div>
      </li>`;
    }).join('');

    const talkDist = data.talk_distribution || {};
    const talkChips = Object.entries(talkDist)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<span class="chip talk-${t}">${TALK_LABELS[t] || t} &middot; ${n}</span>`)
      .join('');

    const consensusTxt = data.n_articles >= 3 ? (data.consensus_label || '-') : '-';

    els.modalBody.innerHTML = `
      <h2>${escape(s.name)} <span class="card-symbol">${s.symbol}</span></h2>
      <p class="sub">${escape(s.sector || '')} &middot; ISIN ${escape(s.isin || '-')} &middot; Fenster: ${data.window_days} Tage</p>

      <div class="stats">
        <div><span>Mood (−100..+100)</span><strong class="badge ${mCls}" style="display:inline-block;">${data.n_articles ? bullSign(data.mood_100) : '-'}</strong></div>
        <div><span>Bull/Bear</span><strong class="badge ${bCls}" style="display:inline-block;">${data.n_articles ? bullSign(data.bull_100) : '-'}</strong></div>
        <div><span>Trend Δ</span><strong>${data.trend_delta >= 0 ? '+' : ''}${(data.trend_delta || 0).toFixed(1)}</strong></div>
        <div><span>Buzz</span><strong>${(data.buzz || 0).toFixed(1)}×</strong></div>
        <div><span>Konsens</span><strong>${consensusTxt}</strong></div>
        <div><span>Artikel</span><strong>${data.n_articles}</strong></div>
        <div><span>+ / ○ / −</span><strong>${data.n_positive} / ${data.n_neutral} / ${data.n_negative}</strong></div>
        <div><span>Bull / Bear</span><strong>${data.n_bull} / ${data.n_bear}</strong></div>
        <div><span>Top-Thema</span><strong>${TALK_LABELS[data.top_talk_type] || data.top_talk_type || '-'}</strong></div>
        <div><span>zuletzt</span><strong>${fmtDate(data.last_seen)}</strong></div>
      </div>

      <h3>Themenverteilung &middot; wie wird geredet</h3>
      <div class="chip-row">${talkChips || '<span class="empty">keine Klassifikation</span>'}</div>

      <h3>Sentiment-Verlauf (Tagesmittel)</h3>
      <div class="sparkline">${sparklineSvg(data.series, 'mood')}</div>

      <h3>Alle Artikel im Zeitraum</h3>
      ${items ? `<ul class="article-list">${items}</ul>` : '<div class="empty">Keine Artikel im gewaehlten Zeitraum.</div>'}
    `;
    if (!els.modal.open) els.modal.showModal();
    setStatus('bereit', 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

els.modalClose.addEventListener('click', () => els.modal.close());
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) els.modal.close(); });
els.windowSelect.addEventListener('change', loadOverview);
els.sortSelect.addEventListener('change', render);
els.talkFilter.addEventListener('change', render);
els.filterInput.addEventListener('input', render);

els.scanBtn.addEventListener('click', async () => {
  els.scanBtn.disabled = true;
  setStatus('scanne ...', 'busy');
  try {
    await api('/api/scan', { method: 'POST' });
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const h = await api('/api/health');
      if (!h.scan?.running) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await loadOverview();
    if (lastOverview.stocks) {
      const total = lastOverview.stocks.reduce((acc, s) => acc + s.n_articles, 0);
      els.sumScan.textContent = `${new Date().toLocaleTimeString('de-DE')} (${total} Art.)`;
    }
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    els.scanBtn.disabled = false;
  }
});

// Theme: persistiert in localStorage.
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
  try { localStorage.setItem('dax-theme', theme); } catch {}
}
els.themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});
const savedTheme = (() => { try { return localStorage.getItem('dax-theme'); } catch { return null; } })();
applyTheme(savedTheme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

// Tastatur-Shortcuts: / = Suche fokussieren, r = reload, s = scan, Esc = Modal zu.
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === '/') { e.preventDefault(); els.filterInput.focus(); }
  else if (e.key === 'r') { e.preventDefault(); loadOverview(); }
  else if (e.key === 's') { e.preventDefault(); els.scanBtn.click(); }
  else if (e.key === 'Escape' && els.modal.open) els.modal.close();
});

loadOverview();
setInterval(loadOverview, 90000);
