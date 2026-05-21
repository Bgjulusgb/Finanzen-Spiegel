'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const db = require('../src/database');
const { buildApp } = require('../src/server');

function mkDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daxps-srv-'));
  return db.open(path.join(dir, 'srv.db'));
}

async function get(server, p) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    http.get({ hostname: '127.0.0.1', port: addr.port, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    }).on('error', reject);
  });
}

test('server: /api/health antwortet ok', async () => {
  const d = mkDb();
  const app = buildApp(d, { running: false });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const r = await get(server, '/api/health');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.status, 'ok');
    assert.ok(j.stocks >= 40);
  } finally { server.close(); d.close(); }
});

test('server: /api/overview liefert 40 Aktien', async () => {
  const d = mkDb();
  const app = buildApp(d, { running: false });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const r = await get(server, '/api/overview?days=7');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.ok(Array.isArray(j.stocks));
    assert.ok(j.stocks.length >= 40, `erwartet >=40 Aktien, war ${j.stocks.length}`);
    assert.equal(j.window_days, 7);
  } finally { server.close(); d.close(); }
});

test('server: /api/stock/:symbol funktioniert fuer DAX, 404 sonst', async () => {
  const d = mkDb();
  const app = buildApp(d, { running: false });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const ok = await get(server, '/api/stock/SAP.DE');
    assert.equal(ok.status, 200);
    const j = JSON.parse(ok.body);
    assert.equal(j.stock.symbol, 'SAP.DE');

    const nf = await get(server, '/api/stock/UNKNOWN');
    assert.equal(nf.status, 404);
  } finally { server.close(); d.close(); }
});

test('server: /api/dax40 listet alle Aktien', async () => {
  const d = mkDb();
  const app = buildApp(d, { running: false });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const r = await get(server, '/api/dax40');
    const j = JSON.parse(r.body);
    assert.ok(j.stocks.length >= 40);
    // SAP, BMW, Allianz muessen drin sein.
    const symbols = j.stocks.map((s) => s.symbol);
    assert.ok(symbols.includes('SAP.DE'));
    assert.ok(symbols.includes('BMW.DE'));
    assert.ok(symbols.includes('ALV.DE'));
  } finally { server.close(); d.close(); }
});
