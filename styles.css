'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const database = require('../src/database');

test('classifyFeedHealth: null -> unknown', () => {
  assert.equal(database.classifyFeedHealth(null), 'unknown');
});

test('classifyFeedHealth: erfolgreich ohne Fehler -> ok', () => {
  const h = {
    consecutive_failures: 0,
    last_success: new Date().toISOString(),
    last_error_class: null,
  };
  assert.equal(database.classifyFeedHealth(h), 'ok');
});

test('classifyFeedHealth: 1 Fehler -> degraded', () => {
  const h = { consecutive_failures: 1, last_error_class: 'timeout' };
  assert.equal(database.classifyFeedHealth(h), 'degraded');
});

test('classifyFeedHealth: 3 Fehler in Folge -> degraded', () => {
  const h = { consecutive_failures: 3, last_error_class: 'timeout' };
  assert.equal(database.classifyFeedHealth(h), 'degraded');
});

test('classifyFeedHealth: 4 Fehler in Folge -> dead', () => {
  const h = { consecutive_failures: 4, last_error_class: 'timeout' };
  assert.equal(database.classifyFeedHealth(h), 'dead');
});

test('classifyFeedHealth: HTTP 403 -> blocked (auch bei nur 1 Fehler)', () => {
  const h = { consecutive_failures: 1, last_error_class: 'forbidden' };
  assert.equal(database.classifyFeedHealth(h), 'blocked');
});

test('classifyFeedHealth: HTTP 410 -> dead unabhaengig vom Counter', () => {
  const h = { consecutive_failures: 1, last_error_class: 'gone' };
  assert.equal(database.classifyFeedHealth(h), 'dead');
});

test('classifyFeedHealth: HTTP 404 -> dead unabhaengig vom Counter', () => {
  const h = { consecutive_failures: 2, last_error_class: 'notfound' };
  assert.equal(database.classifyFeedHealth(h), 'dead');
});

test('classifyFeedHealth: Counter 5 mit 404-class -> dead', () => {
  const h = { consecutive_failures: 5, last_error_class: 'notfound' };
  assert.equal(database.classifyFeedHealth(h), 'dead');
});
