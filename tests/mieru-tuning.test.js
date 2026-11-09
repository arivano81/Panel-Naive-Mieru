#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeMieruTuning, recommendMieruTuning } = require('../panel/server/mieruTuning');
let pass = 0, fail = 0;
function ok(value, message) { if (value) { console.log('  ✓', message); pass++; } else { console.error('  ✗', message); fail++; } }
function rejects(fn, pattern, message) { try { fn(); ok(false, message); } catch (e) { ok(pattern.test(e.message), message); } }

console.log('Mieru tuning helper regression test');
const constrained = recommendMieruTuning({ cpuCores: 1, memoryMB: 512, cpuLoadPercent: 90, routeMtu: 1280 });
ok(constrained.settings.mtu === 1280 && constrained.settings.multiplexing === 'MULTIPLEXING_LOW',
  'resource and route constraints produce a conservative recommendation');
const capable = recommendMieruTuning({ cpuCores: 4, memoryMB: 4096, cpuLoadPercent: 10, routeMtu: 1500 });
ok(capable.settings.mtu === 1400 && capable.settings.transport === 'TCP' && capable.settings.trafficPattern === 'NOOP',
  'capable hosts retain official safe transport defaults');
rejects(() => normalizeMieruTuning({ mtu: 1500 }), /MTU/, 'unsupported MTU is rejected');
rejects(() => normalizeMieruTuning({ transport: 'QUIC' }), /transport/, 'unsupported transport is rejected');

const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
ok(server.includes("app.get('/api/settings/mieru/tuning/recommendation'") &&
   server.includes("app.post('/api/settings/mieru/tuning'"), 'authenticated recommendation and apply routes exist');
const route = server.match(/app\.post\('\/api\/settings\/mieru\/tuning'[\s\S]*?\n\}\);/u)?.[0] || '';
ok(route.includes('restartMieru()') && !route.includes('applyXrayConfig') && !route.includes('reloadCaddy') &&
   !route.includes('reloadHysteria'), 'activation is isolated to Mieru');
ok(route.includes('cfg.mieruTuning = previous.tuning') && route.includes('rolledBack'),
  'failed activation restores panel state and reports rollback');
ok(html.includes('id="btn-analyze-mieru-tuning"') && html.includes('id="btn-apply-mieru-tuning"') &&
   app.includes('function analyzeMieruTuning()') && app.includes('function applyMieruTuning()'),
  'panel separates read-only analysis from confirmed activation');
ok((server.match(/cfg\.mieruTuning\?\.multiplexing \|\| 'MULTIPLEXING_HIGH'/g) || []).length >= 4,
  'generated Mieru client profiles use the confirmed multiplexing level');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
