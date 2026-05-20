'use strict';

const cron = require('node-cron');
const { subWeeks, subMonths, startOfDay, endOfDay } = require('date-fns');

const logger = require('./logger');
const { settings } = require('./config');
const { runScan } = require('./pipeline');
const database = require('./database');
const { generateReport } = require('./reporter');

async function dailyScan() {
  const to = endOfDay(new Date());
  const lookbackHours = settings.schedule.daily_scan_lookback_hours || 24;
  const from = new Date(to.getTime() - lookbackHours * 3600 * 1000);
  logger.info('[Cron] Taeglicher Scan startet');
  try {
    const summary = await runScan({ from, to });
    logger.info('[Cron] Taeglicher Scan beendet', summary);
  } catch (err) {
    logger.error('[Cron] Taeglicher Scan fehlgeschlagen', { error: err.message });
  }
}

async function weeklyReport() {
  const to = endOfDay(new Date());
  const from = startOfDay(subWeeks(to, 1));
  logger.info('[Cron] Wochenbericht');
  try {
    await runScan({ from, to });
    const articles = database.getArticlesByRange(from, to);
    const result = await generateReport({
      from,
      to,
      articles,
      format: 'both',
      title: 'Wochenbericht Muenchner Kammerspiele',
    });
    logger.info('[Cron] Wochenbericht erstellt', { html: result.html, pdf: result.pdf });
  } catch (err) {
    logger.error('[Cron] Wochenbericht fehlgeschlagen', { error: err.message });
  }
}

async function monthlyReport() {
  const to = endOfDay(new Date());
  const from = startOfDay(subMonths(to, 1));
  logger.info('[Cron] Monatsbericht');
  try {
    const articles = database.getArticlesByRange(from, to);
    const result = await generateReport({
      from,
      to,
      articles,
      format: 'both',
      title: 'Monatsbericht Muenchner Kammerspiele',
    });
    logger.info('[Cron] Monatsbericht erstellt', { html: result.html, pdf: result.pdf });
  } catch (err) {
    logger.error('[Cron] Monatsbericht fehlgeschlagen', { error: err.message });
  }
}

function start() {
  const tz = settings.schedule.timezone || 'Europe/Berlin';

  cron.schedule(settings.schedule.daily_scan_cron, dailyScan, { timezone: tz });
  logger.info(`Cron aktiv: Daily Scan (${settings.schedule.daily_scan_cron} ${tz})`);

  cron.schedule(settings.schedule.weekly_report_cron, weeklyReport, { timezone: tz });
  logger.info(`Cron aktiv: Wochenbericht (${settings.schedule.weekly_report_cron} ${tz})`);

  cron.schedule(settings.schedule.monthly_report_cron, monthlyReport, { timezone: tz });
  logger.info(`Cron aktiv: Monatsbericht (${settings.schedule.monthly_report_cron} ${tz})`);

  logger.info('Scheduler gestartet. Prozess laeuft im Vordergrund. Stoppen mit Ctrl+C.');
  logger.info(`Reports werden lokal abgelegt in: ${settings.reports.path}`);
}

module.exports = { start, dailyScan, weeklyReport, monthlyReport };
