#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'tests/openflux-systemd-canary.sh');
const source = fs.readFileSync(file, 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
console.log('OpenFlux Debian 13 systemd canary contract test');
ok(spawnSync('bash', ['-n', 'tests/openflux-systemd-canary.sh'], { cwd: root, encoding: 'utf8' }).status === 0,
  'canary has valid Bash syntax');
ok(source.includes('VERSION_ID:-}') && source.includes("== 13"), 'canary is restricted to Debian 13');
ok(source.includes("existing OpenFlux installation found") && source.includes("existing OpenFlux client bundle found"),
  'prepare refuses a server with existing OpenFlux state');
ok(source.includes('/proc/sys/kernel/random/boot_id') && source.includes('the server has not rebooted since prepare'),
  'verify requires evidence of a real reboot');
ok(source.includes(".active == true and .enabled == true and .listening == true and .healthy == true"),
  'prepare and verify require the full profile health contract');
ok(source.includes("length == 1 and .[0].id == $id") && source.includes('refusing broad cleanup'),
  'cleanup refuses unknown or additional profiles');
ok(source.includes('assert_core_unchanged') && /CORE_SERVICES=.*caddy-naive.*mita.*hysteria-server.*xray.*panel-naive-mieru/.test(source),
  'all phases preserve the primary proxy stack service state');
ok(source.includes('bash "$UNINSTALLER" --purge') && source.includes('OpenFlux artifacts remain after uninstall'),
  'cleanup exercises and verifies the production uninstaller');
ok(!/^\s*(?:sudo\s+)?(?:reboot|shutdown)\b|^\s*systemctl\s+reboot\b/m.test(source),
  'canary never reboots the server automatically');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
