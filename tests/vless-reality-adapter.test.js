#!/usr/bin/env node
'use strict';

const {
  normalizeRealitySettings, buildXrayRealityConfig, buildVlessRealityLink,
} = require('../panel/server/xrayConfig');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function rejects(fn, pattern, message) {
  try { fn(); ok(false, message); } catch (error) { ok(pattern.test(error.message), message); }
}

console.log('VLESS REALITY adapter regression test');
const settings = {
  host: 'vpn.example.com', port: 8443, serverName: 'www.microsoft.com',
  target: 'www.microsoft.com:443', privateKey: 'A'.repeat(43), publicKey: 'B'.repeat(43),
  shortId: 'a1b2c3d4e5f60708',
};
const user = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'alice@example.com' };
const config = buildXrayRealityConfig(settings, [user]);
const inbound = config.inbounds[0];
ok(inbound.port === 8443 && inbound.protocol === 'vless', 'dedicated VLESS TCP inbound generated');
ok(config.api && config.api.listen === '127.0.0.1:10085', 'Stats API listens only on loopback');
ok(config.api.services.includes('StatsService'), 'StatsService is explicitly enabled');
ok(inbound.settings.clients[0].flow === 'xtls-rprx-vision', 'Vision flow enforced');
ok(inbound.streamSettings.security === 'reality', 'REALITY transport enforced');
ok(inbound.streamSettings.realitySettings.privateKey === settings.privateKey, 'private key stays server-side');
ok(config.policy.levels['0'].statsUserUplink, 'per-user stats enabled for later quota integration');

const link = new URL(buildVlessRealityLink(settings, user, 'Alice VLESS'));
ok(link.protocol === 'vless:', 'client link uses vless scheme');
ok(link.searchParams.get('pbk') === settings.publicKey, 'client link contains public key');
ok(!link.href.includes(settings.privateKey), 'private key never leaks into client link');
ok(link.searchParams.get('flow') === 'xtls-rprx-vision', 'client link carries Vision flow');

rejects(() => normalizeRealitySettings({ ...settings, target: 'other.example:443' }), /must equal/,
  'mismatched target/SNI rejected');
rejects(() => normalizeRealitySettings({ ...settings, port: 443 }), /1024/, 'privileged/shared port rejected');
rejects(() => buildXrayRealityConfig(settings, [{ ...user, id: 'not-a-uuid' }]), /UUID/,
  'invalid user UUID rejected');
rejects(() => buildXrayRealityConfig(settings, [user, user]), /duplicate/, 'duplicate UUID rejected');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
