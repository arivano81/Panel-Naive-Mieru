#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
let pass = 0, fail = 0;
const ok = (value, message) => {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
};
const cascadePath = path.join(__dirname, '../panel/scripts/cascade_mieru.sh');
const warpPath = path.join(__dirname, '../panel/scripts/warp_egress.sh');
const cascade = fs.readFileSync(cascadePath, 'utf8');
const warp = fs.readFileSync(warpPath, 'utf8');

console.log('VLESS egress routing regression test');
for (const file of [cascadePath, warpPath]) {
  // Feed normalized source on stdin: Windows worktrees may expose CRLF and a
  // WSL bash cannot resolve a native C:\\ path, while CI checks the same bytes.
  const input = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const result = cp.spawnSync('bash', ['-n'], { input, encoding: 'utf8' });
  ok(result.status === 0, `${path.basename(file)} has valid Bash syntax`);
}
ok(/xray_uid\(\)/.test(cascade) && /id -u xray/.test(cascade),
  'cascade resolves the dedicated Xray service uid');
ok(/-A OUTPUT -p tcp -m owner --uid-owner "\$xuid" -j REDSOCKS/.test(cascade),
  'cascade redirects Xray-owned TCP upstream dials');
ok(/-d "\$\{exit_ip\}\/32" -j RETURN/.test(cascade),
  'cascade keeps the shared Exit address anti-loop bypass');
ok(/-D OUTPUT -p tcp -m owner --uid-owner "\$xuid" -j REDSOCKS/.test(cascade),
  'cascade teardown removes the Xray owner rule');
ok(/-A PREROUTING ! -i "\$dev" -p tcp .*--set-mark "\$MARK_CONN"/.test(warp),
  'WARP marks inbound VLESS TCP connections for native replies');
ok(/-A OUTPUT -p tcp -j CONNMARK --restore-mark/.test(warp),
  'WARP restores the inbound mark on Xray replies');
ok(/not fwmark "\$WG_FWMARK" lookup "\$RT_TABLE"/.test(warp),
  'unmarked Xray upstream traffic follows the WARP table');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
