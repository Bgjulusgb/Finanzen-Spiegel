#!/usr/bin/env node
'use strict';

/* Postinstall-Check: prueft, ob node:sqlite verfuegbar ist.
 * Bricht den npm-install NICHT ab, gibt nur klare Warnungen aus.
 */

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function info(msg) {
  process.stdout.write(`${C.cyan}[check-native]${C.reset} ${msg}\n`);
}
function ok(msg) {
  process.stdout.write(`${C.green}[check-native]${C.reset} ${msg}\n`);
}
function fail(msg) {
  process.stdout.write(`${C.red}[check-native]${C.reset} ${msg}\n`);
}

function checkNodeSqlite() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);

  if (nodeMajor < 22) {
    fail(
      `Node v${process.versions.node} ist zu alt. node:sqlite erfordert Node 22.5+ (empfohlen: Node 24 LTS).`
    );
    process.stdout.write(`\n${C.yellow}Download: https://nodejs.org/de/download/${C.reset}\n\n`);
    return false;
  }

  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE _test (id INTEGER PRIMARY KEY)');
    db.close();
    if (nodeMajor >= 24) {
      ok(`node:sqlite laedt korrekt (Node ${process.versions.node}, stabil).`);
    } else {
      ok(
        `node:sqlite laedt korrekt (Node ${process.versions.node}, experimentell — in Node 24 stabil).`
      );
    }
    return true;
  } catch (err) {
    fail(`node:sqlite konnte nicht geladen werden: ${err.message.split('\n')[0]}`);
    process.stdout.write(
      `\n${C.yellow}Loesung: Node 24 LTS installieren — https://nodejs.org/de/download/${C.reset}\n\n`
    );
    return false;
  }
}

if (require.main === module) {
  info(
    `Pruefe node:sqlite auf ${process.platform}-${process.arch}, Node v${process.versions.node}...`
  );
  checkNodeSqlite();
  process.exit(0);
}

module.exports = { checkNodeSqlite };
