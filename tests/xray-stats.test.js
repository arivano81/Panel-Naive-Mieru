#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('../panel/node_modules/better-sqlite3');
const { parseXrayStats, advanceCounter, accumulateXrayStats } = require('../panel/server/xrayStats');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Xray per-user traffic regression test');
const parsed = parseXrayStats({ stat: [
  { name: 'user>>>alice>>>traffic>>>uplink', value: String(2 * 1048576) },
  { name: 'user>>>alice>>>traffic>>>downlink', value: 3 * 1048576 },
  { name: 'user>>>bob>>>traffic>>>uplink', value: 512 * 1024 },
  { name: 'inbound>>>vless-reality-in>>>traffic>>>uplink', value: 999 },
  { name: 'user>>>mallory>>>traffic>>>uplink', value: -1 },
] });
ok(parsed.alice.uploadMB === 2, 'uplink bytes map to user upload MB');
ok(parsed.alice.downloadMB === 3, 'downlink bytes map to user download MB');
ok(parsed.alice.usedMB === 5, 'per-user total is summed');
ok(parsed.bob.usedMB === 0.5, 'fractional MiB is preserved');
ok(!parsed.mallory, 'negative counters are rejected');
ok(Object.keys(parseXrayStats('not-json')).length === 0, 'malformed API output is isolated');
ok(advanceCounter(10, 7, 9) === 12, 'counter growth adds only the new delta');
ok(advanceCounter(10, 9, 2) === 12, 'counter reset starts a new generation');
const db = new Database(':memory:');
db.exec(`CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT,
  vlessUploadBytes INTEGER DEFAULT 0, vlessDownloadBytes INTEGER DEFAULT 0,
  vlessLastUploadBytes INTEGER DEFAULT 0, vlessLastDownloadBytes INTEGER DEFAULT 0
)`);
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('u1', 'alice', 10, 20, 8, 15);
let rows = db.prepare('SELECT * FROM users').all();
let totals = accumulateXrayStats(db, { alice: { uploadMB: 12 / 1048576, downloadMB: 3 / 1048576 } }, rows);
ok(totals.alice.uploadMB === 14 / 1048576, 'database accumulation adds a live counter delta');
ok(totals.alice.downloadMB === 23 / 1048576, 'database accumulation survives a counter reset');
rows = db.prepare('SELECT * FROM users').all();
totals = accumulateXrayStats(db, {}, rows);
ok(totals.alice.usedMB === 37 / 1048576, 'stored totals remain visible without a live sample');
db.close();
ok(server.includes("'api', 'statsquery', '--server=127.0.0.1:10085'"),
  'server queries only the loopback StatsService');
ok(server.includes('let vless = {}') && server.includes('vlessMB:    vlessUp + vlessDown'),
  'VLESS counters are isolated and exposed per user');
ok(html.includes('<th>VLESS (MB)</th>'), 'users table displays a VLESS traffic column');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
