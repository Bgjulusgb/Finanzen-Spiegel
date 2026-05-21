'use strict';

const els = {
  grid: document.getElementById('grid'),
  windowSelect: document.getElementById('window-select'),
  sortSelect: document.getElementById('sort-select'),
  filterInput: document.getElementById('filter-input'),
  scanBtn: document.getElementById('scan-btn'),
  statusPill: document.getElementById('status-pill'),
  sumPos: document.getElementById('sum-pos'),
  sumNeu: document.getElementById('sum-neu'),
  sumNeg: document.getElementById('sum-neg'),
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

function scoreClass(s) {
  if (s > 10) return 'pos';
  if (s < -10) return 'neg';
  return '';
}
function moodLabel(p) {
  if (p > 0.15) return 'positiv';
  if (p < -0.15) return 'negativ';
  return 'neutral';
}
function fmtDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso.slice(0, 16).replace('T', ' '); }
}

function buildCard(stock) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.symbol = stock.symbol;
  const total = (stock.n_positive || 0) + (stock.n_neutral || 0) + (stock.n_negative || 0);
  const posPct = total ? (stock.n_positive / total) * 100 : 0;
  const negPct = total ? (stock.n_negative / total) * 100 : 0;
  const neuPct = total ? 100 - posPct - negPct : 100;

  const cls = scoreClass(stock.score_100);
  const scoreText = stock.n_articles > 0 ? ((stock.score_100 >= 0 ? '+' : '') + stock.score_100.toFixed(0)) : '-';
  const lastSeen = stock.last_seen ? fmtDate(stock.last_seen) : '-';

  const articlesHtml = (stock.top_articles && stock.top_articles.length)
    ? stock.top_articles.slice(0, 3).map((a) => {
        const ac = scoreClass((a.polarity || 0) * 100);
        return `<div class="headline ${ac}">
          ${escape(a.title || '(ohne Titel)')}
          <div class="meta"><span>${escape(a.source_name || '')}</span><span>${fmtDate(a.published_utc)}</span></div>
        </div>`;
      }).join('')
    : '<div class="empty">Noch keine Treffer im gewaehlten Zeitraum.</div>';

  card.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-title">${escape(stock.name)}</div>
        <div class="card-symbol">${stock.symbol} · <span class="card-sector">${escape(stock.sector || '')}</span></div>
      </div>
      <div class="score-badge ${cls}">${scoreText}</div>
    </div>
    <div class="mood-bar">
      <span class="pos" style="width:${posPct.toFixed(1)}%"></span>
      <span class="neu" style="width:${neuPct.toFixed(1)}%"></span>
      <span class="neg" style="width:${negPct.toFixed(1)}%"></span>
    </div>
    <div class="counts">
      <span>Artikel <strong>${stock.n_articles || 0}</strong></span>
      <span>+ <strong>${stock.n_positive || 0}</strong></span>
      <span>○ <strong>${stock.n_neutral || 0}</strong></span>
      <span>− <strong>${stock.n_negative || 0}</strong></span>
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sortStocks(stocks, mode) {
  const copy = [...stocks];
  if (mode === 'best') copy.sort((a, b) => b.score_100 - a.score_100);
  else if (mode === 'worst') copy.sort((a, b) => a.score_100 - b.score_100);
  else if (mode === 'name') copy.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  else copy.sort((a, b) => b.n_articles - a.n_articles || b.score_100 - a.score_100);
  return copy;
}

function filterStocks(stocks, q) {
  if (!q) return stocks;
  const ql = q.toLowerCase();
  return stocks.filter((s) =>
    s.name.toLowerCase().includes(ql)
    || s.symbol.toLowerCase().includes(ql)
    || (s.sector || '').toLowerCase().includes(ql)
    || (s.queries || []).some((qq) => qq.toLowerCase().includes(ql))
  );
}

function renderSummary(overview) {
  let pos = 0, neu = 0, neg = 0, art = 0;
  for (const s of overview.stocks) {
    pos += s.n_positive || 0;
    neu += s.n_neutral || 0;
    neg += s.n_negative || 0;
    art += s.n_articles || 0;
  }
  els.sumPos.textContent = pos;
  els.sumNeu.textContent = neu;
  els.sumNeg.textContent = neg;
  els.sumArt.textContent = art;
}

function render() {
  if (!lastOverview.stocks) return;
  const filtered = filterStocks(lastOverview.stocks, els.filterInput.value.trim());
  const sorted = sortStocks(filtered, els.sortSelect.value);
  els.grid.innerHTML = '';
  for (const s of sorted) els.grid.appendChild(buildCard(s));
  renderSummary({ stocks: sorted });
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

async function openDetail(symbol) {
  setStatus('lade Detail ...', 'busy');
  try {
    const days = parseInt(els.windowSelect.value, 10);
    const data = await api(`/api/stock/${encodeURIComponent(symbol)}?days=${days}`);
    const s = data.stock;
    const moodClass = scoreClass(data.score_100);
    const items = (data.articles || []).map((a) => {
      const ac = scoreClass((a.polarity || 0) * 100);
      const label = moodLabel(a.polarity || 0);
      return `<li class="${ac}">
        <a href="${escape(a.url)}" target="_blank" rel="noopener noreferrer">${escape(a.title || '(ohne Titel)')}</a>
        <div class="meta">
          <span>${escape(a.source_name || '')}</span>
          <span>${fmtDate(a.published_utc)}</span>
          <span>Sentiment: <strong>${label}</strong> (${(a.polarity || 0).toFixed(2)})</span>
          <span>Erwaehnungen: ${a.mentions}${a.title_hit ? ' (Titel)' : ''}</span>
        </div>
      </li>`;
    }).join('');
    els.modalBody.innerHTML = `
      <h2>${escape(s.name)} <span class="card-symbol">${s.symbol}</span></h2>
      <p class="sub">${escape(s.sector || '')} · ISIN ${escape(s.isin || '-')}</p>
      <div class="stats">
        <div><span>Sentiment-Score</span><strong class="score-badge ${moodClass}" style="display:inline-block;">${data.n_articles ? (data.score_100 >= 0 ? '+' : '') + data.score_100.toFixed(0) : '-'}</strong></div>
        <div><span>Artikel</span><strong>${data.n_articles}</strong></div>
        <div><span>+</span><strong>${data.n_positive}</strong></div>
        <div><span>○</span><strong>${data.n_neutral}</strong></div>
        <div><span>−</span><strong>${data.n_negative}</strong></div>
        <div><span>letzte Erwaehnung</span><strong>${fmtDate(data.last_seen)}</strong></div>
      </div>
      <h3>Alle Artikel im Zeitraum (${data.window_days} Tage)</h3>
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
els.filterInput.addEventListener('input', render);

els.scanBtn.addEventListener('click', async () => {
  els.scanBtn.disabled = true;
  setStatus('scanne ...', 'busy');
  try {
    await api('/api/scan', { method: 'POST' });
    // Pollen bis Scan fertig.
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const h = await api('/api/health');
      if (!h.scan?.running) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await loadOverview();
    if (lastOverview.stocks) {
      const total = lastOverview.stocks.reduce((acc, s) => acc + s.n_articles, 0);
      els.sumScan.textContent = `${new Date().toLocaleTimeString('de-DE')} (${total} Artikel)`;
    }
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    els.scanBtn.disabled = false;
  }
});

loadOverview();

// Automatisch alle 90s neu laden.
setInterval(loadOverview, 90000);
