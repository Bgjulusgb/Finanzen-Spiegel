'use strict';

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level, ...args) {
  const line = `${ts()} ${level.padEnd(5)} | ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  if (level === 'ERROR' || level === 'WARN') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  info:  (...a) => log('INFO',  ...a),
  warn:  (...a) => log('WARN',  ...a),
  error: (...a) => log('ERROR', ...a),
  debug: (...a) => { if (process.env.DEBUG) log('DEBUG', ...a); },
};
