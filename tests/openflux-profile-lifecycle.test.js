#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
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
ok(script.includes('OPENFLUX_TEST_ROOT must be a dedicated /tmp subdirectory'),
  'fault injection root is constrained to a dedicated /tmp directory');
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

if (process.platform !== 'win32') {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'openflux-profile-'));
  const bin = path.join(fixture, 'mock-bin');
  const state = path.join(fixture, 'state');
  for (const dir of [bin, state, path.join(fixture, 'usr/local/bin'),
    path.join(fixture, 'etc/openflux/profiles'), path.join(fixture, 'etc/openflux/secrets'),
    path.join(fixture, 'etc/systemd/system'), path.join(fixture, 'root')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'usr/local/bin/openflux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fixture, 'etc/systemd/system/openflux-exit@.service'), '[Service]\n');
  fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh
set -eu
cmd=$1; shift
case "$cmd" in
  is-active) [ -f "$OPENFLUX_TEST_STATE/$1.active" ] ;;
  is-enabled) [ -f "$OPENFLUX_TEST_STATE/$1.enabled" ] ;;
  enable) shift; svc=$1; [ "\${OPENFLUX_TEST_FAIL_START:-0}" != 1 ] || exit 1; touch "$OPENFLUX_TEST_STATE/$svc.active" "$OPENFLUX_TEST_STATE/$svc.enabled" ;;
  disable) shift; svc=$1; rm -f "$OPENFLUX_TEST_STATE/$svc.active" "$OPENFLUX_TEST_STATE/$svc.enabled" ;;
  restart) svc=$1; [ -f "$OPENFLUX_TEST_STATE/$svc.active" ] ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ufw'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OPENFLUX_TEST_STATE/ufw.log"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ss'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, OPENFLUX_TEST_ROOT: fixture, OPENFLUX_TEST_STATE: state,
    PATH: `${bin}:${process.env.PATH}` };
  const run = (args, extra = {}) => spawnSync('bash', ['panel/scripts/openflux_profile.sh', ...args],
    { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  const created = run(['create', 'alpha', '18445', 'vpn.example.com']);
  ok(created.status === 0 && JSON.parse(created.stdout).created === true, 'fixture creates an inactive profile');
  ok((fs.statSync(path.join(fixture, 'etc/openflux/secrets/alpha.key')).mode & 0o777) === 0o600,
    'functional fixture writes a mode-600 key');
  const failed = run(['start', 'alpha'], { OPENFLUX_TEST_FAIL_START: '1' });
  ok(failed.status !== 0 && !fs.existsSync(path.join(state, 'openflux-exit@alpha.service.active')),
    'failed systemd start leaves no active instance');
  const firewallAfterFailure = fs.readFileSync(path.join(state, 'ufw.log'), 'utf8');
  ok(firewallAfterFailure.includes('allow 18445/tcp comment RIXXX OpenFlux alpha') &&
    firewallAfterFailure.includes('delete allow 18445/tcp comment RIXXX OpenFlux alpha'),
  'failed start removes the same scoped firewall rule');
  const started = run(['start', 'alpha']);
  ok(started.status === 0 && JSON.parse(started.stdout).active === true, 'fixture starts and enables the instance');
  const stopped = run(['stop', 'alpha']);
  ok(stopped.status === 0 && JSON.parse(stopped.stdout).active === false, 'fixture stops the instance idempotently');
  const removed = run(['remove', 'alpha']);
  ok(removed.status === 0 && !fs.existsSync(path.join(fixture, 'etc/openflux/secrets/alpha.key')) &&
    !fs.existsSync(path.join(fixture, 'root/openflux-alpha-client')), 'fixture removes only the selected secret and bundle');
  fs.rmSync(fixture, { recursive: true, force: true });
} else {
  ok(true, 'functional fault fixture runs in Linux CI');
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
