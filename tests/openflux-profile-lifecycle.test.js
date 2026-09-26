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
for (const action of ['list', 'create', 'start', 'stop', 'restart', 'reset', 'rotate', 'status', 'remove']) {
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
ok(script.includes('listening:$listening,healthy:$healthy') &&
   script.includes('[[ "$active" == true && "$listening" == true ]]'),
  'status requires both an active unit and its assigned listening socket');
ok(script.includes('timeout --signal=TERM --kill-after=5s "$limit" systemctl "$@"') &&
   script.includes('svcctl enable --now "$service"') && script.includes('svcctl is-active --quiet "$service"'),
  'service control is bounded and start verifies systemd health');
ok(script.includes('validate_profile_config "$id"') && script.includes('cmp -s "$expected" "$config"'),
  'service activation rejects a config that differs from validated metadata');
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
  is-active) [ "\${1:-}" != --quiet ] || shift; [ -f "$OPENFLUX_TEST_STATE/$1.active" ] ;;
  is-enabled) [ "\${1:-}" != --quiet ] || shift; [ -f "$OPENFLUX_TEST_STATE/$1.enabled" ] ;;
  enable) shift; svc=$1; [ "\${OPENFLUX_TEST_HANG_START:-0}" != 1 ] || { sleep 5; exit 1; }
    [ "\${OPENFLUX_TEST_FAIL_START:-0}" != 1 ] || exit 1
    id=\${svc#openflux-exit@}; id=\${id%.service}
    port=$(jq -er '.port' "$OPENFLUX_TEST_ROOT/etc/openflux/profiles/$id.json")
    touch "$OPENFLUX_TEST_STATE/$svc.active" "$OPENFLUX_TEST_STATE/$svc.enabled" "$OPENFLUX_TEST_STATE/listen.$port" ;;
  disable) shift; svc=$1; id=\${svc#openflux-exit@}; id=\${id%.service}
    port=$(jq -r '.port // empty' "$OPENFLUX_TEST_ROOT/etc/openflux/profiles/$id.json" 2>/dev/null || true)
    rm -f "$OPENFLUX_TEST_STATE/$svc.active" "$OPENFLUX_TEST_STATE/$svc.enabled"
    [ -z "$port" ] || rm -f "$OPENFLUX_TEST_STATE/listen.$port" ;;
  restart) svc=$1; [ "\${OPENFLUX_TEST_FAIL_RESTART:-0}" != 1 ] && [ -f "$OPENFLUX_TEST_STATE/$svc.active" ] ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ufw'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OPENFLUX_TEST_STATE/ufw.log"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ss'), `#!/bin/sh
set -eu
[ "\${OPENFLUX_TEST_NO_LISTENER:-0}" != 1 ] || exit 1
port=$(printf '%s' "$*" | sed -n 's/.*:\\([0-9][0-9]*\\).*/\\1/p')
[ -n "$port" ] && [ -f "$OPENFLUX_TEST_STATE/listen.$port" ] || exit 1
echo "LISTEN 0 4096 0.0.0.0:$port 0.0.0.0:*"
`, { mode: 0o755 });
  const env = { ...process.env, OPENFLUX_TEST_ROOT: fixture, OPENFLUX_TEST_STATE: state,
    PATH: `${bin}:${process.env.PATH}` };
  const run = (args, extra = {}) => spawnSync('bash', ['panel/scripts/openflux_profile.sh', ...args],
    { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  const created = run(['create', 'alpha', '18445', 'vpn.example.com']);
  let createdJson = null;
  try { createdJson = JSON.parse(created.stdout); } catch {}
  ok(created.status === 0 && createdJson?.created === true,
    `fixture creates an inactive profile${created.stderr ? `: ${created.stderr.trim()}` : ''}`);
  const secretPath = path.join(fixture, 'etc/openflux/secrets/alpha.key');
  ok(fs.existsSync(secretPath) && (fs.statSync(secretPath).mode & 0o777) === 0o600,
    'functional fixture writes a mode-600 key');
  if (!fs.existsSync(secretPath)) {
    fs.rmSync(fixture, { recursive: true, force: true });
    console.log(`\nResult: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  const betaCreated = run(['create', 'beta', '18446', 'vpn.example.com']);
  const betaSecretPath = path.join(fixture, 'etc/openflux/secrets/beta.key');
  ok(betaCreated.status === 0 && fs.existsSync(betaSecretPath) &&
    fs.readFileSync(betaSecretPath, 'utf8') !== fs.readFileSync(secretPath, 'utf8'),
  'two profiles receive independent ports and different keys');
  const listed = run(['list']);
  ok(listed.status === 0 && JSON.parse(listed.stdout)[0]?.id === 'alpha' &&
    !JSON.stringify(JSON.parse(listed.stdout)).includes('EncryptionKey'),
  'list returns profile state without key material');
  const configPath = path.join(fixture, 'etc/openflux/profiles/alpha.conf');
  const originalConfig = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(configPath, 'corrupted = true\n');
  const corrupted = run(['start', 'alpha']);
  ok(corrupted.status !== 0 && corrupted.stderr.includes('config differs from validated metadata') &&
    !fs.existsSync(path.join(state, 'openflux-exit@alpha.service.active')) &&
    !fs.existsSync(path.join(state, 'ufw.log')),
  'corrupted profile config is rejected before systemd or firewall changes');
  fs.writeFileSync(configPath, originalConfig);
  const failed = run(['start', 'alpha'], { OPENFLUX_TEST_FAIL_START: '1' });
  ok(failed.status !== 0 && !fs.existsSync(path.join(state, 'openflux-exit@alpha.service.active')),
    'failed systemd start leaves no active instance');
  const firewallAfterFailure = fs.readFileSync(path.join(state, 'ufw.log'), 'utf8');
  ok(firewallAfterFailure.includes('allow 18445/tcp comment RIXXX OpenFlux alpha') &&
    firewallAfterFailure.includes('delete allow 18445/tcp comment RIXXX OpenFlux alpha'),
  'failed start removes the same scoped firewall rule');
  const hungStartedAt = Date.now();
  const hung = run(['start', 'alpha'], { OPENFLUX_TEST_HANG_START: '1' });
  const hungElapsed = Date.now() - hungStartedAt;
  ok(hung.status !== 0 && hungElapsed < 4000 &&
    !fs.existsSync(path.join(state, 'openflux-exit@alpha.service.active')),
  `hung systemd start is terminated and rolled back in bounded time (${hungElapsed} ms)`);
  const firewallAfterHang = fs.readFileSync(path.join(state, 'ufw.log'), 'utf8');
  ok((firewallAfterHang.match(/allow 18445\/tcp comment RIXXX OpenFlux alpha/g) || []).length ===
    (firewallAfterHang.match(/delete allow 18445\/tcp comment RIXXX OpenFlux alpha/g) || []).length,
  'hung start leaves no unmatched scoped firewall rule');
  const missingListener = run(['start', 'alpha'], { OPENFLUX_TEST_NO_LISTENER: '1' });
  ok(missingListener.status !== 0 &&
    !fs.existsSync(path.join(state, 'openflux-exit@alpha.service.active')),
  'active unit without a listening socket is rolled back');
  const started = run(['start', 'alpha']);
  let startedJson = null;
  try { startedJson = JSON.parse(started.stdout); } catch {}
  ok(started.status === 0 && startedJson?.active === true,
    `fixture starts and enables the instance${started.stderr ? `: ${started.stderr.trim()}` : ''}`);
  const betaStarted = run(['start', 'beta']);
  ok(betaStarted.status === 0 && JSON.parse(betaStarted.stdout).port === 18446,
    'two profiles can listen simultaneously on distinct ports');
  ok(fs.existsSync(path.join(state, 'openflux-exit@alpha.service.enabled')) &&
    fs.existsSync(path.join(state, 'openflux-exit@beta.service.enabled')),
  'both instance units persist as enabled for reboot restoration');
  const reset = run(['reset', 'alpha']);
  ok(reset.status === 0 && JSON.parse(reset.stdout).reset === true && JSON.parse(reset.stdout).listening === true,
    'reset repairs and health-checks the same profile idempotently');
  const oldKey = fs.readFileSync(secretPath, 'utf8');
  const rotated = run(['rotate', 'alpha']);
  const rotatedKey = fs.readFileSync(secretPath, 'utf8');
  ok(rotated.status === 0 && JSON.parse(rotated.stdout).oldClientRevoked === true && rotatedKey !== oldKey,
    'active profile key rotation restarts successfully and revokes the old client');
  ok(fs.readFileSync(path.join(fixture, 'root/openflux-alpha-client/openflux.key'), 'utf8') === rotatedKey,
    'server key and client bundle rotate atomically');
  const failedRotate = run(['rotate', 'alpha'], { OPENFLUX_TEST_FAIL_RESTART: '1' });
  ok(failedRotate.status !== 0 && fs.readFileSync(secretPath, 'utf8') === rotatedKey &&
    fs.readFileSync(path.join(fixture, 'root/openflux-alpha-client/openflux.key'), 'utf8') === rotatedKey,
  'failed active restart restores both previous keys');
  const stopped = run(['stop', 'alpha']);
  ok(stopped.status === 0 && JSON.parse(stopped.stdout).active === false &&
    fs.existsSync(path.join(state, 'openflux-exit@beta.service.active')),
  'stopping one profile leaves the other profile active');
  const removed = run(['remove', 'alpha']);
  ok(removed.status === 0 && !fs.existsSync(path.join(fixture, 'etc/openflux/secrets/alpha.key')) &&
    !fs.existsSync(path.join(fixture, 'root/openflux-alpha-client')), 'fixture removes only the selected secret and bundle');
  const betaRemoved = run(['remove', 'beta']);
  ok(betaRemoved.status === 0 && !fs.existsSync(betaSecretPath), 'second isolated profile removes cleanly');
  fs.rmSync(fixture, { recursive: true, force: true });
} else {
  ok(true, 'functional fault fixture runs in Linux CI');
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
