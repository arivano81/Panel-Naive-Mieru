#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { settingsDiff } = require('../panel/server/tuningHistory');
let pass = 0, fail = 0;
function ok(value, message) { if (value) { console.log('  ✓', message); pass++; } else { console.error('  ✗', message); fail++; } }

console.log('Unified tuning preview and history regression test');
const diff = settingsDiff({ enabled: false, mtu: 1400, profile: 'balanced' },
  { enabled: true, mtu: 1280, profile: 'balanced' });
ok(diff.length === 1 && diff[0].key === 'mtu' && diff[0].before === 1400 && diff[0].after === 1280,
  'diff is stable, shallow and excludes the internal enabled flag');
ok(settingsDiff({ nested: { a: 1 } }, { nested: { a: 1 } }).length === 0,
  'equal structured values are omitted');

const migrations = fs.readFileSync(path.join(__dirname, '../panel/server/databaseMigrations.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
ok(/version:\s*8[\s\S]*VPN tuning history/.test(migrations) &&
   migrations.includes('CREATE TABLE IF NOT EXISTS tuning_history'), 'history has an ordered SQLite migration');
ok(server.includes("app.post('/api/settings/tuning/preview'") &&
   server.includes("app.get('/api/settings/tuning/history'"), 'authenticated preview and history APIs exist');
ok(server.includes("recordTuning(component, 'recommendation'") &&
   (server.match(/recordTuning\('[^']+', 'applied'/g) || []).length === 4,
  'exact previews and all four successful applications are recorded');
ok(server.includes('TUNING_HISTORY_LIMIT = 200') && server.includes('DELETE FROM tuning_history'),
  'history retention is bounded');
ok(html.includes('id="tuning-history"') && app.includes('function loadTuningHistory()') &&
   app.includes('function confirmTuningApply('), 'settings UI shows history and exact pre-apply diff');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
