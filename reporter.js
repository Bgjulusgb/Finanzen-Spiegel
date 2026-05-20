#!/usr/bin/env node
'use strict';

/* Diagnose-Script: prueft Node-Version, OS, native Modules, Configs.
 * Aufruf: npm run doctor
 */

process.env.DOTENV_CONFIG_QUIET = 'true';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

let problems = 0;
let warnings = 0;

function head(title) {
  console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}
function ok(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}
function warn(msg) {
  console.log(`  ${C.yellow}!${C.reset} ${msg}`);
  warnings++;
}
function err(msg) {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
  problems++;
}
function tip(msg) {
  console.log(`    ${C.dim}→ ${msg}${C.reset}`);
}

function checkNode() {
  head('Node.js');
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  console.log(`  Version: v${v} (${process.arch}, ${process.platform})`);
  console.log(`  ABI:     NODE_MODULE_VERSION ${process.versions.modules}`);

  if (major < 24) {
    err(`Node v${v} ist zu alt. Mindestens Node 24 LTS erforderlich.`);
    tip('https://nodejs.org/de/download/');
  } else if (major === 24) {
    ok(`Node v${v} ist die empfohlene LTS-Version.`);
  } else if (major > 26) {
    warn(`Node v${v} ist sehr neu. Bei Problemen mit nativen Modulen auf Node 24 LTS wechseln.`);
  } else {
    ok(`Node v${v} wird unterstuetzt.`);
  }
}

function checkPackageJson() {
  head('package.json');
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    err('package.json nicht gefunden.');
    return;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    ok(`package.json gueltig (${pkg.name}@${pkg.version}).`);
    if (pkg.engines && pkg.engines.node) {
      ok(`engines.node: ${pkg.engines.node}`);
    }
  } catch (e) {
    err(`package.json kaputt: ${e.message}`);
  }
}

function checkConfigJson() {
  head('Config-Dateien');
  const configDir = path.resolve(__dirname, '..', 'config');
  const files = [
    'settings.json',
    'sources.json',
    'keywords.json',
    'synonyms.json',
    'sentiment.json',
    'tags.json',
  ];
  for (const f of files) {
    const p = path.join(configDir, f);
    if (!fs.existsSync(p)) {
      err(`config/${f} fehlt.`);
      continue;
    }
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      let extra = '';
      if (f === 'sources.json' && d.feeds) extra = ` (${d.feeds.length} Feeds)`;
      ok(`config/${f} gueltig${extra}.`);
    } catch (e) {
      err(`config/${f} ist kein gueltiges JSON: ${e.message}`);
    }
  }
}

function checkNativeModules() {
  head('Built-in SQLite (node:sqlite)');
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE _t (id INTEGER PRIMARY KEY)');
    db.close();
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMajor >= 24) {
      ok('node:sqlite laedt korrekt (Node 24+, stabil, keine Build-Tools noetig).');
    } else {
      ok('node:sqlite laedt korrekt (experimentell in Node 22, stabil ab Node 24).');
    }
  } catch (e) {
    err(`node:sqlite kann nicht geladen werden: ${e.message.split('\n')[0]}`);
    tip('Loesung: Node 24 LTS installieren — https://nodejs.org/de/download/');
  }
}

function checkOptionalModules() {
  head('Dependencies (geladen)');
  const deps = [
    'axios',
    'cheerio',
    'commander',
    'express',
    'rss-parser',
    'winston',
    'natural',
    'fuse.js',
    'lru-cache',
  ];
  for (const d of deps) {
    try {
      require(d);
      ok(d);
    } catch (e) {
      err(`${d}: ${e.message.split('\n')[0]}`);
    }
  }
}

function checkBuildTools() {
  head('Build-Tools (optional)');
  const hasCommand = (cmd) => {
    try {
      execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  };
  if (hasCommand('python3') || hasCommand('python')) ok('Python verfuegbar.');
  else warn('Python nicht im PATH (nur fuer Build-from-Source noetig).');
  if (process.platform === 'win32') {
    if (hasCommand('cl')) ok('MSVC-Compiler verfuegbar.');
    else warn('MSVC nicht im PATH (Visual Studio Build Tools fehlen evtl.).');
  } else {
    if (hasCommand('make') && (hasCommand('gcc') || hasCommand('g++'))) ok('GCC/Make verfuegbar.');
    else warn('GCC/Make nicht im PATH (nur fuer Build-from-Source noetig).');
  }
}

function summary() {
  console.log('');
  if (problems === 0 && warnings === 0) {
    console.log(`${C.green}${C.bold}✓ Alles in Ordnung — keine Probleme gefunden.${C.reset}\n`);
    process.exit(0);
  }
  if (problems > 0) {
    console.log(
      `${C.red}${C.bold}✗ ${problems} Problem(e) gefunden${C.reset}${warnings ? `, ${warnings} Warnung(en)` : ''}.\n`
    );
    process.exit(1);
  }
  console.log(
    `${C.yellow}${C.bold}! ${warnings} Warnung(en)${C.reset} — laeuft, aber bitte pruefen.\n`
  );
  process.exit(0);
}

console.log(`${C.bold}Pressespiegel — Doctor${C.reset}`);
checkNode();
checkPackageJson();
checkConfigJson();
checkNativeModules();
checkOptionalModules();
checkBuildTools();
summary();
