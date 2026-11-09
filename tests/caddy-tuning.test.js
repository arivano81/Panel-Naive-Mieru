#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeCaddyTuning, recommendCaddyTuning, renderCaddyTuning } = require('../panel/server/caddyTuning');
const template = require('../panel/server/caddyTemplate');
let pass = 0, fail = 0;
function ok(value, message) { if (value) { console.log('  ✓', message); pass++; } else { console.error('  ✗', message); fail++; } }
function rejects(fn, pattern, message) { try { fn(); ok(false, message); } catch (e) { ok(pattern.test(e.message), message); } }

console.log('NaiveProxy/Caddy tuning helper regression test');
const recommendation = recommendCaddyTuning({ cpuCores: 1, memoryMB: 512, cpuLoadPercent: 90 });
ok(recommendation.settings.profile === 'conservative' && recommendation.settings.maxIdleConns === 50,
  'resource pressure produces a conservative connection pool');
rejects(() => normalizeCaddyTuning({ maxIdleConns: 2, maxIdleConnsPerHost: 3 }), /global limit/,
  'per-host pool cannot exceed the global pool');
rejects(() => normalizeCaddyTuning({ dialTimeout: 0 }), /dial timeout/, 'unsafe dial timeout is rejected');
ok(renderCaddyTuning({ enabled: false }) === '', 'disabled tuning leaves the Caddyfile byte-compatible');
const lines = renderCaddyTuning({ enabled: true, profile: 'custom', dialTimeout: 25,
  maxIdleConns: 120, maxIdleConnsPerHost: 6 });
ok(lines.includes('dial_timeout 25s') && lines.includes('max_idle_conns 120') &&
  lines.includes('max_idle_conns_per_host 6'), 'only supported forward_proxy directives are rendered');

const base = { adminEmail: 'admin@example.test', domain: 'vpn.example.test', naivePort: 443,
  fakeSiteDir: '/var/www/fake-site', probeMode: 'bare', logFile: '/tmp/access.log' };
const users = [{ username: 'alice', password: 'secret' }];
const plain = template.render(base, users);
const disabled = template.render({ ...base, caddyTuning: { enabled: false } }, users);
ok(plain === disabled, 'migration default does not change established Caddy output');
const tuned = template.render({ ...base, caddyTuning: { enabled: true, profile: 'balanced',
  dialTimeout: 30, maxIdleConns: 100, maxIdleConnsPerHost: 4 } }, users);
ok(tuned.includes('hide_via\n    dial_timeout 30s\n    max_idle_conns 100'),
  'tuning is scoped inside forward_proxy');

const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
const update = fs.readFileSync(path.join(__dirname, '../update.sh'), 'utf8');
ok(server.includes("app.get('/api/settings/naive/tuning/recommendation'") &&
   server.includes("app.post('/api/settings/naive/tuning'"), 'authenticated recommendation and apply routes exist');
const route = server.match(/app\.post\('\/api\/settings\/naive\/tuning'[\s\S]*?\n\}\);/u)?.[0] || '';
ok(route.includes('applyCaddyTransaction') && !route.includes('restartMieru') &&
   !route.includes('applyXrayConfig') && !route.includes('reloadHysteria'), 'activation is isolated to Caddy');
ok(route.includes('cfg.caddyTuning = previous') && route.includes('rolledBack'),
  'failed activation restores panel state and reports rollback');
ok(html.includes('id="btn-analyze-caddy-tuning"') && html.includes('id="btn-apply-caddy-tuning"') &&
   app.includes('function analyzeCaddyTuning()') && app.includes('function applyCaddyTuning()'),
  'panel separates read-only analysis from confirmed activation');
ok(/caddyTuning:\s+cfg\.caddyTuning\s+\|\| \{\}/.test(update) &&
   update.includes("'    hide_via' + tuningLines + probeLine"),
  'update and repair preserve confirmed Caddy tuning in both renderer paths');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
