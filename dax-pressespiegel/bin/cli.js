#!/usr/bin/env node
'use strict';

const { settings, dax } = require('../src/config');
const db = require('../src/database');
const { runScan } = require('../src/pipeline');
const { start } = require('../src/server');
const logger = require('../src/logger');

const args = process.argv.slice(2);
const cmd = args[0];

async function main() {
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp();
    return;
  }

  if (cmd === 'list' || cmd === 'dax40') {
    console.log(`DAX 40 (${dax.length} Aktien):\n`);
    for (const s of dax) {
      console.log(`  ${s.symbol.padEnd(8)} ${s.name.padEnd(28)} ${s.sector || ''}`);
    }
    return;
  }

  if (cmd === 'scan') {
    const database = db.open(settings.database.path);
    const result = await runScan(database);
    console.log('\nErgebnis:');
    console.log(`  feeds_ok      ${result.feeds_ok}`);
    console.log(`  feeds_failed  ${result.feeds_failed}`);
    console.log(`  articles_new  ${result.articles_new}`);
    console.log(`  duration      ${(result.duration_ms / 1000).toFixed(1)}s`);
    return;
  }

  if (cmd === 'ui') {
    const portIdx = args.indexOf('--port');
    const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : settings.server.port;
    await start({ port });
    return;
  }

  console.error(`Unbekannter Befehl: ${cmd}`);
  printHelp();
  process.exitCode = 2;
}

function printHelp() {
  console.log(`DAX 40 Pressespiegel - lokal, frei, offline.

Befehle:
  list                 Liste der ueberwachten DAX-40-Aktien
  scan                 Ein einmaliger Scan aller Quellen (RSS + Google News pro Aktie)
  ui [--port N]        Web-UI starten (Default Port ${settings.server.port})
  help                 Diese Hilfe

Beispiele:
  npm run scan
  npm run ui
  node bin/cli.js ui --port 4712
`);
}

main().catch((err) => {
  logger.error(err.stack || err.message);
  process.exitCode = 1;
});
