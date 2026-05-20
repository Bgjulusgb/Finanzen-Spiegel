#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { program } = require('commander');
const chalk = require('chalk');
const { format } = require('date-fns');

const logger = require('../src/logger');
const { parseDateRange } = require('../src/utils');
const { runScan } = require('../src/pipeline');
const database = require('../src/database');
const { generateReport, findLatestReport, REPORTS_DIR } = require('../src/reporter');
const scheduler = require('../src/scheduler');
const { loadJson, saveJson } = require('../src/config');
const { findDuplicate } = require('../src/deduplicator');

function bar(value, max, width = 20) {
  if (!max) return '';
  const filled = Math.round((value / max) * width);
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
}

function section(title) {
  console.log('\n' + chalk.bold.cyan(`▶ ${title}`));
  console.log(chalk.gray('─'.repeat(60)));
}

program
  .name('pressespiegel')
  .description('Lokales Pressespiegel-Tool fuer die Muenchner Kammerspiele')
  .version('2.0.0');

program
  .command('ui')
  .description('Startet die grafische Bedienoberflaeche (lokaler Server + Browser)')
  .option('-p, --port <port>', 'Port', '4711')
  .option('--no-open', 'Browser nicht automatisch oeffnen')
  .action(async (opts) => {
    const { start } = require('../src/server');
    try {
      const info = await start({ port: parseInt(opts.port, 10) });
      const url = `http://${info.host}:${info.port}/`;
      console.log(chalk.cyan(`\n▶ UI laeuft auf ${chalk.bold.underline(url)}`));
      console.log(chalk.gray('  Stoppen mit Ctrl+C\n'));
      if (opts.open !== false) openFile(url);
    } catch (err) {
      console.error(chalk.red(`Server-Start fehlgeschlagen: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Scannt RSS-Feeds und speichert relevante Artikel lokal')
  .option('--from <date>', 'Startdatum YYYY-MM-DD')
  .option('--to <date>', 'Enddatum YYYY-MM-DD')
  .option('--last <range>', 'Zeitraum z.B. 7d, 30d, 3m')
  .action(async (opts) => {
    try {
      const { from, to } = parseDateRange(opts);
      section(`Scan-Zeitraum: ${format(from, 'yyyy-MM-dd')} bis ${format(to, 'yyyy-MM-dd')}`);
      const summary = await runScan({ from, to });
      console.log(chalk.green('\nScan abgeschlossen'));
      console.log(`  ${chalk.bold('Gefunden:')}      ${summary.articlesFound}`);
      console.log(`  ${chalk.bold('Neu in DB:')}     ${chalk.green.bold(summary.articlesAdded)}`);
      console.log(`  ${chalk.bold('Duplikate:')}     ${summary.duplicatesFound}`);
      console.log(
        `  ${chalk.bold('Fehler:')}        ${summary.errors > 0 ? chalk.red(summary.errors) : summary.errors}`
      );
      if (summary.articlesAdded > 0) {
        console.log(
          chalk.gray(
            `\nTipp: ${chalk.white('pressespiegel report --last 7d')} erstellt einen HTML-Report`
          )
        );
      }
    } catch (err) {
      logger.error('Scan fehlgeschlagen', { error: err.message, stack: err.stack });
      console.error(chalk.red(`Fehler: ${err.message}`));
      process.exit(1);
    } finally {
      database.close();
    }
  });

program
  .command('report')
  .description('Generiert lokalen HTML- und/oder PDF-Report')
  .option('--from <date>', 'Startdatum YYYY-MM-DD')
  .option('--to <date>', 'Enddatum YYYY-MM-DD')
  .option('--last <range>', 'Zeitraum z.B. 7d, 30d')
  .option('--period <p>', 'Schnellauswahl: daily | weekly | monthly')
  .option('--format <f>', 'Format: html | pdf | both', 'html')
  .option('--title <t>', 'Titel des Reports')
  .option('--open', 'Report nach Erstellung im Browser oeffnen')
  .action(async (opts) => {
    try {
      if (opts.period) {
        if (opts.period === 'daily') opts.last = '1d';
        else if (opts.period === 'weekly') opts.last = '7d';
        else if (opts.period === 'monthly') opts.last = '1m';
      }
      const { from, to } = parseDateRange(opts);
      section(`Report: ${format(from, 'yyyy-MM-dd')} bis ${format(to, 'yyyy-MM-dd')}`);
      const articles = database.getArticlesByRange(from, to);
      console.log(`  ${chalk.bold(articles.length)} Artikel im Zeitraum`);

      if (articles.length === 0) {
        console.log(chalk.yellow('\n⚠ Keine Artikel im Zeitraum.'));
        console.log(
          chalk.gray(`Tipp: Erst ${chalk.white('pressespiegel scan --last 7d')} ausfuehren.`)
        );
        return;
      }

      const result = await generateReport({
        from,
        to,
        articles,
        format: opts.format,
        title: opts.title,
      });
      console.log('');
      if (result.html) console.log(chalk.green(`  HTML: ${result.html}`));
      if (result.pdf) console.log(chalk.green(`  PDF:  ${result.pdf}`));

      if (opts.open && result.html) {
        openFile(result.html);
      } else if (result.html) {
        console.log(chalk.gray(`\nOeffnen: ${chalk.white(`pressespiegel open`)}`));
      }
    } catch (err) {
      logger.error('Report fehlgeschlagen', { error: err.message });
      console.error(chalk.red(`Fehler: ${err.message}`));
      process.exit(1);
    } finally {
      database.close();
    }
  });

program
  .command('open [filename]')
  .description('Oeffnet den neuesten Report (oder einen bestimmten) im Standard-Browser')
  .action((filename) => {
    let filepath;
    if (filename) {
      filepath = path.isAbsolute(filename) ? filename : path.join(REPORTS_DIR, filename);
      if (!fs.existsSync(filepath)) {
        console.error(chalk.red(`Datei nicht gefunden: ${filepath}`));
        process.exit(1);
      }
    } else {
      const latest = findLatestReport();
      if (!latest) {
        console.log(chalk.yellow('Kein Report gefunden. Zuerst:'));
        console.log(chalk.white('  pressespiegel report --last 7d'));
        return;
      }
      filepath = latest.path;
    }
    console.log(chalk.cyan(`Oeffne: ${filepath}`));
    openFile(filepath);
  });

program
  .command('list-reports')
  .description('Listet alle lokalen Reports')
  .action(() => {
    if (!fs.existsSync(REPORTS_DIR)) {
      console.log(chalk.yellow('Noch keine Reports.'));
      return;
    }
    const files = fs
      .readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith('.html') || f.endsWith('.pdf'))
      .map((f) => {
        const fp = path.join(REPORTS_DIR, f);
        const stat = fs.statSync(fp);
        return { name: f, path: fp, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) {
      console.log(chalk.yellow('Noch keine Reports.'));
      return;
    }
    section(`${files.length} Report${files.length === 1 ? '' : 's'} in ${REPORTS_DIR}`);
    for (const f of files) {
      const sizeKb = Math.round(f.size / 1024);
      console.log(
        `  ${chalk.gray(format(f.mtime, 'dd.MM.yyyy HH:mm'))}  ${chalk.cyan(f.name)} ${chalk.gray(`(${sizeKb} KB)`)}`
      );
    }
  });

program
  .command('search <query>')
  .description('Sucht Artikel in der lokalen Datenbank')
  .option('--limit <n>', 'Max. Treffer', '20')
  .action(async (query, opts) => {
    try {
      const stmt = database.db.prepare(`
        SELECT id, title, source, published_date, relevance_score, sentiment, url, summary
        FROM articles
        WHERE (title LIKE @q OR full_text LIKE @q OR summary LIKE @q)
          AND deleted_at IS NULL AND duplicate_of IS NULL
        ORDER BY relevance_score DESC, published_date DESC
        LIMIT @limit
      `);
      const rows = stmt.all({ q: `%${query}%`, limit: parseInt(opts.limit, 10) });
      if (!rows.length) {
        console.log(chalk.yellow(`Keine Treffer fuer "${query}".`));
        return;
      }
      section(`${rows.length} Treffer fuer "${query}"`);
      for (const r of rows) {
        const sent =
          r.sentiment === 'positiv'
            ? chalk.green('▲')
            : r.sentiment === 'negativ'
              ? chalk.red('▼')
              : chalk.gray('·');
        console.log(`\n  ${sent} ${chalk.bold(r.title)}`);
        console.log(
          `    ${chalk.gray(r.source || '')} · ${chalk.gray(format(new Date(r.published_date), 'dd.MM.yyyy'))} · ${chalk.cyan(`Score ${r.relevance_score}`)}`
        );
        if (r.summary)
          console.log(
            `    ${chalk.gray(r.summary.slice(0, 150) + (r.summary.length > 150 ? '…' : ''))}`
          );
        console.log(`    ${chalk.blue.underline(r.url)}`);
      }
    } finally {
      database.close();
    }
  });

const configCmd = program.command('config').description('Konfiguration anpassen');

configCmd
  .command('add-keyword <kw>')
  .option(
    '--type <t>',
    'Typ: required | productions | people | venues | exclude | theater_context',
    'productions'
  )
  .action((kw, opts) => {
    const data = loadJson('keywords.json');
    if (!data[opts.type]) {
      console.error(chalk.red(`Unbekannter Typ: ${opts.type}`));
      console.log(
        chalk.gray('Verfuegbar: required, productions, people, venues, theater_context, exclude')
      );
      process.exit(1);
    }
    if (data[opts.type].includes(kw)) {
      console.log(chalk.yellow(`Bereits vorhanden: ${kw}`));
      return;
    }
    data[opts.type].push(kw);
    saveJson('keywords.json', data);
    console.log(chalk.green(`Hinzugefuegt zu ${opts.type}: ${kw}`));
  });

configCmd
  .command('remove-keyword <kw>')
  .option(
    '--type <t>',
    'Typ: required | productions | people | venues | exclude | theater_context',
    'productions'
  )
  .action((kw, opts) => {
    const data = loadJson('keywords.json');
    if (!data[opts.type]) {
      console.error(chalk.red(`Unbekannter Typ: ${opts.type}`));
      process.exit(1);
    }
    const before = data[opts.type].length;
    data[opts.type] = data[opts.type].filter((k) => k !== kw);
    if (data[opts.type].length === before) {
      console.log(chalk.yellow(`Nicht gefunden: ${kw}`));
      return;
    }
    saveJson('keywords.json', data);
    console.log(chalk.green(`Entfernt aus ${opts.type}: ${kw}`));
  });

configCmd
  .command('add-source <url>')
  .option('--name <name>', 'Name der Quelle')
  .option('--priority <n>', 'Prioritaet (1-100)', '50')
  .action((url, opts) => {
    const data = loadJson('sources.json');
    if (data.feeds.some((f) => f.url === url)) {
      console.log(chalk.yellow(`Bereits vorhanden: ${url}`));
      return;
    }
    data.feeds.push({
      name: opts.name || new URL(url).hostname,
      url,
      priority: parseInt(opts.priority, 10),
      type: 'rss',
    });
    saveJson('sources.json', data);
    console.log(chalk.green(`Hinzugefuegt: ${opts.name || url}`));
  });

configCmd
  .command('list')
  .description('Zeigt aktuelle Konfiguration')
  .action(() => {
    const sources = loadJson('sources.json');
    const kw = loadJson('keywords.json');
    section(`Quellen (${sources.feeds.length})`);
    for (const f of sources.feeds) {
      const cat = f.category ? chalk.gray(` [${f.category}]`) : '';
      console.log(`  ${chalk.cyan(String(f.priority).padStart(3))} ${chalk.bold(f.name)}${cat}`);
      console.log(`      ${chalk.gray(f.url)}`);
    }
    section(`Pflicht-Begriffe (${kw.required.length})`);
    console.log('  ' + kw.required.join(', '));
    section(`Produktionen (${kw.productions.length})`);
    console.log(
      '  ' + kw.productions.slice(0, 50).join(', ') + (kw.productions.length > 50 ? '…' : '')
    );
    section(`Personen (${kw.people.length})`);
    console.log('  ' + kw.people.slice(0, 30).join(', ') + (kw.people.length > 30 ? '…' : ''));
    section(`Ausschluss (${kw.exclude.length})`);
    console.log('  ' + kw.exclude.join(', '));
  });

program
  .command('stats')
  .description('Zeigt Statistiken')
  .option('--from <date>', 'Startdatum YYYY-MM-DD')
  .option('--to <date>', 'Enddatum YYYY-MM-DD')
  .option('--last <range>', 'Zeitraum z.B. 30d')
  .action(async (opts) => {
    try {
      const { from, to } = parseDateRange(opts);
      const stats = database.getStats(from, to);
      section(`Statistiken ${format(from, 'yyyy-MM-dd')} bis ${format(to, 'yyyy-MM-dd')}`);
      const o = stats.overview;
      console.log(`  ${chalk.bold('Artikel gesamt:')}  ${o.total}`);
      console.log(`  ${chalk.bold('Unique:')}          ${o.unique_articles}`);
      console.log(`  ${chalk.bold('Duplikate:')}       ${o.duplicates}`);
      console.log(`  ${chalk.bold('Paywall:')}         ${o.paywalled}`);
      console.log('');
      console.log(`  ${chalk.green('Positiv:')}         ${o.positive}`);
      console.log(`  ${chalk.gray('Neutral:')}         ${o.neutral}`);
      console.log(`  ${chalk.red('Negativ:')}         ${o.negative}`);

      if (stats.bySource.length > 0) {
        section('Top Quellen');
        const max = Math.max(...stats.bySource.map((r) => r.count));
        for (const row of stats.bySource.slice(0, 15)) {
          console.log(
            `  ${chalk.cyan(String(row.count).padStart(5))} ${bar(row.count, max, 20)}  ${row.source}`
          );
        }
      }

      const health = database.getSourceHealth();
      if (health.length > 0) {
        section('Feed-Gesundheit');
        for (const h of health) {
          const status =
            h.consecutive_failures > 0
              ? chalk.red(`Fehler: ${h.consecutive_failures}x Fehler in Folge`)
              : chalk.green('OK');
          console.log(`  ${status}  ${h.source}`);
        }
      }
    } finally {
      database.close();
    }
  });

program
  .command('dedupe')
  .description('Sucht Duplikate in der Datenbank')
  .option('--dry-run', 'Nur anzeigen, nicht markieren', false)
  .option('--since <date>', 'Pruefe seit Datum YYYY-MM-DD')
  .action(async (opts) => {
    try {
      const since = opts.since
        ? new Date(opts.since)
        : new Date(Date.now() - 90 * 24 * 3600 * 1000);
      const candidates = database.getRecentForDedup(since);
      section(`Pruefe ${candidates.length} Artikel auf Duplikate`);
      let dupCount = 0;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const others = candidates.slice(0, i);
        const hit = findDuplicate(
          {
            id: c.id,
            title: c.title,
            url: c.url_normalized,
            first_paragraph: c.first_paragraph,
            source: c.source,
          },
          others
        );
        if (hit) {
          dupCount++;
          console.log(chalk.yellow(`  Duplikat: "${c.title}"`));
          console.log(chalk.gray(`    -> ${hit.reason}: "${hit.duplicate.title}"`));
          if (!opts.dryRun) {
            database.markAsDuplicate(c.id, hit.duplicate.id, null);
          }
        }
      }
      console.log(
        chalk.green(`\n${dupCount} Duplikate ${opts.dryRun ? 'gefunden (dry-run)' : 'markiert'}`)
      );
    } finally {
      database.close();
    }
  });

program
  .command('schedule')
  .description('Startet Scheduler im Vordergrund (Cron-Jobs, lokal)')
  .action(() => {
    console.log(chalk.cyan('▶ Starte lokalen Scheduler...'));
    scheduler.start();
  });

program
  .command('test-feed <url>')
  .description('Testet eine RSS/Atom/JSON-Feed-URL ohne sie zu speichern')
  .action(async (url) => {
    const { testFeed } = require('../src/scraper');
    section(`Test: ${url}`);
    const result = await testFeed(url);
    if (result.ok) {
      console.log(chalk.green(`  OK (${result.responseTimeMs}ms)`));
      console.log(`    Typ:          ${result.type}`);
      console.log(`    Encoding:     ${result.encoding || '-'}`);
      console.log(`    Content-Type: ${result.contentType || '-'}`);
      console.log(`    Titel:        ${result.title || '-'}`);
      console.log(`    Eintraege:    ${chalk.bold(result.itemCount)}`);
      if (result.sample.length) {
        console.log(chalk.cyan('\n  Beispiele:'));
        result.sample.forEach((s) => {
          console.log(`    - ${chalk.bold(s.title || '(ohne Titel)')}`);
          console.log(`      ${chalk.gray(s.url || '')}`);
        });
      }
    } else {
      console.log(chalk.red(`  Fehler (${result.responseTimeMs}ms)`));
      console.log(`    ${result.error}`);
    }
    database.close();
  });

program
  .command('test-all-feeds')
  .description('Testet alle konfigurierten Feeds und gibt eine Tabelle aus')
  .action(async () => {
    const { testFeed } = require('../src/scraper');
    const { sources: srcCfg } = require('../src/config');
    section(`Pruefe ${srcCfg.feeds.length} Feeds`);
    const results = await Promise.all(
      srcCfg.feeds.map(async (f) => ({ feed: f, result: await testFeed(f.url, f.name) }))
    );
    let ok = 0,
      fail = 0;
    for (const { feed, result } of results) {
      if (result.ok) {
        ok++;
        console.log(
          `  ${chalk.green('OK')} ${chalk.bold(feed.name.padEnd(38))} ${result.itemCount.toString().padStart(4)} Eintraege  ${chalk.gray(result.responseTimeMs + 'ms')}`
        );
      } else {
        fail++;
        console.log(
          `  ${chalk.red('FAIL')} ${chalk.bold(feed.name.padEnd(38))} ${chalk.red(result.error)}`
        );
      }
    }
    console.log(
      `\n  ${chalk.green(ok + ' OK')} · ${chalk.red(fail + ' fehlgeschlagen')} von ${srcCfg.feeds.length}`
    );
    database.close();
  });

program
  .command('health')
  .description('Prueft Feed-Gesundheit')
  .action(async () => {
    try {
      const health = database.getSourceHealth();
      if (!health.length) {
        console.log(chalk.yellow('Noch keine Health-Daten. Fuehre erst einen Scan aus.'));
        return;
      }
      section('Feed-Gesundheit');
      for (const h of health) {
        const status = h.consecutive_failures > 0 ? chalk.red('FEHLER') : chalk.green('OK');
        console.log(`\n  [${status}] ${chalk.bold(h.source)}`);
        if (h.last_success) console.log(`    ${chalk.gray('Letzter Erfolg:')} ${h.last_success}`);
        if (h.last_failure) console.log(`    ${chalk.gray('Letzter Fehler:')} ${h.last_failure}`);
        if (h.last_error) console.log(`    ${chalk.gray(h.last_error.slice(0, 100))}`);
      }
    } finally {
      database.close();
    }
  });

function openFile(filepath) {
  const platform = os.platform();
  let child;
  try {
    if (platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '""', filepath], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      });
    } else if (platform === 'darwin') {
      child = spawn('open', [filepath], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [filepath], { detached: true, stdio: 'ignore' });
    }
    child.on('error', (err) => {
      console.log(chalk.yellow(`Konnte Datei nicht automatisch oeffnen: ${err.message}`));
      console.log(chalk.gray(`Pfad: ${filepath}`));
    });
    child.unref();
  } catch (err) {
    console.log(chalk.yellow(`Konnte Datei nicht oeffnen: ${err.message}`));
    console.log(chalk.gray(`Pfad: ${filepath}`));
  }
}

program.parseAsync(process.argv).catch((err) => {
  logger.error('CLI fataler Fehler', { error: err.message, stack: err.stack });
  console.error(chalk.red(`Fehler: ${err.message}`));
  process.exit(1);
});
