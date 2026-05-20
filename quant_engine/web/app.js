/* Quant Engine Dashboard - vanilla JS (Chart.js via CDN) */

const els = {
  assetSelect: document.getElementById('asset-select'),
  symbolInput: document.getElementById('symbol-input'),
  refreshBtn: document.getElementById('refresh-btn'),
  statusPill: document.getElementById('status-pill'),
  heroSymbol: document.getElementById('hero-symbol'),
  heroName: document.getElementById('hero-name'),
  heroPrice: document.getElementById('hero-price'),
  heroChange: document.getElementById('hero-change'),
  kpiSentiment: document.getElementById('kpi-sentiment'),
  barSentiment: document.getElementById('bar-sentiment'),
  kpiRisk: document.getElementById('kpi-risk'),
  barRisk: document.getElementById('bar-risk'),
  kpiPolitical: document.getElementById('kpi-political'),
  barPolitical: document.getElementById('bar-political'),
  kpiHype: document.getElementById('kpi-hype'),
  barHype: document.getElementById('bar-hype'),
  kpiPanic: document.getElementById('kpi-panic'),
  barPanic: document.getElementById('bar-panic'),
  kpiVol: document.getElementById('kpi-vol'),
  probBull: document.getElementById('prob-bull'),
  probBear: document.getElementById('prob-bear'),
  probHighvol: document.getElementById('prob-highvol'),
  probPanicfc: document.getElementById('prob-panicfc'),
  forecastDetail: document.getElementById('forecast-detail'),
  volDetail: document.getElementById('vol-detail'),
  heatmapPolitical: document.getElementById('heatmap-political'),
  anomalyList: document.getElementById('anomaly-list'),
  alertList: document.getElementById('alert-list'),
  explanations: document.getElementById('explanations'),
  keywordCloud: document.getElementById('keyword-cloud'),
  entities: document.getElementById('entities'),
  footerTs: document.getElementById('footer-ts'),
};

let charts = { price: null, sentiment: null, mentions: null };

function setStatus(state, text) {
  els.statusPill.className = 'pill pill-' + state;
  els.statusPill.textContent = text;
}

function fmtPct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '--';
  return (x * 100).toFixed(digits) + '%';
}
function fmt(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '--';
  return Number(x).toFixed(digits);
}

function setBar(el, pct) {
  el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json();
}

async function loadAssets() {
  const data = await api('/api/assets');
  els.assetSelect.innerHTML = '';
  data.assets.forEach((a) => {
    const o = document.createElement('option');
    o.value = a.symbol;
    o.textContent = `${a.symbol} - ${a.name}`;
    els.assetSelect.appendChild(o);
  });
  const active = await api('/api/asset');
  els.assetSelect.value = active.symbol;
}

function currentSymbol() {
  const custom = els.symbolInput.value.trim();
  if (custom) return custom.toUpperCase();
  return els.assetSelect.value || '';
}

async function refresh(reload = false) {
  const symbol = currentSymbol();
  const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  setStatus('loading', 'lade ...');
  try {
    const path = reload ? `/api/analysis/refresh${qs}` : `/api/analysis${qs}`;
    const opts = reload ? { method: 'POST' } : {};
    const snap = await api(path, opts);
    renderSnapshot(snap);
    const explain = await api(`/api/explain${qs}`);
    renderExplanations(explain.explanations);
    const prices = await api(`/api/prices${qs}&range=3mo&interval=1d`);
    renderPriceChart(prices.rows);
    setStatus('ok', 'aktualisiert ' + new Date().toLocaleTimeString());
    els.footerTs.textContent = 'Stand: ' + new Date().toLocaleString();
  } catch (err) {
    console.error(err);
    setStatus('error', err.message);
  }
}

