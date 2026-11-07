#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeHy2Tuning, recommendHy2Tuning, spliceHy2Tuning } = require('../panel/server/hy2Tuning');
let pass = 0, fail = 0;
function ok(value, message) { if (value) { console.log('  ✓', message); pass++; } else { console.error('  ✗', message); fail++; } }
function rejects(fn, pattern, message) { try { fn(); ok(false, message); } catch (e) { ok(pattern.test(e.message), message); } }
console.log('Hysteria2 tuning adapter regression test');
const base = 'listen: :443\nauth:\n  type: userpass\n  userpass:\n    "a": "b"\ntls:\n  cert: /x\n  key: /y\n';
const recommendation = recommendHy2Tuning({ cpuCores: 1, memoryMB: 512, cpuLoadPercent: 90, routeMtu: 1280 });
ok(recommendation.settings.profile === 'conservative' && !recommendation.settings.disablePathMTUDiscovery,
  'advisor selects a conservative profile without guessing that PMTU is broken');
const tuned = spliceHy2Tuning(base, recommendation.settings);
ok(tuned.includes('congestion:\n  type: bbr') && tuned.includes('maxIncomingStreams: 256'),
  'official Hysteria2 QUIC and congestion fields are rendered');
ok(spliceHy2Tuning(tuned, { ...recommendation.settings, udpIdleTimeout: 120 }).match(/BEGIN VertaFlux/g).length === 1,
  'managed tuning update is idempotent');
rejects(() => spliceHy2Tuning(`${base}\nquic:\n  maxIdleTimeout: 20s\n`, recommendation.settings), /unmanaged/,
  'operator-owned tuning is never overwritten silently');
rejects(() => normalizeHy2Tuning({ bandwidthUp: '999 bananas' }), /bandwidth/,
  'invalid bandwidth unit is rejected');
const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
ok(server.includes("app.get('/api/settings/hy2/tuning/recommendation'") &&
   server.includes("app.post('/api/settings/hy2/tuning'"), 'authenticated recommendation and apply routes exist');
const route = server.match(/app\.post\('\/api\/settings\/hy2\/tuning'[\s\S]*?\n\}\);/u)?.[0] || '';
ok(route.includes('applyFileTransaction') && route.includes('reloadHysteria()') &&
   !route.includes('applyXrayConfig') && !route.includes('reloadCaddy'),
  'activation is isolated to transactional Hysteria2 restart');
ok(route.includes('cfg.hy2Tuning = previous') && route.includes('rolledBack: result.rolledBack'),
  'failed activation restores panel state and reports rollback');
ok(html.includes('id="btn-analyze-hy2-tuning"') && html.includes('id="btn-apply-hy2-tuning"') &&
   app.includes('function analyzeHy2Tuning()') && app.includes('function applyHy2Tuning()'),
  'panel separates read-only analysis from confirmed activation');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
