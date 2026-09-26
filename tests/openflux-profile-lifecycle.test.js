#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const scriptPath = path.join(__dirname, '../panel/scripts/openflux_profile.sh');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(scriptPath, 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('OpenFlux profile lifecycle regression test');
const syntax = spawnSync('bash', ['-n', 'panel/scripts/openflux_profile.sh'], { cwd: root, encoding: 'utf8' });
ok(syntax.status === 0, `profile CLI has valid Bash syntax${syntax.stderr ? `: ${syntax.stderr}` : ''}`);
for (const action of ['create', 'start', 'stop', 'restart', 'status', 'remove']) {
  ok(new RegExp(`\\b${action}\\)`).test(script), `${action} command is explicitly dispatched`);
}
ok(script.includes('flock -n 9'), 'profile mutations are serialized');
ok(/create_profile\(\) \(/.test(script) && script.includes("status != 0 || committed == 0"),
  'create runs in a subshell with EXIT rollback for partial files');
ok(script.includes('openssl rand -base64 48') && script.includes('-m 0600'),
  'each profile gets a strong, mode-600 key');
ok(script.includes('buildOpenFluxExitConfig') && script.includes('buildOpenFluxClientConfig'),
  'server and client configs use the validated adapter');
ok(script.includes('port_is_busy "$port"') && script.includes('select(.port == $port)'),
  'live and assigned port collisions are rejected');
ok(script.includes('systemctl enable --now "$service"') && script.includes('systemctl is-active --quiet "$service"'),
  'start enables reboot persistence and checks service health');
ok(script.includes('profile failed its systemd health check; activation rolled back') &&
   script.includes('firewall_remove "$id" "$port"'), 'failed start rolls service and firewall back');
ok(script.includes("RIXXX OpenFlux %s") &&
   script.includes('ufw --force delete allow "$port/tcp" comment "$comment"'),
  'firewall rule is scoped by profile marker');
ok(script.includes("find \"$bundle\" -maxdepth 1 -type f -delete") &&
   script.includes('rm -f -- "$(profile_config "$id")"'), 'remove deletes only the selected profile and its bundle');
ok(!/caddy|mieru|hysteria|xray|warp|cascade/i.test(script), 'lifecycle script cannot address the primary stack');
ok(!/eval|bash -c|sh -c/.test(script), 'validated arguments are never re-evaluated by a shell');
ok(script.includes('clientBundle:$bundle') && !script.includes('cat "$secret"'),
  'secret is returned only through a root-only client bundle');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
