#!/usr/bin/env node
'use strict';

const {
  normalizeRealitySettings, normalizeXhttpSettings, buildXrayRealityConfig,
  buildVlessRealityLink, buildVlessXhttpLink, buildCaddyXhttpRoute,
} = require('../panel/server/xrayConfig');
const caddyTemplate = require('../panel/server/caddyTemplate');
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
ok(config.inbounds.length === 1, 'disabled XHTTP leaves the REALITY config unchanged');

const link = new URL(buildVlessRealityLink(settings, user, 'Alice VLESS'));
ok(link.protocol === 'vless:', 'client link uses vless scheme');
ok(link.searchParams.get('pbk') === settings.publicKey, 'client link contains public key');
ok(!link.href.includes(settings.privateKey), 'private key never leaks into client link');
ok(link.searchParams.get('flow') === 'xtls-rprx-vision', 'client link carries Vision flow');

const xhttpSettings = { enabled: true, port: 10443, host: 'vpn.example.com', path: '/xhttp_a1b2c3d4e5f6' };
const combined = buildXrayRealityConfig(settings, [user], xhttpSettings);
const xhttp = combined.inbounds[1];
ok(xhttp.listen === '127.0.0.1' && xhttp.port === 10443, 'XHTTP inbound is loopback-only');
ok(xhttp.streamSettings.network === 'xhttp' && xhttp.streamSettings.security === 'none',
  'TLS terminates at Caddy and Xray receives XHTTP over loopback');
ok(xhttp.streamSettings.xhttpSettings.path === xhttpSettings.path &&
  xhttp.streamSettings.xhttpSettings.mode === 'auto', 'XHTTP uses a validated secret path and auto mode');
ok(!('flow' in xhttp.settings.clients[0]), 'XHTTP client does not inherit REALITY Vision flow');
const xhttpLink = new URL(buildVlessXhttpLink(xhttpSettings, user, 'Alice XHTTP'));
ok(xhttpLink.searchParams.get('type') === 'xhttp' && xhttpLink.searchParams.get('security') === 'tls',
  'XHTTP client link selects XHTTP behind TLS');
ok(xhttpLink.searchParams.get('path') === xhttpSettings.path && xhttpLink.port === '443',
  'XHTTP client link targets the secret path on standard HTTPS port');
const caddyRoute = buildCaddyXhttpRoute(xhttpSettings);
ok(caddyRoute.includes(`path ${xhttpSettings.path}/*`) &&
  caddyRoute.includes('reverse_proxy h2c://127.0.0.1:10443') && caddyRoute.includes('flush_interval -1'),
  'Caddy route is path-scoped, loopback-only h2c, and unbuffered');
const caddyCfg = { adminEmail: 'admin@example.com', domain: 'vpn.example.com', naivePort: 443,
  fakeSiteDir: '/var/www/fake-site', probeMode: 'bare' };
const caddyWithoutXhttp = caddyTemplate.render(caddyCfg, [{ username: 'alice', password: 'safe-pass' }]);
const caddyWithEmptyXhttp = caddyTemplate.render({ ...caddyCfg, xhttpRoute: '' },
  [{ username: 'alice', password: 'safe-pass' }]);
ok(caddyWithoutXhttp === caddyWithEmptyXhttp,
  'disabled XHTTP leaves the established Caddyfile byte-for-byte unchanged');
const caddyWithXhttp = caddyTemplate.render({ ...caddyCfg, xhttpRoute: caddyRoute },
  [{ username: 'alice', password: 'safe-pass' }]);
ok(caddyWithXhttp.indexOf('@vless_xhttp') < caddyWithXhttp.indexOf('file_server {'),
  'XHTTP route is rendered before the catch-all masquerade handler');

rejects(() => normalizeRealitySettings({ ...settings, target: 'other.example:443' }), /must equal/,
  'mismatched target/SNI rejected');
rejects(() => normalizeRealitySettings({ ...settings, port: 443 }), /1024/, 'privileged/shared port rejected');
rejects(() => buildXrayRealityConfig(settings, [{ ...user, id: 'not-a-uuid' }]), /UUID/,
  'invalid user UUID rejected');
rejects(() => buildXrayRealityConfig(settings, [user, user]), /duplicate/, 'duplicate UUID rejected');
rejects(() => normalizeXhttpSettings({ ...xhttpSettings, path: '/../admin' }), /path must/,
  'unsafe XHTTP path rejected');
rejects(() => normalizeXhttpSettings({ ...xhttpSettings, port: 10085 }), /Stats API/,
  'XHTTP cannot collide with the Stats API');
rejects(() => normalizeXhttpSettings({ ...xhttpSettings, host: '127.0.0.1' }), /DNS hostname/,
  'XHTTP public host must be a DNS hostname for Caddy TLS');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
