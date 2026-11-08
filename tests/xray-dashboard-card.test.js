#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
let pass = 0, fail = 0;
function ok(v, m) { if (v) { console.log('  ✓', m); pass++; } else { console.error('  ✗', m); fail++; } }
console.log('Xray dashboard card regression test');
ok(html.includes('id="d-xray-card"') && html.includes('id="d-xray-status"'), 'dashboard contains the Xray status card');
ok(html.includes('data-svc="xray"') && html.includes('data-svc-action="restart"'), 'card exposes standard Xray service controls');
ok(app.includes("const vless = status.services.vless || {}") && app.includes("el('d-xray-status').innerHTML = badge(vless.active"),
  'card renders the real installed and active state');
ok(server.includes("'vless': 'xray', 'xray': 'xray'") && server.includes('systemctl is-active xray'),
  'backend service control and status are mapped to xray.service');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
