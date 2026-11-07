#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('panel/public/app.js');
const html = read('panel/public/index.html');
const server = read('panel/server/index.js');
let passed = 0, failed = 0;
const ok = (value, message) => value
  ? (console.log('  ✓', message), passed++)
  : (console.error('  ✗', message), failed++);

console.log('Operator-friendly result messages regression test');
ok(html.includes('id="cascade-details"') && html.includes('id="warp-details"') &&
   (html.match(/<summary data-i18n="settings.technicalDetails">/g) || []).length === 2,
  'raw cascade and WARP output is kept in collapsed technical details');
ok(server.includes('naiveConfigured:') && server.includes('mieruConfigured:'),
  'cascade status exposes structured state instead of requiring stdout parsing');
ok(app.includes("t('settings.cascadeStateFull')") && app.includes("t('settings.cascadeStateAttention')"),
  'cascade status presents a classified operator message');
ok(app.includes("t('settings.warpStateOn')") && app.includes("t('settings.warpStateAttention')"),
  'WARP status presents a classified operator message');
const applyWarp = app.slice(app.indexOf('async function applyWarp()'), app.indexOf('async function checkWarpStatus()'));
const changeCascade = app.slice(app.indexOf('async function changeCascade()'), app.indexOf('function cascadeShowStatus'));
ok(!applyWarp.includes('pre.textContent = res.output') && !changeCascade.includes('cascadeShowStatus(res.cascadeOutput)'),
  'successful mutations no longer dump command output into the primary result');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
