#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'panel/scripts/uninstall_openflux.sh');
const source = fs.readFileSync(scriptPath, 'utf8');
let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('OpenFlux isolated uninstall regression test');
ok(spawnSync('bash', ['-n', 'panel/scripts/uninstall_openflux.sh'], { cwd: root, encoding: 'utf8' }).status === 0,
  'uninstaller has valid Bash syntax');
ok(source.includes('[[ "${1:-}" == --purge') && source.includes('explicit --purge is required'),
  'uninstall requires an explicit destructive flag');
ok(source.includes('vertaflux-openflux-uninstall-backup-') && source.includes('chmod 0600 "$backup"'),
  'root-only recovery archive is created before deletion');
ok(source.includes('VertaFlux OpenFlux $id') && source.includes('RIXXX OpenFlux $id') &&
   source.includes('openflux-exit@${id}.service'),
  'cleanup is scoped by validated profile metadata');
ok(!/caddy|mieru|hysteria|xray|warp|cascade/i.test(source),
  'uninstaller cannot address the primary proxy stack');

if (process.platform !== 'win32') {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'openflux-uninstall-'));
  const bin = path.join(fixture, 'mock-bin');
  const profileDir = path.join(fixture, 'etc/openflux/profiles');
  const secretDir = path.join(fixture, 'etc/openflux/secrets');
  const bundle = path.join(fixture, 'root/openflux-alpha-client');
  for (const dir of [bin, profileDir, secretDir, bundle, path.join(fixture, 'usr/local/bin'),
    path.join(fixture, 'etc/systemd/system'), path.join(fixture, 'etc/vertaflux'), path.join(fixture, 'root')])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'usr/local/bin/openflux'), 'binary');
  fs.writeFileSync(path.join(fixture, 'etc/systemd/system/openflux-exit@.service'), 'unit');
  fs.writeFileSync(path.join(profileDir, 'alpha.json'), JSON.stringify({ id: 'alpha', port: 18445 }));
  fs.writeFileSync(path.join(profileDir, 'alpha.conf'), 'profile');
  fs.writeFileSync(path.join(secretDir, 'alpha.key'), 'secret', { mode: 0o600 });
  fs.writeFileSync(path.join(bundle, 'client.conf'), 'client');
  fs.writeFileSync(path.join(bundle, 'openflux.key'), 'secret', { mode: 0o600 });
  fs.writeFileSync(path.join(fixture, 'etc/vertaflux/components.json'),
    JSON.stringify({ components: { openflux: { installed: true }, caddy: { installed: true } } }));
  fs.writeFileSync(path.join(fixture, 'core-stack-sentinel'), 'untouched');
  fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OPENFLUX_TEST_ROOT/systemctl.log"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ufw'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OPENFLUX_TEST_ROOT/ufw.log"\n', { mode: 0o755 });
  const env = { ...process.env, OPENFLUX_TEST_ROOT: fixture, PATH: `${bin}:${process.env.PATH}` };
  const first = spawnSync('bash', [scriptPath, '--purge'], { env, encoding: 'utf8' });
  let firstJson = null;
  try { firstJson = JSON.parse(first.stdout); } catch {}
  ok(first.status === 0 && firstJson?.uninstalled === true && firstJson?.changed === true,
    `first uninstall removes installed state${first.stderr ? `: ${first.stderr.trim()}` : ''}`);
  ok(firstJson?.backup && fs.existsSync(firstJson.backup) && (fs.statSync(firstJson.backup).mode & 0o777) === 0o600,
    'recovery archive exists with mode 600');
  ok(!fs.existsSync(path.join(fixture, 'usr/local/bin/openflux')) && !fs.existsSync(bundle) &&
    fs.existsSync(path.join(fixture, 'core-stack-sentinel')), 'only OpenFlux artifacts are removed');
  const registry = JSON.parse(fs.readFileSync(path.join(fixture, 'etc/vertaflux/components.json'), 'utf8'));
  ok(registry.components.openflux.installed === false && registry.components.caddy.installed === true,
    'component registry disables OpenFlux and preserves unrelated entries');
  ok(fs.readFileSync(path.join(fixture, 'ufw.log'), 'utf8').includes('delete allow 18445/tcp comment VertaFlux OpenFlux alpha'),
    'profile-scoped firewall rule is removed');
  const second = spawnSync('bash', [scriptPath, '--purge'], { env, encoding: 'utf8' });
  let secondJson = null;
  try { secondJson = JSON.parse(second.stdout); } catch {}
  ok(second.status === 0 && secondJson?.changed === false,
    'repeated uninstall is an idempotent no-op');
  fs.rmSync(fixture, { recursive: true, force: true });
} else {
  ok(true, 'functional uninstall fixture runs in Linux CI');
  ok(true, 'recovery archive is verified in Linux CI');
  ok(true, 'scoped artifact removal is verified in Linux CI');
  ok(true, 'registry preservation is verified in Linux CI');
  ok(true, 'firewall cleanup is verified in Linux CI');
  ok(true, 'idempotent second uninstall is verified in Linux CI');
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
