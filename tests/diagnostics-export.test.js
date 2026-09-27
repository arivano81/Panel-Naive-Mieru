#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Secret-free diagnostic export regression test');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const start = server.indexOf('function collectSafeDiagnostics()');
const end = server.indexOf("app.get('/api/diagnostics',", start);
const collector = server.slice(start, end);

ok(start > 0 && end > start, 'diagnostics are built by one shared allowlist collector');
ok(!collector.includes('mita describe config') && !collector.includes('journalctl') &&
   !collector.includes('LOG_PANEL') && !collector.includes('LOG_CADDY'),
  'collector never returns raw config or log command output');
ok(!/cfg\.(admin|federation|cascade|totp)/.test(collector) &&
   !/password|passHash|privateKey|sub_token/.test(collector),
  'collector does not read known secret-bearing config fields');
ok(collector.includes('probeSecretSet: !!(cfg.probeSecret)') &&
   !collector.includes('probeSecret: cfg.probeSecret'),
  'probe secret is reduced to a boolean presence flag');
ok(collector.includes("format: 'rixxx-panel-diagnostics'") && collector.includes('schema: 1'),
  'download format is explicitly tagged and versioned');
ok(collector.includes('users: Array.isArray(state.users) ? state.users.length : 0') &&
   !collector.includes('state.users.map'), 'Mita users are reduced to a count');
ok(collector.includes("execFileSync('systemctl', ['is-active', unit]") &&
   collector.includes("execFileSync('ss', ['-H', '-tlnup'"),
  'service and port probes use argv-safe process execution');
ok(/app\.get\('\/api\/diagnostics\/export', requireAuth/.test(server) &&
   /Cache-Control', 'no-store'/.test(server) && /Content-Disposition/.test(server.slice(end)),
  'authenticated export is non-cacheable and downloaded as an attachment');
ok(ui.includes("case 'export-diagnostics': exportDiagnostics()") &&
   html.includes('data-action="export-diagnostics"'),
  'diagnostics page exposes the safe report download');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