function renderSnapshot(snap) {
  const a = snap.asset || {};
  els.heroSymbol.textContent = a.symbol || '--';
  els.heroName.textContent = a.name || '--';

  const quote = snap.quote || {};
  els.heroPrice.textContent = quote.price ? fmt(quote.price, 2) + ' ' + (quote.currency || '') : '--';
  const ch = quote.change_pct;
  if (ch !== undefined && ch !== null) {
    els.heroChange.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
    els.heroChange.className = 'change ' + (ch >= 0 ? 'up' : 'down');
  } else {
    els.heroChange.textContent = '--';
    els.heroChange.className = 'change';
  }

  const s = snap.sentiment?.score ?? 0;
  els.kpiSentiment.textContent = (s >= 0 ? '+' : '') + s.toFixed(1);
  setBar(els.barSentiment, ((s + 100) / 2));

  const vol = snap.volatility || {};
  els.kpiRisk.textContent = (vol.risk_score * 100).toFixed(0);
  setBar(els.barRisk, vol.risk_score * 100);
  els.kpiHype.textContent = fmtPct(vol.hype_probability, 0);
  setBar(els.barHype, vol.hype_probability * 100);
  els.kpiPanic.textContent = fmtPct(vol.panic_probability, 0);
  setBar(els.barPanic, vol.panic_probability * 100);
  els.kpiVol.textContent = (vol.sigma_annual * 100).toFixed(1) + '%';

  const pol = snap.political_risk || {};
  els.kpiPolitical.textContent = (pol.score || 0).toFixed(0);
  setBar(els.barPolitical, pol.score || 0);

  const fc = snap.forecast || {};
  els.probBull.textContent = fmtPct(fc.bullish_probability, 0);
  els.probBear.textContent = fmtPct(fc.bearish_probability, 0);
  els.probHighvol.textContent = fmtPct(fc.high_volatility_probability, 0);
  els.probPanicfc.textContent = fmtPct(fc.panic_risk, 0);
  els.forecastDetail.textContent =
    `Horizont: ${fc.horizon_days || '-'} Tage | Erwartete Bewegung: ${fmt(fc.expected_return_pct, 2)}% ` +
    `| 95%-KI: ${fmt(fc.ci95_low)} - ${fmt(fc.ci95_high)} | Modell: ${fc.model_used || '-'}`;

  renderVolTable(vol);
  renderPoliticalHeatmap(pol);
  renderAnomalies(snap.anomalies || {});
  renderAlerts(snap.alerts || []);
  renderKeywords(snap.keywords || []);
  renderEntities(snap.entities || {});
  renderSentimentChart(snap.sentiment?.series_daily || []);
  renderMentionsChart(snap.momentum?.mention_series || [], snap.momentum?.velocity || []);
}

function renderVolTable(vol) {
  const rows = [
    ['Sigma (Tag)', (vol.sigma_daily * 100).toFixed(3) + '%'],
    ['Sigma (annualisiert)', (vol.sigma_annual * 100).toFixed(2) + '%'],
    ['ATR(14)', fmt(vol.atr_latest, 3)],
    ['Beta vs Benchmark', fmt(vol.beta, 3)],
    ['Vol-Clustering', fmt(vol.clustering, 3)],
    ['Risk Score', fmt(vol.risk_score, 3)],
    ['Hype-Wahrscheinlichkeit', fmtPct(vol.hype_probability, 1)],
    ['Panic-Wahrscheinlichkeit', fmtPct(vol.panic_probability, 1)],
  ];
  els.volDetail.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

function renderPoliticalHeatmap(pol) {
  const items = pol.breakdown || [];
  if (!items.length) {
    els.heatmapPolitical.innerHTML = '<div class="heat-cell">Keine politischen Risiken erkannt.</div>';
    return;
  }
  els.heatmapPolitical.innerHTML = items.map((b) => {
    const alpha = Math.max(0.2, Math.min(1, b.score / 100));
    return `<div class="heat-cell" style="background: rgba(231,76,60,${alpha})"><strong>${b.score.toFixed(0)}</strong>${b.category}</div>`;
  }).join('');
}

function renderAnomalies(an) {
  const items = [];
  (an.news_spikes || []).forEach((x) => items.push(`News-Spike @ ${x.ts} (z=${x.z})`));
  (an.sentiment_spikes || []).forEach((x) => items.push(`Sentiment-Spike @ ${x.ts} (z=${x.z})`));
  (an.sentiment_drops || []).forEach((x) => items.push(`Sentiment-Drop @ ${x.ts} (z=${x.z})`));
  (an.return_outliers || []).forEach((x) => items.push(`Rendite-Outlier idx=${x.index} (z=${x.z})`));
  els.anomalyList.innerHTML = items.length
    ? items.slice(0, 12).map((t) => `<li>${t}</li>`).join('')
    : '<li>Keine Anomalien erkannt.</li>';
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    els.alertList.innerHTML = '<li>Keine aktiven Alerts.</li>';
    return;
  }
  els.alertList.innerHTML = alerts.map((a) => {
    const cls = a.severity >= 0.7 ? 'sev-high' : a.severity >= 0.4 ? 'sev-mid' : 'sev-low';
    return `<li class="${cls}"><strong>${a.title}</strong><br/><span>${a.message}</span></li>`;
  }).join('');
}

