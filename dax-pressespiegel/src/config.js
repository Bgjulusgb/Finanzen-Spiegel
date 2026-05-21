'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CFG_DIR = path.join(ROOT, 'config');

function loadJson(name) {
  const p = path.join(CFG_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`Config nicht gefunden: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const settings = loadJson('settings.json');
const sources = loadJson('sources.json').sources;
const dax = loadJson('dax40.json').stocks;
const sentiment = loadJson('sentiment.json');

// DB-Pfad immer absolut machen, damit CLI von ueberall startbar ist.
if (!path.isAbsolute(settings.database.path)) {
  settings.database.path = path.join(ROOT, settings.database.path);
}

module.exports = { ROOT, settings, sources, dax, sentiment, loadJson };
