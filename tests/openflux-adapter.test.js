#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  OPENFLUX_RELEASE,
  profilePaths,
  buildOpenFluxExitConfig,
  buildOpenFluxClientConfig,
  buildOpenFluxUnit,
} = require('../panel/server/openfluxAdapter');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
function rejects(fn, pattern, message) {
  try { fn(); ok(false, message); }
  catch (error) { ok(pattern.test(error.message), message); }
}

console.log('OpenFlux isolated adapter regression test');
ok(OPENFLUX_RELEASE.version === '0.0.5' && OPENFLUX_RELEASE.asset === 'openflux-linux-amd64',
  'release and amd64 asset are pinned');
ok(OPENFLUX_RELEASE.sha256 === '8211dd5343dd4eac49fcd2838ffcb9e1912c14a0e878c735395967999b0573c5',
  'official release SHA-256 is pinned');
ok(OPENFLUX_RELEASE.license === 'GPL-3.0-or-later' && OPENFLUX_RELEASE.sourceUrl.endsWith('/OpenFlux'),
  'upstream source and license provenance are retained');

const profile = { id: 'direct-one', port: 18445, host: 'vpn.example.com' };
const paths = profilePaths(profile.id);
const exit = buildOpenFluxExitConfig(profile);
const client = buildOpenFluxClientConfig(profile);
const unit = buildOpenFluxUnit();
ok(paths.secret === '/etc/openflux/secrets/direct-one.key' &&
   paths.service === 'openflux-exit@direct-one.service', 'profile paths remain namespaced');
ok(exit.includes('Role = exit') && exit.includes('Mode = l4') &&
   exit.includes('[Transport "direct"]') && exit.includes('Listen = 0.0.0.0:18445'),
  'exit is restricted to L4 and Direct');
ok(exit.includes('EncryptionKeyFile = /etc/openflux/secrets/direct-one.key') &&
   exit.includes('URL = openflux-direct://direct-one'), 'exit requires a profile-specific encryption context');
ok(client.includes('Role = client') && client.includes('Dial = vpn.example.com:18445') &&
   client.includes('EncryptionKeyFile = ./openflux.key'), 'matching SOCKS5 client config is generated');
ok(buildOpenFluxClientConfig({ ...profile, host: '2001:db8::1' }).includes('Dial = [2001:db8::1]:18445'),
  'IPv6 client endpoint is bracketed');
ok(buildOpenFluxClientConfig({ ...profile, socksPort: 11080 }).includes('Socks5 = 127.0.0.1:11080'),
  'canary can isolate its local SOCKS5 listener');
rejects(() => buildOpenFluxClientConfig({ ...profile, socksPort: 80 }), /SOCKS5/, 'privileged SOCKS5 port rejected');
ok(unit.includes('User=openflux') && unit.includes('ProtectSystem=strict') &&
   unit.includes('CapabilityBoundingSet=') && !unit.includes('ExecStartPre=/bin/sh'),
  'unit is unprivileged, hardened and contains no shell hook');
ok(unit.includes('/etc/openflux/profiles/%i.conf') && !unit.includes('caddy') &&
   !unit.includes('mieru') && !unit.includes('xray'), 'unit can only start its own profile');

for (const id of ['../escape', 'UPPER', '1starts-number', 'has space', 'a'.repeat(33)]) {
  rejects(() => profilePaths(id), /invalid/, `unsafe profile id rejected: ${id}`);
}
rejects(() => buildOpenFluxExitConfig({ id: 'safe', port: 443 }), /1024/, 'privileged port rejected');
rejects(() => buildOpenFluxClientConfig({ id: 'safe', port: 18445, host: 'bad/host' }), /host/,
  'unsafe client host rejected');

const root = path.resolve(__dirname, '..');
for (const file of ['panel/server/index.js', 'install.sh', 'update.sh']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  ok(!source.includes('openfluxAdapter'), `${file} does not activate the adapter`);
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
