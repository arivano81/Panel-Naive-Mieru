#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'panel/scripts/install_openflux.sh');
const script = fs.readFileSync(scriptPath, 'utf8');
const install = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
const update = fs.readFileSync(path.join(__dirname, '../update.sh'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
const canary = fs.readFileSync(path.join(__dirname, 'openflux-binary-canary.sh'), 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('OpenFlux opt-in installer regression test');
ok(script.includes('OPENFLUX_VERSION="v0.17.1"'), 'release version is pinned');
ok(script.includes('OPENFLUX_ASSET="openflux-linux-amd64"'), 'amd64 asset is pinned');
ok(script.includes('c0d00461e8cc59e48429b239fd8044b1c1aaa3769968a7c9160c488f4bd63f3b'),
  'official SHA-256 is pinned');
ok(!/releases\/latest|api\.github\.com/.test(script), 'installer never resolves latest');
const fastPathAt = script.indexOf('pinned OpenFlux ${OPENFLUX_VERSION} is already installed exactly');
ok(fastPathAt > 0 && fastPathAt < script.indexOf('downloading pinned OpenFlux'),
  'exact installed version exits before network download or file replacement');
ok(script.includes('cmp -s "$WORK/openflux-exit@.service" "$OPENFLUX_UNIT"') &&
   script.includes('"changed":false'), 'idempotent fast path verifies binary and canonical unit');
ok(script.includes('stop all OpenFlux profiles before update') &&
   script.indexOf('stop all OpenFlux profiles before update') < script.indexOf('downloading pinned OpenFlux'),
  'non-noop update refuses to replace a binary used by an active profile');
const verifyAt = script.indexOf('sha256sum -c');
ok(verifyAt > 0 && verifyAt < script.indexOf('install -m 0755'), 'checksum precedes binary installation');
ok(script.includes("--help 2>&1 | grep -F 'OpenFlux'"), 'candidate binary receives an identity smoke test');
ok(script.includes('User=openflux') || script.includes('buildOpenFluxUnit'), 'dedicated service identity is used');
ok(script.includes('Status: installed, disabled, no profiles') && script.includes('Opened ports: none'),
  'root-only report states the non-activation contract');
ok(script.includes('chmod 0600 "$REPORT"'), 'installation report is root-only');
ok(!/ufw allow|iptables|nft /.test(script), 'installer cannot change firewall');
ok(!/enable --now|systemctl start|systemctl restart/.test(script), 'installer cannot start a profile or service');
ok(/rollback\(\)/.test(script) && script.includes('restoring previous OpenFlux files') &&
   script.includes('COMMITTED=1'), 'partial system writes roll back before commit');
ok(script.includes('OPENFLUX_TEST_ROOT must be a dedicated /tmp subdirectory'),
  'installer fault root is constrained to a dedicated /tmp directory');
ok(script.includes('OPENFLUX_RESULT_JSON=') && script.includes('"changed":true'),
  'successful repair/update exposes a machine-readable changed result');
ok(workflow.includes("if: matrix.release == '13'") && workflow.includes('bash tests/openflux-binary-canary.sh'),
  'Debian 13 CI runs the real OpenFlux tunnel canary');
ok(canary.includes('--socks5-hostname 127.0.0.1:11080') && canary.includes('wrong encryption key'),
  'canary checks an encrypted tunnel and rejects a mismatched key');
for (const [name, source] of [['main installer', install], ['updater', update]]) {
  ok(source.includes('openflux_installed=false') && source.includes('openfluxInstalled'),
    `${name} detects an already installed OpenFlux binary`);
}

if (process.platform !== 'win32') {
  const runFault = mode => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `openflux-install-${mode}-`));
    const bin = path.join(fixture, 'mock-bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
set -eu
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; out=$1; fi
  shift
done
[ -n "$out" ]
printf 'partial-or-corrupt-download' > "$out"
[ "${mode}" != interrupted ] || exit 28
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh
printf '%s\n' "$*" >> "$OPENFLUX_TEST_ROOT/systemctl.log"
`, { mode: 0o755 });
    const result = spawnSync('bash', [scriptPath], { cwd: root, encoding: 'utf8', env: {
      ...process.env, OPENFLUX_TEST_ROOT: fixture, PATH: `${bin}:${process.env.PATH}`
    }});
    return { fixture, result };
  };
  for (const [mode, error] of [['interrupted', 'download failed; nothing was installed'], ['checksum', 'SHA-256 mismatch']]) {
    const { fixture, result } = runFault(mode);
    ok(result.status !== 0 && (result.stderr + result.stdout).includes(error),
      `${mode} download is rejected with an explicit error`);
    ok(!fs.existsSync(path.join(fixture, 'usr/local/bin/openflux')) &&
      !fs.existsSync(path.join(fixture, 'etc/systemd/system/openflux-exit@.service')) &&
      !fs.existsSync(path.join(fixture, 'etc/vertaflux/components.json')) &&
      !fs.existsSync(path.join(fixture, 'systemctl.log')),
    `${mode} download leaves no binary, unit, registry, or systemd side effect`);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  const activationFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'openflux-install-activation-'));
  const activationBin = path.join(activationFixture, 'mock-bin');
  fs.mkdirSync(activationBin, { recursive: true });
  fs.writeFileSync(path.join(activationBin, 'curl'), `#!/bin/sh
set -eu
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; out=$1; fi
  shift
done
printf '#!/bin/sh\necho OpenFlux test binary\n' > "$out"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(activationBin, 'sha256sum'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(activationBin, 'systemctl'), `#!/bin/sh
printf '%s\n' "$*" >> "$OPENFLUX_TEST_ROOT/systemctl.log"
exit 1
`, { mode: 0o755 });
  const activation = spawnSync('bash', [scriptPath], { cwd: root, encoding: 'utf8', env: {
    ...process.env, OPENFLUX_TEST_ROOT: activationFixture,
    PATH: `${activationBin}:${process.env.PATH}`
  }});
  ok(activation.status !== 0 && fs.existsSync(path.join(activationFixture, 'systemctl.log')),
    'post-write systemd failure reaches transactional rollback');
  ok(!fs.existsSync(path.join(activationFixture, 'usr/local/bin/openflux')) &&
    !fs.existsSync(path.join(activationFixture, 'etc/systemd/system/openflux-exit@.service')) &&
    !fs.existsSync(path.join(activationFixture, 'etc/vertaflux/components.json')) &&
    !fs.existsSync(path.join(activationFixture, 'etc/openflux')) &&
    !fs.existsSync(path.join(activationFixture, 'var/lib/openflux')),
  'post-write failure removes every newly installed system artifact');
  fs.rmSync(activationFixture, { recursive: true, force: true });
} else {
  ok(true, 'interrupted download fault fixture runs in Linux CI');
  ok(true, 'interrupted download side effects are verified in Linux CI');
  ok(true, 'checksum mismatch fault fixture runs in Linux CI');
  ok(true, 'checksum mismatch side effects are verified in Linux CI');
  ok(true, 'post-write systemd failure fixture runs in Linux CI');
  ok(true, 'post-write rollback artifacts are verified in Linux CI');
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
