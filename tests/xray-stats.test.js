#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseXrayStats } = require('../panel/server/xrayStats');
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
ok(server.includes("'api', 'statsquery', '--server=127.0.0.1:10085'"),
  'server queries only the loopback StatsService');
ok(server.includes('let vless = {}') && server.includes('vlessMB:    vlessUp + vlessDown'),
  'VLESS counters are isolated and exposed per user');
ok(html.includes('<th>VLESS (MB)</th>'), 'users table displays a VLESS traffic column');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
