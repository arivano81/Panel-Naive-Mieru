#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'tests/cascade-systemd-canary.sh');
const source = fs.readFileSync(file, 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}
console.log('Two-node VLESS cascade reboot canary contract test');
const syntax = spawnSync('bash', ['-n'], { input: source.replace(/\r\n/g, '\n'), encoding: 'utf8' });
ok(syntax.status === 0, 'canary has valid Bash syntax');
ok(source.includes('VERSION_ID:-}') && source.includes('== 13'), 'canary is restricted to Debian 13');
ok(source.includes('read -r exit_pass') && source.includes("'--exit-pass-stdin'") === false &&
   source.includes('setup --exit-pass-stdin'), 'Exit password enters through stdin and is never a CLI value');
ok(!/--exit-pass(?:\s|=)/.test(source), 'legacy password argv option is absent');
ok(source.includes('Xray rejected the supplied VLESS client config') &&
   source.includes('.protocol == "vless"') && source.includes('.protocol == "socks"'),
  'prepare validates a real VLESS client with a loopback SOCKS probe');
ok(source.includes('probe_vless_cascade') && source.includes('--socks5-hostname') &&
   source.includes('https://api.ipify.org'), 'prepare and verify send real traffic through the VLESS client');
ok(source.includes('Xray owner rule is missing') && source.includes('Exit anti-loop rule is missing'),
  'health gate requires scoped Xray REDSOCKS routing and anti-loop bypass');
ok(source.includes('/proc/sys/kernel/random/boot_id') && source.includes('has not rebooted since prepare'),
  'verify requires evidence of a real Entry reboot');
ok(source.includes('.verifiedAfterReboot == true') && source.includes('run verify after reboot before cleanup'),
  'cleanup is refused until the post-reboot probe succeeds');
ok(source.includes('assert_core_unchanged') && /CORE_SERVICES=.*caddy-naive.*mita.*hysteria-server.*xray.*pm2-root/.test(source),
  'every phase protects the primary stack service state');
ok(source.includes('bash "$CASCADE" teardown') && source.includes('REDSOCKS chain remains after teardown'),
  'cleanup exercises and verifies production cascade teardown');
ok(!/^\s*(?:sudo\s+)?(?:reboot|shutdown)\b|^\s*systemctl\s+reboot\b/m.test(source),
  'canary never reboots Entry automatically');
ok(!/exit_pass.*(?:jq|STATE)|(?:jq|STATE).*exit_pass/.test(source), 'canary state never persists the Exit password');
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
