#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeXrayTuning, recommendXrayTuning } = require('../panel/server/xrayTuning');
const { buildXrayRealityConfig } = require('../panel/server/xrayConfig');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function rejects(fn, pattern, message) {
  try { fn(); ok(false, message); } catch (error) { ok(pattern.test(error.message), message); }
}

console.log('Xray adaptive tuning regression test');
const settings = {
  host: 'vpn.example.com', port: 8443, serverName: 'vpn.example.com',
  target: 'vpn.example.com:443', privateKey: 'A'.repeat(43), publicKey: 'B'.repeat(43),
  shortId: 'a1b2c3d4e5f60708',
};
const users = [{ id: '550e8400-e29b-41d4-a716-446655440000', email: 'alice@example.com' }];

const established = buildXrayRealityConfig(settings, users);
const explicitlyDisabled = buildXrayRealityConfig({ ...settings, tuning: { enabled: false } }, users);
ok(JSON.stringify(established) === JSON.stringify(explicitlyDisabled),
  'disabled tuning preserves the established Xray config byte-for-byte');
ok(!established.inbounds[0].streamSettings.sockopt && !established.outbounds[0].streamSettings,
  'disabled tuning adds no implicit socket policy');

const tuned = buildXrayRealityConfig({ ...settings, tuning: {
  enabled: true, profile: 'custom', sniffing: false, tcpFastOpen: true,
  tcpKeepAliveIdle: 90, tcpKeepAliveInterval: 20, tcpUserTimeout: 12000,
  tcpCongestion: 'bbr', domainStrategy: 'UseIPv4',
} }, users);
const inboundSocket = tuned.inbounds[0].streamSettings.sockopt;
const outboundSocket = tuned.outbounds[0].streamSettings.sockopt;
ok(inboundSocket.tcpFastOpen && inboundSocket.tcpcongestion === 'bbr' && inboundSocket.tcpKeepAliveIdle === 90,
  'validated tuning is rendered on the REALITY listener');
ok(outboundSocket.domainStrategy === 'UseIPv4' && outboundSocket.tcpUserTimeout === 12000,
  'validated tuning is rendered on direct egress');
ok(tuned.inbounds[0].sniffing.enabled === false, 'sniffing remains an explicit administrator choice');

const constrained = recommendXrayTuning({ memoryMB: 512, cpuLoadPercent: 92, cpuCores: 1,
  congestionControls: ['cubic'], tcpFastOpen: 1, routeMtu: 1280, ipv6Default: false });
ok(constrained.settings.profile === 'conservative' && constrained.settings.tcpCongestion === 'cubic',
  'advisor selects a conservative supported profile for a constrained VPS');
ok(!constrained.settings.tcpFastOpen && constrained.settings.domainStrategy === 'UseIPv4',
  'advisor does not enable unsupported TFO or unusable IPv6');
const capable = recommendXrayTuning({ memoryMB: 4096, cpuLoadPercent: 10, cpuCores: 4,
  congestionControls: ['cubic', 'bbr'], tcpFastOpen: 3, routeMtu: 1500, ipv6Default: true });
ok(capable.settings.profile === 'throughput' && capable.settings.tcpCongestion === 'bbr',
  'advisor selects BBR throughput settings only when the kernel supports them');

rejects(() => normalizeXrayTuning({ tcpKeepAliveIdle: 5 }), /30\.\.7200/,
  'unsafe keepalive value is rejected');
rejects(() => normalizeXrayTuning({ tcpCongestion: 'reno' }), /unsupported/,
  'unapproved congestion control is rejected');
rejects(() => normalizeXrayTuning({ domainStrategy: 'UseMagic' }), /unsupported/,
  'unknown domain strategy is rejected');

const server = fs.readFileSync(path.join(__dirname, '../panel/server/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../panel/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../panel/public/app.js'), 'utf8');
ok(server.includes("app.get('/api/settings/vless/tuning/recommendation'") &&
   server.includes("app.post('/api/settings/vless/tuning'"),
  'authenticated recommendation and apply endpoints exist');
ok(server.includes("readCommand('sysctl'") && server.includes("readCommand('ip'") &&
   server.includes("readCommand('ss'"), 'advisor uses bounded read-only host probes');
const route = server.match(/app\.post\('\/api\/settings\/vless\/tuning'[\s\S]*?\n\}\);/u)?.[0] || '';
ok(route.includes('applyXrayConfig()') && !route.includes('applyCaddyConfig') &&
   !route.includes('restartMita') && !route.includes('restartHy2'),
  'apply path is isolated to the transactional Xray restart');
ok(route.includes('cfg.stack && cfg.stack.vless') && route.includes('result.changed === true'),
  'disabled VLESS cannot persist tuning or report a restart that did not happen');
ok(route.includes('cfg.xrayTuning = previous') && route.includes('rolledBack: result.rolledBack'),
  'failed activation restores panel state and reports rollback');
ok(html.includes('id="btn-analyze-xray-tuning"') && html.includes('id="btn-apply-xray-tuning"') &&
   app.includes('function analyzeXrayTuning()') && app.includes('function applyXrayTuning()'),
  'panel separates read-only analysis from confirmed activation');
ok(app.includes("confirm('Проверить и применить параметры?"),
  'activation requires an explicit administrator confirmation');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
