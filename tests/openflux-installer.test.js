#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../panel/scripts/install_openflux.sh'), 'utf8');
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
ok(script.includes('OPENFLUX_VERSION="0.0.5"'), 'release version is pinned');
ok(script.includes('OPENFLUX_ASSET="openflux-linux-amd64"'), 'amd64 asset is pinned');
ok(script.includes('8211dd5343dd4eac49fcd2838ffcb9e1912c14a0e878c735395967999b0573c5'),
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

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