function renderExplanations(ex) {
  if (!ex) return;
  els.explanations.innerHTML = `
    <div class="explanation-block"><h4>Warum steigt/faellt das Asset?</h4>
      <p><b>${ex.direction.direction}</b> - ${ex.direction.rationale}</p></div>
    <div class="explanation-block"><h4>Welche News beeinflussen?</h4>
      <p>${ex.news.summary}</p></div>
    <div class="explanation-block"><h4>Politische Risiken</h4>
      <p>${ex.political.rationale}</p></div>
    <div class="explanation-block"><h4>Warum Volatilitaet?</h4>
      <p>${ex.volatility.rationale}</p></div>
  `;
}

function renderKeywords(kw) {
  if (!kw.length) {
    els.keywordCloud.innerHTML = '<span>Keine Daten</span>';
    return;
  }
  const max = Math.max(...kw.map((k) => k.score));
  els.keywordCloud.innerHTML = kw.map((k) => {
    const big = k.score >= max * 0.5 ? 'big' : '';
    return `<span class="${big}">${k.term}</span>`;
  }).join('');
}

function renderEntities(ents) {
  const rows = [
    ['Laender', ents.countries || []],
    ['Politiker', ents.politicians || []],
    ['Notenbanken', ents.central_banks || []],
    ['Konflikte', ents.conflicts || []],
    ['Organisationen', ents.organizations || []],
  ];
  els.entities.innerHTML = rows.map(([label, vals]) => {
    const tags = vals.slice(0, 8).map((v) => `<span>${v}</span>`).join(' ');
    return `<div class="row"><b>${label}:</b> ${tags || '<span>-</span>'}</div>`;
  }).join('');
}

function renderPriceChart(rows) {
  const ctx = document.getElementById('chart-price').getContext('2d');
  const labels = rows.map((r) => r.ts_utc.slice(0, 10));
  const closes = rows.map((r) => r.close);
  if (charts.price) charts.price.destroy();
  charts.price = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Close',
        data: closes,
        borderColor: '#58e0c1',
        backgroundColor: 'rgba(88,224,193,0.08)',
        tension: 0.25,
        pointRadius: 0,
        fill: true,
      }],
    },
    options: chartOptions(),
  });
}

function renderSentimentChart(series) {
  const ctx = document.getElementById('chart-sentiment').getContext('2d');
  const labels = series.map((s) => s.ts);
  const data = series.map((s) => s.score);
  if (charts.sentiment) charts.sentiment.destroy();
  charts.sentiment = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Sentiment',
        data,
        borderColor: '#4c8bff',
        backgroundColor: 'rgba(76,139,255,0.08)',
        tension: 0.3,
        pointRadius: 0,
        fill: true,
      }],
    },
    options: chartOptions({ y: { min: -100, max: 100 } }),
  });
}

function renderMentionsChart(series, velSeries) {
  const ctx = document.getElementById('chart-mentions').getContext('2d');
  const labels = series.map((s) => s.ts);
  const counts = series.map((s) => s.count);
  const vel = velSeries.map((s) => s.value);
  if (charts.mentions) charts.mentions.destroy();
  charts.mentions = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Mentions', data: counts, backgroundColor: 'rgba(76,139,255,0.45)' },
        { type: 'line', label: 'Velocity', data: vel, borderColor: '#f5b041', backgroundColor: 'transparent', pointRadius: 0, tension: 0.25 },
      ],
    },
    options: chartOptions(),
  });
}

function chartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#d7e0ee' } } },
    scales: {
      x: { ticks: { color: '#7c8aa3', maxTicksLimit: 8 }, grid: { color: 'rgba(120,140,180,0.12)' } },
      y: { ticks: { color: '#7c8aa3' }, grid: { color: 'rgba(120,140,180,0.12)' }, ...(extra.y || {}) },
    },
  };
}

els.refreshBtn.addEventListener('click', () => refresh(true));
els.assetSelect.addEventListener('change', () => { els.symbolInput.value = ''; refresh(false); });
els.symbolInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') refresh(true); });

(async () => {
  try {
    await loadAssets();
    await refresh(false);
  } catch (err) {
    setStatus('error', err.message);
  }
})();
