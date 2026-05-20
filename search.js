'use strict';

const fs = require('fs');
const path = require('path');

process.env.DOTENV_CONFIG_QUIET = 'true';

const dotenvPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(dotenvPath)) {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => {
    const s = chunk && chunk.toString ? chunk.toString() : String(chunk);
    if (s.includes('injected env') || s.includes('tip:') || /^[◇⌘⚀-⛿].*injected/.test(s))
      return true;
    return origWrite(chunk, ...args);
  };
  try {
    require('dotenv').config({ path: dotenvPath, quiet: true, debug: false });
  } catch {
    /* optional */
  }
  process.stdout.write = origWrite;
}

const CONFIG_DIR = path.join(__dirname, '..', 'config');

function loadJson(filename) {
  const filePath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Konfigurationsdatei fehlt: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filename, data) {
  const filePath = path.join(CONFIG_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const settings = loadJson('settings.json');
const sources = loadJson('sources.json');
const keywords = loadJson('keywords.json');
const sentiment = loadJson('sentiment.json');

settings.scraping.user_agent = process.env.USER_AGENT || settings.scraping.user_agent;

if (process.env.REQUEST_TIMEOUT) {
  settings.scraping.request_timeout_ms = parseInt(process.env.REQUEST_TIMEOUT, 10);
}
if (process.env.MAX_CONCURRENT_REQUESTS) {
  settings.scraping.max_concurrent_requests = parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10);
}
if (process.env.LOG_LEVEL) {
  settings.logging.level = process.env.LOG_LEVEL;
}

module.exports = {
  settings,
  sources,
  keywords,
  sentiment,
  loadJson,
  saveJson,
  CONFIG_DIR,
};
